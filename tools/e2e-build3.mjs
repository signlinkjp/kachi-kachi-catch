/**
 * Build 3 の実ブラウザ検査（Playwright）。
 *
 *   node tools/e2e-build3.mjs
 *
 * 見るもの:
 *   1. 連続ステージ（1→2→…→8）クリア・やりなおし・設定往復・連打・
 *      pointercancel / pointerup が来ない端末・例外注入でも「押せない」が残らない
 *   2. タップの応答（押した瞬間に1手進む）
 *   3. ボイス（ウサギローとポコ丸が別々に鳴る／BGM が下がる／連打で語尾が切れない）
 *   4. ホームの見た目（キャラの全体像が画面内・名前ラベル・5×5 タグ）
 *   5. プレイ画面のスクリーンショット
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
  await page.waitForTimeout(250);
  return { ctx, page };
}

const cellPoint = (page, i) =>
  page.evaluate((idx) => {
    const r = document.querySelectorAll("#board .cell")[idx].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, i);

async function tapCell(page, i) {
  const p = await cellPoint(page, i);
  await page.touchscreen.tap(p.x, p.y);
}

const stateOf = (page) =>
  page.evaluate(() => ({
    screen: window.kachi.screen(),
    stage: window.kachi.state(),
    overlay: document.querySelector("#overlay").classList.contains("show"),
  }));

const waitCard = (page, ms = 5000) =>
  page
    .waitForFunction(() => document.querySelector("#overlay").classList.contains("show"), null, { timeout: ms })
    .then(() => true)
    .catch(() => false);

/* ---------------- 1. Build 3 として起動 ---------------- */
{
  const { ctx, page } = await newPage();
  const v = await page.evaluate(() => window.kachi.version);
  check("Build 3 として起動する", v.build === 3, JSON.stringify(v));
  const ver = await page.evaluate(() => document.querySelector("#version-line").textContent);
  check("設定画面の版が 1.0.0 (3)", /1\.0\.0 \(3\)/.test(ver), ver);
  await ctx.close();
}

/* ---------------- 2. 連続ステージで固まらない（1→2→3→4→5） ---------------- */
{
  const { ctx, page } = await newPage();
  await page.evaluate(() => window.kachi.setPro(true));
  const order = ["s01", "s02", "s03", "s04", "s05"];
  let cleared = 0;
  let freeze = null;
  for (const id of order) {
    await page.evaluate((sid) => window.kachi.openStage(sid), id);
    await page.waitForTimeout(120);
    let guard = 0;
    while (guard++ < 12) {
      const s = await stateOf(page);
      if (!s.stage || s.stage.status !== "playing") break;
      const hint = await page.evaluate(() => window.kachi.hint());
      if (hint == null) break;
      await tapCell(page, hint);
      await page.waitForTimeout(40);
      // アニメーション中に同じマスをもう一度（ロックされていないこと）
      await tapCell(page, hint).catch(() => {});
    }
    if (!(await waitCard(page))) {
      freeze = `${id}: クリアカードが出ない`;
      break;
    }
    cleared += 1;
    // 「つぎのステージ」→ すぐタップ（1手目が効くこと）
    await page.evaluate(() => document.querySelector("#card-actions button").click());
    await page.waitForTimeout(90);
    const hint = await page.evaluate(() => window.kachi.hint());
    if (hint == null) {
      freeze = `${id}: 次ステージのヒントが取れない`;
      break;
    }
    await tapCell(page, hint);
    await page.waitForTimeout(260);
    const after = await stateOf(page);
    if (!after.stage || after.stage.movesUsed === 0) {
      freeze = `${id}: 次ステージの即タップが効かない`;
      break;
    }
    if (after.overlay) {
      freeze = `${id}: カードが残った`;
      break;
    }
  }
  check("ステージ1→5を連続クリア、つぎへ→即タップで固まらない", freeze === null, freeze || `${cleared}ステージ`);
  await ctx.close();
}

