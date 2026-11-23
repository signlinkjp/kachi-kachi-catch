import pw from "/workspace/work/dcd-b17/node_modules/playwright/index.js";
const { chromium } = pw;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
await page.addInitScript(() => {
  document.addEventListener("DOMContentLoaded", () => {
    const s = document.createElement("style");
    s.textContent = "#tanuki{filter:none !important;will-change:auto !important} .tanuki{filter:none !important;will-change:auto !important}";
    document.head.appendChild(s);
  });
});
await page.goto("http://127.0.0.1:8123/index.html");
await page.waitForFunction(() => window.kachi && window.kachi.ready);
await page.evaluate(() => window.kachi.open("b1"));
await page.waitForTimeout(800);
const el = await page.$("#screen-game .board-wrap");
await el.screenshot({ path: "tmp/nf-fresh.png" });

// 2) filter は残し、img を CSS の clip-path で丸抜き
await page.evaluate(() => {
  const s = document.createElement("style");
  s.textContent = ".tanuki img{clip-path:circle(50% at 50% 50%)}";
  document.head.appendChild(s);
});
await page.waitForTimeout(400);
await el.screenshot({ path: "tmp/nf-clip.png" });
await browser.close();
console.log("ok");
