# Kachi Kachi Catch（カチカチ キャッチ）

日本昔話「カチカチ山」をモチーフにした、**5×5 の詰みパズル**（年齢制限 4+）。
ウサギの **ウサギロー（Usagiro）** が十字に網を仕掛け、タヌキの **ポコ丸（Pokomaru）** の逃げ場をふさいで捕まえるゲームです。
Capacitor iOS アプリ（Bundle ID `jp.signlink.KachiCatch`）。現在は **Build 2**（フリーズ修正・音の復帰・ボイス・タイムアタック120/180秒・文字サイズ）です。

---

## あそびかた

1. マスを1つタップすると、**そのマス＋上下左右の十字5マス**が反転（安全床 ↔ 罠床）。
2. 手を打つと、ポコ丸は **上下左右＋ななめの8方向** の安全床へ1歩逃げる（その場に留まることも）。
3. ポコ丸の逃げ場をすべて罠か岩でふさいだら **つかまえた！**
4. ステージごとに決められた手数（1手詰・3手詰・5手詰・7手詰）以内に捕まえればクリア。

### ルールの設計メモ（brief からの調整点）

brief のルールをそのまま実装すると、**「ポコ丸のいるマスをタップ＝十字5マスが罠＝1手で必ず詰み」** になり、
3手詰・5手詰・7手詰が原理的に成立しませんでした。そこで次の2点だけ調整しています（画面の「あそびかた」にも明記）。

| 調整 | 理由 |
| --- | --- |
| **ポコ丸のいるマスはタップできない**（素早いタヌキの真下には網を仕掛けられない） | 1手詰の自明な手をなくし、「隣のマスから十字で囲う」という本来のパズルにする |
| **逃げ道を8方向にした**（十字フリップは斜めを塗れない） | 1手詰〜7手詰の階段が自然に成立し、深い問題でも「どんな逃げ方をされても必ず詰む」ゲーム木が閉じる |

この2点により、全問が **AND/OR ゲーム木探索** で「プレイヤーが最善を尽くせば、ポコ丸がどの合法手を選んでも指定手数以内に100%詰む」と証明できます。

---

## 収録内容（Build 2）

| モード | 内容 | 無料 / PRO |
| --- | --- | --- |
| ステージ | 50問（初級1手×10 / 中級3手×15 / 上級5手×15 / 激ムズ7手×10） | 初級10＋中級15＝**25問が無料**、上級15＋激ムズ10の25問は PRO |
| 今日の1問（デイリー） | 120問を同梱し、端末の日付から毎日1問を自動出題 | 当日分は無料、**過去日は PRO** |
| タイムアタック | 1〜3手詰を連続で何問解けるか（**60 / 120 / 180秒**から選択・手数切れで −3秒・ベストは秒ごと） | **PRO** |
| ヒント | ソルバーの最善手を表示 | 無料は1ステージ3回まで、**PRO は無制限** |

PRO は買い切りの非消耗型 **`jp.signlink.KachiCatch.pro`**（StoreKit 2）。

---

## ソルバー（`src/solver.js`）

- 状態＝罠ビットマスク（25bit）＋ポコ丸の位置。AND/OR 探索（反復深化・メモ化）で
  **最短手数** と **全応手に対する詰み** を同時に証明します。
- `solveState(state, geom, {limit})` → `{distance, moves[]}`（`limit` 手以内に必ず詰むか）
- `exactDistance()` → 最短手数ちょうど
- `tanukiReply()` → ポコ丸AI（最も長く生き残る手を選ぶ）
- `principalLine()` / `src/solutions.js` → 全170問の最善手順を事前計算（起動時の計算ゼロ）

### 検証（`npm test`・300テスト）

- ルール（十字5マス・8方向の逃げ道・タップ不可マス）の単体テスト
- ソルバーと**素朴実装（メモ化なしの配列版）**の総当たり照合
- **通常50問**: 最短手数＝par（par−1では詰まない）／初手のあと**ポコ丸の全合法手**が par−1 手以内に詰む
- **デイリー120問**: 全問で最短手数＝par、盤面の使い回しなし、日付→問題の決定性と120日周期
- ゲーム進行（ヒントに従うとちょうど par 手でクリア／外すと失敗／やりなおし）
- 12言語のキー完全一致・キャラ名・言語フォールバック
- 無料/PRO の線引き（25問・タイムアタック・過去デイリー・ヒント回数）
- ボイス（日英の mp3 が全セリフそろう・容量・場面ごとのバリエーション）
- タイムアタックのベストが60/120/180秒で別・古い保存の引き継ぎ・文字サイズの丸め

```
npm install
npm test          # 300 tests
npm run test:e2e  # Playwright（連続ステージ・音の復帰・ボイス・文字サイズ・レイアウト）
npm run serve     # http://127.0.0.1:8123 （ブラウザで試遊）
npm run www       # 配布用 www/ を作る
npm run ios:sync  # capacitor sync ios
```

---

## 画面・演出

