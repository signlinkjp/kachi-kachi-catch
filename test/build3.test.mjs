/**
 * Build 3 の検証。
 *  - 「押せない」を作る入力ロックが残っていないこと（ソースの約束）
 *  - 声が確実に鳴る仕組み（話者べつのチャンネル・先読み・ネイティブ再生・BGM ダッキング）
 *  - ホームの全体像（キャラ・名前ラベル・5×5 タグ）
 *  - 版番号（package.json / index.html / iOS プロジェクト / アプリ内表示）
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { allVoiceUrls, VOICE_SETS, voiceUrl } from "../src/voices.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

test("版: package.json は build 3", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.version, "1.0.0");
  assert.equal(pkg.build, 3);
  assert.match(pkg.description, /Build 3/);
  assert.match(pkg.scripts.test, /test\/build3\.test\.mjs/);
});

test("版: index.html と設定画面が 1.0.0 (3)", () => {
  const html = read("index.html");
  assert.match(html, /Build 3/);
  assert.ok(!/Build 2/.test(html), "index.html に Build 2 の注記が残っている");
  assert.match(html, /1\.0\.0 \(3\)/);
  assert.match(read("src/main.js"), /const BUILD = 3;/);
});

test("版: iOS の CURRENT_PROJECT_VERSION は 3 の1つだけ", () => {
  const pbx = read("ios/App/App.xcodeproj/project.pbxproj");
  const values = [...new Set([...pbx.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((m) => m[1]))];
  assert.deepEqual(values, ["3"], `値: ${values.join(",")}`);
  assert.match(pbx, /MARKETING_VERSION = 1\.0\.0;/);
  assert.match(pbx, /PRODUCT_BUNDLE_IDENTIFIER = jp\.signlink\.KachiCatch;/);
});

/* ---------------- 入力（フリーズしない設計） ---------------- */

