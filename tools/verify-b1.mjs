/**
 * Build 1 ブラウザ検証（iPhone 375 / 393 / 特大文字 / iPad・コンソールエラー0）
 * node tools/verify-b1.mjs
 */
import pw from "/workspace/work/dcd-b17/node_modules/playwright/index.js";
const { chromium } = pw;

const URL = "http://127.0.0.1:8123/index.html";
const configs = [
  { name: "iPhone SE (375x667)", width: 375, height: 667, scale: 2 },
  { name: "iPhone 15 (393x852)", width: 393, height: 852, scale: 2 },
  { name: "特大文字 (393x852, 125%)", width: 393, height: 852, scale: 2, font: "125%" },
  { name: "iPad (820x1180)", width: 820, height: 1180, scale: 1 },
];

const browser = await chromium.launch();
const problems = [];

for (const cfg of configs) {
  const context = await browser.newContext({
    viewport: { width: cfg.width, height: cfg.height },
    deviceScaleFactor: cfg.scale,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });
  await page.goto(URL + "?dev=1", { waitUntil: "networkidle" });
  if (cfg.font) {
    await page.addStyleTag({ content: `:root { font-size: ${cfg.font}; } html { font-size: ${cfg.font}; }` });
  }
  await page.waitForFunction(() => window.kachi && window.kachi.ready);
  await page.evaluate(() => window.kachi.setPro(true));
  await page.waitForTimeout(2100); // オープニングを飛ばす

  const shots = [
    ["title", () => window.kachi.showTitle()],
    ["select", () => window.kachi.showSelect()],
    ["daily", () => window.kachi.showDaily()],
    ["howto", () => window.kachi.showHowto()],
    ["settings", () => window.kachi.showSettings()],
    ["game", () => window.kachi.openStage("s01")],
  ];
  for (const [name, fn] of shots) {
    await page.evaluate(fn);
    await page.waitForTimeout(420);
    await page.screenshot({ path: `/workspace/work/kachi-kachi-catch/tmp/b1-${cfg.width}-${name}.png` });
    // 画面外にはみ出した要素がないか（横スクロール・見切れ）
    const overflow = await page.evaluate(() => {
      const app = document.getElementById("app");
      const rect = app.getBoundingClientRect();
      const bad = [];
      const scrollers = [".select-scroll", ".rules-scroll", ".settings-scroll", ".privacy-scroll"];
      for (const el of app.querySelectorAll(".screen.active *")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const cs = getComputedStyle(el);
        if (cs.opacity === "0" || cs.visibility === "hidden" || cs.display === "none") continue;
        if (el.closest(".token-layer, .fx-layer, .sun, .hills, .open-sun, .paw-trail, .grain, .open-bg")) continue;
        let hidden = false;
        for (let p = el; p && p !== app; p = p.parentElement) {
          const pcs = getComputedStyle(p);
          if (pcs.opacity === "0" || pcs.visibility === "hidden") { hidden = true; break; }
        }
        if (hidden) continue;
        // スクロール領域の中は縦に見切れて良い
        const inScroller = scrollers.some((s) => el.closest(s));
        const horizontal = r.right > rect.right + 1.5 || r.left < rect.left - 1.5;
        const vertical = !inScroller && (r.bottom > rect.bottom + 1.5 || r.top < rect.top - 1.5);
        if (horizontal || vertical) {
          bad.push(`${el.tagName}.${el.className || ""} → ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}x${Math.round(r.height)}`);
        }
      }
      return bad.slice(0, 6);
    });
    if (overflow.length) problems.push({ cfg: cfg.name, screen: name, overflow });
  }

  // 実行: 1手詰ステージを解く
  await page.evaluate(() => window.kachi.openStage("s01"));
  await page.waitForTimeout(500);
  const cell = await page.evaluate(() => window.kachi.hint());
  await page.evaluate((c) => window.kachi.tap(c), cell);
  await page.waitForTimeout(1600);
  const st = await page.evaluate(() => window.kachi.state());
  if (st.status !== "clear") problems.push({ cfg: cfg.name, screen: "play", state: st });

  // デイリー
  await page.evaluate(() => window.kachi.openDaily());
  await page.waitForTimeout(400);
  const dstate = await page.evaluate(() => window.kachi.state());
  if (!dstate || dstate.mode !== "daily") problems.push({ cfg: cfg.name, screen: "daily-play", state: dstate });

  // タイムアタック
  await page.evaluate(() => {
    window.kachi.showTitle();
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => window.kachi.startTa());
  await page.waitForTimeout(700);
  const ta = await page.evaluate(() => window.kachi.taState());
  if (!ta || !ta.running) problems.push({ cfg: cfg.name, screen: "ta", ta });
  const tacell = await page.evaluate(() => window.kachi.hint());
  if (tacell != null) {
    await page.evaluate((c) => window.kachi.tap(c), tacell);
    await page.waitForTimeout(1400);
  }
  const ta2 = await page.evaluate(() => window.kachi.taState());
  if (!ta2 || ta2.score < 1) problems.push({ cfg: cfg.name, screen: "ta-score", ta: ta2 });

  if (errors.length) problems.push({ cfg: cfg.name, errors });
  console.log(cfg.name, "errors:", errors.length, "checks done");
  await context.close();
}

await browser.close();
console.log("\n=== problems ===");
console.log(JSON.stringify(problems, null, 1));
console.log(problems.length ? "NG" : "ALL BROWSER CHECKS PASSED");
