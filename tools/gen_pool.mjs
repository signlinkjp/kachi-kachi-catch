/**
 * 問題プール生成（再開可能）
 * 目標: 1手詰 35問 / 3手詰 55問 / 5手詰 50問 / 7手詰 30問（計170問）
 *  - 通常ステージ 50問 + デイリー 120問 に振り分ける
 *  - 最短手数は exactDistance(limit=7) で厳密に判定
 *  - 初手が 3通り以下、壁 1〜6 の見た目重視
 *
 * 使い方: node tools/gen_pool.mjs [秒数]
 */
import fs from "node:fs";
import { makeGeometry, stateFromStage, exactDistance, isCaught, parseCell } from "../src/solver.js";

const POOL = "tools/pool.json";
const keys = [...Array(25).keys()].map((i) => `${Math.floor(i / 5)},${i % 5}`);

const TARGETS = { 1: 35, 3: 55, 5: 50, 7: 30 };

const TEMPLATES = [
  ["1,0", "1,4"],
  ["0,0", "0,4", "4,0", "4,4"],
  ["0,0", "0,4", "4,0"],
  ["2,2"],
  ["1,2", "3,2", "2,1", "2,3"],
  ["0,0", "0,1", "1,0"],
  ["4,4", "4,3", "3,4"],
  ["0,0", "1,1", "3,3", "4,4"],
  ["1,1", "1,2", "2,1", "2,2"],
  ["2,2", "2,3", "3,2", "3,3"],
  ["0,2", "4,2"],
  ["2,0", "2,4"],
  ["0,4", "1,3", "3,1", "4,0"],
  ["0,1", "0,2", "0,3"],
  ["4,1", "4,2", "4,3"],
  ["2,2", "0,0", "0,4", "4,0", "4,4"],
  ["1,0", "2,0", "1,4", "2,4"],
  ["0,0", "1,2", "2,4", "3,1", "4,3"],
  ["0,1", "1,0"],
  ["1,1", "1,3", "3,1", "3,3"],
];

function rngFrom(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

let pool = [];
try {
  pool = JSON.parse(fs.readFileSync(POOL, "utf8"));
} catch {
  pool = [];
}
const sigOf = (s) =>
  [...s.walls].sort().join("|") + "#" + [...s.traps].sort().join("|") + "#" + s.tanuki;
const seen = new Set(pool.map(sigOf));

function counts() {
  const c = { 1: 0, 3: 0, 5: 0, 7: 0 };
  for (const p of pool) c[p.par] = (c[p.par] || 0) + 1;
  return c;
}
function complete() {
  const c = counts();
  return [1, 3, 5, 7].every((p) => (c[p] || 0) >= TARGETS[p]);
}

const budgetMs = Number(process.argv[2] || 240) * 1000;
const t0 = Date.now();
const seedBase = Number(process.argv[3] || Date.now() % 100000);
let samples = 0;
let hits = 0;

while (!complete() && Date.now() - t0 < budgetMs) {
  const rng = rngFrom(seedBase + samples * 7919);
  samples++;
  // 7手狙いは壁多めのテンプレに寄せる
  const c = counts();
  const wantHard = (TARGETS[7] - (c[7] || 0)) > 0 && rng() < 0.45;
  const tpl = TEMPLATES[Math.floor(rng() * TEMPLATES.length)];
  const walls = [...tpl];
  if (wantHard && rng() < 0.5) {
    const extra = keys[Math.floor(rng() * keys.length)];
    if (!walls.includes(extra) && walls.length < 6) walls.push(extra);
  }
  if (!wantHard && walls.length > 4 && rng() < 0.4) walls.pop();
  const free = keys.filter((k) => !walls.includes(k));
  const shuffled = [...free].sort(() => rng() - 0.5);
  const tanuki = shuffled[0];
  const nTraps = Math.floor(rng() * 6);
  const traps = shuffled.slice(1, 1 + nTraps).sort();

  const geom = makeGeometry(walls);
  const state = stateFromStage({ walls, traps, tanuki });
  if (isCaught(state.traps, state.pos, geom)) continue;
  if ((state.traps >>> parseCell(tanuki)) & 1) continue;

  const r = exactDistance(state, geom, { maxLimit: 7 });
  if (!r) continue;
  if (![1, 3, 5, 7].includes(r.distance)) continue;
  if (r.moves.length > 3) continue;
  if (r.moves.length === 0) continue;
  const sig = sigOf({ walls, traps, tanuki });
  if (seen.has(sig)) continue;
  if ((counts()[r.distance] || 0) >= TARGETS[r.distance]) continue;
  // 壁上のタヌキ・罠は不可（念のため）
  const entry = {
    walls: walls.slice().sort(),
    traps,
    tanuki,
    par: r.distance,
    firstMoves: r.moves.length,
    first: r.moves.map((m) => `${Math.floor(m.cell / 5)},${m.cell % 5}`),
  };
  pool.push(entry);
  seen.add(sig);
  hits++;
  fs.writeFileSync(POOL, JSON.stringify(pool, null, 0));
}
fs.writeFileSync(POOL, JSON.stringify(pool, null, 0));
console.log(
  `samples=${samples} hits=${hits} total=${pool.length} counts=${JSON.stringify(counts())} complete=${complete()} ${((Date.now() - t0) / 1000).toFixed(0)}s`
);
