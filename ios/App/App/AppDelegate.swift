import UIKit
import Capacitor
import Foundation
import StoreKit
import AVFoundation
import CoreHaptics

/* Kachi Kachi Catch — iOS アプリの入口（Build 1）
 *
 * `npx cap add ios` が生成する AppDelegate を置き換える。中身は4つ:
 *
 *   1. アプリのデリゲート（テンプレート）
 *   2. KachiBridgeViewController — 実際に動かす Capacitor のビューコントローラ。
 *      StoreKit / Haptics / Audio のプラグインをここでブリッジに渡す
 *   3. StoreKit 2 の PRO プラグイン（jp.signlink.KachiCatch.pro）
 *   4. KachiHapticsPlugin（UIKit の触覚フィードバック）
 *
 * プラグインを `cap sync` の packageClassList に任せず、ここで登録するのは
 * 実行時の NSClassFromString 解決に失敗すると課金画面まで来ても StoreKit に
 * 届かないため。ここでインスタンスを作れば、クラスが無いことはビルドエラーになる。
 */

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        AppDelegate.activateAudioSession()
        return true
    }

    /// WebView とは別にアプリ側の AudioSession を playback で用意しておく。
    /// 電話・Siri・バックグラウンドから戻ると止まっていることがあるので都度起こす。
    /// Build 4: タップのたびに setCategory / setActive を叩くと重いので、
    /// 直近 2 秒以内に起きていれば何もしない（force: true で必ず起こし直す）。
    private static var lastActivate: CFTimeInterval = 0
    static func activateAudioSession(force: Bool = false) {
        let now = CACurrentMediaTime()
        if !force && now - lastActivate < 2.0 { return }
        lastActivate = now
        do {
            let session = AVAudioSession.sharedInstance()
            if session.category != .playback {
                try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
            }
            try session.setActive(true)
        } catch {
            NSLog("Kachi Kachi Catch: AVAudioSession setup failed: \(error)")
        }
    }

    func applicationWillResignActive(_ application: UIApplication) {}

    func applicationDidEnterBackground(_ application: UIApplication) {
        // バックグラウンドでは BGM を止める（Web 側も visibilitychange で停止する）
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // 戻ってきたら必ず AudioSession を起こし直す（WKWebView 側も resume し直す）
        AppDelegate.activateAudioSession(force: true)
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        AppDelegate.activateAudioSession(force: true)
    }

    func applicationWillTerminate(_ application: UIApplication) {}

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }
}

/// このアプリのブリッジ。SceneDelegate が root にする。
/// `capacitorDidLoad()` は WebView が最初のページを読む前に走るので、
/// ここでプラグインを渡せば最初の1回から JS 側が見つけられる。
final class KachiBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(StoreKitPlugin())
        bridge?.registerPluginInstance(KachiHapticsPlugin())
        bridge?.registerPluginInstance(KachiAudioPlugin())
    }

    /// WKWebView は既定で「ユーザー操作が無いと音を鳴らせない」設定になっている。
    /// ゲームの操作音・ボイスはタップの直後に鳴らすので、ここを空にして
    /// タップの合図が途切れても（非同期のあとでも）鳴らせるようにしておく。
    override func viewDidLoad() {
        super.viewDidLoad()
        if let webView = self.webView {
            webView.configuration.mediaTypesRequiringUserActionForPlayback = []
            webView.configuration.allowsInlineMediaPlayback = true
        }
    }
}

/* 音のための小さなブリッジ。
   WKWebView の Web Audio は別プロセスの Audio Session で鳴るため、
   操作のたびにアプリ側のセッションを起こし直して音が戻るようにする。 */