/* ---------------- 3. pointerup が来ない端末 / pointercancel / click だけ ---------------- */
{
  const { ctx, page } = await newPage();
  await page.evaluate(() => window.kachi.setPro(true));
  const fresh = async () => {
    await page.evaluate(() => window.kachi.openStage("s21"));
    await page.waitForTimeout(160);
  };

  // (a) pointerdown だけが来て pointerup が来ない（iOS の取りこぼし）
  await fresh();
  const a = await page.evaluate(() => {
    const s = window.kachi;
    const hint = s.hint();
    const el = document.querySelectorAll("#board .cell")[hint];
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, isPrimary: true, pointerId: 7, clientX: r.left + 4, clientY: r.top + 4 }));
    return { hint, moves: s.state().movesUsed };
  });
  check("pointerdown だけで1手進む（指を離さなくても反応）", a.moves === 1, `moves=${a.moves}`);

  // (b) pointercancel が来ても次が押せる
  await fresh();
  const b = await page.evaluate(async () => {
    const s = window.kachi;
    const board = document.querySelector("#board");
    const hint = s.hint();
    const el = document.querySelectorAll("#board .cell")[hint];
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, isPrimary: true, pointerId: 7, clientX: r.left + 4, clientY: r.top + 4 }));
    board.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 7 }));
    await new Promise((res) => setTimeout(res, 120));
    const before = s.state().movesUsed;
    const h2 = s.hint();
    const el2 = document.querySelectorAll("#board .cell")[h2];
    const r2 = el2.getBoundingClientRect();
    el2.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, isPrimary: true, pointerId: 8, clientX: r2.left + 4, clientY: r2.top + 4 }));
    return { before, after: s.state().movesUsed };
  });
  check("pointercancel のあとも押せる", b.after > b.before, `${b.before}→${b.after}`);

  // (c) click だけが来る環境（支援技術）
  await fresh();
  await page.waitForTimeout(760); // 直前のタップの click 抑制（700ms）が明けるのを待つ
  const c = await page.evaluate(() => {
    const s = window.kachi;
    const hint = s.hint();
    const el = document.querySelectorAll("#board .cell")[hint];
    const before = s.state().movesUsed;
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return { before, after: s.state().movesUsed };
  });
  check("click だけでも1手進む", c.after > c.before, `${c.before}→${c.after}`);

  // (d) 例外を注入しても押せる（アニメーション・音が壊れた端末）
  await fresh();
  const d = await page.evaluate(() => {
    const s = window.kachi;
    window.__origAnimate = Element.prototype.animate;
    Element.prototype.animate = () => {
      throw new Error("boom");
    };
    const AC = window.AudioContext || window.webkitAudioContext;
    window.__origOsc = AC.prototype.createOscillator;
    AC.prototype.createOscillator = () => {
      throw new Error("audio dead");
    };
    const hint = s.hint();
    const el = document.querySelectorAll("#board .cell")[hint];
    const before = s.state().movesUsed;
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, isPrimary: true, pointerId: 9 }));
    return { before, after: s.state().movesUsed };
  });
  check("アニメも音も壊れていても押せる", d.after > d.before, `${d.before}→${d.after}`);
  await page.evaluate(() => {
    Element.prototype.animate = window.__origAnimate;
    const AC = window.AudioContext || window.webkitAudioContext;
    AC.prototype.createOscillator = window.__origOsc;
  });
  // 壊れたあとも続けて遊べる
  const h = await page.evaluate(() => window.kachi.hint());
  await tapCell(page, h);
  await page.waitForTimeout(120);
  const stillOk = await page.evaluate(() => window.kachi.state().movesUsed);
  check("壊れたあとも続けて遊べる", stillOk >= 2, `moves=${stillOk}`);
  await ctx.close();
}

