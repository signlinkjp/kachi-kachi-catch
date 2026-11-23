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
  const pts = [
    [r.left + 2, r.top + 2],
    [r.left + r.width / 2, r.top + 1],
  ];
  const out = pts.map(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    const cs = el ? getComputedStyle(el) : null;
    return { x, y, tag: el && el.tagName, cls: el && el.className, bg: cs && cs.backgroundColor, bgImg: cs && cs.backgroundImage.slice(0, 60) };
  });
  const cs = getComputedStyle(t);
  return { rect: { x: r.x, y: r.y, w: r.width, h: r.height }, pts: out, tanukiBg: cs.backgroundColor, imgAlpha: getComputedStyle(t.querySelector("img")).opacity };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
