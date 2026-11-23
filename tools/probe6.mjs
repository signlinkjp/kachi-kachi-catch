import pw from "/workspace/work/dcd-b17/node_modules/playwright/index.js";
import fs from "node:fs";
const { chromium } = pw;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
await page.goto("http://127.0.0.1:8123/index.html");
await page.waitForFunction(() => window.kachi && window.kachi.ready);
await page.evaluate(() => window.kachi.open("b1"));
await page.waitForTimeout(600);
const el = await page.$("#screen-game .board-wrap");

const variants = {
  base: () => {},
  noFilter: () => (document.querySelector("#tanuki").style.filter = "none"),
  noWillChange: () => (document.querySelector("#tanuki").style.willChange = "auto"),
  imgRadius: () => (document.querySelector("#tanuki img").style.borderRadius = "50%"),
  bgRed: () => (document.querySelector("#tanuki").style.background = "red"),
  isolate: () => (document.querySelector("#tanuki").style.isolation = "isolate"),
};
for (const [name, fn] of Object.entries(variants)) {
  await page.evaluate(fn);
  await page.waitForTimeout(250);
  await el.screenshot({ path: `tmp/v-${name}.png` });
}
await browser.close();
console.log("ok");
