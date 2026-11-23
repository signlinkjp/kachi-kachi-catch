import pw from "/workspace/work/dcd-b17/node_modules/playwright/index.js";
const { chromium } = pw;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
await page.goto("http://127.0.0.1:8123/index.html");
await page.waitForFunction(() => window.kachi && window.kachi.ready);
await page.evaluate(() => window.kachi.open("b1"));
await page.waitForTimeout(600);
const info = await page.evaluate(() => {
  const out = [];
  const walk = (el, depth) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    out.push({
      d: depth,
      tag: el.tagName,
      cls: typeof el.className === "string" ? el.className : "",
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      bg: cs.backgroundColor,
      bgImg: cs.backgroundImage.slice(0, 40),
      opacity: cs.opacity,
      src: el.tagName === "IMG" ? el.src.split("/").pop() : undefined,
      naturalSize: el.tagName === "IMG" ? [el.naturalWidth, el.naturalHeight] : undefined,
    });
    for (const c of el.children) walk(c, depth + 1);
  };
  const cell0 = document.querySelector("#board").children[0];
  walk(cell0, 0);
  const t = document.querySelector("#tanuki");
  walk(t, 0);
  return out;
});
console.log(JSON.stringify(info, null, 0).replace(/\},\{/g, "},\n{"));
await browser.close();
