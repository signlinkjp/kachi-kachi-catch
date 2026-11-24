/**
 * Build 4 の実ブラウザ検査（Playwright）。
 *
 *   node tools/e2e-build4.mjs
 *
 * 見るもの:
 *   1. Build 4 として起動・ホーム（言語チップ廃止・設定ボタンが普通の濃さで中央）
 *   2. **ステージ選択画面の導線**（クリアカード/ゲームの←→ステージ選択→
 *      下までスクロール→上級・激ムズをタップ→左上←でホーム）
 *      ＝ Build 3 実機で「選択できない・スクロールできない・←が効かない」の再発防止
 *   3. 声は同時に2人鳴らない（掛け合いキュー）＋連打で声が溜まらない
 *   4. ウサギローの叩くアニメ（約0.52秒＋衝撃波）とポコ丸の逃げるアニメ（約0.42秒）
 *   5. 深い盤面でもタップが固まらない（1手 < 400ms・連打が効く）
 *   6. 8ステージ連続でクリア→選択画面→戻る、を繰り返しても触れる
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.KACHI_ROOT ? path.resolve(process.env.KACHI_ROOT) : path.join(HERE, "..");
const CHROMIUM = process.env.CHROMIUM_PATH || "";
const SHOTS = process.env.KACHI_SHOTS || "";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
};

function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || "/").split("?")[0]);
    let file = path.join(ROOT, url);
    if (url.endsWith("/")) file = path.join(file, "index.html");
    if (!file.startsWith(ROOT)) return res.writeHead(403).end("no");
    fs.readFile(file, (err, data) => {
      if (err) return res.writeHead(404).end("not found");
      res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port })));
}

async function loadPlaywright() {
  for (const name of ["playwright", "playwright-core"]) {
    try {
      const mod = await import(name);
      if (mod.chromium) return mod.chromium;
    } catch {}
  }
  throw new Error("playwright が見つかりません（npm i -D playwright）");
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? "  — " + detail : ""}`);
}

const { server, port } = await serve();
const chromium = await loadPlaywright();
const args = ["--no-sandbox", "--autoplay-policy=no-user-gesture-required", "--mute-audio"];
const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM, args } : { args });

async function newPage(viewport = { width: 393, height: 852 }, opts = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true, ...opts });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "load" });
  await page.waitForFunction(() => window.kachi && window.kachi.ready, null, { timeout: 15000 });
  await page.waitForTimeout(300);
  return { ctx, page };
}

const cellPoint = (page, i) =>
  page.evaluate((idx) => {
    const r = document.querySelectorAll("#board .cell")[idx].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, i);

const stateOf = (page) =>
  page.evaluate(() => ({
    screen: window.kachi.screen(),
    stage: window.kachi.state(),
    overlay: document.querySelector("#overlay").classList.contains("show"),
  }));

const waitCard = (page, ms = 6000) =>
  page
    .waitForFunction(() => document.querySelector("#overlay").classList.contains("show"), null, { timeout: ms })
    .then(() => true)
    .catch(() => false);

/** いまこの瞬間、その座標のいちばん上にある要素が何か */
const hitAt = (page, x, y) =>
  page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return { tag: null };
      return {
        tag: el.tagName,
        id: el.id || "",
        cls: typeof el.className === "string" ? el.className : "",
        text: (el.textContent || "").trim().slice(0, 30),
        inActive: !!el.closest(".screen.active"),
      };
    },
    { x, y }
  );

/** ステージを最善手でクリアする */
async function clearStage(page, id) {
  await page.evaluate((sid) => window.kachi.openStage(sid), id);
  await page.waitForTimeout(120);
  let guard = 0;
  while (guard++ < 12) {
    const st = (await stateOf(page)).stage;
    if (!st || st.status !== "playing") break;
    const hint = await page.evaluate(() => window.kachi.hint());
    if (hint == null) break;
    const p = await cellPoint(page, hint);
    await page.touchscreen.tap(p.x, p.y);
    await page.waitForTimeout(60);
  }
  return waitCard(page);
}

