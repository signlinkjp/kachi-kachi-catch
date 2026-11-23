import pw from "/workspace/work/dcd-b17/node_modules/playwright/index.js";
const { chromium } = pw;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
await page.goto("http://127.0.0.1:8123/index.html");
await page.waitForFunction(() => window.kachi && window.kachi.ready);
await page.evaluate(() => window.kachi.open("b1"));
await page.waitForTimeout(600);
const info = await page.evaluate(() => {
  const t = document.querySelector("#tanuki");
  const r = t.getBoundingClientRect();
  const x = r.left + 3;
  const y = r.top + 3;
  const els = document.elementsFromPoint(x, y).map((e) => {
    const cs = getComputedStyle(e);
    return `${e.tagName}.${typeof e.className === "string" ? e.className : ""} bg=${cs.backgroundColor} bgi=${cs.backgroundImage.slice(0, 30)} op=${cs.opacity} sh=${cs.boxShadow.slice(0, 30)}`;
  });
  return els;
});
console.log(info.join("\n"));
await browser.close();
