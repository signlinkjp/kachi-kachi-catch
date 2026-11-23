/**
 * 実ブラウザで全12ステージを最後まで通しで検証（Playwright）
 */
import pw from "/workspace/work/dcd-b17/node_modules/playwright/index.js";
const { chromium } = pw;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, locale: "ja-JP" });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
await page.goto("http://127.0.0.1:8123/index.html");
await page.waitForFunction(() => window.kachi && window.kachi.ready);
await page.evaluate(() => window.kachi.muted(true));

const ids = await page.evaluate(() => window.kachi.stages.map((s) => s.id));
const report = [];
for (const id of ids) {
  const t0 = Date.now();
  await page.evaluate((sid) => window.kachi.open(sid), id);
  await page.waitForFunction(() => window.kachi.screen() === "game" && !window.kachi.busy());
  const openMs = Date.now() - t0;

  // ヒントに従って最後まで打つ
  let guard = 0;
  let hintMs = 0;
  while (guard++ < 12) {
    const st = await page.evaluate(() => window.kachi.state());
    if (st.status !== "playing") break;
    const h0 = Date.now();
    const cell = await page.evaluate(() => window.kachi.hint());
    hintMs = Math.max(hintMs, Date.now() - h0);
    if (cell == null) break;
    await page.evaluate((c) => window.kachi.tap(c), cell);
  }
  const st = await page.evaluate(() => window.kachi.state());
  report.push({ id, name: st.name, par: st.par, moves: st.movesUsed, status: st.status, openMs, maxHintMs: hintMs });
}

console.table(report);
console.log("errors:", errors);
const bad = report.filter((r) => r.status !== "clear" || r.moves !== r.par);
console.log(bad.length ? `NG: ${JSON.stringify(bad)}` : "ALL 12 STAGES CLEARED IN EXACTLY PAR MOVES");
await browser.close();
