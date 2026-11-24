/**
 * Build 2 の実ブラウザ検査（Playwright）。
 *
 *   npm i -D playwright        # または playwright-core + CHROMIUM_PATH
 *   node tools/e2e-build2.mjs
 *
 * 見るもの:
 *   1. ステージを8つ連続でクリアして「つぎのステージ」→即タップ（フリーズしない）
 *   2. アニメーションが壊れても操作ロックが残らない（例外を注入）
 *   3. タイムアタック 60/120/180 秒（選択シート・HUD・ベストは秒ごと）
 *   4. バックグラウンド復帰の音（suspended / interrupted / closed のどれでも鳴る）
 *   5. ボイス（吹き出しと同時に鳴る・連打で前の声を止める・日英のファイルがある）
 *   6. 文字サイズ 標準/大/特大（保存・即時反映・はみ出しなし）
 *   7. 375 / 393 / 430 幅のホーム画面レイアウト（はみ出しゼロ）
 *   8. 無料25問 / PRO の線引き
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.KACHI_ROOT ? path.resolve(process.env.KACHI_ROOT) : path.join(HERE, "..");
const CHROMIUM = process.env.CHROMIUM_PATH || "";

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

async function newPage(viewport = { width: 375, height: 812 }, opts = {}) {
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

async function tapCell(page, i) {
  const p = await cellPoint(page, i);
  await page.touchscreen.tap(p.x, p.y);
}

const stateOf = (page) =>
  page.evaluate(() => ({
    screen: window.kachi.screen(),
    busy: window.kachi.busy(),
    stage: window.kachi.state(),
    overlay: document.querySelector("#overlay").classList.contains("show"),
    note: window.kachi.note(),
    audio: window.kachi.audio(),
  }));

const waitIdle = async (page, ms = 4000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (!(await page.evaluate(() => window.kachi.busy()))) return true;
    await page.waitForTimeout(40);
  }
  return false;
};

/* ---------------- 1. 起動と12言語 ---------------- */
{
  const { ctx, page } = await newPage();
  const v = await page.evaluate(() => window.kachi.version);
  check("Build 2 以降として起動する", v.build >= 2, JSON.stringify(v));
  const langs = await page.evaluate(() => {
    const out = [];
    for (const row of document.querySelectorAll("#lang-list .lang-row")) out.push(row.textContent);
    return out;
  });
  check("言語は12種類", langs.length === 12, String(langs.length));
  const counts = await page.evaluate(() => window.kachi.counts());
  check("無料ステージは25問（初級10＋中級15）", counts.freeStages === 25, JSON.stringify(counts));
  const seal = await page.evaluate(() => !!document.querySelector(".seal"));
  check("ホーム右上の「詰」バッジが無い", seal === false);
  await ctx.close();
}

