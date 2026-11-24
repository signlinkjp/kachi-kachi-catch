/**
 * Build 5 の検証。
 *  1. オープニング: 臼の杵を持ったウサギローがポコ丸を追いかけるアニメ
 *     （transform と opacity だけ・1.6秒・タップで即スキップ・終了後は完全に非表示）
 *  2. クリア/結果カードの「シェアする」（Web Share API → クリップボード＋トースト）
 *  3. シェア文言の12言語（src/share.js ＋ i18n.js の share.*）
 *  4. 中級 STAGE 25（無料分の最後）クリア時の PRO 案内
 *  5. ゲーム上部の説明文（全12言語で「協力して追い込み、アミで捕まえる」意味）
 *  6. 下部「ポコ丸の逃げ場 ○マス」の単位
 *  7. 版番号 Build 5（package.json / index.html / main.js / iOS）
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { STRINGS, LANGS, makeT } from "../src/i18n.js";
import { shareTextFor, shareButtonLabel } from "../src/share.js";
import { isFreeTierFinale, FREE_STAGE_COUNT } from "../src/pro.js";
import { STAGES } from "../src/stages.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const json = (p) => JSON.parse(read(p));

const CODES = ["ja", "en", "zh-Hans", "zh-Hant", "ko", "es", "fr", "de", "pt", "it", "hi", "id"];

/** その @keyframes の中のプロパティ名をすべて集める（セレクタは無視） */
function keyframeProps(css, name) {
  const start = css.indexOf(`@keyframes ${name}`);
  assert.ok(start >= 0, `@keyframes ${name} が無い`);
  let i = css.indexOf("{", start);
  let depth = 0;
  let end = i;
  for (; end < css.length; end++) {
    if (css[end] === "{") depth++;
    else if (css[end] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  const body = css.slice(i + 1, end);
  const props = new Set();
  const re = /([a-z-]+)\s*:/g;
  let m;
  while ((m = re.exec(body))) {
    // 「50% { transform: ...」の百分率はマッチしない（数字のあとの { を除く）
    props.add(m[1]);
  }
  return props;
}

/* ---------------- 1. オープニング（追いかけアニメ） ---------------- */

test("オープニング: 臼の杵を持ったウサギローがポコ丸を追いかける要素がある", () => {
  const html = read("index.html");
  assert.match(html, /id="open-chase"/);
  assert.match(html, /id="chase-tanuki"/);
  assert.match(html, /id="chase-usagiro"/);
  // 追われるポコ丸と、杵（木槌）を持ったウサギローの2人
  assert.match(html, /class="open-tanuki" src="assets\/tanuki_token\.png"/);
  assert.match(html, /class="open-rabbit" src="assets\/rabbit_token\.png"/);
  const usagiro = html.slice(html.indexOf('id="chase-usagiro"'), html.indexOf("</span>", html.indexOf('id="chase-usagiro"')));
  assert.match(usagiro, /class="chase-mallet"/, "ウサギローが杵（臼の杵）を持っていない");
  assert.match(usagiro, /class="open-rabbit"/);
  // 逃げるポコ丸は汗をかいて慌てている
  const tanuki = html.slice(html.indexOf('id="chase-tanuki"'), html.indexOf("</span>", html.indexOf('id="chase-tanuki"')));
  assert.match(tanuki, /class="chase-sweat"/);
});

test("オープニング: transform と opacity だけで、約1.6秒の軽量アニメ", () => {
  const css = read("styles.css");
  for (const name of ["chaseTanuki", "chaseUsagiro", "malletBob", "sweatPop", "dustPuff", "speedFlick"]) {
    const props = keyframeProps(css, name);
    for (const p of props) {
      assert.ok(p === "transform" || p === "opacity", `${name} が重いプロパティ ${p} を動かしている`);
    }
  }
  // 位置・大きさ・色をアニメで動かしていない（transform だけ）
  assert.match(css, /#screen-opening\.playing \.chase-tanuki \{ animation: chaseTanuki 1\.6s/);
  assert.match(css, /#screen-opening\.playing \.chase-usagiro \{ animation: chaseUsagiro 1\.6s/);
  // will-change で合成レイヤーに載せる
  const runner = css.slice(css.indexOf(".chase-runner {"), css.indexOf(".chase-tanuki {"));
  assert.match(runner, /will-change: transform, opacity;/);
  // 1.5〜1.8秒（タップで即スキップも可）
  const main = read("src/main.js");
  const m = main.match(/openingTimer = setTimeout\(finishOpening, (\d+)\);/);
  assert.ok(m, "オープニングのタイマーが無い");
  const ms = Number(m[1]);
  assert.ok(ms >= 1500 && ms <= 1800, `オープニングが ${ms}ms`);
  assert.match(main, /\$\("#screen-opening"\)\.addEventListener\("pointerdown", \(\) => \{[\s\S]*?finishOpening\(\);/);
});

test("オープニング: タップをブロックせず、終了後・スキップ後は完全に非表示", () => {
  const css = read("styles.css");
  const main = read("src/main.js");
  const chase = css.slice(css.indexOf(".open-chase {"), css.indexOf(".chase-runner {"));
  assert.match(chase, /pointer-events: none;/);
  // オープニング中だけ動く（離れたら .playing が外れて opacity 0・アニメなし）
  assert.match(css, /#screen-opening:not\(\.playing\) \.open-chase \{ opacity: 0; \}/);
  const runner = css.slice(css.indexOf(".chase-runner {"), css.indexOf(".chase-tanuki {"));
  assert.match(runner, /opacity: 0;/);
  assert.match(runner, /pointer-events: none;/);
  // 画面を移るときに .playing を外す
  const nav = main.slice(main.indexOf("function nav(screen)"), main.indexOf("function openSheet"));
  assert.match(nav, /classList\.toggle\("playing", screen === "opening"\)/);
  // 非表示の画面は中身ごとタップを受けない（Build 4 の保険が効いている）
  assert.match(css, /\.screen:not\(\.active\) \* \{ pointer-events: none !important; \}/);
});

/* ---------------- 2. シェア（仕組み） ---------------- */

test("シェア: Web Share API を最優先し、非対応ならクリップボード＋トースト", () => {
  const main = read("src/main.js");
  const share = main.slice(main.indexOf("async function shareResult("), main.indexOf("function priceLabel("));
  assert.match(share, /typeof navigator\.share === "function"/);
  assert.match(share, /await navigator\.share\(\{ title: app\.t\("app\.title"\), text \}\)/);
  // ユーザーがシートを閉じただけのときはコピーしない
  assert.match(share, /name === "AbortError"/);
  // フォールバックはクリップボード→ execCommand → 失敗
  assert.match(share, /await copyToClipboard\(text\)/);
  assert.match(share, /showToast\(app\.t\(ok \? "share\.copied" : "share\.failed"\)\)/);
  const copy = main.slice(main.indexOf("async function copyToClipboard("), main.indexOf("async function shareResult("));
  assert.match(copy, /navigator\.clipboard\.writeText/);
  assert.match(copy, /document\.execCommand\("copy"\)/);
  // 触るとすぐ共有（await でカードを閉じたりしない）
  assert.ok(!/await shareResult\(/.test(main));
});

test("シェア: クリアカード（通常・今日の1問）とタイムアタック結果カードにボタンがある", () => {
  const main = read("src/main.js");
  const clear = main.slice(main.indexOf("function showClear("), main.indexOf("function showFail("));
  assert.match(clear, /shareButtonLabel\(t\)/, "クリアカードにシェアボタンが無い");
  assert.match(clear, /shareResult\("stage", \{ stage: t\("stage\.stageNo", \{ n: stage\.index \}\), moves: game\.movesUsed \}\)/);
  assert.match(clear, /shareResult\("daily", \{ date:/);
  const ta = main.slice(main.indexOf("function endTimeAttack("), main.indexOf("function stopTimeAttack("));
  assert.match(ta, /shareResult\("ta", \{ seconds: duration, score: ta\.score \}\)/);
  // シェアボタンはカードの操作列に入る（.share の見た目）
  assert.match(main, /cardButton\(shareButtonLabel\(t\), "", "share"/);
  const css = read("styles.css");
  assert.match(css, /\.card-actions \.btn\.share \{/);
});

/* ---------------- 3. シェア文言（12言語） ---------------- */

test("シェア: 日本語の文面が指定どおり（3行・絵文字・ハッシュタグ）", () => {
  const t = makeT("ja");
  assert.equal(
    shareTextFor(t, "stage", { stage: "STAGE 49", moves: 3 }),
    "「カチカチ キャッチ」STAGE 49 をクリア！🐇🪵🦝\nウサギローとポコ丸の5×5詰みパズル\n#カチカチキャッチ #KachiKachiCatch"
  );
  const daily = shareTextFor(t, "daily", { date: "2026-11-24" });
  assert.match(daily, /^「カチカチ キャッチ」今日の1問（2026-11-24）をクリア！🐇🪵🦝\n/);
  const ta = shareTextFor(t, "ta", { seconds: 60, score: 12 });
  assert.match(ta, /^「カチカチ キャッチ」タイムアタック60秒で12問クリア！🐇🪵🦝\n/);
  assert.match(shareButtonLabel(t), /^📤 シェアする$/);
  // 3行（見出し・サブ・タグ）
  assert.equal(ta.split("\n").length, 3);
});

test("シェア: 12言語すべてに文言があり、差し込みが残らない", () => {
  for (const code of CODES) {
    const table = STRINGS[code];
    for (const key of ["share.stage", "share.daily", "share.ta", "share.sub", "share.tags", "share.button", "share.copied", "share.failed"]) {
      assert.ok(table[key] && String(table[key]).trim().length > 0, `${code}: ${key} が空`);
    }
    const t = makeT(code);
    for (const kind of ["stage", "daily", "ta"]) {
      const text = shareTextFor(t, kind, { stage: "STAGE 1", moves: 3, date: "2026-11-24", seconds: 60, score: 5 });
      assert.ok(!/[{}]/.test(text), `${code}/${kind}: 差し込みが残っている（${text}）`);
      assert.ok(text.split("\n").length === 3, `${code}/${kind}: 3行でない`);
      // 英語に落ちていない（未翻訳キーは key 名がそのまま出る）
      assert.ok(!text.includes("share."), `${code}/${kind}: 未翻訳`);
    }
  }
  // 英語・中国語・韓国語の見出しにハッシュタグがある
  for (const code of CODES) assert.match(STRINGS[code]["share.tags"], /#\S+/);
});

/* ---------------- 4. STAGE 25 の PRO 案内 ---------------- */

test("STAGE 25: 無料ユーザーが中級の最後をクリアしたときだけ PRO 案内", () => {
  const s25 = STAGES.find((s) => s.index === 25);
  assert.ok(s25, "STAGE 25 が無い");
  assert.equal(s25.difficulty, "middle");
  assert.equal(FREE_STAGE_COUNT, 25);
  assert.equal(isFreeTierFinale(s25, "stage", false), true);
  assert.equal(isFreeTierFinale(s25, "stage", true), false, "PRO 購入済みでも案内が出る");
  assert.equal(isFreeTierFinale(s25, "daily", false), false);
  assert.equal(isFreeTierFinale(STAGES.find((s) => s.index === 26), "stage", false), false);
  assert.equal(isFreeTierFinale(s25, "ta", false), false);

  const main = read("src/main.js");
  assert.match(main, /isFreeTierFinale\(stage, s && s\.mode, isPro\(\)\)/);
  const clear = main.slice(main.indexOf("function showClear("), main.indexOf("function showFail("));
  // 案内のときは「PRO を開く」が先頭（自然に目立つ）
  assert.match(clear, /if \(promoTier\) \{[\s\S]*?cardButton\(t\("pro\.clear25Btn"\), "", "pro-cta", \(\) => openProSheet\(\)\)/);
  assert.match(clear, /t\("pro\.clear25Title"\)/);
  assert.match(clear, /t\("pro\.clear25Text", \{ price: priceLabel\(\) \}\)/);
  assert.match(clear, /classList\.toggle\("promo", promoTier\)/);
  // PRO のときは通常の「つぎのステージ」
  assert.match(clear, /else \{\s*const idx = STAGES\.indexOf\(stage\);/);
});

test("STAGE 25: 案内文が12言語そろう（達成感＋上級/激ムズ/TA＋買い切り）", () => {
  for (const code of CODES) {
    for (const key of ["pro.clear25Title", "pro.clear25Text", "pro.clear25Btn"]) {
      assert.ok(STRINGS[code][key], `${code}: ${key}`);
    }
  }
  assert.equal(STRINGS.ja["pro.clear25Title"], "初級・中級25問を制覇！🎉");
  assert.equal(STRINGS.ja["pro.clear25Btn"], "PRO を開く");
  const t = makeT("ja");
  const text = t("pro.clear25Text", { price: "¥300" });
  assert.match(text, /上級（5手詰）/);
  assert.match(text, /激ムズ（7手詰）/);
  assert.match(text, /タイムアタック/);
  assert.match(text, /¥300/);
  assert.match(text, /買い切り/);
});

/* ---------------- 5. ゲーム上部の説明文 ---------------- */

test("上部の説明文: 日本語が新しい文言で、12言語も「協力して追い込む」意味", () => {
  assert.equal(STRINGS.ja["tip.general"], "ウサギローと協力してポコ丸を追い込み、アミで捕まえよう‼️");
  for (const code of CODES) {
    const v = STRINGS[code]["tip.general"];
    assert.ok(v && v.trim().length > 0, `${code}: tip.general が空`);
    assert.ok(!/escape/i.test(v) || code === "en", `${code}: 古い文言が残っている（${v}）`);
  }
  // ほかの言語もキャラ名（ウサギロー・ポコ丸）と網に触れている
  for (const code of CODES) {
    const v = STRINGS[code]["tip.general"];
    assert.match(v, /‼️|‼/u, `${code}: 呼びかけの「‼️」が無い（${v}）`);
  }
  const main = read("src/main.js");
  assert.match(main, /\$\("#hud-strip"\)\.textContent = t\("tip\.general", \{ name: t\("char\.tanuki"\) \}\)/);
});

test("上部の説明文: 長い文言が枠内で自然に折り返す（375px・特大でも収まる）", () => {
  const css = read("styles.css");
  const strip = css.slice(css.indexOf(".strip-text {"), css.indexOf("/* ============================ BOARD"));
  assert.match(strip, /flex: 1 1 auto;/);
  assert.match(strip, /min-width: 0;/);
  assert.match(strip, /white-space: normal;/);
  assert.match(strip, /overflow-wrap: break-word;/);
  assert.match(strip, /line-height: 1\.32;/);
  // 枠は文字数で高さが伸びる（clip しない）
  const par = css.slice(css.indexOf(".par-strip {"), css.indexOf(".strip-text {"));
  assert.match(par, /min-height: 36px;/);
  assert.ok(!/overflow:\s*hidden/.test(par), "説明文の枠が overflow:hidden で切れている");
});

/* ---------------- 6. 「○マス」の単位 ---------------- */

test("逃げ場の単位: 「4マス」のように単位が付く（12言語）", () => {
  const html = read("index.html");
  assert.match(html, /<span class="meter-num" id="meter-num">0<\/span>\s*<span class="meter-unit" id="meter-unit">マス<\/span>/);
  assert.equal(STRINGS.ja["stage.escapeUnit"], "マス");
  assert.equal(STRINGS.en["stage.escapeUnit"], "tiles");
  for (const code of CODES) {
    const v = STRINGS[code]["stage.escapeUnit"];
    assert.ok(v && v.trim().length > 0, `${code}: stage.escapeUnit が空`);
    assert.ok(v.length <= 10, `${code}: 単位が長すぎる（${v}）`);
  }
  const main = read("src/main.js");
  const meter = main.slice(main.indexOf("function paintMeter("), main.indexOf("/* ---------------- アニメーション"));
  assert.match(meter, /\$\("#meter-num"\)\.textContent = String\(total\)/);
  assert.match(meter, /unit\.textContent = app\.t\("stage\.escapeUnit"\)/);
  const css = read("styles.css");
  assert.match(css, /\.meter-unit \{/);
});

/* ---------------- 7. 版 ---------------- */

test("版: Build 5（package.json / index.html / main.js / iOS）", () => {
  const pkg = json("package.json");
  assert.equal(pkg.version, "1.0.0");
  assert.equal(pkg.build, 5);
  assert.match(pkg.description, /Build 5/);
  assert.match(read("index.html"), /1\.0\.0 \(5\)/);
  assert.match(read("src/main.js"), /const BUILD = 5;/);
  const pbx = read("ios/App/App.xcodeproj/project.pbxproj");
  const values = [...new Set([...pbx.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((m) => m[1]))];
  assert.deepEqual(values, ["5"]);
  assert.equal(values.length, 1);
});

test("版: 既存のテスト・E2E に Build 5 が組み込まれている", () => {
  const pkg = json("package.json");
  assert.match(pkg.scripts.test, /test\/build5\.test\.mjs/);
  assert.match(pkg.scripts["test:e2e"], /^node tools\/e2e-build5\.mjs &&/);
  assert.ok(fs.existsSync(path.join(ROOT, "tools/e2e-build5.mjs")));
});

/* ---------------- 8. Build 4 の安全策を壊していない ---------------- */

test("回帰: フリーズ防止（nav/オーバーレイ/見張り番）と声の排他は残っている", () => {
  const main = read("src/main.js");
  assert.match(main, /function closeOverlays\(\)/);
  const nav = main.slice(main.indexOf("function nav(screen)"), main.indexOf("function openSheet"));
  assert.match(nav, /closeOverlays\(\)/);
  assert.match(main, /setInterval\(\(\) => \{[\s\S]*?1200\);/);
  const audio = read("src/audio.js");
  assert.match(audio, /const VOICE_GAP_MS = 150;/);
  assert.match(audio, /pendingVoice = \{ url, who, volume \}/);
});
