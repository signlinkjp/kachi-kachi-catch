/**
 * Build 5 の実ブラウザ検査（Playwright）。
 *
 *   node tools/e2e-build5.mjs
 *   KACHI_SHOTS=/workspace/downloads node tools/e2e-build5.mjs   # スクリーンショットも保存
 *
 * 見るもの:
 *   1. Build 5 として起動（版 1.0.0 (5)）
 *   2. オープニングの追いかけアニメ（臼の杵を持ったウサギローがポコ丸を追う）
 *      — transform/opacity だけ・1.6秒・タップで即スキップ・終了後は完全に非表示で操作を邪魔しない
 *   3. ゲーム上部の新文言「ウサギローと協力してポコ丸を追い込み、アミで捕まえよう‼️」と
 *      下部「ポコ丸の逃げ場 ○マス」の表記（375/393 × 標準/大/特大でも枠内に収まる）
 *   4. クリアカードの「📤 シェアする」（Web Share API／クリップボード＋トーストのフォールバック）
 *   5. 今日の1問・タイムアタック結果カードのシェア文言
 *   6. 中級 STAGE 25 クリア時の PRO 案内（無料ユーザーのみ）
 *   7. 既存の操作（ホーム・盤面タップ・クリア）が壊れていない
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

/** 言語を保存済みの状態で開く（スクリーンショット用） */
async function newPage(viewport = { width: 393, height: 852 }, opts = {}) {
  const { lang, share = true, noShare = false, clipboard = false, ...ctxOpts } = opts;
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true, ...ctxOpts });
  if (lang) {
    await ctx.addInitScript((code) => {
      try {
        localStorage.setItem("kachi.b1.v1", JSON.stringify({ settings: { lang: code } }));
      } catch {}
    }, lang);
  }
  if (share && !noShare) {
    await ctx.addInitScript(() => {
      window.__shared = [];
      try {
        Object.defineProperty(navigator, "share", {
          configurable: true,
          value: async (data) => {
            window.__shared.push(data);
          },
        });
      } catch {}
    });
  }
  if (clipboard) {
    await ctx.addInitScript(() => {
      window.__copied = null;
      try {
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: { writeText: async (t) => { window.__copied = t; } },
        });
      } catch {}
    });
  }
  if (noShare) {
    await ctx.addInitScript(() => {
      try {
        Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
      } catch {}
      // execCommand も無効化（クリップボード API の経路だけを見る）
      document.execCommand = () => false;
    });
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => {
    errors.push(String(e && e.message ? e.message : e));
    console.log("  [pageerror]", e.message);
  });
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "load" });
  await page.waitForFunction(() => window.kachi && window.kachi.ready, null, { timeout: 15000 });
  return { ctx, page, errors };
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

const waitCard = (page, ms = 8000) =>
  page
    .waitForFunction(() => document.querySelector("#overlay").classList.contains("show"), null, { timeout: ms })
    .then(() => true)
    .catch(() => false);

/** 最善手順（PV）でステージをクリアする（ヒント回数の制限を受けない） */
async function clearStage(page, id) {
  await page.evaluate((sid) => window.kachi.openStage(sid), id);
  await page.waitForTimeout(150);
  await page.evaluate(async () => {
    await window.kachi.playPv({ gap: 70 });
  });
  return waitCard(page);
}

const cardActions = (page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll("#card-actions .btn")).map((b) => ({
      label: (b.textContent || "").trim(),
      cls: typeof b.className === "string" ? b.className : "",
    }))
  );

const clickAction = (page, matcher) =>
  page.evaluate((m) => {
    const btn = Array.from(document.querySelectorAll("#card-actions .btn")).find((b) => new RegExp(m).test(b.textContent || ""));
    if (!btn) return false;
    btn.click();
    return true;
  }, matcher);

if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const shot = async (page, name) => {
  if (!SHOTS) return;
  await page.screenshot({ path: path.join(SHOTS, name) });
};