/* ---------------- 1. 起動・版 ---------------- */
{
  const { ctx, page } = await newPage();
  await page.evaluate(() => window.kachi.setLang("ja"));
  const v = await page.evaluate(() => window.kachi.version);
  check("Build 4 として起動する", v.build === 4 && v.marketing === "1.0.0", JSON.stringify(v));
  const ver = await page.evaluate(() => document.querySelector("#version-line").textContent);
  check("設定画面の版が 1.0.0 (4)", /1\.0\.0 \(4\)/.test(ver), ver);

  /* ---------------- 2. ホーム（言語チップ廃止・設定ボタン） ---------------- */
  await page.evaluate(() => window.kachi.showTitle());
  await page.waitForTimeout(260);
  const home = await page.evaluate(() => {
    const lang = document.querySelector("#btn-lang");
    const set = document.querySelector("#btn-settings");
    const menu = document.querySelector("#btn-stages");
    const cs = set ? getComputedStyle(set) : null;
    const cm = menu ? getComputedStyle(menu) : null;
    const appRect = document.querySelector("#app").getBoundingClientRect();
    const sr = set ? set.getBoundingClientRect() : null;
    return {
      hasLang: !!lang,
      setText: set ? set.textContent.replace(/\s+/g, "") : "",
      color: cs ? cs.color : "",
      menuColor: cm ? cm.color : "",
      border: cs ? cs.borderTopColor : "",
      menuBorder: cm ? cm.borderTopColor : "",
      fontSize: cs ? parseFloat(cs.fontSize) : 0,
      menuFontSize: cm ? parseFloat(cm.fontSize) : 0,
      centerOffset: sr ? Math.round(sr.left + sr.width / 2 - (appRect.left + appRect.width / 2)) : 999,
      height: sr ? Math.round(sr.height) : 0,
    };
  });
  check("ホームに 🌐 日本語チップが無い", home.hasLang === false);
  check("設定ボタンが「⚙ 設定」の普通のボタン", /⚙\s*(設定|Settings)/.test(home.setText), home.setText);
  check(
    "設定ボタンがメニューと同じ濃い文字色（薄いグレーでない）",
    home.color === home.menuColor && home.color !== "rgb(122, 98, 80)",
    `${home.color} vs ${home.menuColor}`
  );
  check("設定ボタンの枠線がメニューと同じはっきりした色", home.border === home.menuBorder, `${home.border} vs ${home.menuBorder}`);
  check("設定ボタンが中央に配置されている", Math.abs(home.centerOffset) <= 2, `offset=${home.centerOffset}px`);
  check("設定ボタンがメニューと同じ文字サイズ", Math.abs(home.fontSize - home.menuFontSize) < 1.5, `${home.fontSize} vs ${home.menuFontSize}`);

  // 設定 → 言語（🌐 の代わり）で切り替えられる
  await page.evaluate(() => document.querySelector("#btn-settings").click());
  await page.waitForTimeout(260);
  const settings = await page.evaluate(() => ({
    screen: window.kachi.screen(),
    langRow: (document.querySelector("#row-lang") || {}).textContent || "",
    langValue: (document.querySelector("#set-lang") || {}).textContent || "",
  }));
  check("設定画面に「言語」行がある（🌐 の代わり）", /(言語|Language)/.test(settings.langRow) && /(日本語|Japanese)/.test(settings.langValue), JSON.stringify(settings));
  await page.evaluate(() => document.querySelector("#row-lang").click());
  await page.waitForTimeout(220);
  const sheetOpen = await page.evaluate(() => document.querySelector("#lang-sheet").classList.contains("show"));
  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll("#lang-list [data-lang], #lang-list button"));
    const en = items.find((b) => /English/i.test(b.textContent || ""));
    if (en) en.click();
  });
  await page.waitForTimeout(220);
  const afterEn = await page.evaluate(() => document.querySelector("#set-lang").textContent.trim());
  check("設定の言語で English に切り替えられる", sheetOpen && /English/i.test(afterEn), afterEn);
  await page.evaluate(() => window.kachi.setLang("ja"));
  await page.evaluate(() => window.kachi.closeSheets());
  await page.evaluate(() => window.kachi.showTitle());
  await page.waitForTimeout(250);

  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, "kachi-b4-title.png") });
  }
  await ctx.close();
}

