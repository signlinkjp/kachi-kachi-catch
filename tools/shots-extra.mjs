import pw from "/workspace/work/dcd-b17/node_modules/playwright/index.js";
const { chromium } = pw;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, locale: "ja-JP" });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://127.0.0.1:8123/index.html");
await page.waitForFunction(() => window.kachi && window.kachi.ready);
await page.evaluate(() => window.kachi.muted(true));

await page.evaluate(() => window.kachi.showSelect());
await page.waitForTimeout(500);
await page.screenshot({ path: "tmp/shot-select.png" });

await page.evaluate(() => window.kachi.showRules());
await page.waitForTimeout(500);
await page.screenshot({ path: "tmp/shot-rules.png" });

// 失敗画面
await page.evaluate(async () => {
  window.kachi.open("b1");
  await new Promise((r) => setTimeout(r, 400));
  // 1手詰をわざと外す → 手数切れ
  const st = window.kachi.state();
  await window.kachi.tap(15);
  await new Promise((r) => setTimeout(r, 1500));
});
await page.waitForTimeout(600);
await page.screenshot({ path: "tmp/shot-fail.png" });
console.log("state", JSON.stringify(await page.evaluate(() => window.kachi.state())));
console.log("errors", errors);
await browser.close();