@objc(KachiAudioPlugin)
public class KachiAudioPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "KachiAudioPlugin"
    public let jsName = "KachiAudio"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "activate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "playVoice", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopVoice", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "preloadVoices", returnType: CAPPluginReturnPromise)
    ]

    /* ------------------------------------------------------------------
       ボイス（ウサギロー・ポコ丸）は AVAudioPlayer で直接鳴らす。

       WKWebView の Web Audio は「ユーザー操作と同じ瞬間」でないと
       AudioContext が起きず、fetch→decodeAudioData をはさむと
       実機 iPhone では声が出ないことがあった。
       AVAudioPlayer なら AudioSession を都度起こすだけで必ず鳴り、
       BGM（Web Audio）とは別経路なので声が埋もれない。
       ------------------------------------------------------------------ */
    private var voicePlayers: [String: AVAudioPlayer] = [:] // who -> 再生中
    private var voiceCache: [String: AVAudioPlayer] = [:] // path -> 準備済み
    private var voiceGeneration = 0
    /// ファイル読み込みとキャッシュはこの直列キューだけで触る（メインスレッドを止めない）
    private let voiceQueue = DispatchQueue(label: "jp.signlink.KachiCatch.voices", qos: .userInitiated)

    /// `assets/voices/ja/usagiro-start1.mp3` のような相対パスを実ファイルに解決する
    static func voiceURL(_ relative: String) -> URL? {
        var rel = relative
        if let q = rel.firstIndex(of: "?") { rel = String(rel[..<q]) }
        if let h = rel.firstIndex(of: "#") { rel = String(rel[..<h]) }
        while rel.hasPrefix("/") { rel.removeFirst() }
        guard !rel.isEmpty, !rel.contains("..") else { return nil }
        let base = Bundle.main.bundlePath as NSString
        let candidates = ["public/\(rel)", rel, "www/\(rel)"]
        for candidate in candidates {
            let full = base.appendingPathComponent(candidate)
            if FileManager.default.fileExists(atPath: full) {
                return URL(fileURLWithPath: full)
            }
        }
        return nil
    }

    /// 声を1つ鳴らす。同時に2人の声は鳴らさない（鳴っている声を全部止めてから）。
    /// ファイル読み込み（AVAudioPlayer(contentsOf:)）はバックグラウンドで行う。
    @objc public func playVoice(_ call: CAPPluginCall) {
        let path = call.getString("path") ?? ""
        let who = call.getString("who") ?? "voice"
        let volume = Float(call.getFloat("volume") ?? 1.0)
        guard !path.isEmpty else {
            call.resolve(["ok": false, "reason": "empty path"])
            return
        }
        guard let url = KachiAudioPlugin.voiceURL(path) else {
            call.resolve(["ok": false, "reason": "missing file", "path": path])
            return
        }
        AppDelegate.activateAudioSession()
        voiceQueue.async {
            let prepared: AVAudioPlayer?
            if let cached = self.voiceCache[path] {
                prepared = cached
            } else if let player = try? AVAudioPlayer(contentsOf: url) {
                player.prepareToPlay()
                self.voiceCache[path] = player
                prepared = player
            } else {
                prepared = nil
            }
            DispatchQueue.main.async {
                guard let player = prepared else {
                    call.resolve(["ok": false, "reason": "load failed", "path": path])
                    return
                }
                self.voiceGeneration += 1
                // 排他: どの話者の声も止めてから鳴らす（2人が同時にしゃべらない）
                for (key, playing) in self.voicePlayers {
                    playing.stop()
                    self.voicePlayers.removeValue(forKey: key)
                }
                player.stop()
                player.currentTime = 0
                player.numberOfLoops = 0
                player.volume = max(0, min(1, volume))
                player.prepareToPlay()
                guard player.play() else {
                    call.resolve(["ok": false, "reason": "play returned false"])
                    return
                }
                self.voicePlayers[who] = player
                call.resolve(["ok": true, "duration": Double(player.duration), "path": path])
            }
        }
    }

    /// 声を止める（who を省略すると全部）
    @objc public func stopVoice(_ call: CAPPluginCall) {
        let who = call.getString("who")
        DispatchQueue.main.async {
            for (key, player) in self.voicePlayers {
                if who == nil || who == key {
                    player.stop()
                    self.voicePlayers.removeValue(forKey: key)
                }
            }
            call.resolve(["ok": true])
        }
    }

    /// 声のファイルを先に読み込んでおく（最初のタップから間を空けずに鳴らす）
    @objc public func preloadVoices(_ call: CAPPluginCall) {
        let paths = call.getArray("paths", String.self) ?? []
        // 読み込みはバックグラウンドで（起動直後のメインスレッドを止めない）
        voiceQueue.async {
            var loaded = 0
            for path in paths {
                if self.voiceCache[path] != nil {
                    loaded += 1
                    continue
                }
                guard let url = KachiAudioPlugin.voiceURL(path) else { continue }
                if let player = try? AVAudioPlayer(contentsOf: url) {
                    player.prepareToPlay()
                    self.voiceCache[path] = player
                    loaded += 1
                }
            }
            DispatchQueue.main.async {
                call.resolve(["ok": true, "loaded": loaded])
            }
        }
    }

    override public func load() {
        AppDelegate.activateAudioSession()
        // 電話・Siri・イヤホン差し替え・メディアサービスのリセットから戻ったら起こし直す
        let center = NotificationCenter.default
        center.addObserver(
            self,
            selector: #selector(handleInterruption(_:)),
            name: AVAudioSession.interruptionNotification,
            object: nil
        )
        center.addObserver(
            self,
            selector: #selector(handleMediaReset(_:)),
            name: AVAudioSession.mediaServicesWereResetNotification,
            object: nil
        )
        center.addObserver(
            self,
            selector: #selector(handleRouteChange(_:)),
            name: AVAudioSession.routeChangeNotification,
            object: nil
        )
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    @objc public func activate(_ call: CAPPluginCall) {
        AppDelegate.activateAudioSession()
        let session = AVAudioSession.sharedInstance()
        call.resolve([
            "category": session.category.rawValue,
            "active": session.isOtherAudioPlaying,
            "voices": self.voicePlayers.count
        ])
    }

    /// いまの AudioSession の様子（Web 側の復帰判断に使う）
    @objc public func status(_ call: CAPPluginCall) {
        let session = AVAudioSession.sharedInstance()
        call.resolve([
            "category": session.category.rawValue,
            "otherAudioPlaying": session.isOtherAudioPlaying,
            "outputVolume": Double(session.outputVolume)
        ])
    }

    @objc private func handleInterruption(_ note: Notification) {
        guard
            let info = note.userInfo,
            let raw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
            let type = AVAudioSession.InterruptionType(rawValue: raw)
        else { return }
        if type == .ended {
            AppDelegate.activateAudioSession(force: true)
            notifyListeners("audioResumed", data: ["reason": "interruptionEnded"])
        }
    }

    @objc private func handleMediaReset(_ note: Notification) {
        AppDelegate.activateAudioSession(force: true)
        notifyListeners("audioResumed", data: ["reason": "mediaServicesReset"])
    }

    @objc private func handleRouteChange(_ note: Notification) {
        // イヤホンを抜き差しすると AudioSession が止まることがある
        AppDelegate.activateAudioSession(force: true)
    }
}

