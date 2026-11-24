/**
 * Build 4 の検証。
 *  1. 声: ウサギローとポコ丸の声質を交換（ウサギローは明るく高い声／ポコ丸は丸みのある男声）＋38本の再生成
 *  2. 声: 同時に2人しゃべらない「掛け合いキュー」（排他＋0.15秒あけ＋連打の間引き）
 *  3. ステージ選択画面: 透明オーバーレイがタップを食べない（Build 3 の実機フリーズの原因）
 *  4. 叩く/逃げるアニメーション（transform と opacity だけ・await しない）
 *  5. ヒントの時間切れ保険（深い盤面で固まらない）
 *  6. 版番号 Build 4
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { STAGES } from "../src/stages.js";
import { DAILY } from "../src/daily.js";
import { Game } from "../src/game.js";
import { makeGeometry, stateFromStage, solveState, playableCells } from "../src/solver.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const json = (p) => JSON.parse(read(p));

/* ---------------- 1. 声質の交換 ---------------- */

test("声: ウサギロー＝明るい女声（Nanami/Ana）・ポコ丸＝丸みのある男声（Keita/Brian）", () => {
  const script = json("tools/voices.json");
  const ja = script.voices.ja;
  const en = script.voices.en;

  assert.equal(ja.usagiro.voice, "ja-JP-NanamiNeural");
  assert.equal(en.usagiro.voice, "en-US-AnaNeural");
  assert.equal(ja.pokomaru.voice, "ja-JP-KeitaNeural");
  assert.equal(en.pokomaru.voice, "en-US-BrianNeural");

  // ウサギローは高め（+28〜+32Hz）・速め（+10〜+12%）
  for (const cfg of [ja.usagiro, en.usagiro]) {
    const pitch = Number(cfg.pitch.replace("Hz", ""));
    const rate = Number(cfg.rate.replace("%", ""));
    assert.ok(pitch >= 28 && pitch <= 32, `pitch ${cfg.pitch}`);
    assert.ok(rate >= 10 && rate <= 12, `rate ${cfg.rate}`);
  }
  // ポコ丸は控えめ（+8Hz / +8%）
  for (const cfg of [ja.pokomaru, en.pokomaru]) {
    assert.equal(cfg.pitch, "+8Hz");
    assert.equal(cfg.rate, "+8%");
  }
});

test("声: ja/en 計38本が assets と www に揃っていて、中身が空でない", () => {
  const script = json("tools/voices.json");
  let count = 0;
  for (const [lang, chars] of Object.entries(script.lines)) {
    for (const [who, lines] of Object.entries(chars)) {
      for (const key of Object.keys(lines)) {
        const rel = path.join("assets", "voices", lang, `${who}-${key}.mp3`);
        for (const base of [ROOT, path.join(ROOT, "www")]) {
          const p = path.join(base, rel);
          assert.ok(fs.existsSync(p), `無い: ${p}`);
          assert.ok(fs.statSync(p).size > 1200, `小さすぎる: ${p}`);
        }
        count += 1;
      }
    }
  }
  assert.equal(count, 38, `声の本数: ${count}`);
});

/* ---------------- 2. 掛け合いキュー（同時再生ゼロ） ---------------- */