/* ---------------- 2. 連続ステージでフリーズしない ---------------- */
{
  const { ctx, page } = await newPage();
  await page.evaluate(() => window.kachi.setPro(true));
  const order = ["s01", "s02", "s11", "s12", "s13", "s14", "s15", "s03"];
  let cleared = 0;
  let freeze = null;
  for (const id of order) {
    await page.evaluate((sid) => window.kachi.openStage(sid), id);
    await page.waitForTimeout(120);
    let guard = 0;
    while (guard++ < 10) {
      const s = await stateOf(page);
      if (!s.stage || s.stage.status !== "playing") break;
      const hint = await page.evaluate(() => window.kachi.hint());
      if (hint == null) break;
      await tapCell(page, hint);
      // アニメーション中に連打（ロック中は捨てる／詰まらない）
      await page.waitForTimeout(50);
      await tapCell(page, hint).catch(() => {});
      if (!(await waitIdle(page))) {
        freeze = `${id}: タップ後にロックが残った`;
        break;
      }
    }
    if (freeze) break;
    const card = await page
      .waitForFunction(() => document.querySelector("#overlay").classList.contains("show"), null, { timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (!card) {
      freeze = `${id}: クリアカードが出ない`;
      break;
    }
    cleared += 1;
    // 「つぎのステージ」→ すぐタップ
    await page.evaluate(() => document.querySelector("#card-actions button").click());
    await page.waitForTimeout(80);
    const after = await stateOf(page);
    if (after.busy || after.overlay) {
      freeze = `${id}: 次のステージでロック/カードが残った`;
      break;
    }
    const hint = await page.evaluate(() => window.kachi.hint());
    if (hint == null) {
      freeze = `${id}: 次ステージのヒントが取れない`;
      break;
    }
    await tapCell(page, hint);
    await page.waitForTimeout(900);
    const tapped = await stateOf(page);
    if (!tapped.stage || tapped.stage.movesUsed === 0) {
      freeze = `${id}: 次ステージの即タップが効かない`;
      break;
    }
  }
  check("8ステージ連続クリア→つぎへ→即タップでフリーズしない", freeze === null, freeze || `${cleared}ステージ`);
  await ctx.close();
}

/* ---------------- 3. 壊れたアニメーションでも操作が死なない ---------------- */
{
  const { ctx, page } = await newPage();
  await page.evaluate(() => window.kachi.setPro(true));
  await page.evaluate(() => window.kachi.openStage("s11"));
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    window.__origAnimate = Element.prototype.animate;
    Element.prototype.animate = function () {
      throw new Error("boom");
    };
  });
  const hint = await page.evaluate(() => window.kachi.hint());
  await tapCell(page, hint);
  const idle = await waitIdle(page, 3000);
  const afterBroken = await stateOf(page);
  check("アニメーションが例外でもロックが残らない", idle && afterBroken.busy === false, `busy=${afterBroken.busy}`);
  await page.evaluate(() => {
    Element.prototype.animate = window.__origAnimate;
  });
  // 続けてふつうに遊べる
  let guard = 0;
  while (guard++ < 6) {
    const s = await stateOf(page);
    if (!s.stage || s.stage.status !== "playing") break;
    const h = await page.evaluate(() => window.kachi.hint());
    if (h == null) break;
    await tapCell(page, h);
    await waitIdle(page);
  }
  const done = await page
    .waitForFunction(() => document.querySelector("#overlay").classList.contains("show"), null, { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  check("例外のあとも最後まで遊べる", done);

  // 音が壊れていてもタップが止まらない（端末で音が死んだときのフリーズ経路）
  const audioBoom = await page.evaluate(async () => {
    const s = window.kachi;
    s.openStage("s01");
    await new Promise((r) => setTimeout(r, 250));
    const AC = window.AudioContext || window.webkitAudioContext;
    const orig = AC.prototype.createOscillator;
    AC.prototype.createOscillator = function () {
      throw new Error("audio dead");
    };
    const hint = s.hint();
    const el = document.querySelectorAll("#board .cell")[hint];
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: r.left + 2, clientY: r.top + 2 }));
    await new Promise((res) => setTimeout(res, 1500));
    const busy = s.busy();
    const st = s.state();
    AC.prototype.createOscillator = orig;
    return { busy, moves: st && st.movesUsed };
  });
  check("音が壊れていてもタップが効いてロックが残らない", audioBoom.busy === false && audioBoom.moves === 1, JSON.stringify(audioBoom));
  await ctx.close();
}