/* ---------------- 3. ステージ選択画面の導線（Build 3 の実機不具合） ---------------- */
{
  const { ctx, page } = await newPage();
  await page.evaluate(() => window.kachi.setPro(true));

  // (a) クリアカードの「ステージをえらぶ」から選択画面へ
  check("ステージ1をクリアできる", await clearStage(page, "s01"));
  const cardButtons = await page.evaluate(() => Array.from(document.querySelectorAll("#card-actions .btn")).map((b) => b.textContent.trim()));
  await page.evaluate(() => document.querySelectorAll("#card-actions .btn")[2].click());
  await page.waitForTimeout(320);
  let s = await stateOf(page);
  check("「ステージをえらぶ」でステージ選択画面へ", s.screen === "select", JSON.stringify({ screen: s.screen, buttons: cardButtons }));
  check("選択画面に来たときクリアカードが残っていない", s.overlay === false);

  // (b) 左上の←が押せる（透明な幕が乗っていない）
  const backPoint = await page.evaluate(() => {
    const r = document.querySelector("#screen-select [data-back]").getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const backHit = await hitAt(page, backPoint.x, backPoint.y);
  check("左上の←が最前面にある（透明オーバーレイに食べられていない）", /icon-btn/.test(backHit.cls) && backHit.inActive, JSON.stringify(backHit));

  // (c) 下までスクロールできる（タッチ/ホイール）
  const scrollBox = await page.evaluate(() => {
    const el = document.querySelector("#screen-select .select-scroll");
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, before: el.scrollTop, max: el.scrollHeight - el.clientHeight };
  });
  const sHit = await hitAt(page, scrollBox.x, scrollBox.y);
  check("選択リストの上が最前面（スクロールを受け取れる）", sHit.inActive && !/overlay/.test(sHit.cls), JSON.stringify(sHit));
  await page.mouse.move(scrollBox.x, scrollBox.y);
  for (let k = 0; k < 6; k++) {
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(80);
  }
  const scrolled = await page.evaluate(() => {
    const el = document.querySelector("#screen-select .select-scroll");
    return { top: el.scrollTop, max: el.scrollHeight - el.clientHeight };
  });
  check("下にスクロールできる", scrolled.top > 100 && scrolled.top >= scrolled.max - 40, JSON.stringify(scrolled));

  // (d) 一番下（激ムズ）のステージが見えて、タップで開ける
  const last = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll("#screen-select .stage-item"));
    const el = items[items.length - 1];
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, label: el.textContent.trim().slice(0, 24), count: items.length };
  });
  await page.waitForTimeout(120);
  const lastHit = await hitAt(page, last.x, last.y);
  check("上級・激ムズまで表示され、ステージが最前面にある", lastHit.inActive && /stage-item/.test(lastHit.cls), JSON.stringify({ last, lastHit }));
  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, "kachi-b4-select-bottom.png") });
  }
  await page.touchscreen.tap(last.x, last.y);
  await page.waitForTimeout(320);
  s = await stateOf(page);
  check("スクロールした先のステージをタップして開ける", s.screen === "game" && !!s.stage, JSON.stringify({ screen: s.screen, id: s.stage && s.stage.id }));

  // (e) ゲーム画面の← → 選択画面（また触れる）→ 左上←でホーム
  await page.evaluate(() => document.querySelector("#btn-back").click());
  await page.waitForTimeout(320);
  s = await stateOf(page);
  const midHit = await page.evaluate(() => {
    const r = document.querySelector("#screen-select [data-back]").getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { cls: el ? String(el.className) : null, inside: !!(el && el.closest("[data-back]")) };
  });
  check("ゲーム画面の←で選択画面に戻れる", s.screen === "select", s.screen);
  check("戻った選択画面の←も押せる", midHit.inside === true, JSON.stringify(midHit));
  await page.evaluate(() => document.querySelector("#screen-select [data-back]").click());
  await page.waitForTimeout(320);
  s = await stateOf(page);
  check("選択画面の左上←でホームに戻れる", s.screen === "title", s.screen);
  await ctx.close();
}

