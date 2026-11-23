import pw from "/workspace/work/dcd-b17/node_modules/playwright/index.js";
const { chromium } = pw;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
await page.goto("http://127.0.0.1:8123/index.html");
await page.waitForFunction(() => window.kachi && window.kachi.ready);
await page.evaluate(() => window.kachi.open("b1"));
await page.waitForTimeout(600);
const el = await page.$("#screen-game .board-wrap");

// A: img を div + background-image に置換
await page.evaluate(() => {
  const t = document.querySelector("#tanuki");
  const img = t.querySelector("img");
  const d = document.createElement("div");
  d.style.cssText = "width:100%;height:100%;background:url(assets/tanuki_token.png) center/contain no-repeat";
  img.replaceWith(d);
});
await page.waitForTimeout(300);
await el.screenshot({ path: "tmp/v-bgimg.png" });

// B: 新しい img を追加（同じ src）
await page.evaluate(() => {
  const t = document.querySelector("#tanuki");
  t.innerHTML = "";
  const img = document.createElement("img");
  img.src = "assets/tanuki_token.png";
  img.style.cssText = "width:100%;height:100%;display:block";
  t.appendChild(img);
});
await page.waitForTimeout(400);
await el.screenshot({ path: "tmp/v-newimg.png" });

// C: token-layer を通常の重なり（z-index/stacking 調整）
await page.evaluate(() => {
  document.querySelector(".token-layer").style.zIndex = "5";
  document.querySelector(".token-layer").style.position = "absolute";
});
await page.waitForTimeout(300);
await el.screenshot({ path: "tmp/v-zb.png" });
await browser.close();
console.log("ok");