/* 触覚フィードバック（バイブ）。
   JS 側は設定が OFF のとき呼ばない。ここは合図どおりに鳴らすだけ。 */
@objc(KachiHapticsPlugin)
public class KachiHapticsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "KachiHapticsPlugin"
    public let jsName = "KachiHaptics"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "impact", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "success", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "warning", returnType: CAPPluginReturnPromise)
    ]

    private var engine: CHHapticEngine?

    private func prepareEngine() {
        guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else { return }
        if engine == nil {
            engine = try? CHHapticEngine()
            engine?.isAutoShutdownEnabled = true
        }
        try? engine?.start()
    }

    @objc public func impact(_ call: CAPPluginCall) {
        let styleName = call.getString("style") ?? "light"
        DispatchQueue.main.async {
            switch styleName {
            case "heavy":
                UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
            case "medium":
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            default:
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
            }
            self.prepareEngine()
            call.resolve(["ok": true, "style": styleName])
        }
    }

    @objc public func success(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            call.resolve(["ok": true])
        }
    }

    @objc public func warning(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            UINotificationFeedbackGenerator().notificationOccurred(.warning)
            call.resolve(["ok": true])
        }
    }
}

/* PRO（jp.signlink.KachiCatch.pro）の StoreKit 2 ブリッジ。
   非消耗型の1アイテム。ここは Apple が返したことだけを返し、
   「遊べるかどうか」の判断は www/src/pro.js が持つ。 */