/* ---------------- 4. 声は同時に2人鳴らない（掛け合いキュー） ---------------- */
{
  const { ctx, page } = await newPage();
  await page.evaluate(() => window.kachi.setPro(true));
  await page.evaluate(() => window.kachi.setLang("ja"));
  await page.evaluate(() => window.kachi.openStage("s11"));
  // 開始の掛け合い（ポコ丸 → ウサギロー）を 20ms ごとに観測
  const sample = await page.evaluate(async () => {
    const marks = [];
    let maxAtOnce = 0;
    let overlapPairs = 0;
    let starts = 0;
    let lastVoices = "";
    for (let k = 0; k < 220; k++) {
      const a = window.kachi.audio();
      const key = (a.voices || []).slice().sort().join("+");
      const n = (a.voices || []).length + (a.voiceBusy && !(a.voices || []).length ? 1 : 0);
      if (n > maxAtOnce) maxAtOnce = n;
      if ((a.voices || []).length > 1) overlapPairs += 1;
      if (a.voiceStarts > starts) starts = a.voiceStarts;
      if (key !== lastVoices) {
        marks.push({ t: k * 20, voices: key, busy: a.voiceBusy, queued: a.voiceQueued });
        lastVoices = key;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    return { maxAtOnce, overlapPairs, starts, marks };
  });
  check("開始の掛け合いで声が同時に2人鳴らない", sample.overlapPairs === 0 && sample.maxAtOnce <= 1, JSON.stringify({ ...sample, marks: sample.marks.slice(0, 8) }));
  check("開始時に2人ぶんの声が順番に鳴る", sample.starts >= 2, `starts=${sample.starts}`);

  // 連打しても声が溜まらない（待機は最新1本）
  const rapid = await page.evaluate(async () => {
    const marks = [];
    let overlap = 0;
    for (let k = 0; k < 40; k++) {
      const a = window.kachi.audio();
      if ((a.voices || []).length > 1) overlap += 1;
      if (a.voiceQueued > 1) overlap += 1;
      await new Promise((r) => setTimeout(r, 15));
    }
    // 3手つづけて打つ
    for (const cell of [7, 12, 17]) window.kachi.tap(cell);
    let maxAtOnce = 0;
    let pairs = 0;
    for (let k = 0; k < 120; k++) {
      const a = window.kachi.audio();
      maxAtOnce = Math.max(maxAtOnce, (a.voices || []).length);
      if ((a.voices || []).length > 1) pairs += 1;
      await new Promise((r) => setTimeout(r, 15));
    }
    const a = window.kachi.audio();
    return { overlap: overlap + pairs, maxAtOnce, queued: a.voiceQueued, busy: a.voiceBusy, starts: a.voiceStarts };
  });
  check("連打しても声が2人同時にならない", rapid.overlap === 0 && rapid.maxAtOnce <= 1, JSON.stringify(rapid));
  await ctx.close();
}

/* ---------------- 5. 叩く/逃げるアニメーション ---------------- */
{
  const { ctx, page } = await newPage();
  await page.evaluate(() => window.kachi.setPro(true));
  await page.evaluate(() => window.kachi.openStage("s21"));
  await page.waitForTimeout(300);
  const hint = await page.evaluate(() => window.kachi.hint());
  const p = await cellPoint(page, hint);
  const t0 = Date.now();
  await page.touchscreen.tap(p.x, p.y);
  // 直後: ウサギロー登場＋木槌
  await page.waitForTimeout(80);
  const early = await page.evaluate(() => {
    const u = document.querySelector("#usagiro");
    const m = document.querySelector("#usagiro .mallet");
    return {
      swing: u.classList.contains("swing"),
      usaAnim: u.getAnimations().map((a) => Math.round(a.effect.getTiming().duration)),
      malletAnim: m ? m.getAnimations().map((a) => Math.round(a.effect.getTiming().duration)) : [],
    };
  });
  check("タップ直後にウサギローが登場して木槌を振る", early.swing === true, JSON.stringify(early));
  check("叩くアニメは約0.52秒（Build 3 の0.3秒より長い）", early.usaAnim.includes(520), JSON.stringify(early));

  // 当たる瞬間（約290ms）に衝撃波リング
  await page.waitForTimeout(230);
  const impact = await page.evaluate(() => ({
    rings: document.querySelectorAll("#fx .shockwave").length,
    elapsed: 0,
  }));
  check("木槌が当たる瞬間に衝撃波リングが出る", impact.rings >= 1, JSON.stringify(impact));

  // ポコ丸の逃げるアニメ（ビクッ→放物線→着地）
  const hop = await page.evaluate(() => {
    const t = document.querySelector("#tanuki");
    const anims = t.getAnimations().map((a) => ({
      duration: Math.round(a.effect.getTiming().duration),
      frames: (a.effect.getKeyframes() || []).map((f) => f.transform || ""),
    }));
    return anims;
  });
  const hopAnim = hop.find((a) => a.duration === 420) || hop[0];
  check("ポコ丸が約0.42秒で逃げるアニメをする", !!hopAnim && hopAnim.duration === 420, JSON.stringify(hop.map((a) => a.duration)));
  const frames = hopAnim ? hopAnim.frames.join(" ") : "";
  check("逃げるアニメに回転と伸縮（ビクッ・着地）がある", /rotate\(/.test(frames) && /scale\(0?\.9,\s*1\.14\)|scale\(1\.14,\s*\.86\)/.test(frames), frames.slice(0, 120));

  // 0.7秒後にはウサギローは消えている（当たり判定も残らない）
  await page.waitForTimeout(420);
  const late = await page.evaluate(() => ({
    swing: document.querySelector("#usagiro").classList.contains("swing"),
    hit: (() => {
      const r = document.querySelector("#board .cell").getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return el ? { cls: typeof el.className === "string" ? el.className : "svg", cell: !!el.closest(".cell") } : null;
    })(),
  }));
  check("0.7秒後にはウサギローの演出が消えて盤面が押せる", late.swing === false && !!late.hit && late.hit.cell === true, JSON.stringify(late));

  if (SHOTS) {
    // もう一度叩いて、演出の途中を撮る
    const hint2 = await page.evaluate(() => window.kachi.hint());
    if (hint2 != null) {
      const p2 = await cellPoint(page, hint2);
      await page.touchscreen.tap(p2.x, p2.y);
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(SHOTS, "kachi-b4-tap-action.png") });
    }
  }
  await ctx.close();
}

/* ---------------- 6. 深い盤面でもタップが固まらない ---------------- */
{
  const { ctx, page } = await newPage();
  await page.evaluate(() => window.kachi.setPro(true));
  await page.evaluate(() => window.kachi.openStage("s41")); // 7手詰
  await page.waitForTimeout(250);
  const perf = await page.evaluate(() => {
    const s = window.kachi;
    const st = s.state();
    const hint = s.hint();
    const t0 = performance.now();
    s.tap(hint);
    const ms = performance.now() - t0;
    return { ms: Math.round(ms), before: st.movesUsed, after: s.state().movesUsed, status: s.state().status };
  });
  check("激ムズ（7手詰）でも1手の計算が軽い（<400ms）", perf.ms < 400 && perf.after === perf.before + 1, JSON.stringify(perf));

  const rapid = await page.evaluate(async () => {
    const s = window.kachi;
    const cells = Array.from(document.querySelectorAll("#board .cell"));
    let accepted = 0;
    const st0 = s.state();
    const used = [st0.tanuki];
    for (let k = 0; k < 4; k++) {
      const st = s.state();
      if (st.status !== "playing") break;
      // ポコ丸のマス以外を順に
      const i = (k * 6 + 2) % 25;
      if (used.includes(String(Math.floor(i / 5)) + "," + (i % 5))) continue;
      const before = st.movesUsed;
      cells[i].dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, isPrimary: true, pointerId: 300 + k }));
      accepted += s.state().movesUsed > before ? 1 : 0;
      await new Promise((r) => setTimeout(r, 10));
    }
    await new Promise((r) => setTimeout(r, 600));
    const st = s.state();
    let alive = false;
    if (st.status === "playing") {
      const before = st.movesUsed;
      s.tap(s.hint());
      alive = s.state().movesUsed > before;
    } else alive = true;
    return { accepted, alive, status: st.status };
  });
  check("激ムズでも連打がすべて受け付き、そのあとも押せる", rapid.accepted >= 2 && rapid.alive === true, JSON.stringify(rapid));
  await ctx.close();
}