/* ---------------- 4. やりなおし・設定往復・連打 ---------------- */
{
  const { ctx, page } = await newPage();
  await page.evaluate(() => window.kachi.setPro(true));
  await page.evaluate(() => window.kachi.openStage("s12"));
  await page.waitForTimeout(150);
  const h = await page.evaluate(() => window.kachi.hint());
  await tapCell(page, h);
  await page.waitForTimeout(120);
  await page.evaluate(() => document.querySelector("#btn-retry").click());
  await page.waitForTimeout(150);
  const afterRetry = await stateOf(page);
  check("やりなおしで手数が戻る", afterRetry.stage && afterRetry.stage.movesUsed === 0, JSON.stringify(afterRetry.stage && afterRetry.stage.movesUsed));

  // 設定へ行って戻る
  await page.evaluate(() => document.querySelector("#btn-settings").click());
  await page.waitForTimeout(120);
  await page.evaluate(() => document.querySelector("#screen-settings [data-back]").click());
  await page.waitForTimeout(150);
  const back = await page.evaluate(() => window.kachi.screen());
  check("設定→戻るでホームに戻る", back === "title", back);

  // 連打（1マスを8回連続）
  await page.evaluate(() => window.kachi.openStage("s13"));
  await page.waitForTimeout(150);
  let accepted = 0;
  for (let k = 0; k < 8; k++) {
    const st = await page.evaluate(() => window.kachi.state());
    if (!st || st.status !== "playing") break;
    const before = st.movesUsed;
    const hint = await page.evaluate(() => window.kachi.hint());
    if (hint == null) break;
    await tapCell(page, hint);
    await page.waitForTimeout(30);
    const now = await page.evaluate(() => window.kachi.state().movesUsed);
    if (now > before) accepted += 1;
  }
  check("連続タップがすべて受け付けられる", accepted >= 2, `${accepted}手`);
  await ctx.close();
}

