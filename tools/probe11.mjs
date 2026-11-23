import pw from "/workspace/work/dcd-b17/node_modules/playwright/index.js";
const { chromium } = pw;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
await page.goto("http://127.0.0.1:8123/index.html");
await page.waitForFunction(() => window.kachi && window.kachi.ready);
await page.evaluate(() => window.kachi.open("b1"));
await page.waitForTimeout(600);
const info = await page.evaluate(async () => {
  const img = document.querySelector("#tanuki img");
  await img.decode();
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 512;
  const g = c.getContext("2d");
  g.clearRect(0, 0, 512, 512);
  g.drawImage(img, 0, 0, 512, 512);
  const px = (x, y) => Array.from(g.getImageData(x, y, 1, 1).data);
  // 縮小後の見え方も確認
  const c2 = document.createElement("canvas");
  c2.width = 58; c2.height = 58;
  const g2 = c2.getContext("2d");
  g2.clearRect(0, 0, 58, 58);
  g2.drawImage(img, 0, 0, 58, 58);
  const px2 = (x, y) => Array.from(g2.getImageData(x, y, 1, 1).data);
  return {
    corner: px(2, 2),
    edge: px(30, 30),
    mid: px(256, 256),
    smallCorner: px2(2, 2),
    smallCorner5: px2(5, 5),
    smallMid: px2(29, 29),
    natural: [img.naturalWidth, img.naturalHeight],
    complete: img.complete,
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