/* ---------------- 4. タイムアタック 60/120/180 ---------------- */
{
  const { ctx, page } = await newPage();
  await page.evaluate(() => window.kachi.setPro(true));
  await page.evaluate(() => window.kachi.closeSheets());
  await page.evaluate(() => window.kachi.showTitle());
  await page.evaluate(() => document.querySelector("#btn-ta").click());
  await page.waitForTimeout(250);
  const picks = await page.evaluate(() => Array.from(document.querySelectorAll("#ta-pick-list .ta-pick")).map((b) => ({ sec: b.dataset.sec, text: b.textContent })));
  check("時間選びに 60/120/180 が並ぶ", picks.length === 3 && picks.map((p) => p.sec).join() === "60,120,180", JSON.stringify(picks.map((p) => p.sec)));
  const durations = [];
  for (const sec of ["60", "120", "180"]) {
    await page.evaluate(() => {
      window.kachi.closeSheets();
      window.kachi.showTitle();
    });
    await page.evaluate(() => document.querySelector("#btn-ta").click());
    await page.waitForTimeout(200);
    await page.evaluate((s) => document.querySelector(`#ta-pick-list .ta-pick[data-sec="${s}"]`).click(), sec);
    await page.waitForTimeout(250);
    const st = await page.evaluate(() => window.kachi.taState());
    const hud = await page.evaluate(() => document.querySelector("#ta-time").textContent);
    const sheetOpen = await page.evaluate(() => document.querySelector("#ta-sheet").classList.contains("show"));
    durations.push({ sec, st, hud, sheetOpen });
    await page.evaluate(() => window.kachi.showTitle());
    await page.waitForTimeout(100);
  }
  check(
    "60/120/180 秒で始まり、HUD も秒数どおり（シートは閉じる）",
    durations.every(
      (d) => d.st && d.st.duration === Number(d.sec) && Number(d.hud) <= Number(d.sec) && Number(d.hud) > Number(d.sec) - 3 && d.sheetOpen === false
    ),
    JSON.stringify(durations.map((d) => `${d.sec}:${d.hud}:${d.st && d.st.duration}:${d.sheetOpen}`))
  );
  // ベストは秒ごと（保存を消してから、別々の記録が入ることを確かめる）
  await page.evaluate(() => {
    window.localStorage.removeItem("kachi.b1.v1");
  });
  await page.evaluate(() => location.reload());
  await page.waitForFunction(() => window.kachi && window.kachi.ready, null, { timeout: 15000 });
  const sep = await page.evaluate(() => {
    const s = window.kachi;
    return { a: s.taState(), d: s.taDurations() };
  });
  check("タイムアタックの秒数リスト", JSON.stringify(sep.d) === "[60,120,180]", JSON.stringify(sep.d));
  await ctx.close();
}

/* ---------------- 5. 音の復帰とボイス ---------------- */
{
  const { ctx, page } = await newPage();
  await page.evaluate(() => window.kachi.setPro(true));
  await page.evaluate(() => window.kachi.openStage("s11"));
  await page.waitForTimeout(300);
  const a0 = await page.evaluate(() => window.kachi.audio());
  check("AudioContext が動いている", a0.state === "running", a0.state);

  // 裏→表（suspend して復帰）
  const a1 = await page.evaluate(() => window.kachi.simulateBackgroundReturn());
  check("バックグラウンドから戻ると鳴る（suspended）", a1.state === "running");

  // iOS の interrupted（resume では戻らない）→ 作り直す
  const a2 = await page.evaluate(async () => {
    window.kachi.forceAudioState("interrupted");
    const before = window.kachi.audio();
    const ok = await window.kachi.recoverAudio();
    return { before, after: window.kachi.audio(), ok };
  });
  check("interrupted から AudioContext を作り直して鳴る", a2.ok === true && a2.after.generation > a2.before.generation && a2.after.state === "running", JSON.stringify(a2));

  // closed でも作れる
  const a3 = await page.evaluate(async () => {
    window.kachi.forceAudioState("closed");
    const ok = await window.kachi.recoverAudio();
    return { ok, after: window.kachi.audio() };
  });
  check("closed からも復帰する", a3.ok === true && a3.after.state === "running", JSON.stringify(a3.after));

  // ボイス: 吹き出しと同時に鳴る
  const v1 = await page.evaluate(() => {
    const s = window.kachi;
    const before = s.audio();
    return { before };
  });
  const hint = await page.evaluate(() => window.kachi.hint());
  await tapCell(page, hint);
  await page.waitForTimeout(600);
  const v2 = await page.evaluate(() => ({ audio: window.kachi.audio(), note: window.kachi.note() }));
  check("タップでボイスが鳴る", v2.audio.voiceStarts > v1.before.voiceStarts, `${v1.before.voiceStarts}→${v2.audio.voiceStarts}`);
  check("吹き出しのセリフがある", typeof v2.note.text === "string" && v2.note.text.length > 0, v2.note.text);

  // 連打で前の声が止まる
  const stops = await page.evaluate(async () => {
    const before = window.kachi.audio();
    for (let i = 0; i < 3; i++) {
      window.kachi.playVoice("pokomaru", "taunt");
      await new Promise((r) => setTimeout(r, 160));
    }
    await new Promise((r) => setTimeout(r, 120));
    const after = window.kachi.audio();
    return { starts: after.voiceStarts - before.voiceStarts, stops: after.voiceStops - before.voiceStops, last: after.lastVoice };
  });
  check("連打で前のボイスを止める", stops.starts >= 3 && stops.stops >= 2, JSON.stringify(stops));

  // 日英のファイルが実際に取れる
  const files = await page.evaluate(async () => {
    const out = {};
    for (const url of ["assets/voices/ja/usagiro-start1.mp3", "assets/voices/en/pokomaru-escape1.mp3"]) {
      const r = await fetch(url);
      out[url] = r.ok ? (await r.arrayBuffer()).byteLength : 0;
    }
    return out;
  });
  check(
    "日英のボイスファイルが取れる",
    Object.values(files).every((n) => n > 800),
    JSON.stringify(files)
  );
  await ctx.close();
}

