/**
 * Build 6: オープニングのスクリーンショット（アニメを時間で止めて撮る）。
 *   node tools/shots-b6-opening.mjs [outdir]
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const OUT = process.argv[2] || path.join(ROOT, "tmp");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".mp3": "audio/mpeg" };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent((req.url || "/").split("?")[0]);
  let f = path.join(ROOT, u);
  if (u.endsWith("/")) f = path.join(f, "index.html");
  fs.readFile(f, (e, d) => {
    if (e) return res.writeHead(404).end("nf");
    res.writeHead(200, { "Content-Type": MIME[path.extname(f).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(d);
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const { chromium } = await import("playwright");
const b = await chromium.launch({ args: ["--no-sandbox"] });
fs.mkdirSync(OUT, { recursive: true });
const TIMES = [200, 400, 600, 800, 1000, 1200, 1500, 2000];
for (const vp of [{ width: 393, height: 852 }, { width: 375, height: 667 }]) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.goto("http://127.0.0.1:" + port + "/index.html");
  await p.waitForFunction(() => window.kachi && window.kachi.ready);
  await p.waitForTimeout(60);
  for (const t of TIMES) {
    await p.evaluate((ms) => {
      window.kachi.showOpening();
      // すべてのアニメを同じ時刻で止める（コマ送りも含めて再現性のある絵にする）
      for (const a of document.getAnimations()) {
        try {
          a.pause();
          a.currentTime = ms;
        } catch {}
      }
    }, t);
    await p.waitForTimeout(80);
    await p.screenshot({ path: path.join(OUT, `b6-open-${vp.width}-${String(t).padStart(4, "0")}ms.png`) });
  }
  await ctx.close();
}
await b.close();
server.close();
console.log("saved to", OUT);