@objc(StoreKitPlugin)
public class StoreKitPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StoreKitPlugin"
    public let jsName = "StoreKit"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getProducts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "entitlement", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise)
    ]

    static let defaultProductId = "jp.signlink.KachiCatch.pro"

    private var updatesTask: Task<Void, Never>?

    override public func load() {
        guard #available(iOS 15.0, *) else { return }
        updatesTask = Task.detached {
            for await result in Transaction.updates {
                if case .verified(let transaction) = result {
                    await transaction.finish()
                }
            }
        }
    }

    deinit {
        updatesTask?.cancel()
    }

    private func productId(_ call: CAPPluginCall) -> String {
        let value = call.getString("id") ?? StoreKitPlugin.defaultProductId
        return value.isEmpty ? StoreKitPlugin.defaultProductId : value
    }

    private static func reason(_ error: Error) -> String {
        let text = error.localizedDescription.replacingOccurrences(of: "\n", with: " ")
        return text.isEmpty ? "unknown error" : text
    }

    @objc public func getProducts(_ call: CAPPluginCall) {
        guard #available(iOS 15.0, *) else {
            call.reject("SK: needs iOS 15", "SK_IOS", nil)
            return
        }
        let ids = call.getArray("ids", String.self) ?? [StoreKitPlugin.defaultProductId]
        Task {
            do {
                let products = try await Product.products(for: ids)
                let list: [[String: Any]] = products.map { product in
                    [
                        "id": product.id,
                        "displayName": product.displayName,
                        "description": product.description,
                        "displayPrice": product.displayPrice,
                        "price": "\(product.price)",
                        "currencyCode": product.priceFormatStyle.currencyCode
                    ]
                }
                var answer: [String: Any] = ["products": list, "ids": ids]
                if list.isEmpty {
                    answer["diag"] = "SK: empty"
                    answer["message"] = "SK: empty — App Store returned no product for \(ids.joined(separator: ", ")). The product must exist in App Store Connect as 提出準備完了 and the paid apps agreement must be active."
                }
                call.resolve(answer)
            } catch {
                call.reject("SK: \(StoreKitPlugin.reason(error))", "SK_ERROR", error)
            }
        }
    }

    @objc public func entitlement(_ call: CAPPluginCall) {
        guard #available(iOS 15.0, *) else {
            call.resolve(["entitled": false, "diag": "SK: needs iOS 15"])
            return
        }
        let id = productId(call)
        Task {
            let owned = await StoreKitPlugin.owns(id)
            call.resolve(["entitled": owned])
        }
    }

    @objc public func purchase(_ call: CAPPluginCall) {
        guard #available(iOS 15.0, *) else {
            call.reject("SK: needs iOS 15", "SK_IOS", nil)
            return
        }
        let id = productId(call)
        Task { @MainActor in
            do {
                guard let product = try await Product.products(for: [id]).first else {
                    call.reject("SK: empty \(id)", "SK_EMPTY", nil)
                    return
                }
                switch try await product.purchase() {
                case .success(let verification):
                    switch verification {
                    case .verified(let transaction):
                        await transaction.finish()
                        call.resolve([
                            "status": "success",
                            "entitled": true,
                            "transactionId": String(transaction.id)
                        ])
                    case .unverified:
                        call.resolve([
                            "status": "failed",
                            "entitled": false,
                            "reason": "unverified",
                            "diag": "SK: unverified"
                        ])
                    }
                case .pending:
                    call.resolve(["status": "pending", "entitled": false])
                case .userCancelled:
                    call.resolve(["status": "cancelled", "entitled": false])
                @unknown default:
                    call.resolve([
                        "status": "failed",
                        "entitled": false,
                        "reason": "unknown",
                        "diag": "SK: unknown purchase result"
                    ])
                }
            } catch {
                call.reject("SK: \(StoreKitPlugin.reason(error))", "SK_ERROR", error)
            }
        }
    }

    @objc public func restore(_ call: CAPPluginCall) {
        guard #available(iOS 15.0, *) else {
            call.resolve(["entitled": false, "diag": "SK: needs iOS 15"])
            return
        }
        let id = productId(call)
        Task {
            var syncError: String?
            do {
                try await AppStore.sync()
            } catch {
                syncError = "SK: \(StoreKitPlugin.reason(error))"
            }
            let owned = await StoreKitPlugin.owns(id)
            var answer: [String: Any] = ["entitled": owned]
            if let syncError = syncError, !owned {
                answer["diag"] = syncError
            }
            call.resolve(answer)
        }
    }

    /// 検証済みで、取り消されていない購入だけ true
    static func owns(_ productID: String) async -> Bool {
        for await result in Transaction.currentEntitlements {
            guard case .verified(let transaction) = result else { continue }
            if transaction.productID == productID && transaction.revocationDate == nil {
                return true
            }
        }
        return false
    }
}