test("声: 1本ずつ鳴らすキュー（排他・0.15秒あけ・連打は最新だけ待つ）", () => {
  const audio = read("src/audio.js");
  // 前の声が終わってから次（間隔は 0.15 秒）
  assert.match(audio, /const VOICE_GAP_MS = 150;/);
  // 待機は常に最新の1本（古い待機は間引く）
  assert.match(audio, /pendingVoice = \{ url, who, volume \}/);
  assert.match(audio, /function pumpVoice\(\)/);
  assert.match(audio, /function scheduleNextVoice\(/);
  // 鳴り終わりが報告より長引いたら、実際に終わるまで待つ（重ねない）
  assert.match(audio, /activeVoiceCount\(\) > 0 && Date\.now\(\) - startedAt < length \+ 2500/);
  // stopVoice は再生中・待機中・タイマーを全部捨てる
  const stop = audio.slice(audio.indexOf("export function stopVoice"), audio.indexOf("function duckBgm"));
  assert.match(stop, /pendingVoice = null/);
  assert.match(stop, /clearTimeout\(voiceTimer\)/);
  // 声は playOneVoice を1回だけ通る（2人が同時に鳴る道が無い）
  assert.equal((audio.match(/await nativePlayVoice/g) || []).length, 1);
  assert.equal((audio.match(/await webPlayVoice/g) || []).length, 1);
  // 検査用の状態が見える
  assert.match(audio, /voiceBusy,/);
  assert.match(audio, /voiceQueued: pendingVoice \? 1 : 0/);
});

test("声: ネイティブ（iOS）側でも鳴っている声を全部止めてから鳴らす", () => {
  const swift = read("ios/App/App/AppDelegate.swift");
  const play = swift.slice(swift.indexOf("public func playVoice"), swift.indexOf("public func stopVoice"));
  assert.match(play, /for \(key, playing\) in self\.voicePlayers/);
  assert.match(play, /playing\.stop\(\)/);
  // ファイル読み込みはバックグラウンド（メインスレッドを止めない）
  assert.match(play, /voiceQueue\.async/);
  assert.match(swift, /private let voiceQueue = DispatchQueue\(label:/);
  // AudioSession の起こし直しは 2 秒に1回まで（タップのたびに setActive しない）
  assert.match(swift, /static func activateAudioSession\(force: Bool = false\)/);
  assert.match(swift, /now - lastActivate < 2\.0/);
});

test("声: iOS ブリッジの起こし直しは Web 側でも 1.5 秒に1回まで", () => {
  const audio = read("src/audio.js");
  assert.match(audio, /lastNativeActivateAt/);
  assert.match(audio, /now - lastNativeActivateAt < 1500/);
});

/* ---------------- 3. ステージ選択画面（実機フリーズの原因） ---------------- */

test("選択画面: 画面を移るとオーバーレイ/シート/トーストを必ず閉じる", () => {
  const src = read("src/main.js");
  assert.match(src, /function closeOverlays\(\)/);
  assert.match(src, /ov\.classList\.remove\("show"\)/);
  assert.match(src, /closeAllSheets\(\)/);
  // nav() はどの画面へ移っても閉じる
  const nav = src.slice(src.indexOf("function nav(screen)"), src.indexOf("function openSheet"));
  assert.match(nav, /closeOverlays\(\)/);
  // ステージを移るとき（resetInteraction）もカードを畳む
  const reset = src.slice(src.indexOf("function resetInteraction"), src.indexOf("function later("));
  assert.match(reset, /overlay/);
});

test("選択画面: 非表示の画面は中身ごとタップを受けない（透明オーバーレイ対策）", () => {
  const css = read("styles.css");
  assert.match(css, /\.screen:not\(\.active\),\s*\n\.screen:not\(\.active\) \* \{ pointer-events: none !important; \}/);
  // 下までスクロールできる（flex の縮小を許可・iOS のスクロールを許可）
  const scrollers = css.slice(css.indexOf(".select-scroll, .rules-scroll"), css.indexOf(".diff-group"));
  assert.match(scrollers, /min-height: 0;/);
  assert.match(scrollers, /overflow-y: auto;/);
  assert.match(scrollers, /touch-action: pan-y;/);
  assert.match(scrollers, /-webkit-overflow-scrolling: touch;/);
});

test("選択画面: 見張り番が透明オーバーレイを自己修復する", () => {
  const src = read("src/main.js");
  const watchdog = src.slice(src.indexOf("見張り番"));
  assert.match(watchdog, /app\.screen !== "game"/);
  assert.match(watchdog, /ov\.classList\.remove\("show"\)/);
});

/* ---------------- 4. 叩く/逃げるアニメーション ---------------- */

test("アニメ: ウサギローは約0.52秒かけて振り上げてドン（transform/opacity だけ）", () => {
  const css = read("styles.css");
  const src = read("src/main.js");
  assert.match(css, /\.usagiro\.swing \{ opacity: 1; animation: usaIn \.52s/);
  assert.match(css, /\.usagiro\.swing \.mallet \{ opacity: 1; animation: malletSwing \.52s/);
  // 振り上げ → 振り下ろし のキーフレーム
  const swing = css.slice(css.indexOf("@keyframes malletSwing"), css.indexOf(".usagiro .dust"));
  assert.match(swing, /rotate\(-108deg\)/);
  assert.match(swing, /rotate\(34deg\)/);
  // 衝撃波リング
  assert.match(css, /\.shockwave \{/);
  assert.match(css, /@keyframes shockOut/);
  assert.match(src, /function shockwave\(/);
  // 音・バイブは「当たる瞬間」（約290ms）に合わせる
  assert.match(src, /}, 290\);/);
  // await しない・重い filter を使わない
  assert.ok(!/await usagiroSwing/.test(src));
  assert.ok(!/filter: drop-shadow/.test(css.slice(css.indexOf(".usagiro"), css.indexOf(".tanuki .net"))));
});

test("アニメ: ポコ丸は約0.42秒でビクッ→放物線→着地（回転・伸縮つき）", () => {
  const src = read("src/main.js");
  const hop = src.slice(src.indexOf("function startHop("), src.indexOf("function finishHop()"));
  assert.match(hop, /duration: 420/);
  assert.match(hop, /scale\(\.9,1\.14\)/); // ビクッ
  assert.match(hop, /rotate\(/); // 回転
  assert.match(hop, /scale\(1\.14,\.86\)/); // 着地
  // 音・バイブ・砂煙は投げっぱなし（await しない）
  assert.ok(!/await startHop/.test(src));
  assert.match(hop, /hopAnim = tanuki\.animate\(/);
});

/* ---------------- 5. ヒントの時間切れ保険 ---------------- */

test("ヒント: 探索は時間で打ち切られ、固まらずに手を返す", () => {
  const hard = [...STAGES, ...DAILY].find((s) => s.par >= 7) || STAGES[STAGES.length - 1];
  const geom = makeGeometry(hard.walls);
  const state = stateFromStage(hard);
  const t0 = Date.now();
  const aborted = solveState(state, geom, { limit: 7, budgetMs: 1 });
  const elapsed = Date.now() - t0;
  assert.equal(aborted, null, "時間切れで null にならない");
  assert.ok(elapsed < 400, `打ち切りが遅い: ${elapsed}ms`);

  // 予算なしなら従来どおり解ける
  const full = solveState(state, geom, { limit: hard.par });
  assert.ok(full && full.moves.length > 0);

  // Game.hint() は必ず合法手を返す（近似でもよい）
  const game = new Game(hard);
  const t1 = Date.now();
  const hint = game.hint();
  const hintMs = Date.now() - t1;
  assert.ok(Number.isInteger(hint), "ヒントが返らない");
  assert.ok(playableCells(geom, game.state.pos).includes(hint), "ヒントが違法手");
  assert.ok(hintMs < 1500, `ヒントが遅い: ${hintMs}ms`);
});

/* ---------------- 6. ホームの設定ボタン・版 ---------------- */

test("ホーム: 🌐日本語チップを廃止し、設定を普通のボタンで中央に", () => {
  const html = read("index.html");
  const css = read("styles.css");
  assert.ok(!/id="btn-lang"/.test(html), "言語チップが残っている");
  assert.ok(!/lang-chip/.test(html));
  assert.match(html, /class="btn menu-btn util-btn" id="btn-settings"/);
  assert.match(css, /\.btn\.util-btn \{/);
  // 設定の中に言語の行は残っている
  assert.match(html, /id="row-lang"/);
  // 薄いグレー文字ではない（メニューと同じ濃い色）
  const util = css.slice(css.indexOf(".btn.util-btn"), css.indexOf(".chip {"));
  assert.match(util, /color: var\(--verm-dark\)/);
});

test("版: 1.0.0 系のままビルド番号が上がっている（package.json / index.html / main.js / iOS が一致）", () => {
  const pkg = json("package.json");
  assert.equal(pkg.version, "1.0.0");
  assert.ok(Number.isInteger(pkg.build) && pkg.build >= 5);
  assert.match(pkg.description, /Build \d/);
  assert.match(read("index.html"), new RegExp(`1\\.0\\.0 \\(${pkg.build}\\)`));
  assert.match(read("src/main.js"), new RegExp(`const BUILD = ${pkg.build};`));
  const pbx = read("ios/App/App.xcodeproj/project.pbxproj");
  const values = [...new Set([...pbx.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((m) => m[1]))];
  assert.deepEqual(values, [String(pkg.build)]);
});