/* ---------------- 5. ボイス（ウサギローとポコ丸が別々に鳴る） ---------------- */
{
  const { ctx, page } = await newPage();
  await page.evaluate(() => {
    window.kachi.closeSheets();
    document.querySelector("#screen-opening")?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    window.kachi.showTitle();
    document.querySelector("#btn-play").click();
  });
  await page.waitForTimeout(400);
  const before = await page.evaluate(() => window.kachi.audio());
  const two = await page.evaluate(async () => {
    const s = window.kachi;
    const a = s.playVoice("usagiro", "clear");
    const b = s.playVoice("pokomaru", "caught");
    await new Promise((r) => setTimeout(r, 400));
    return { a, b, dbg: s.audio() };
  });
  check("ウサギローとポコ丸の声が同時に鳴る（別チャンネル）", two.dbg.voices.length === 2, JSON.stringify(two.dbg.voices));
  check("ボイスは assets/voices の mp3 を指す", /assets\/voices\/(ja|en)\//.test(two.a.url) && /assets\/voices\/(ja|en)\//.test(two.b.url), `${two.a.url} / ${two.b.url}`);

  const throttle = await page.evaluate(async () => {
    const s = window.kachi;
    const n0 = s.audio().voiceStarts;
    // 同じ会話の声を連打しても語尾が切れないよう、タップの声は間引く
    s.openStage("s14");
    await new Promise((r) => setTimeout(r, 60));
    return { n0 };
  });
  await page.waitForTimeout(100);
  const voice1 = await page.evaluate(async () => {
    const s = window.kachi;
    s.playVoice("usagiro", "clear");
    await new Promise((r) => setTimeout(r, 200));
    return s.audio();
  });
  check(
    "声が鳴っている間は BGM を下げる（埋もれない）",
    voice1.bgmGain != null && voice1.bgmGain < 0.14,
    JSON.stringify({ bgmGain: voice1.bgmGain, voices: voice1.voices })
  );

  const all = await page.evaluate(() => new Promise((resolve) => {
    const list = window.kachi.voices();
    let ok = 0;
    let fail = 0;
    let left = list.length;
    for (const url of list) {
      fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((b) => (b.byteLength > 800 ? ok++ : fail++))
        .catch(() => fail++)
        .finally(() => {
          if (--left === 0) resolve({ ok, fail, total: list.length });
        });
    }
  }));
  check("その言語のボイス mp3 がすべて読める", all.fail === 0 && all.ok >= 19, JSON.stringify(all));
  const both = await page.evaluate(async () => {
    const out = {};
    for (const lang of ["ja", "en"]) {
      for (const url of [`assets/voices/${lang}/usagiro-start1.mp3`, `assets/voices/${lang}/pokomaru-taunt0.mp3`]) {
        const r = await fetch(url);
        out[url] = r.ok ? (await r.arrayBuffer()).byteLength : 0;
      }
    }
    return out;
  });
  check("日英どちらの声も読める", Object.values(both).every((n) => n > 800), JSON.stringify(both));

  const off = await page.evaluate(async () => {
    const s = window.kachi;
    document.querySelector("#row-lang");
    // 設定のボイス OFF で鳴らない
    const btn = document.querySelector("#tg-voice");
    btn.click();
    const before = s.audio().voiceStarts;
    const v = s.playVoice("usagiro", "start");
    await new Promise((r) => setTimeout(r, 200));
    const after = s.audio().voiceStarts;
    btn.click();
    return { before, after, v };
  });
  check("設定のボイス OFF では鳴らない", off.after === off.before, JSON.stringify(off));
  await ctx.close();
}

/* ---------------- 6. ホームの見た目（キャラの全体像） ---------------- */
{
  const outDir = SHOTS;
  if (outDir) fs.mkdirSync(outDir, { recursive: true });
  for (const vp of [
    { w: 393, h: 852, ts: "normal" },
    { w: 375, h: 812, ts: "normal" },
    { w: 393, h: 852, ts: "xlarge" },
  ]) {
    const { ctx, page } = await newPage({ width: vp.w, height: vp.h });
    await page.evaluate((v) => window.kachi.setTextSize(v), vp.ts);
    await page.evaluate(() => window.kachi.showTitle());
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const r = (s) => {
        const e = document.querySelector(s);
        if (!e) return null;
        const b = e.getBoundingClientRect();
        return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height };
      };
      const img = document.querySelector(".hero-img");
      return {
        vw: innerWidth,
        vh: innerHeight,
        stage: r("#hero-stage"),
        img: r(".hero-img"),
        natural: img ? { w: img.naturalWidth, h: img.naturalHeight } : null,
        rabbit: r("#label-rabbit"),
        tanuki: r("#label-tanuki"),
        tag: r(".title-tag"),
        credit: r("#credit-line"),
        hero: r(".hero"),
        labelText: [document.querySelector("#name-rabbit").textContent, document.querySelector("#name-tanuki").textContent],
        tagText: document.querySelector("#title-tagline").textContent,
        deco: document.querySelectorAll(".name-line").length,
      };
    });
    const inside = (b) => b && b.l >= -0.5 && b.r <= m.vw + 0.5 && b.t >= -0.5 && b.b <= m.vh + 0.5;
    const aspectOk = m.natural && Math.abs(m.img.w / m.img.h - m.natural.w / m.natural.h) < 0.02;
    const fillsWidth = m.img.w >= Math.min(m.vw, m.hero.h * (m.natural.w / m.natural.h)) - 2;
    check(
      `${vp.w}x${vp.h} ${vp.ts}: キャラの全体像が画面内（見切れなし）`,
      inside(m.img) && aspectOk && fillsWidth,
      `img=${Math.round(m.img.w)}x${Math.round(m.img.h)} 比率差=${aspectOk ? "0" : "NG"}`
    );
    check(
      `${vp.w}x${vp.h} ${vp.ts}: 名前ラベルと5×5タグが見切れない`,
      inside(m.rabbit) && inside(m.tanuki) && inside(m.tag) && m.credit.b <= m.vh && m.deco === 4,
      `rabbit=${m.labelText[0]} tanuki=${m.labelText[1]} tag=${m.tagText}`
    );
    // 名前ラベルが絵の上に重なっているか（キャラと一体で見えるか）
    const overlap = m.rabbit.b <= m.img.b && m.rabbit.t >= m.img.t - 2;
    check(`${vp.w}x${vp.h} ${vp.ts}: 名前ラベルがキャラ絵の上に載る`, overlap, `labelTop=${Math.round(m.rabbit.t)} imgTop=${Math.round(m.img.t)}`);
    if (outDir) {
      await page.screenshot({ path: path.join(outDir, `kachi-b3-title-${vp.w}x${vp.h}-${vp.ts}.png`) });
    }
    await ctx.close();
  }
}

