/** 配布用 www/ を作る（index.html・styles.css・src/・assets/） */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "www");
const ASSETS = [
  "title_hero.png",
  "rabbit_token.png",
  "tanuki_token.png",
  "rabbit_face.png",
  "tanuki_face.png",
  "kachi-appicon-1024.png",
];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "src"), { recursive: true });
fs.mkdirSync(path.join(OUT, "assets"), { recursive: true });

for (const f of ["index.html", "styles.css"]) {
  fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f));
}
for (const f of fs.readdirSync(path.join(ROOT, "src"))) {
  if (f.endsWith(".js")) fs.copyFileSync(path.join(ROOT, "src", f), path.join(OUT, "src", f));
}
for (const f of ASSETS) {
  const src = path.join(ROOT, "assets", f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(OUT, "assets", f));
}
// ボイス（assets/voices/<lang>/*.mp3）はフォルダごとコピーする
const VOICES = path.join(ROOT, "assets", "voices");
if (fs.existsSync(VOICES)) {
  for ( const lang of fs.readdirSync(VOICES)) {
    const srcDir = path.join(VOICES, lang);
    if (!fs.statSync(srcDir).isDirectory()) continue;
    const outDir = path.join(OUT, "assets", "voices", lang);
    fs.mkdirSync(outDir, { recursive: true });
    for (const f of fs.readdirSync(srcDir)) {
      if (f.endsWith(".mp3")) fs.copyFileSync(path.join(srcDir, f), path.join(outDir, f));
    }
  }
}
const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else files.push(path.relative(OUT, p));
  }
};
walk(OUT);
console.log("www:", files.length, "files");
