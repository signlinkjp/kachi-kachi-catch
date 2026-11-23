/**
 * 実ブラウザ検証 + スクリーンショット + デモ動画
 * node tools/capture.mjs [--video]
 */
import pw from "/workspace/work/dcd-b17/node_modules/playwright/index.js";
const { chromium } = pw;
import fs from "node:fs";

const OUT = "/workspace/downloads";
const URL = "http://127.0.0.1:8123/index.html";
const wantVideo = process.argv.includes("--video");

const consoleErrors = [];

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 2,
  locale: "ja-JP",
  timezoneId: "Asia/Tokyo",
  ...(wantVideo
    ? {
        recordVideo: { dir: "/workspace/work/kachi-kachi-catch/tmp/video", size: { width: 393, height: 852 } },
      }
    : {}),
});
const page = await context.newPage();
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForFunction(() => window.kachi && window.kachi.ready);
await page.evaluate(() => window.kachi.muted(true));
await page.waitForTimeout(700);

const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}` });
  console.log("shot", name);
};

if (!wantVideo) {
  // 1) タイトル
  await shot("kachi-proto-title.png");

  // 2) 初級1手詰プレイ画面（十字プレビュー付き）
  await page.evaluate(() => window.kachi.open("b1"));
  await page.waitForTimeout(650);
  await page.evaluate(() => window.kachi.hint());
  await page.waitForTimeout(500);
  await shot("kachi-proto-play1.png");

  // 3) 上級5手詰プレイ画面（2手すすめた局面）
  await page.evaluate(async () => {
    window.kachi.open("a1");
    await new Promise((r) => setTimeout(r, 500));
    const g = window.kachi;
    const st = g.state();
    // 最善手順のうち2手だけ打つ
    await g.tap(2 * 5 + 2); // (2,2) — a1 の初手
    await new Promise((r) => setTimeout(r, 700));
    const hint = g.hint();
    if (hint != null) await g.tap(hint);
    await new Promise((r) => setTimeout(r, 700));
  });
  await page.waitForTimeout(2600);
  await shot("kachi-proto-play5.png");

  // 4) クリア画面
  await page.evaluate(async () => {
    window.kachi.open("m1");
    await new Promise((r) => setTimeout(r, 400));
    await window.kachi.playPv({ gap: 500 });
  });
  await page.waitForTimeout(1200);
  await shot("kachi-proto-clear.png");

  const st = await page.evaluate(() => window.kachi.state());
  console.log("final state:", JSON.stringify(st));
  console.log("console errors:", consoleErrors);
}

await browser.close();
if (wantVideo) {
  const dir = "/workspace/work/kachi-kachi-catch/tmp/video";
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".webm"));
  console.log("videos:", files.join(", "));
}
