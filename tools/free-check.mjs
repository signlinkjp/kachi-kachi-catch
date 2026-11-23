/** 無料ユーザーの導線チェック（ロック→PROシート、ヒント3回でPROシート） */
import pw from "/workspace/work/dcd-b17/node_modules/playwright/index.js";
const { chromium } = pw;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, locale: "ja-JP" });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://127.0.0.1:8123/index.html");
await page.waitForFunction(() => window.kachi && window.kachi.ready);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.kachi && window.kachi.ready);
await page.waitForTimeout(2100);
const pro = await page.evaluate(() => window.kachi.isPro());
const locked = await page.evaluate(() => {
  window.kachi.showSelect();
  const items = Array.from(document.querySelectorAll(".stage-item"));
  return { total: items.length, locked: items.filter((i) => i.classList.contains("locked")).length };
});
// ロック中のステージをタップ → PROシート
await page.evaluate(() => {
  const item = Array.from(document.querySelectorAll(".stage-item")).find((i) => i.classList.contains("locked"));
  item.click();
});
await page.waitForTimeout(400);
const sheetOpen = await page.evaluate(() => document.getElementById("pro-sheet").classList.contains("show"));
await page.evaluate(() => window.kachi.closeSheets());
// ヒント3回 → 4回目でPROシート
await page.evaluate(() => window.kachi.openStage("s01"));
await page.waitForTimeout(500);
const hints = [];
for (let i = 0; i < 4; i++) {
  const r = await page.evaluate(() => window.kachi.hint());
  hints.push(r);
  await page.waitForTimeout(200);
  await page.evaluate(() => window.kachi.closeSheets());
}
const sheetAfterHints = await page.evaluate(() => document.getElementById("pro-sheet").classList.contains("show"));
await page.evaluate(() => window.kachi.closeSheets());
// タイムアタック → PROシート
await page.evaluate(() => window.kachi.showTitle());
await page.evaluate(() => document.getElementById("btn-ta").click());
await page.waitForTimeout(400);
const taSheet = await page.evaluate(() => document.getElementById("pro-sheet").classList.contains("show"));
console.log(JSON.stringify({ pro, locked, sheetOpen, hints, sheetAfterHints, taSheet, errors }, null, 1));
await browser.close();
