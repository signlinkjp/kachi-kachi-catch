import pw from "/workspace/work/dcd-b17/node_modules/playwright/index.js";
const { chromium } = pw;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
await page.goto("http://127.0.0.1:8123/index.html");
await page.waitForFunction(() => window.kachi && window.kachi.ready);
await page.waitForTimeout(500);
const info = await page.evaluate(() => {
  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) };
  };
  return {
    screen: pick("#screen-title"),
    head: pick(".title-head"),
    hero: pick(".hero"),
    paw: pick(".paw-trail"),
    foot: pick(".title-foot"),
    hint: pick(".title-hint"),
    actions: pick(".title-actions"),
    credit: pick(".credit"),
    innerH: window.innerHeight,
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