/* ---------------- 1. 起動・オープニングの追いかけアニメ ---------------- */
{
  const { ctx, page, errors } = await newPage({ width: 393, height: 852 }, { lang: "ja" });
  const v = await page.evaluate(() => window.kachi.version);
  check("現行ビルドとして起動する（Build 6）", v.build === 6 && v.marketing === "1.0.0", JSON.stringify(v));
  const ver = await page.evaluate(() => document.querySelector("#version-line").textContent);
  check("設定画面の版が 1.0.0 (6)", /1\.0\.0 \(6\)/.test(ver), ver);

  // 起動直後はオープニング。追いかけの2人が動いている
  const early = await page.evaluate(() => {
    const op = document.querySelector("#screen-opening");
    const tanuki = document.querySelector("#chase-tanuki");
    const usagiro = document.querySelector("#chase-usagiro");
    const sprite = document.querySelector("#chase-usagiro .run-body");
    const anims = (el) => (el ? el.getAnimations().map((a) => ({ duration: Math.round(a.effect.getTiming().duration), name: a.animationName || "" })) : []);
    const cs = getComputedStyle(document.querySelector("#open-chase"));
    return {
      screen: window.kachi.screen(),
      playing: op.classList.contains("playing"),
      tanukiAnim: anims(tanuki),
      usagiroAnim: anims(usagiro),
      spriteAnim: anims(sprite),
      tanukiOpacity: Number(getComputedStyle(tanuki).opacity),
      usagiroOpacity: Number(getComputedStyle(usagiro).opacity),
      chaseOpacity: Number(cs.opacity),
      chasePE: cs.pointerEvents,
      tanukiTransform: getComputedStyle(tanuki).transform,
    };
  });
  check("起動直後はオープニング画面", early.screen === "opening" && early.playing === true, JSON.stringify({ screen: early.screen, playing: early.playing }));
  check("ポコ丸とウサギローの追いかけアニメが動いている", early.tanukiAnim.length > 0 && early.usagiroAnim.length > 0, JSON.stringify({ t: early.tanukiAnim, u: early.usagiroAnim }));
  check("追いかけは1.5秒（transform と opacity だけ）", [early.tanukiAnim, early.usagiroAnim].every((a) => a.some((x) => x.duration === 1500)), JSON.stringify([early.tanukiAnim, early.usagiroAnim]));
  check("ウサギローは全身キャラの4コマ走りで足を動かしている", early.spriteAnim.some((x) => x.name === "runCycle"), JSON.stringify(early.spriteAnim));
  check("追いかけの2人が見えていて、位置が動いている", early.tanukiOpacity > 0.05 && early.usagiroOpacity > 0.05 && early.tanukiTransform !== "none", JSON.stringify({ to: early.tanukiOpacity, uo: early.usagiroOpacity, tr: early.tanukiTransform }));
  check("追いかけの層はタップを受けない（pointer-events: none）", early.chasePE === "none" && early.chaseOpacity === 1, JSON.stringify({ pe: early.chasePE, op: early.chaseOpacity }));

  // アニメのいちばん絵になる瞬間（約0.7秒）で止めて撮る
  await page.waitForTimeout(120);
  const mid = await page.evaluate(() => ({
    tanuki: Number(getComputedStyle(document.querySelector("#chase-tanuki")).opacity),
    playing: document.querySelector("#screen-opening").classList.contains("playing"),
  }));
  check("アニメ途中も2人は表示されている", mid.playing && mid.tanuki > 0.2, JSON.stringify(mid));
  const paused = await page.evaluate(() => {
    for (const el of document.querySelectorAll(".chase-runner")) {
      for (const a of el.getAnimations()) {
        a.pause();
        a.currentTime = 600;
      }
    }
    const t = document.querySelector("#chase-tanuki").getBoundingClientRect();
    const u = document.querySelector("#chase-usagiro").getBoundingClientRect();
    return { tanuki: [Math.round(t.left), Math.round(t.right)], usagiro: [Math.round(u.left), Math.round(u.right)], vw: window.innerWidth };
  });
  check(
    "追いかけの瞬間は2人とも画面にいて、ウサギローがポコ丸の後ろを追っている",
    paused.tanuki[0] >= -4 && paused.usagiro[0] > paused.tanuki[0] && paused.usagiro[0] < paused.vw && paused.usagiro[0] - paused.tanuki[1] < 160,
    JSON.stringify(paused)
  );
  await shot(page, "kachi-b5-opening.png");
  await page.evaluate(() => {
    for (const el of document.querySelectorAll(".chase-runner")) for (const a of el.getAnimations()) a.play();
  });

  // 2.1秒でホームへ。オープニングの層は完全に消える
  await page.waitForTimeout(2000);
  const after = await page.evaluate(() => {
    const op = document.querySelector("#screen-opening");
    const runners = Array.from(document.querySelectorAll(".chase-runner"));
    const r = document.querySelector("#btn-play").getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      screen: window.kachi.screen(),
      active: op.classList.contains("active"),
      playing: op.classList.contains("playing"),
      chaseOpacity: Number(getComputedStyle(document.querySelector("#open-chase")).opacity),
      runnerANim: runners.map((el) => el.getAnimations().length),
      runnerOpacity: runners.map((el) => Number(getComputedStyle(el).opacity)),
      hit: top ? { cls: typeof top.className === "string" ? top.className : "", play: !!top.closest("#btn-play") } : null,
    };
  });
  check("約2.1秒で自動的にホームへ", after.screen === "title", after.screen);
  check("オープニングは非表示（active なし・playing なし）", after.active === false && after.playing === false, JSON.stringify({ active: after.active, playing: after.playing }));
  check("追いかけの層は完全に消える（opacity 0・アニメ停止）", after.chaseOpacity === 0 && after.runnerOpacity.every((o) => o === 0) && after.runnerANim.every((n) => n === 0), JSON.stringify(after));
  check("ホームの「あそぶ」が最前面で押せる", !!after.hit && after.hit.play === true, JSON.stringify(after.hit));
  check("起動〜オープニングでページエラーが無い", errors.length === 0, errors.join(" / "));
  await ctx.close();
}

