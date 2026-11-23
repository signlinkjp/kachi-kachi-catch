import pw from "/workspace/work/dcd-b17/node_modules/playwright/index.js";
const { chromium } = pw;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
await page.goto("http://127.0.0.1:8123/index.html");
await page.waitForFunction(() => window.kachi && window.kachi.ready);
await page.evaluate(() => window.kachi.open("b1"));
await page.waitForTimeout(700);
const el = await page.$("#screen-game .board-wrap");

for (const [name, css] of [
  ["hide-net", "#tanuki .net{display:none!important}"],
  ["hide-sweat", "#tanuki .sweat{display:none!important}"],
  ["img-alone", "#tanuki{all:unset;position:absolute;width:58px;height:58px;left:0;top:0}"],
]) {
  await page.evaluate((c) => {
    const s = document.createElement("style");
    s.textContent = c;
    document.head.appendChild(s);
  }, css);
  await page.waitForTimeout(350);
  await el.screenshot({ path: `tmp/h-${name}.png` });
}
await browser.close();
console.log("ok");