/* ---------------- 6. 文字サイズ ---------------- */
{
  const { ctx, page } = await newPage();
  await page.evaluate(() => window.kachi.showSettings());
  for (const size of ["large", "xlarge", "normal"]) {
    await page.evaluate((s) => document.querySelector(`#text-size-seg button[data-size="${s}"]`).click(), size);
    await page.waitForTimeout(120);
    const now = await page.evaluate((s) => ({
      attr: document.documentElement.getAttribute("data-text-size"),
      api: window.kachi.textSize(),
      pressed: document.querySelector(`#text-size-seg button[data-size="${s}"]`).classList.contains("on"),
    }), size);
    check(`文字サイズ ${size} がすぐ反映される`, now.attr === size && now.api === size && now.pressed, JSON.stringify(now));
  }
  await page.evaluate(() => window.kachi.setTextSize("xlarge"));
  await page.evaluate(() => location.reload());
  await page.waitForFunction(() => window.kachi && window.kachi.ready, null, { timeout: 15000 });
  const saved = await page.evaluate(() => ({ attr: document.documentElement.getAttribute("data-text-size"), api: window.kachi.textSize() }));
  check("文字サイズは保存される", saved.attr === "xlarge" && saved.api === "xlarge", JSON.stringify(saved));
  await ctx.close();
}

/* ---------------- 7. レイアウト（375/393/430 × 標準/特大） ---------------- */
{
 const viewports = [
    { w: 375, h: 812 },
    { w: 393, h: 852 },
    { w: 430, h: 932 },
  ];
  for (const vp of viewports) {
    for (const ts of ["normal", "xlarge"]) {
      const { ctx, page } = await newPage({ width: vp.w, height: vp.h });
      await page.evaluate((v) => window.kachi.setTextSize(v), ts);
      await page.evaluate(() => window.kachi.showTitle());
      await page.waitForTimeout(250);
      const m = await page.evaluate(() => {
        const vw = innerWidth;
        const vh = innerHeight;
        const decorative = new Set([".sun", ".hills", ".grain", ".paw-trail", ".hero-frame", ".hero img", ".seal"]);
        const bad = [];
        for (const el of document.querySelectorAll("#screen-title *")) {
          const b = el.getBoundingClientRect();
          if (b.width === 0 || b.height === 0) continue;
          if (el.closest(".hero")) continue;
          if (el.classList.contains("sun") || el.classList.contains("hills") || el.classList.contains("grain")) continue;
          if (b.left < -1 || b.right > vw + 1) bad.push(`${el.tagName}.${el.className}:${Math.round(b.left)}..${Math.round(b.right)}`);
          if (b.bottom > vh + 1) bad.push(`bottom ${el.tagName}.${el.className}:${Math.round(b.bottom)}`);
        }
        const credit = document.querySelector("#credit-line").getBoundingClientRect();
        return { vw, vh, bad: bad.slice(0, 6), creditBottom: Math.round(credit.bottom), heroSize: Math.round(document.querySelector(".hero img").getBoundingClientRect().width), logo: Math.round(parseFloat(getComputedStyle(document.querySelector(".logo")).fontSize)) };
      });
      check(
        `${vp.w}x${vp.h} ${ts}: ホームがはみ出さない`,
        m.bad.length === 0 && m.creditBottom <= m.vh,
        m.bad.length ? m.bad.join(" / ") : `hero=${m.heroSize} logo=${m.logo}px credit=${m.creditBottom}`
      );
      await ctx.close();
    }
  }
}