test("入力: タップを止めるロック（app.busy）が残っていない", () => {
  const src = read("src/main.js");
  assert.ok(!/app\.busy/.test(src), "app.busy（タップのロック）が残っている");
  assert.ok(!/TAP_LOCK_MS/.test(src), "古いロックの解除処理が残っている");
  assert.ok(!/await hop\(/.test(src), "アニメーションを await している");
  assert.ok(!/await flipAnimation/.test(src), "反転アニメーションを await している");
});

test("入力: タップは pointerdown / pointerup / click / pointercancel の4経路", () => {
  const src = read("src/main.js");
  for (const ev of ["pointerdown", "pointerup", "click", "pointercancel"]) {
    assert.ok(src.includes(`addEventListener("${ev}"`), `${ev} を拾っていない`);
  }
  // 押した瞬間に1手（pointerup を待たない）
  const down = src.slice(src.indexOf('addEventListener("pointerdown"'), src.indexOf('addEventListener("pointerup"'));
  assert.ok(/tapCell\(/.test(down), "pointerdown で1手進めていない");
});

test("入力: 局面はタップと同時に確定する（tapCell が async でない）", () => {
  const src = read("src/main.js");
  assert.ok(/function tapCell\(i\) \{/.test(src), "tapCell が同期関数ではない");
  assert.ok(!/async function tapCell/.test(src));
  // ステージ世代（epoch）で古い処理を捨てる
  assert.ok(/if \(epoch !== app\.epoch/.test(src), "世代チェックが無い");
});

test("入力: マスの位置はキャッシュして測り直す（毎タップで全マスを測らない）", () => {
  const src = read("src/main.js");
  assert.ok(/function measureCells\(\)/.test(src));
  assert.ok(/function boardGeometry\(\)/.test(src));
  assert.ok(/function refreshBoardLayout\(\)/.test(src));
});

test("入力: 見張り番（固まった見た目を戻す）と復帰の後始末がある", () => {
  const src = read("src/main.js");
  assert.ok(/setInterval\(/.test(src), "見張り番が無い");
  assert.ok(/visibilitychange/.test(src));
});

/* ---------------- 音・声 ---------------- */

test("声: 言語ごとのファイルを全部そろえて先読みできる", () => {
  const ja = allVoiceUrls("ja");
  const en = allVoiceUrls("en");
  assert.equal(ja.length, 19);
  assert.equal(en.length, 19);
  assert.equal(new Set(ja).size, 19);
  // ほかの言語は英語の声
  assert.deepEqual(allVoiceUrls("ko"), en);
  for (const url of ja.concat(en)) {
    assert.ok(fs.existsSync(path.join(ROOT, url)), `無い: ${url}`);
    assert.ok(fs.existsSync(path.join(ROOT, "www", url)), `www に無い: ${url}`);
  }
});

test("声: 場面（開始・罠・ピンチ・クリア・失敗）に声が割り当てられている", () => {
  assert.ok(VOICE_SETS.usagiro.start.length >= 1);
  assert.ok(VOICE_SETS.usagiro.tap.length >= 1);
  assert.ok(VOICE_SETS.usagiro.clear.length >= 1);
  assert.ok(VOICE_SETS.usagiro.fail.length >= 1);
  assert.ok(VOICE_SETS.pokomaru.taunt.length >= 1);
  assert.ok(VOICE_SETS.pokomaru.panic.length >= 1);
  assert.ok(VOICE_SETS.pokomaru.caught.length >= 1);
  assert.ok(VOICE_SETS.pokomaru.escape.length >= 1);
  assert.match(voiceUrl("ko", "usagiro", "start1"), /assets\/voices\/en\/usagiro-start1\.mp3$/);
});

test("声: 話者べつのチャンネル・BGM ダッキング・先読み・ネイティブ再生", () => {
  const audio = read("src/audio.js");
  // 話者べつ（同じ話者だけ差し替える）
  assert.ok(/export function stopVoice\(who\)/.test(audio));
  assert.ok(/voiceNodes/.test(audio) && /voiceAudios/.test(audio));
  assert.ok(/opts\.who/.test(audio), "playClip が話者を受け取っていない");
  // BGM を下げる
  assert.ok(/function duckBgm/.test(audio));
  assert.ok(/gainFor\("bgm"\) \* 0\.28/.test(audio));
  // 先読み
  assert.ok(/export function preloadVoices/.test(audio));
  // ネイティブ優先
  assert.ok(/nativePlayVoice/.test(audio));
  assert.ok(/Plugins\.KachiAudio/.test(audio));
  // 例外を投げない
  assert.ok(!/throw new Error/.test(audio.split("/* ---------------- ボイス")[1] || ""), "ボイス側で例外を投げている");
});

test("声: iOS 側に AVAudioPlayer の再生・停止・先読みがある", () => {
  const swift = read("ios/App/App/AppDelegate.swift");
  assert.match(swift, /AVAudioPlayer/);
  assert.match(swift, /name: "playVoice"/);
  assert.match(swift, /name: "stopVoice"/);
  assert.match(swift, /name: "preloadVoices"/);
  assert.match(swift, /mediaTypesRequiringUserActionForPlayback = \[\]/);
  assert.match(swift, /public\/\\\(rel\)/, "バンドル内の public/ を見ていない");
});

test("声: タップの声は間引いて語尾を切らない／ポコ丸の声とはぶつけない", () => {
  const src = read("src/main.js");
  assert.match(src, /speak\("usagiro", "tap", \{ throttle: \d+ \}\)/);
  assert.match(src, /speak\("usagiro", "start", \{ delay: \d+ \}\)/);
  assert.match(src, /tanukiSpeak\("caught", "happy", \{ delay: \d+ \}\)/);
  // stopVoice はステージを移るとき（resetInteraction）だけ
  assert.match(src, /function resetInteraction\(\)[\s\S]{0,400}stopVoice\(\)/);
});

/* ---------------- ホームの見た目 ---------------- */

test("ホーム: キャラの全体像を置く入れ物と layoutHero がある", () => {
  const html = read("index.html");
  const css = read("styles.css");
  const src = read("src/main.js");
  assert.match(html, /id="hero-stage"/);
  assert.match(html, /class="hero-img"/);
  assert.match(src, /function layoutHero\(\)/);
  assert.match(src, /const HERO_RATIO = 1400 \/ 840/);
  // 148% 拡大（見切れの原因）が消えている
  assert.ok(!/148%/.test(css), "styles.css に 148% 拡大が残っている");
  // マスクで端を切らない
  assert.ok(!/mask-image: radial-gradient\(ellipse/.test(css), "キャラを切るマスクが残っている");
});

test("ホーム: 名前ラベルは白縁のポップ文字＋左右に3本の飾り線", () => {
  const html = read("index.html");
  const css = read("styles.css");
  assert.equal((html.match(/class="name-line/g) || []).length, 4, "名前ラベルの飾り線が4本（2人×左右）でない");
  assert.match(html, /id="label-rabbit"[\s\S]*id="name-rabbit"/);
  assert.match(html, /id="label-tanuki"[\s\S]*id="name-tanuki"/);
  assert.match(css, /-webkit-text-stroke: 4\.5px #fffdf7/);
  assert.match(css, /paint-order: stroke fill/);
  assert.match(css, /\.name-rabbit \{ --deco: #f7bd18; \}/);
  assert.match(css, /\.name-tanuki \{ --deco: #a6d31c; \}/);
  // 旧ピルバッジが消えている
  assert.ok(!/\.name-rabbit \{\s*left: 46\.5%/.test(css), "旧ピルバッジの指定が残っている");
});

test("ホーム: 5×5 詰みパズルは白地・太い枠・左右に3本線", () => {
  const html = read("index.html");
  const css = read("styles.css");
  assert.match(html, /class="tag-pill"/);
  assert.equal((html.match(/class="tag-line/g) || []).length, 2);
  assert.match(css, /\.title-tag \.tag-pill \{[\s\S]*?background: #fffdf7;[\s\S]*?border: 3px solid var\(--verm\)/);
  assert.match(css, /\.title-tag \{[\s\S]*?display: inline-flex/);
});

test("ホーム: キャラ絵の地色とページの境目を消している", () => {
  const css = read("styles.css");
  assert.match(css, /\.hero::before \{/);
  assert.match(css, /#feebc6/);
});

/* ---------------- 重い演出を外している（スムーズ化） ---------------- */

test("描画: 動く要素から重いフィルタ・ブレンドを外している", () => {
  const css = read("styles.css");
  const tanuki = css.slice(css.indexOf(".tanuki {"), css.indexOf("/* ポコ丸 */") + 20);
  assert.ok(!/filter: drop-shadow/.test(tanuki), "ポコ丸にフィルタが残っている");
  assert.ok(!/mix-blend-mode/.test(css), "mix-blend-mode が残っている");
  assert.ok(!/backdrop-filter/.test(css), "backdrop-filter が残っている");
  assert.match(css, /touch-action: manipulation/);
});