/* ---------------- 2. タップで即スキップ ---------------- */
{
  const { ctx, page } = await newPage();
  await page.waitForTimeout(200);
  const center = await page.evaluate(() => ({ x: innerWidth / 2, y: innerHeight / 2 }));
  await page.touchscreen.tap(center.x, center.y);
  await page.waitForTimeout(220);
  const s = await page.evaluate(() => ({
    screen: window.kachi.screen(),
    playing: document.querySelector("#screen-opening").classList.contains("playing"),
    chaseOpacity: Number(getComputedStyle(document.querySelector("#open-chase")).opacity),
  }));
  check("タップでオープニングを即スキップできる", s.screen === "title", JSON.stringify(s));
  check("スキップ後は追いかけが残らない", s.playing === false && s.chaseOpacity === 0, JSON.stringify(s));
  await ctx.close();
}

/* ---------------- 3. 上部の新文言・下部の「○マス」・レイアウト ---------------- */
{
  const { ctx, page } = await newPage();
  await page.evaluate(() => window.kachi.setLang("ja"));
  await page.evaluate(() => window.kachi.openStage("s01"));
  await page.waitForTimeout(320);
  const txt = await page.evaluate(() => ({
    strip: (document.querySelector("#hud-strip").textContent || "").trim(),
    meterLabel: (document.querySelector("#meter-label").textContent || "").trim(),
    meterNum: (document.querySelector("#meter-num").textContent || "").trim(),
    meterUnit: (document.querySelector("#meter-unit").textContent || "").trim(),
  }));
  check("上部が「ウサギローと協力してポコ丸を追い込み、アミで捕まえよう‼️」", txt.strip === "ウサギローと協力してポコ丸を追い込み、アミで捕まえよう‼️", txt.strip);
  check("下部が「ポコ丸の逃げ場 ○マス」", txt.meterLabel.includes("ポコ丸の逃げ場") && /^\d+$/.test(txt.meterNum) && txt.meterUnit === "マス", JSON.stringify(txt));
  // 危険域（逃げ場が少ない）でも単位が付く
  const pips = await page.evaluate(() => document.querySelectorAll("#pips .pip.on").length);
  check("逃げ場の数字が点の数と一致する", Number(txt.meterNum) === pips && pips > 0, JSON.stringify({ num: txt.meterNum, pips }));
  await shot(page, "kachi-b5-play.png");

  // 375/393 × 標準/大/特大 で、文言が枠内に収まる（はみ出し・切れなし）
  const problems = [];
  for (const width of [375, 393]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 852 });
    for (const size of ["normal", "large", "xlarge"]) {
      await page.evaluate((s) => window.kachi.setTextSize(s), size);
      await page.waitForTimeout(120);
      await page.evaluate(() => window.kachi.relayout());
      const m = await page.evaluate(() => {
        const strip = document.querySelector(".par-strip");
        const text = document.querySelector("#hud-strip");
        const board = document.querySelector("#board-wrap");
        const sr = strip.getBoundingClientRect();
        const tr = text.getBoundingClientRect();
        const br = board.getBoundingClientRect();
        const lh = parseFloat(getComputedStyle(text).lineHeight) || 14;
        return {
          lines: Math.round(tr.height / lh),
          overflowY: text.scrollHeight - text.clientHeight,
          inside: tr.bottom <= sr.bottom + 0.5 && tr.top >= sr.top - 0.5 && tr.right <= sr.right + 0.5 && tr.left >= sr.left - 0.5,
          stripH: Math.round(sr.height),
          textH: Math.round(tr.height),
          boardH: Math.round(br.height),
          docW: document.documentElement.scrollWidth,
          winW: window.innerWidth,
        };
      });
      if (!m.inside || m.overflowY > 1 || m.boardH < 150 || m.docW > m.winW + 1 || m.lines > 3) {
        problems.push({ width, size, ...m });
      }
    }
  }
  await page.evaluate(() => window.kachi.setTextSize("normal"));
  check("375/393 × 標準・大・特大で文言が枠内に収まり、盤面も縮みすぎない", problems.length === 0, JSON.stringify(problems.slice(0, 3)));

  // 英語など他言語でも単位が付く
  await page.evaluate(() => window.kachi.setLang("en"));
  await page.waitForTimeout(160);
  const en = await page.evaluate(() => ({
    strip: document.querySelector("#hud-strip").textContent.trim(),
    unit: document.querySelector("#meter-unit").textContent.trim(),
  }));
  check("英語では「tiles」表記・説明文も英語", /tiles/.test(en.unit) && /Usagiro/.test(en.strip), JSON.stringify(en));
  await page.evaluate(() => window.kachi.setLang("ja"));
  await ctx.close();
}

