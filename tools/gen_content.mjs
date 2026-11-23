/**
 * pool.json → src/stages.js（通常50問） / src/daily.js（デイリー120問） / src/solutions.js
 */
import fs from "node:fs";
import { STAGES as OLD } from "../src/stages.js";
import { makeGeometry, stateFromStage, exactDistance, principalLine, cellKey } from "../src/solver.js";

const pool = JSON.parse(fs.readFileSync("tools/pool.json", "utf8"));

// 手数ごとに「初手が少ない → 岩が多い」順で並べる
const byPar = { 1: [], 3: [], 5: [], 7: [] };
for (const p of pool) byPar[p.par].push(p);
for (const par of [1, 3, 5, 7]) {
  byPar[par].sort((a, b) => a.firstMoves - b.firstMoves || b.walls.length - a.walls.length);
}

// 通常50問: 1手10 / 3手15 / 5手15 / 7手10
const stageCount = { 1: 10, 3: 15, 5: 15, 7: 10 };
const stagePicks = [];
for (const par of [1, 3, 5, 7]) stagePicks.push(...byPar[par].slice(0, stageCount[par]));
const used = new Set(stagePicks.map((p) => JSON.stringify(p)));

// デイリー: 残り全部（120問）
let rest = pool.filter((p) => !used.has(JSON.stringify(p)));
// 決定的シャッフル（日付ごとに手数が散るように）
let s = 20261124;
const rnd = () => {
  s = (s * 1664525 + 1013904223) >>> 0;
  return s / 4294967296;
};
rest = rest
  .map((p) => ({ p, k: rnd() }))
  .sort((a, b) => a.k - b.k)
  .map((x) => x.p);

console.log("pool", pool.length, "stages", stagePicks.length, "daily", rest.length);

const diffOf = { 1: "beginner", 3: "middle", 5: "advanced", 7: "expert" };
const pad = (n) => String(n).padStart(2, "0");

function stageEntry(p, id, idx, par) {
  return `  {
    id: "${id}",
    index: ${idx},
    difficulty: "${diffOf[par]}",
    par: ${par},
    walls: ${JSON.stringify(p.walls)},
    traps: ${JSON.stringify(p.traps)},
    tanuki: "${p.tanuki}",
  },`;
}

const stageBody = stagePicks.map((p, i) => stageEntry(p, `s${pad(i + 1)}`, i + 1, p.par)).join("\n");
fs.writeFileSync(
  "src/stages.js",
  `/**
 * 通常ステージ 50問（自動生成: tools/gen_content.mjs）
 * すべて solver で「最短手数＝par」を検証済み（test/stages.test.mjs）。
 * 座標は "行,列"（0始まり）。
 */
export const STAGES = [
${stageBody}
];

export const DIFFICULTIES = ["beginner", "middle", "advanced", "expert"];
export const PAR_OF = { beginner: 1, middle: 3, advanced: 5, expert: 7 };

export const stageById = (id) => STAGES.find((s) => s.id === id);
export const stagesOf = (diff) => STAGES.filter((s) => s.difficulty === diff);
`
);

const dailyBody = rest.map((p, i) => stageEntry(p, `d${String(i + 1).padStart(3, "0")}`, i + 1, p.par)).join("\n");
fs.writeFileSync(
  "src/daily.js",
  `/**
 * デイリー問題 120問（自動生成: tools/gen_content.mjs）
 * 端末の日付から 1日1問 を選ぶ（src/dailylogic.js）。すべて solver 検証済み。
 */
export const DAILY = [
${dailyBody}
];

/** デイリーの起点（この日が index 0） */
export const DAILY_EPOCH = "2026-01-01";
export const DAILY_COUNT = DAILY.length;
`
);

// --- 全問の最善手順（起動時にソルバーを回さないための事前計算） ---
const all = [
  ...stagePicks.map((p, i) => ({ id: `s${pad(i + 1)}`, p })),
  ...rest.map((p, i) => ({ id: `d${String(i + 1).padStart(3, "0")}`, p })),
];
const SOL_TMP = "tools/solutions.json";
let sol = {};
try { sol = JSON.parse(fs.readFileSync(SOL_TMP, "utf8")); } catch { sol = {}; }
const t0 = Date.now();
const budget = Number(process.argv[2] || 250) * 1000;
let done = 0, skipped = 0;
for (const { id, p } of all) {
  if (sol[id] && sol[id].length === p.par) { skipped++; continue; }
  if (Date.now() - t0 > budget) break;
  const geom = makeGeometry(p.walls);
  const line = principalLine(stateFromStage(p), geom, { limit: p.par });
  if (line.length !== p.par || !line[line.length - 1].caught) {
    throw new Error(`${id}: PV mismatch par=${p.par} line=${line.length}`);
  }
  sol[id] = line.map((x) => ({ player: cellKey(x.player), tanuki: x.tanuki == null ? null : cellKey(x.tanuki) }));
  done++;
  fs.writeFileSync(SOL_TMP, JSON.stringify(sol));
}
const missing = all.filter(({ id, p }) => !(sol[id] && sol[id].length === p.par));
console.log(`solutions: done=${done} skipped=${skipped} missing=${missing.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
if (missing.length) {
  console.log("next:", missing.slice(0, 5).map((m) => m.id).join(" "));
  process.exit(0);
}
fs.writeFileSync(
  "src/solutions.js",
  `/**
 * 全問の最善手順（自動生成: tools/gen_content.mjs）
 * player = プレイヤーのタップ位置, tanuki = そのあとポコ丸が逃げた位置（null なら捕まえた）
 */
export const SOLUTIONS = ${JSON.stringify(sol, null, 0)};
`
);
console.log("solutions", all.length, "in", ((Date.now() - t0) / 1000).toFixed(1), "s");
console.log("old stages replaced:", OLD.length, "->", stagePicks.length);