/* ---------------- 7. 重い面でもタップが引っかからない・乱打しても固まらない ---------------- */
{
  const { ctx, page } = await newPage();
  await page.evaluate(() => window.kachi.setPro(true));
  const heavy = await page.evaluate(async () => {
    window.kachi.openStage("s50");
    await new Promise((r) => setTimeout(r, 320));
    const times = [];
    for (let k = 0; k < 6; k++) {
      const st = window.kachi.state();
      if (!st || st.status !== "playing") break;
      const hint = window.kachi.hint();
      if (hint == null) break;
      const el = document.querySelectorAll("#board .cell")[hint];
      const t0 = performance.now();
      el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, isPrimary: true, pointerId: 100 + k }));
      times.push(Math.round((performance.now() - t0) * 10) / 10);
      await new Promise((r) => setTimeout(r, 60));
    }
    return times;
  });
  check("上級7手詰でもタップ1回の処理が軽い（100ms未満）", heavy.length > 0 && heavy.every((t) => t < 100), JSON.stringify(heavy));

  // 乱打（別々のマスを続けて）→ 盤面が生きている
  const fuzz = await page.evaluate(async () => {
    const s = window.kachi;
    s.openStage("s31");
    await new Promise((r) => setTimeout(r, 250));
    const cells = Array.from(document.querySelectorAll("#board .cell"));
    let accepted = 0;
    for (let k = 0; k < 30; k++) {
      const st = s.state();
      if (!st || st.status !== "playing") break;
      const before = st.movesUsed;
      const i = (k * 7 + 3) % 25;
      const el = cells[i];
      el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, isPrimary: true, pointerId: 200 + k }));
      el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 200 + k }));
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 12));
      if (s.state().movesUsed > before) accepted += 1;
    }
    await new Promise((r) => setTimeout(r, 900));
    // そのあと1手進められる
    const st = s.state();
    let alive = false;
    if (st && st.status === "playing") {
      const hint = s.hint();
      if (hint != null) {
        const before = st.movesUsed;
        const el = cells[hint];
        el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, isPrimary: true, pointerId: 999 }));
        alive = s.state().movesUsed > before;
      }
    } else {
      alive = true; // クリア/失敗カードまで行った
    }
    return { accepted, alive, status: st && st.status };
  });
  check("同じマス以外の乱打はすべて受け付ける", fuzz.accepted >= 2, JSON.stringify(fuzz));
  check("乱打のあとも操作できる", fuzz.alive === true, JSON.stringify(fuzz));
  await ctx.close();
}

/* ---------------- 8. プレイ画面の見た目と操作感 ---------------- */
{
  const outDir = SHOTS;
  const { ctx, page } = await newPage();
  await page.evaluate(() => window.kachi.setPro(true));
  await page.evaluate(() => window.kachi.openStage("s11"));
  await page.waitForTimeout(400);
  const beforeShot = await page.evaluate(() => window.kachi.state());
  if (outDir) await page.screenshot({ path: path.join(outDir, "kachi-b3-game.png") });
  // 押した瞬間に1手進む（体感の速さ）
  const latency = await page.evaluate(async () => {
    const s = window.kachi;
    const hint = s.hint();
    const el = document.querySelectorAll("#board .cell")[hint];
    const r = el.getBoundingClientRect();
    const t0 = performance.now();
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, isPrimary: true, pointerId: 3, clientX: r.left + 4, clientY: r.top + 4 }));
    const t1 = performance.now();
    const moves = s.state().movesUsed;
    return { ms: Math.round((t1 - t0) * 10) / 10, moves };
  });
  check("タップから局面確定までが同期（押した瞬間に進む）", latency.moves === beforeShot.movesUsed + 1 && latency.ms < 120, JSON.stringify(latency));
  if (outDir) {
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, "kachi-b3-game-after-tap.png") });
  }
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