/* ---------------- 4. クリアカードのシェア（Web Share API） ---------------- */
{
  const { ctx, page } = await newPage();
  await page.evaluate(() => window.kachi.setLang("ja"));
  check("ステージ1をクリアできる", await clearStage(page, "s01"));
  const acts = await cardActions(page);
  check("クリアカードに「📤 シェアする」ボタンがある", acts.some((a) => /シェアする/.test(a.label) && /share/.test(a.cls)), JSON.stringify(acts.map((a) => a.label)));
  const box = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("#card-actions .btn")).find((x) => /シェアする/.test(x.textContent || ""));
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, h: Math.round(r.height) };
  });
  check("シェアボタンは指で押せる大きさ", box.h >= 40, `${box.h}px`);
  await page.touchscreen.tap(box.x, box.y);
  await page.waitForTimeout(260);
  const shared = await page.evaluate(() => (window.__shared || [])[0] || null);
  const last = await page.evaluate(() => window.kachi.lastShare());
  check(
    "1タップで共有シートに結果が渡る（STAGE 1・ハッシュタグ）",
    !!shared && /STAGE 1 をクリア/.test(shared.text) && /#カチカチキャッチ/.test(shared.text) && last && last.via === "share",
    JSON.stringify({ text: shared && shared.text, via: last && last.via })
  );
  check("共有文言は3行（見出し・サブ・タグ）", !!shared && shared.text.split("\n").length === 3, shared ? JSON.stringify(shared.text.split("\n")) : "");
  check("シェアしてもカードは閉じない（続けて遊べる）", (await stateOf(page)).overlay === true);
  await shot(page, "kachi-b5-clear-share.png");
  await ctx.close();
}

