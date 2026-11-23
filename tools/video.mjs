/**
 * デモ動画（タイトル → ステージプレイ → 逃走 → 捕獲 → クリア）
 * Playwright の画面録画（webm）→ ffmpeg で MP4 に変換。
 */
import pw from "/workspace/work/dcd-b17/node_modules/playwright/index.js";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const { chromium } = pw;
const URL = "http://127.0.0.1:8123/index.html";
const VIDEO_DIR = "/workspace/work/kachi-kachi-catch/tmp/video";
const OUT = "/workspace/downloads/kachi-proto-demo.mp4";
const STAGE = process.argv[2] || "m1";

fs.rmSync(VIDEO_DIR, { recursive: true, force: true });
fs.mkdirSync(VIDEO_DIR, { recursive: true });

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 2,
  locale: "ja-JP",
  timezoneId: "Asia/Tokyo",
  recordVideo: { dir: VIDEO_DIR, size: { width: 786, height: 1704 } },
});
const page = await context.newPage();
const wait = (ms) => page.waitForTimeout(ms);

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForFunction(() => window.kachi && window.kachi.ready);
await page.evaluate(() => window.kachi.muted(true));
await page.evaluate(() => localStorage.setItem("kachi.cleared.v1", "[]"));
await wait(600);

// --- タイトル ---
await page.evaluate(() => window.kachi.showTitle());
await wait(1000);

// --- ステージ開始 ---
await page.evaluate((id) => window.kachi.open(id), STAGE);
await wait(820);

// --- プレイ（ヒントどおりに指す）---
const par = await page.evaluate(() => window.kachi.state().par);
for (let i = 0; i < par; i++) {
  const before = await page.evaluate(() => window.kachi.state());
  if (before.status !== "playing") break;
  const cell = await page.evaluate(() => window.kachi.hint());
  if (cell == null) break;
  await wait(i === 0 ? 500 : 380);
  await page.evaluate((c) => window.kachi.tap(c), cell);
  await wait(650);
}

// --- クリア演出を少し見せる ---
await page.evaluate(() => {
  const st = window.kachi.state();
  return st && st.status;
});
await wait(1500);

const state = await page.evaluate(() => window.kachi.state());
const videoPath = await page.video().path();
await context.close();
await browser.close();

console.log("state:", JSON.stringify(state));
console.log("webm:", videoPath);

const ffmpeg = execFileSync("python3", ["-c", "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"]).toString().trim();
execFileSync(
  ffmpeg,
  [
    "-y",
    "-i",
    videoPath,
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-pix_fmt",
    "yuv420p",
    "-crf",
    "20",
    "-movflags",
    "+faststart",
    "-r",
    "30",
    OUT,
  ],
  { stdio: "inherit" }
);
const st = fs.statSync(OUT);
console.log("mp4:", OUT, (st.size / 1024 / 1024).toFixed(2), "MB");
