/**
 * Build 6 の検証。
 *
 *  1. 不具合修正: ゲーム終了と同時にステージ選択へ飛ぶ「ゴーストタップ」
 *     - 結果カードを出した直後はカード内のボタンを受け付けない（CSS + JS）
 *     - カードが出る前に始まったタップから出た click は捨てる
 *     - ゲーム終了の処理から勝手に nav() しない（経路の総点検）
 *  2. オープニング: 丸枠なしの全身キャラ（4コマ走りスプライト）が走り抜ける
 *     - assets/rabbit_run.png・tanuki_run.png（背景透過・4コマ・軽い）
 *     - steps(1, end) のコマ送り＋transform の移動
 *  3. 版番号 Build 6（package.json / index.html / main.js / iOS / www）
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const json = (p) => JSON.parse(read(p));

/** その @keyframes の中のプロパティ名をすべて集める */
function keyframeProps(css, name) {
  const start = css.indexOf(`@keyframes ${name}`);
  assert.ok(start >= 0, `@keyframes ${name} が無い`);
  const i = css.indexOf("{", start);
  let depth = 0;
  let end = i;
  for (; end < css.length; end++) {
    if (css[end] === "{") depth++;
    else if (css[end] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  const props = new Set();
  const re = /([a-z-]+)\s*:/g;
  let m;
  while ((m = re.exec(css.slice(i + 1, end)))) props.add(m[1]);
  return props;
}

/** PNG の IHDR を読む（幅・高さ・カラータイプ） */
function pngInfo(file) {
  const buf = fs.readFileSync(path.join(ROOT, file));
  assert.equal(buf.slice(1, 4).toString("ascii"), "PNG", `${file} が PNG でない`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), colorType: buf[25], size: buf.length };
}

/* ---------------- 1. ゴーストタップの修正 ---------------- */

test("Bug 1: 結果カードの開幕ガードがある（時間・タップの起点の2段構え）", () => {
  const main = read("src/main.js");
  assert.match(main, /const OVERLAY_ARM_MS = 5\d\d;/, "開幕ガードの時間が無い");
  assert.match(main, /function armOverlayGuard\(\)/);
  assert.match(main, /function clearOverlayGuard\(\)/);
  assert.match(main, /function isGhostClick\(e\)/);
  // 指から出た click だけを対象にする（スクリプト・支援技術の click は通す）
  assert.match(main, /if \(e && e\.isTrusted === false\) return false;/);
  // カードが出たあとに始まった新しいタップなら、開幕ガードはその場で解く
  assert.match(main, /if \(armFrom && lastDownAt > armFrom && armUntil\) \{\s*armUntil = 0;/);
  // 起点の記録（pointerdown / touchstart）と click の capture 横取り
  assert.match(main, /document\.addEventListener\("pointerdown", markDown, true\)/);
  assert.match(main, /document\.addEventListener\("touchstart", markDown, \{ capture: true, passive: true \}\)/);
  assert.match(main, /document\.addEventListener\(\s*"click",\s*\(e\) => \{\s*if \(!isGhostClick\(e\)\) return;\s*e\.preventDefault\(\);\s*e\.stopImmediatePropagation\(\);/);
  // カードが出る前から始まっていたタップの click は捨てる
  assert.match(main, /if \(lastDownAt <= armFrom\) return true;/);
});

test("Bug 1: クリア・失敗・タイムアタック結果のカードすべてでガードを張る", () => {
  const main = read("src/main.js");
  for (const fn of ["showClear", "showFail", "endTimeAttack"]) {
    const start = main.indexOf(`function ${fn}(`);
    assert.ok(start > 0, `${fn} が無い`);
    const body = main.slice(start, main.indexOf("\nfunction ", start + 10));
    assert.match(body, /armOverlayGuard\(\);/, `${fn} でガードしていない`);
  }
  // カードを閉じる・画面を移るときは解く
  const reset = main.slice(main.indexOf("function resetInteraction()"), main.indexOf("function later("));
  assert.match(reset, /clearOverlayGuard\(\)/);
  const close = main.slice(main.indexOf("function closeOverlays()"), main.indexOf("/* ---------------- 画面遷移"));
  assert.match(close, /clearOverlayGuard\(\)/);
  // ボタン側でも二重に弾く
  const card = main.slice(main.indexOf("function cardButton("), main.indexOf("function showClear("));
  assert.match(card, /if \(isGhostClick\(e\)\) \{/);
});

test("Bug 1: CSS でもカード開幕のボタンを受け付けない", () => {
  const css = read("styles.css");
  assert.match(css, /\.overlay\.arming \.card-actions \{ pointer-events: none; \}/);
  assert.match(read("src/main.js"), /ov\.classList\.add\("arming"\)/);
});

test("Bug 1: ゲームの決着から勝手に nav() しない（経路の総点検）", () => {
  const main = read("src/main.js");
  // 1手打つ・捕まえる処理の中に nav( が無い（カードを出すだけ）
  for (const [from, to] of [
    ["function tapCell(", "function updateMovesHud("],
    ["function onCaught(", "/* ---------------- ヒント"],
  ]) {
    const body = main.slice(main.indexOf(from), main.indexOf(to));
    assert.ok(!/\bnav\(/.test(body), `${from} の中で nav() を呼んでいる`);
  }
  // 結果カードの nav( はボタンの onClick の中だけ（出した瞬間には動かない）
  for (const [from, to] of [
    ["function showClear(", "function showFail("],
    ["function showFail(", "/* ---------------- タイムアタック"],
  ]) {
    const body = main.slice(main.indexOf(from), main.indexOf(to));
    for (const line of body.split("\n").filter((l) => /\bnav\(/.test(l))) {
      assert.match(line, /cardButton\(/, `${from} の nav() がボタンの外にある: ${line.trim()}`);
    }
  }
  // タイマー（later）の中から画面遷移しない
  const laterCalls = [...main.matchAll(/later\(\(\) => \{([\s\S]*?)\}, (\d+)\)/g)].map((m) => m[1]);
  for (const body of laterCalls) assert.ok(!/\bnav\(/.test(body), "タイマーから nav() している");
  // ステージ選択・デイリーへの遷移は「押したとき」の6か所だけ
  // （結果カードの「ステージをえらぶ」×2、ホームのメニュー×2、戻る×2。検証 API は除く）
  const toSelectOrDaily = main
    .split("\n")
    .filter((l) => /nav\(.*("select"|"daily")/.test(l) && !/=> nav\("(select|daily)"\)/.test(l));
  assert.equal(toSelectOrDaily.length, 6, `ステージ選択・デイリーへの遷移が ${toSelectOrDaily.length} か所`);
  // タイマーやアニメの終了から画面を移していない
  const timers = [...main.matchAll(/set(?:Timeout|Interval)\(([\s\S]{0,160}?)\);/g)].map((m) => m[1]);
  assert.equal(timers.filter((t) => /nav\(.*("select"|"daily")/.test(t)).length, 0, "タイマーから画面遷移している");
});

test("Bug 1: 下段タップ→カード開幕→指を離す、でステージ選択へ飛ばない（E2E で確認する仕組み）", () => {
  const e2e = read("tools/e2e-build6.mjs");
  assert.match(e2e, /BUG: ゲーム終了と同時にステージ選択へ飛ばされる/);
  assert.match(e2e, /Input\.dispatchTouchEvent/);
  assert.match(e2e, /touchStart[\s\S]*touchEnd/);
});

/* ---------------- 2. オープニング（全身キャラ） ---------------- */

test("OP: 丸アイコンをやめて全身キャラ2人が走る要素になっている", () => {
  const html = read("index.html");
  assert.match(html, /id="open-chase"/);
  assert.match(html, /id="chase-tanuki"[\s\S]*?class="run-body"/);
  assert.match(html, /id="chase-usagiro"[\s\S]*?class="run-body"/);
  assert.equal([...html.matchAll(/class="run-body"/g)].length, 2);
  // Build 5 の丸アイコン（トークン画像）と丸枠の CSS は残っていない
  assert.ok(!/open-tanuki|open-rabbit/.test(html), "丸アイコンが残っている");
  assert.ok(!/class="chase-mallet"/.test(html), "杵の飾り（丸枠前提）が残っている");
  const css = read("styles.css");
  const body = css.slice(css.indexOf(".run-body {"), css.indexOf(".chase-tanuki .run-body"));
  assert.ok(!/border-radius/.test(body), "全身キャラに丸枠が付いている");
  // 走りの小物（汗・土煙・スピード線）
  assert.ok([...html.matchAll(/class="chase-dust/g)].length >= 4, "土煙が足りない");
  assert.ok([...html.matchAll(/class="chase-speed/g)].length >= 2, "スピード線が足りない");
  // 汗は全身スプライトの絵に描かれている（絵文字のフォント依存を外した）
  assert.ok(!/chase-sweat/.test(html));
});

test("OP: 4コマの走りスプライトが背景透過の PNG で同梱されている", () => {
  for (const file of ["assets/rabbit_run.png", "assets/tanuki_run.png"]) {
    const info = pngInfo(file);
    assert.equal(info.colorType, 6, `${file} が RGBA でない（背景が透過しない）`);
    // 4コマ横並びなので、幅は高さの約4倍弱
    const ratio = info.width / info.height;
    assert.ok(ratio > 3.4 && ratio < 4.1, `${file} が4コマでない（${info.width}x${info.height}）`);
    assert.ok(info.size < 700 * 1024, `${file} が重すぎる（${Math.round(info.size / 1024)}KB）`);
  }
});

test("OP: スプライトを steps(1, end) でコマ送りし、位置は transform で動かす", () => {
  const css = read("styles.css");
  assert.match(css, /\.chase-tanuki \.run-body \{ background-image: url\(assets\/tanuki_run\.png\)/);
  assert.match(css, /\.chase-usagiro \.run-body \{ background-image: url\(assets\/rabbit_run\.png\)/);
  assert.match(css, /#screen-opening\.playing \.run-body \{ animation: runCycle [\d.]+s steps\(1, end\) infinite; \}/);
  const cycle = keyframeProps(css, "runCycle");
  assert.deepEqual([...cycle], ["background-position"]);
  // コマ幅は px の calc で決め打ち（% の入れ子を作るとレイアウトが循環する）
  assert.match(css, /background-size: calc\(var\(--fw\) \* 4\) calc\(var\(--fw\) \* 300 \/ var\(--fh\)\)/);
  for (const name of ["chaseTanuki", "chaseUsagiro"]) {
    for (const p of keyframeProps(css, name)) assert.ok(p === "transform" || p === "opacity", `${name} の ${p}`);
  }
  // キャラは画面の外から入って外へ抜ける
  assert.match(css, /@keyframes chaseTanuki \{\s*0% \{ transform: translate3d\(3\d\dpx/);
  assert.match(css, /@keyframes chaseUsagiro \{\s*0% \{ transform: translate3d\(4\d\dpx/);
});

test("OP: 2人が走り抜けたあとにタイトルが出る", () => {
  const css = read("styles.css");
  const title = css.slice(css.indexOf(".open-title {"), css.indexOf("@keyframes openTitle"));
  const m = title.match(/animation: openTitle [\d.]+s ([\d.]+)s both;/);
  assert.ok(m, "タイトルの表示タイミングが無い");
  const delay = Number(m[1]);
  assert.ok(delay >= 1.0 && delay <= 1.3, `タイトルが ${delay}s に出る`);
  const main = read("src/main.js");
  assert.match(main, /openingTimer = setTimeout\(finishOpening, \d{4}\);/);
});

/* ---------------- 3. 版 ---------------- */

test("版: Build 6（package.json / index.html / main.js / iOS）", () => {
  const pkg = json("package.json");
  assert.equal(pkg.version, "1.0.0");
  assert.equal(pkg.build, 6);
  assert.match(pkg.description, /Build 6/);
  assert.match(read("index.html"), /1\.0\.0 \(6\)/);
  assert.match(read("src/main.js"), /const BUILD = 6;/);
  const pbx = read("ios/App/App.xcodeproj/project.pbxproj");
  const values = [...new Set([...pbx.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((m) => m[1]))];
  assert.deepEqual(values, ["6"]);
});

test("版: www と E2E に Build 6 が組み込まれている", () => {
  const pkg = json("package.json");
  assert.match(pkg.scripts.test, /test\/build6\.test\.mjs/);
  assert.match(pkg.scripts["test:e2e"], /^node tools\/e2e-build6\.mjs &&/);
  assert.ok(fs.existsSync(path.join(ROOT, "tools/e2e-build6.mjs")));
  const www = read("tools/make-www.mjs");
  assert.match(www, /"rabbit_run\.png"/);
  assert.match(www, /"tanuki_run\.png"/);
});

test("回帰: Build 3〜5 の安全策（オーバーレイを畳む・見張り番・声の排他・シェア）は残っている", () => {
  const main = read("src/main.js");
  const nav = main.slice(main.indexOf("function nav(screen)"), main.indexOf("function openSheet"));
  assert.match(nav, /closeOverlays\(\)/);
  assert.match(main, /setInterval\(\(\) => \{[\s\S]*?1200\);/);
  assert.match(read("src/audio.js"), /const VOICE_GAP_MS = 150;/);
  assert.match(main, /sharedText|shareResult/);
  const css = read("styles.css");
  assert.match(css, /\.screen:not\(\.active\) \* \{ pointer-events: none !important; \}/);
});
