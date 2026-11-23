import pw from "/workspace/work/dcd-b17/node_modules/playwright/index.js";
const { chromium } = pw;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
await page.goto("http://127.0.0.1:8123/index.html");
await page.waitForFunction(() => window.kachi && window.kachi.ready);
await page.evaluate(() => window.kachi.open("b1"));
await page.waitForTimeout(600);
const el = await page.$("#screen-game .board-wrap");
await el.screenshot({ path: "tmp/board-with-token.png" });
await page.evaluate(() => {
  document.querySelector("#tanuki").style.display = "none";
});
await page.waitForTimeout(200);
await el.screenshot({ path: "tmp/board-no-token.png" });
await browser.close();
console.log("ok");