- **オープニング** 1.9秒（タップで即スキップ）→ タイトル
- **ポコ丸の逃走**: 放物線のピョン＋着地のつぶれ＋砂埃＋汗リアクション（`hop()`）
- **ウサギローの網**: タップしたマスに0.3秒だけ登場して木槌を「ポンッ」、十字に網が広がる（`usagiroSwing()`）。連打を止めないテンポ
- **捕獲**: ネットが落ちて火花・紙吹雪、クリアカード
- **音**: WebAudio で効果音とループBGMを合成。設定で BGM／効果音／ボイス ON-OFF。**ホーム画面から戻ると必ず鳴る**（suspended→resume、戻らなければ AudioContext を作り直す）
- **ボイス**: ウサギローとポコ丸が場面ごとに声で喋る（日本語・英語の mp3 を `assets/voices/` に同梱、計約170KB）。場面ごとに2〜4パターンをローテーション、連打時は前の声を止める
- **バイブ**: iOS ネイティブ `KachiHapticsPlugin`（UIImpactFeedbackGenerator）。設定で ON-OFF
- **12言語**: 日本語 / English / 简体中文 / 繁體中文 / 한국어 / Español / Français / Deutsch / Português / Italiano / हिन्दी / Bahasa Indonesia（未対応端末は英語）。タイトルと設定の 🌐 から切替。ラベル・あそびかた・PRO案内も12言語
- **文字サイズ**: 設定で 標準 / 大 / 特大（12言語・即時反映・保存）
- **レイアウト**: iPhone 375/393/430・特大文字・iPad（`TARGETED_DEVICE_FAMILY = "1,2"`）で検証済み。ホームはキャラ・ロゴ・ボタンを一回り大きくし、キャラ名ラベル（ウサギロー／ポコ丸）を頭上に配置

---

## 構成

```
index.html / styles.css        UI（1ページ・全画面）
src/solver.js                  ゲームコア＋AND/ORソルバー
src/stages.js                  通常50問（自動生成）
src/daily.js                   デイリー120問（自動生成）
src/solutions.js               全170問の最善手順（自動生成）
src/game.js                    ゲーム進行
src/dailylogic.js              日付→デイリー問題
src/i18n.js                    12言語
src/audio.js                   WebAudio（効果音＋BGM＋ボイス・復帰処理）
src/voices.js                  ボイスの台本（場面×パターン）
src/haptics.js                 バイブ（Capacitor ブリッジ）
src/pro.js                     PRO判定・無料/PROの線引き
src/storage.js                 端末内保存
src/main.js                    UI制御
tools/                         生成・検証・スクリーンショット・アイコン
tools/gen_voices.py            ボイス生成（edge-tts）
tools/voices.json              ボイスの台本（日本語・英語）
tools/e2e-build2.mjs           実ブラウザ検査（Playwright）
ios/                           Capacitor iOS プロジェクト（Xcode）
docs/privacy.md                プライバシーポリシー
docs/ios-testflight-build1.yml TestFlight Build 1 ワークフロー
```

### 問題・素材の生成

```
node tools/gen_pool.mjs 240     # 問題プール（parの厳密判定つき・再開可能）
node tools/gen_content.mjs      # 50問/120問に振り分け＋最善手順の事前計算
python3 tools/extract_sprites.py  # キャラ素材（丸型バッジ・タイトル用）
python3 tools/gen_voices.py       # ボイス（要 pip install edge-tts）
python3 tools/make_icon.py        # アプリアイコン1024・スプラッシュ
```

キャラ画像は `downloads/kachitrap-char-hybrid.png`。白ウサギの産毛がクリーム背景とほぼ同色で
透過切り抜きにすると毛が欠けるため、brief の許容案どおり **丸型バッジ（背景ごと円形に切り出す）** で
盤面・HUD・カードに自然になじませています。

---

## iOS（Build 2）

- Bundle ID: `jp.signlink.KachiCatch` / 表示名: `Kachi Kachi Catch`
- `MARKETING_VERSION = 1.0.0` / `CURRENT_PROJECT_VERSION = 2`（ワークフローが自動で読み取るので貼り替え不要）
- `TARGETED_DEVICE_FAMILY = "1,2"`（iPhone & iPad）
- `AppDelegate.swift`: `StoreKitPlugin`（StoreKit 2・`jp.signlink.KachiCatch.pro`）、`KachiHapticsPlugin`、`KachiAudioPlugin`（割り込み終了・メディアサービスリセット・イヤホン抜き差しで AudioSession を起こし直す）
- アイコン: `assets/kachi-appicon-1024.png` → `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`（1024・RGB・透過なし）
- ワークフロー: `docs/ios-testflight-build1.yml`（`.github/workflows/` にコピーして使用。
  ビルド番号はプロジェクトから自動読み取り、`confirm_bundle_id` と `upload_to_testflight` 付き）

---

## ライセンス

© 2026 Sign Link. All rights reserved. 画像・音・問題はすべて本アプリ用に生成したものです。