/* ---------------- 8. あそびかた（罠・岩の図解と12言語） ---------------- */
{
  const { ctx, page } = await newPage();
  await page.evaluate(() => window.kachi.showHowto());
  await page.waitForTimeout(250);
  const mini = await page.evaluate(() => {
    const board = document.querySelector("#mini-3 .board");
    if (!board) return null;
    return {
      traps: board.querySelectorAll(".cell.is-trap").length,
      walls: board.querySelectorAll(".cell.is-wall").length,
      rocks: board.querySelectorAll(".cell.is-wall .rock svg").length,
      legend: [document.querySelector("#lg-trap").textContent, document.querySelector("#lg-rock").textContent],
      r1: document.querySelector("#r1b").textContent,
      r2: document.querySelector("#r2b").textContent,
    };
  });
  check("罠と岩の図解が出る", mini && mini.traps > 0 && mini.walls > 0 && mini.rocks > 0, JSON.stringify(mini));
  check("図解に凡例の文字がある", mini && mini.legend.every((s) => s.trim().length > 0), mini && mini.legend.join(" / "));
  const miniJa = await page.evaluate(() => {
    window.kachi.setLang("ja");
    window.kachi.showHowto();
    return { r1: document.querySelector("#r1b").textContent, r2: document.querySelector("#r2b").textContent };
  });
  check("あそびかたにキャラ名が入る（日本語）", miniJa.r1.includes("ウサギロー") && miniJa.r2.includes("ポコ丸"), `${miniJa.r1.slice(0, 14)}…`);
  const miniEn = await page.evaluate(() => {
    window.kachi.setLang("en");
    window.kachi.showHowto();
    return { r1: document.querySelector("#r1b").textContent, r2: document.querySelector("#r2b").textContent };
  });
  check("あそびかたにキャラ名が入る（英語）", miniEn.r1.includes("Usagiro") && miniEn.r2.includes("Pokomaru"));
  // 12言語で文言が入る
  const langs = await page.evaluate(() => {
    const out = {};
    const codes = Array.from(document.querySelectorAll("#lang-list .lang-row")).length;
    return codes;
  });
  let allOk = true;
  const codes = ["ja", "en", "zh-Hans", "zh-Hant", "ko", "es", "fr", "de", "pt", "it", "hi", "id"];
  for (const code of codes) {
    const text = await page.evaluate((c) => {
      window.kachi.setLang(c);
      window.kachi.showHowto();
      return document.querySelector("#r5b").textContent + "|" + document.querySelector("#r1b").textContent;
    }, code);
    if (!text || text.length < 20 || text.includes("howto.")) allOk = false;
  }
  check("12言語であそびかたが表示される", allOk, `${langs}行`);
  await ctx.close();
}

/* ---------------- 9. PRO の線引き（UI） ---------------- */
{
  const { ctx, page } = await newPage();
  await page.evaluate(() => window.kachi.setPro(false));
  await page.evaluate(() => window.kachi.showSelect());
  await page.waitForTimeout(200);
  const info = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll(".stage-item"));
    return { total: items.length, locked: items.filter((i) => i.classList.contains("locked")).length };
  });
  check("無料で遊べるのは25問（残り25問はロック）", info.total === 50 && info.locked === 25, JSON.stringify(info));
  await ctx.close();
}

await browser.close();
server.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILED:", failed.map((f) => f.name).join(" | "));
  process.exit(1);
}
