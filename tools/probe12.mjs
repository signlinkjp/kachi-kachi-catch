import pw from "/workspace/work/dcd-b17/node_modules/playwright/index.js";
const { chromium } = pw;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
await page.goto("http://127.0.0.1:8123/index.html");
await page.waitForFunction(() => window.kachi && window.kachi.ready);
await page.evaluate(() => window.kachi.open("b1"));
await page.waitForTimeout(700);
const el = await page.$("#screen-game .board-wrap");
// タヌキを罠マス(0,4)の上へ強制移動（見た目テスト）
await page.evaluate(() => {
  const board = document.querySelector("#board");
  const cell = board.children[4];
  const wrap = document.querySelector(".board-wrap");
  const r = cell.getBoundingClientRect();
  const wr = wrap.getBoundingClientRect();
  const t = document.querySelector("#tanuki");
  t.style.transform = `translate(${r.left - wr.left + 3}px, ${r.top - wr.top + 3}px)`;
});
await page.waitForTimeout(300);
await el.screenshot({ path: "tmp/trap-token.png" });
await browser.close();
console.log("ok");