/* ---------------- 5. 非対応環境ではクリップボード＋トースト ---------------- */
{
  const { ctx, page } = await newPage({ width: 393, height: 852 }, { share: false, noShare: true, clipboard: true });
  await page.evaluate(() => window.kachi.setLang("ja"));
  check("（フォールバック）ステージ2をクリアできる", await clearStage(page, "s02"));
  await clickAction(page, "シェアする");
  await page.waitForTimeout(260);
  const fb = await page.evaluate(() => ({
    copied: window.__copied,
    toast: document.querySelector("#toast").textContent.trim(),
    toastShown: document.querySelector("#toast").classList.contains("show"),
    via: window.kachi.lastShare() && window.kachi.lastShare().via,
  }));
  check("共有シートが無い環境ではクリップボードにコピー", !!fb.copied && /STAGE 2 をクリア/.test(fb.copied), JSON.stringify({ copied: fb.copied && fb.copied.slice(0, 40) }));
  check("コピーしたことをトーストで知らせる", fb.toastShown === true && fb.toast === "結果をコピーしました" && fb.via === "clipboard", JSON.stringify(fb));
  await ctx.close();
}

/* ---------------- 6. 今日の1問・タイムアタックのシェア ---------------- */
{
  const { ctx, page } = await newPage();
  await page.evaluate(() => window.kachi.setLang("ja"));
  // 今日の1問（7手詰もあるので最善手順で解く）
  await page.evaluate(() => window.kachi.openDaily());
  await page.waitForTimeout(200);
  await page.evaluate(async () => {
    await window.kachi.playPv({ gap: 70 });
  });
  check("今日の1問をクリアできる", await waitCard(page));
  const dailyActs = await cardActions(page);
  check("今日の1問のカードにもシェアボタンがある", dailyActs.some((a) => /シェアする/.test(a.label)), JSON.stringify(dailyActs.map((a) => a.label)));
  await clickAction(page, "シェアする");
  await page.waitForTimeout(220);
  const daily = await page.evaluate(() => (window.__shared || []).slice(-1)[0] || null);
  check("今日の1問のシェア文言（日付つき）", !!daily && /今日の1問（\d{4}-\d{2}-\d{2}）をクリア/.test(daily.text) && /#カチカチキャッチ/.test(daily.text), daily && JSON.stringify(daily.text));

  // タイムアタック
  await page.evaluate(() => window.kachi.setPro(true));
  await page.evaluate(() => window.kachi.startTa(60));
  await page.waitForTimeout(300);
  const hint = await page.evaluate(() => window.kachi.hint());
  if (hint != null) {
    const p = await cellPoint(page, hint);
    await page.touchscreen.tap(p.x, p.y);
    await page.waitForTimeout(700);
  }
  const score = await page.evaluate(() => window.kachi.taState());
  await page.evaluate(() => window.kachi.endTa());
  await page.waitForTimeout(260);
  const taActs = await cardActions(page);
  check("タイムアタック結果カードにシェアボタンがある", taActs.some((a) => /シェアする/.test(a.label)), JSON.stringify(taActs.map((a) => a.label)));
  await clickAction(page, "シェアする");
  await page.waitForTimeout(220);
  const ta = await page.evaluate(() => (window.__shared || []).slice(-1)[0] || null);
  const taScore = score ? score.score : 0;
  check("タイムアタックのシェア文言（秒数とスコア）", !!ta && new RegExp(`タイムアタック60秒で${taScore}問クリア`).test(ta.text), ta && JSON.stringify(ta.text));
  await ctx.close();
}

/* ---------------- 7. 中級 STAGE 25（無料分の最後）の PRO 案内 ---------------- */
{
  const { ctx, page } = await newPage();
  await page.evaluate(() => window.kachi.setLang("ja"));
  await page.evaluate(() => window.kachi.setPro(false));
  check("（無料）中級 STAGE 25 をクリアできる", await clearStage(page, "s25"));
  const card = await page.evaluate(() => ({
    title: document.querySelector("#card-title").textContent.trim(),
    text: document.querySelector("#card-text").textContent.trim(),
    promo: document.querySelector("#card").classList.contains("promo"),
    actions: Array.from(document.querySelectorAll("#card-actions .btn")).map((b) => ({ label: (b.textContent || "").trim(), cls: typeof b.className === "string" ? b.className : "" })),
  }));
  check("STAGE 25 クリアで「初級・中級25問を制覇！🎉」", card.title === "初級・中級25問を制覇！🎉" && card.promo === true, card.title);
  check("案内に上級・激ムズ・タイムアタックと買い切り価格が入る", /上級（5手詰）/.test(card.text) && /激ムズ（7手詰）/.test(card.text) && /タイムアタック/.test(card.text) && /¥300/.test(card.text), card.text);
  check("「PRO を開く」が先頭（目立つ位置）にある", /PRO を開く/.test(card.actions[0].label) && /pro-cta/.test(card.actions[0].cls), JSON.stringify(card.actions.map((a) => a.label)));
  check("PRO 案内のカードにもシェアボタンがある", card.actions.some((a) => /シェアする/.test(a.label)), JSON.stringify(card.actions.map((a) => a.label)));
  await shot(page, "kachi-b5-stage25-pro.png");
  await page.evaluate(() => document.querySelector("#card-actions .btn").click());
  await page.waitForTimeout(240);
  const sheet = await page.evaluate(() => ({
    open: document.querySelector("#pro-sheet").classList.contains("show"),
    price: (document.querySelector("#pro-price").textContent || "").trim(),
  }));
  check("「PRO を開く」で PRO シートが開く", sheet.open === true, JSON.stringify(sheet));
  await page.evaluate(() => window.kachi.closeSheets());

  // PRO 購入済みなら通常のクリアカード（つぎのステージ）
  await page.evaluate(() => window.kachi.setPro(true));
  await page.waitForTimeout(120);
  await page.evaluate(() => window.kachi.openStage("s25"));
  await page.waitForTimeout(150);
  await page.evaluate(async () => {
    await window.kachi.playPv({ gap: 70 });
  });
  await waitCard(page);
  const proCard = await page.evaluate(() => ({
    title: document.querySelector("#card-title").textContent.trim(),
    promo: document.querySelector("#card").classList.contains("promo"),
    actions: Array.from(document.querySelectorAll("#card-actions .btn")).map((b) => (b.textContent || "").trim()),
  }));
  check("PRO 購入済みなら通常どおり次へ進める", proCard.promo === false && /つぎのステージ/.test(proCard.actions[0]) && /STAGE 26/.test(proCard.actions[0]), JSON.stringify(proCard));
  await ctx.close();
}

/* ---------------- 8. 既存の操作が壊れていない ---------------- */
{
  const { ctx, page, errors } = await newPage();
  await page.evaluate(() => window.kachi.setLang("ja"));
  await page.evaluate(() => window.kachi.showTitle());
  await page.waitForTimeout(220);
  const play = await page.evaluate(() => {
    const r = document.querySelector("#btn-play").getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { play: !!(el && el.closest("#btn-play")) };
  });
  await page.evaluate(() => document.querySelector("#btn-play").click());
  await page.waitForTimeout(300);
  const opened = await stateOf(page);
  const hint = await page.evaluate(() => window.kachi.hint());
  const p = await cellPoint(page, hint);
  const before = (await stateOf(page)).stage.movesUsed;
  await page.touchscreen.tap(p.x, p.y);
  await page.waitForTimeout(120);
  const after = (await stateOf(page)).stage;
  check("ホームの「あそぶ」からゲームに入って1手打てる", play.play && opened.screen === "game" && after.movesUsed === before + 1, JSON.stringify({ play, screen: opened.screen, before, after: after.movesUsed }));
  // ゲーム画面の説明文が新しい文言のまま
  const strip = await page.evaluate(() => document.querySelector("#hud-strip").textContent.trim());
  check("プレイ中も上部の説明文が新しい文言", strip === "ウサギローと協力してポコ丸を追い込み、アミで捕まえよう‼️", strip);
  check("このページでもページエラーが無い", errors.length === 0, errors.join(" / "));
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
