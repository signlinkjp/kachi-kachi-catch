import pw from "/workspace/work/dcd-b17/node_modules/playwright/index.js";
const { chromium } = pw;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
await page.goto("http://127.0.0.1:8123/index.html");
await page.waitForFunction(() => window.kachi && window.kachi.ready);
await page.evaluate(() => window.kachi.open("b1"));
await page.waitForTimeout(600);
const el = await page.$("#screen-game .board-wrap");
await page.evaluate(() => {
  const img = document.querySelector("#tanuki img");
  img.style.visibility = "hidden";
});
await page.waitForTimeout(150);
await el.screenshot({ path: "tmp/b-img-hidden.png" });
await page.evaluate(() => {
  const img = document.querySelector("#tanuki img");
  img.style.visibility = "visible";
  document.querySelector("#tanuki").style.display = "none";
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;left:27px;top:170px;width:58px;height:58px;background:magenta";
  document.querySelector(".board-wrap").appendChild(probe);
});
await page.waitForTimeout(150);
await el.screenshot({ path: "tmp/b-probe.png" });
await browser.close();
console.log("ok");