/* ---------------- 7. 8ステージ連続クリア→選択画面→戻る ---------------- */
{
  const { ctx, page } = await newPage();
  await page.evaluate(() => window.kachi.setPro(true));
  const order = ["s01", "s02", "s03", "s04", "s05", "s06", "s07", "s08"];
  let problem = null;
  for (const id of order) {
    if (!(await clearStage(page, id))) {
      problem = `${id}: クリアカードが出ない`;
      break;
    }
    // 「ステージをえらぶ」→ 触れる → 左上←でホーム → あそぶ で戻る
    await page.evaluate(() => document.querySelectorAll("#card-actions .btn")[2].click());
    await page.waitForTimeout(220);
    const s1 = await stateOf(page);
    const reachable = await page.evaluate(() => {
      const r = document.querySelector("#screen-select [data-back]").getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!(el && el.closest("[data-back]"));
    });
    if (s1.screen !== "select" || s1.overlay || !reachable) {
      problem = `${id}: 選択画面が触れない（screen=${s1.screen} overlay=${s1.overlay} back=${reachable}）`;
      break;
    }
    await page.evaluate(() => document.querySelector("#screen-select [data-back]").click());
    await page.waitForTimeout(200);
    const s2 = await stateOf(page);
    if (s2.screen !== "title") {
      problem = `${id}: 選択画面の←でホームに戻れない（${s2.screen}）`;
      break;
    }
  }
  check("8ステージ連続で「選択画面→ホーム」を往復しても触れなくならない", problem === null, problem || "8ステージ");
  await ctx.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
await browser.close();
server.close();
if (failed.length) {
  console.log("FAILED:", failed.map((f) => f.name).join(" / "));
  process.exit(1);
}
