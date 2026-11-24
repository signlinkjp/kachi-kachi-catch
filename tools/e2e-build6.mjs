/**
 * Build 6 の実ブラウザ検査（Playwright）。
 *
 *   node tools/e2e-build6.mjs
 *   KACHI_SHOTS=/workspace/downloads node tools/e2e-build6.mjs   # スクリーンショットも保存
 *
 * 見るもの:
 *   1. Build 6 として起動（版 1.0.0 (6)）
 *   2. BUG: ゲーム終了と同時にステージ選択へ飛ばされる不具合
 *      - 盤面の下段（カードのボタンと重なるマス）を押しっぱなしにして失敗させ、
 *        カードが出てから指を離す（iOS のゴーストクリック）→ ステージ選択へ飛ばない
 *      - クリアでも同じ（最後の1手がカードのボタンの下にあるステージで再現）
 *      - ガードが明けたあとは「ステージをえらぶ」「やりなおす」が普通に押せる
 *   3. オープニング: 丸枠なしの全身キャラ2人が足を動かして走り抜ける
 *      - 4コマのスプライトが切り替わる（背景位置が4段階で進む）
 *      - 位置は transform で右から左へ、足場の弾みも付く
 *      - 走り去ったあとにタイトルが出る／タップで即スキップ
 *   4. 既存の遊び（1手打つ・クリア・カードのボタン）が壊れていない
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
  await ctx.addInitScript(() => {
    try {
      localStorage.clear();
    } catch {}
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e && e.message ? e.message : e)));
  const cdp = await ctx.newCDPSession(page);
  await page.goto(`http://127.0.0.1:${port}/index.html`);
  await page.waitForFunction(() => window.kachi && window.kachi.ready);
  return { ctx, page, errors, cdp };
}

const state = (page) => page.evaluate(() => window.kachi.state());
const screenOf = (page) => page.evaluate(() => window.kachi.screen());
const shot = async (page, name) => {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name) });
};

/** マスの中心（CSS px） */
const cellPoint = (page, i) =>
  page.evaluate((idx) => {
    const c = document.querySelectorAll("#board .cell")[idx];
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, i);

/** 結果カードのボタンの矩形（CSS px） */
const cardButtons = (page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll("#card-actions .btn")).map((b) => {
      const r = b.getBoundingClientRect();
      return { label: (b.textContent || "").trim(), left: r.left, right: r.right, top: r.top, bottom: r.bottom, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    })
  );

/** 指を置く→待つ→離す（iOS のゴーストクリック相当。click は離した位置の要素へ飛ぶ） */
async function pressAndHold(cdp, x, y, holdMs) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
  await new Promise((r) => setTimeout(r, holdMs));
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/* ---------------- 1. 起動と版 ---------------- */
{
  const { ctx, page, errors } = await newPage();
  const version = await page.evaluate(() => window.kachi.version);
  check("Build 6 として起動する（1.0.0 (6)）", version.marketing === "1.0.0" && version.build === 6, JSON.stringify(version));
  const settings = await page.evaluate(() => {
    window.kachi.showSettings();
    return document.querySelector("#version-line").textContent.trim();
  });
  check("設定画面の版表記が 1.0.0 (6)", /1\.0\.0 \(6\)/.test(settings), settings);
  check("起動時にページエラーが無い", errors.length === 0, errors.join(" / "));
  await ctx.close();
}

/* ---------------- 2. オープニング（全身キャラの走り） ---------------- */
{
  const { ctx, page, errors } = await newPage();
  await page.evaluate(() => window.kachi.setLang("ja"));
  await page.evaluate(() => window.kachi.showOpening());
  await page.waitForTimeout(120);

  // 全身キャラ2人。丸枠（トークン画像・丸いクリップ）ではない
  const shapes = await page.evaluate(() => {
    const out = {};
    for (const [k, sel] of [
      ["tanuki", "#chase-tanuki .run-body"],
      ["rabbit", "#chase-usagiro .run-body"],
    ]) {
      const el = document.querySelector(sel);
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      out[k] = {
        w: Math.round(r.width),
        h: Math.round(r.height),
        radius: cs.borderRadius,
        bg: cs.backgroundImage.replace(/^.*\//, "").replace(/".*$/, ""),
        hasImg: !!el.querySelector("img"),
      };
    }
    return out;
  });
  const fullBody = Object.values(shapes).every((s) => s.h / s.w > 0.9 && s.radius === "0px" && !s.hasImg);
  check(
    "オープニングは丸枠なしの全身キャラ2人（縦長・丸クリップなし・画像タグなし）",
    fullBody && /tanuki_run\.png/.test(shapes.tanuki.bg) && /rabbit_run\.png/.test(shapes.rabbit.bg),
    JSON.stringify(shapes)
  );

  // 4コマのコマ送り: 背景位置が 4段階で進む
  const frames = await page.evaluate(() => {
    const el = document.querySelector("#chase-tanuki .run-body");
    const seen = [];
    for (const a of el.getAnimations()) {
      a.pause();
      for (const t of [12.5, 37.5, 62.5, 87.5]) {
        a.currentTime = (a.effect.getTiming().duration * t) / 100;
        seen.push(getComputedStyle(el).backgroundPosition);
      }
    }
    return seen;
  });
  const uniq = [...new Set(frames)];
  check("走りは4コマのコマ送り（背景位置が4段階に変わる）", uniq.length === 4, `${uniq.length}段階: ${uniq.join(" / ")}`);

  // 位置は transform で右から左へ動く（走っている）
  const pathX = await page.evaluate(() => {
    const el = document.querySelector("#chase-tanuki");
    const a = el.getAnimations().find((x) => x.animationName === "chaseTanuki");
    const dur = a.effect.getTiming().duration;
    const xs = [];
    for (const p of [0.1, 0.5, 0.9]) {
      a.pause();
      a.currentTime = dur * p;
      const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      xs.push(Math.round(m.m41));
    }
    return xs;
  });
  check("ポコ丸が右から左へ走り抜ける（transform で移動）", pathX[0] > pathX[1] && pathX[1] > pathX[2], JSON.stringify(pathX));

  // 走り去ったあと: キャラは消えてタイトルが出る
  await page.evaluate(() => {
    for (const a of document.getAnimations()) {
      a.pause();
      a.currentTime = 1600;
    }
  });
  await page.waitForTimeout(90);
  await shot(page, "kachi-b6-opening-1600ms.png");
  const end = await page.evaluate(() => ({
    runnerOpacity: getComputedStyle(document.querySelector("#chase-usagiro")).opacity,
    tanukiOpacity: getComputedStyle(document.querySelector("#chase-tanuki")).opacity,
    titleOpacity: getComputedStyle(document.querySelector("#open-title")).opacity,
    title: document.querySelector("#open-title").textContent.trim(),
  }));
  check(
    "走り去ったあとはキャラが消えてタイトルが出る",
    Number(end.runnerOpacity) === 0 && Number(end.tanukiOpacity) === 0 && Number(end.titleOpacity) > 0.9,
    JSON.stringify(end)
  );

  // タップで即スキップ（オープニングはタップを邪魔しない）
  await page.evaluate(() => window.kachi.showOpening());
  await page.waitForTimeout(120);
  await page.touchscreen.tap(196, 300);
  await page.waitForTimeout(200);
  check("オープニングはタップで即スキップできる", (await screenOf(page)) === "title");
  check("オープニングのページエラーが無い", errors.length === 0, errors.join(" / "));
  await ctx.close();
}

/* ---------------- 3. BUG: ゲーム終了と同時にステージ選択へ飛ばされる ---------------- */
{
  const { ctx, page, errors, cdp } = await newPage();
  await page.evaluate(() => window.kachi.setLang("ja"));
  await page.evaluate(() => window.kachi.showTitle());
  await page.waitForTimeout(120);

  // 盤面の下段（結果カードのボタンと重なる位置）に「失敗する合法手」があるステージを探す
  let target = null;
  for (const id of ["s01", "s02", "s03", "s04", "s05", "s06"]) {
    await page.evaluate((sid) => window.kachi.openStage(sid), id);
    await page.waitForTimeout(180);
    const hintCell = await page.evaluate(() => window.kachi.hint());
    let failCell = -1;
    for (const i of [20, 21, 22, 24, 19, 18, 15]) {
      if (i === hintCell) continue;
      const ok = await page.evaluate((n) => window.kachi.tap(n), i);
      if (!ok) continue;
      const st = await state(page);
      if (st && st.status === "fail") {
        failCell = i;
        break;
      }
      await page.evaluate((sid) => window.kachi.openStage(sid), id);
      await page.waitForTimeout(140);
    }
    if (failCell >= 0) {
      await page.waitForTimeout(360);
      const btns = await cardButtons(page);
      const pt = await cellPoint(page, failCell);
      const under = btns.find((b) => pt.x >= b.left && pt.x <= b.right && pt.y >= b.top && pt.y <= b.bottom);
      if (under) {
        target = { id, failCell, button: under.label, x: pt.x, y: pt.y };
        break;
      }
    }
    await page.evaluate(() => window.kachi.showTitle());
    await page.waitForTimeout(80);
  }
  check("調査: 失敗カードのボタンの下に重なるマスがある", !!target, JSON.stringify(target));

  if (target) {
    // 本番: 盤面を押したまま失敗させる → カードが出てから指を離す（ゴーストクリック）
    await page.evaluate((sid) => window.kachi.openStage(sid), target.id);
    await page.waitForTimeout(400);
    await shot(page, "kachi-b6-bug-before.png");
    await pressAndHold(cdp, target.x, target.y, 380);
    await page.waitForTimeout(320);
    const after = await page.evaluate(() => ({
      screen: window.kachi.screen(),
      overlay: document.querySelector("#overlay").classList.contains("show"),
      title: document.querySelector("#card-title").textContent.trim(),
    }));
    await shot(page, "kachi-b6-bug-after.png");
    check(
      "BUG修正①: 終わりの1手を押しっぱなしにして指を離してもステージ選択へ飛ばない",
      after.screen === "game" && after.overlay === true,
      JSON.stringify({ target, after })
    );
    check("BUG修正①: 失敗カード（にげられた…）がそのまま出ている", /にげられた/.test(after.title), after.title);

    // ガードが明けたら「ステージをえらぶ」は普通に押せる
    await page.waitForTimeout(700);
    const choose = (await cardButtons(page)).find((b) => /ステージをえらぶ/.test(b.label));
    await page.touchscreen.tap(choose.cx, choose.cy);
    await page.waitForTimeout(260);
    check("ガード後: 「ステージをえらぶ」でステージ選択へ移れる", (await screenOf(page)) === "select");
  }

  // クリア側: 最後の1手がカードのボタンの下にあるステージを探して同じ操作
  await page.evaluate(() => window.kachi.showTitle());
  await page.waitForTimeout(100);
  let clearTarget = null;
  for (const id of ["s01", "s02", "s03", "s04", "s05", "s06", "s07", "s08", "s09", "s10"]) {
    await page.evaluate((sid) => window.kachi.openStage(sid), id);
    await page.waitForTimeout(180);
    const hintCell = await page.evaluate(() => window.kachi.hint());
    const cs = await state(page);
    if (!cs || cs.par !== 1 || cs.status !== "playing") continue;
    const pt = await cellPoint(page, hintCell);
    await page.evaluate((n) => window.kachi.tap(n), hintCell);
    await page.waitForTimeout(760);
    const btns = await cardButtons(page);
    const under = btns.find((b) => pt.x >= b.left && pt.x <= b.right && pt.y >= b.top && pt.y <= b.bottom);
    const st = await state(page);
    if (under && st && st.status === "clear") {
      clearTarget = { id, cell: hintCell, button: under.label, x: pt.x, y: pt.y };
      break;
    }
    await page.evaluate(() => window.kachi.showTitle());
    await page.waitForTimeout(80);
  }
  check("調査: クリアカードのボタンの下に重なるマスがある", !!clearTarget, JSON.stringify(clearTarget));

  if (clearTarget) {
    await page.evaluate((sid) => window.kachi.openStage(sid), clearTarget.id);
    await page.waitForTimeout(400);
    await pressAndHold(cdp, clearTarget.x, clearTarget.y, 380);
    await page.waitForTimeout(340);
    const after = await page.evaluate(() => ({
      screen: window.kachi.screen(),
      overlay: document.querySelector("#overlay").classList.contains("show"),
      title: document.querySelector("#card-title").textContent.trim(),
      stage: window.kachi.state() ? window.kachi.state().id : null,
    }));
    await shot(page, "kachi-b6-clear-card.png");
    check(
      "BUG修正②: クリアの瞬間に指を離しても、つぎのステージへ勝手に進まない",
      after.screen === "game" && after.overlay === true && after.stage === clearTarget.id,
      JSON.stringify({ clearTarget, after })
    );
    // ガード後は「つぎのステージ」が普通に押せる
    await page.waitForTimeout(700);
    const nextBtn = (await cardButtons(page)).find((b) => /つぎのステージ/.test(b.label));
    await page.touchscreen.tap(nextBtn.cx, nextBtn.cy);
    await page.waitForTimeout(320);
    const st2 = await page.evaluate(() => ({ screen: window.kachi.screen(), id: window.kachi.state() ? window.kachi.state().id : null }));
    check("ガード後: 「つぎのステージ」で次のステージに進める", st2.screen === "game" && st2.id !== clearTarget.id, JSON.stringify(st2));
  }

  // 連打（ダブルタップ）でも飛ばされない: 盤面を2回続けて叩き、2回目がカード開幕に重なる
  await page.evaluate(() => window.kachi.showTitle());
  await page.waitForTimeout(120);
  await page.evaluate(() => window.kachi.openStage("s02"));
  await page.waitForTimeout(320);
  const failMove = await page.evaluate(() => {
    const hint = window.kachi.hint();
    for (let i = 0; i < 25; i++) {
      if (i === hint) continue;
      if (window.kachi.tap(i)) {
        const st = window.kachi.state();
        return { cell: i, status: st ? st.status : null };
      }
    }
    return null;
  });
  await page.evaluate(() => window.kachi.showTitle());
  await page.waitForTimeout(120);
  await page.evaluate(() => window.kachi.openStage("s02"));
  await page.waitForTimeout(320);
  const spamPoint = await cellPoint(page, failMove ? failMove.cell : 0);
  // 1回目（失敗する手）→ 2回目を素早く（カードが出る前後に重なる）
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: spamPoint.x, y: spamPoint.y, id: 1 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(140);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: spamPoint.x, y: spamPoint.y, id: 2 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(420);
  const spamState = await page.evaluate(() => ({
    screen: window.kachi.screen(),
    overlay: document.querySelector("#overlay").classList.contains("show"),
    title: document.querySelector("#card-title").textContent.trim(),
    status: window.kachi.state() ? window.kachi.state().status : null,
  }));
  await shot(page, "kachi-b6-double-tap.png");
  check(
    "BUG修正③: 2回続けて叩いてもカードのまま（勝手に画面が変わらない）",
    !!failMove && failMove.status === "fail" && spamState.screen === "game" && spamState.overlay === true,
    JSON.stringify({ failMove, spamState })
  );
  // ガードが効きっぱなしになっていない（本人が押しにいけば普通に動く）
  await page.waitForTimeout(300);
  const laterBtn = (await cardButtons(page)).find((b) => /ステージをえらぶ/.test(b.label));
  const later = !!laterBtn;
  if (laterBtn) await page.touchscreen.tap(laterBtn.cx, laterBtn.cy);
  await page.waitForTimeout(260);
  check("BUG修正③: そのあと「ステージをえらぶ」を押せば普通に移れる", later && (await screenOf(page)) === "select");
  check("BUG修正: ページエラーが無い", errors.length === 0, errors.join(" / "));
  await ctx.close();
}

/* ---------------- 4. 既存の遊びが壊れていない ---------------- */
{
  const { ctx, page, errors } = await newPage();
  await page.evaluate(() => window.kachi.setLang("ja"));
  await page.evaluate(() => window.kachi.showTitle());
  await page.waitForTimeout(150);
  await page.evaluate(() => window.kachi.openStage("s01"));
  await page.waitForTimeout(300);
  const hint = await page.evaluate(() => window.kachi.hint());
  const pt = await cellPoint(page, hint);
  const before = (await state(page)).movesUsed;
  await page.touchscreen.tap(pt.x, pt.y);
  await page.waitForTimeout(160);
  const after = await state(page);
  check("盤面をタップして1手打てる", after.movesUsed === before + 1, JSON.stringify({ before, after: after.movesUsed }));
  await page.waitForTimeout(700);
  const clear = await state(page);
  const title = await page.evaluate(() => document.querySelector("#card-title").textContent.trim());
  check("1手詰を解くとクリアカードが出る", clear.status === "clear" && /つかまえた/.test(title), JSON.stringify({ status: clear.status, title }));
  const btns = await cardButtons(page);
  check("クリアカードのボタンが揃っている（つぎのステージ・シェア・もういちど・ステージをえらぶ）", btns.length === 4, JSON.stringify(btns.map((b) => b.label)));
  await page.waitForTimeout(700);
  const again = btns.find((b) => /もういちど/.test(b.label));
  await page.touchscreen.tap(again.cx, again.cy);
  await page.waitForTimeout(320);
  const st = await state(page);
  check("「もういちど」で同じステージをやり直せる", st.id === "s01" && st.status === "playing" && st.movesUsed === 0, JSON.stringify(st));
  check("既存の遊びのページエラーが無い", errors.length === 0, errors.join(" / "));
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
