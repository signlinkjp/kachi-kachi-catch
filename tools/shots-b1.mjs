/**
 * 審査用/確認用スクリーンショット（Build 1）
 * iPhone 15 Pro Max 相当（430x932 @3 = 1290x2796）で撮影する。
 */
import pw from "/workspace/work/dcd-b17/node_modules/playwright/index.js";
const { chromium } = pw;

const URL = "http://127.0.0.1:8123/index.html?dev=1";
const OUT = "/workspace/downloads";

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 430, height: 932 },
  deviceScaleFactor: 3,
  locale: "ja-JP",
  timezoneId: "Asia/Tokyo",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push("console: " + m.text());
});
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForFunction(() => window.kachi && window.kachi.ready);
await page.evaluate(() => window.kachi.setPro(true));
await page.waitForTimeout(2200); // オープニング

const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/kachi-b1-${name}.png` });
  console.log("shot", name);
};

// 1. タイトル
await page.evaluate(() => window.kachi.showTitle());
await page.waitForTimeout(500);
await shot("title");

// 2. ステージ一覧（PRO有効・全50問）
await page.evaluate(() => window.kachi.showSelect());
await page.waitForTimeout(450);
await shot("stages");

// 3. 初級のプレイ画面（十字プレビュー＋ヒント）
await page.evaluate(() => window.kachi.openStage("s02"));
await page.waitForTimeout(700);
const h = await page.evaluate(() => window.kachi.hint());
await page.waitForTimeout(450);
const cellBox = await page.evaluate((i) => {
  const board = document.getElementById("board");
  const c = board.children[i];
  const r = c.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, i };
}, h);
// 十字プレビューを出した状態にする（指を置いた想定）
await page.evaluate((i) => {
  const board = document.getElementById("board");
  const s = window.kachi.state();
  void s;
  board.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 0, clientY: 0 }));
  const cell = board.children[i];
  cell.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
}, h);
await page.waitForTimeout(300);
await shot("play-beginner");
await page.mouse.click(cellBox.x, cellBox.y);
await page.waitForTimeout(1400);

// 4. 上級5手詰を2手すすめた局面
await page.evaluate(async () => {
  window.kachi.openStage("s27");
  await new Promise((r) => setTimeout(r, 500));
  const a = window.kachi.hint();
  await window.kachi.tap(a);
  await new Promise((r) => setTimeout(r, 900));
  const b = window.kachi.hint();
  if (b != null) await window.kachi.tap(b);
});
await page.waitForTimeout(2200);
await shot("play-advanced");

// 5. クリア画面
await page.evaluate(async () => {
  window.kachi.openStage("s11");
  await new Promise((r) => setTimeout(r, 400));
  await window.kachi.playPv({ gap: 520 });
});
await page.waitForTimeout(1400);
await shot("clear");

// 6. 今日の1問
await page.evaluate(() => window.kachi.showDaily());
await page.waitForTimeout(450);
await shot("daily");

// 7. タイムアタック
await page.evaluate(() => {
  window.kachi.showTitle();
});
await page.waitForTimeout(200);
await page.evaluate(() => window.kachi.startTa());
await page.waitForTimeout(600);
const tac = await page.evaluate(() => window.kachi.hint());
if (tac != null) {
  await page.evaluate((c) => window.kachi.tap(c), tac);
  await page.waitForTimeout(900);
}
await shot("timeattack");

// 8. あそびかた
await page.evaluate(() => window.kachi.showHowto());
await page.waitForTimeout(400);
await shot("howto");

// 9. 設定
await page.evaluate(() => window.kachi.showSettings());
await page.waitForTimeout(400);
await shot("settings");

// 10. PROシート
await page.evaluate(() => window.kachi.openPro());
await page.waitForTimeout(450);
await shot("pro");
await page.evaluate(() => window.kachi.closeSheets());

// 11. 英語タイトル（12言語対応の確認用）
await page.evaluate(() => window.kachi.setLang("en"));
await page.evaluate(() => window.kachi.showTitle());
await page.waitForTimeout(450);
await shot("title-en");

console.log("errors:", errors);
await browser.close();
