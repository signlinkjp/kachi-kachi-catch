/**
 * ステージ候補の生成（サンプリング + スコアリング）
 * node tools/gen2.mjs [target] [samples] [seed]
 */
import fs from "node:fs";
import { makeGeometry, stateFromStage, exactDistance, isCaught, renderState, cellKey, parseCell } from "../src/solver.js";

const N = 5;
const keys = [...Array(25).keys()].map((i) => `${Math.floor(i / N)},${i % N}`);

function rngFrom(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function neighborsKeys(k) {
  const [r, c] = k.split(",").map(Number);
  return [
    [r - 1, c],
    [r + 1, c],
    [r, c - 1],
    [r, c + 1],
  ]
    .filter(([a, b]) => a >= 0 && a < N && b >= 0 && b < N)
    .map(([a, b]) => `${a},${b}`);
}

function wallClusterScore(walls) {
  const set = new Set(walls);
  let pairs = 0;
  for (const w of walls) for (const nb of neighborsKeys(w)) if (set.has(nb)) pairs++;
  return pairs / 2;
}

const target = Number(process.argv[2] || 5);
const samples = Number(process.argv[3] || 60);
const seed0 = Number(process.argv[4] || 1234);

const cands = [];
const hist = {};
const t0 = Date.now();
for (let i = 0; i < samples; i++) {
  const rng = rngFrom(seed0 + i * 7919);
  const nWalls = 2 + Math.floor(rng() * 6);
  const nTraps = Math.floor(rng() * 7);
  const pool = [...keys].sort(() => rng() - 0.5);
  const walls = pool.slice(0, nWalls).sort();
  const tanuki = pool[nWalls];
  const traps = pool.slice(nWalls + 1, nWalls + 1 + nTraps).sort();
  const st = { walls, traps, tanuki };
  const geom = makeGeometry(walls);
  const state = stateFromStage(st);
  if (isCaught(state.traps, state.pos, geom)) continue;
  if ((state.traps >>> parseCell(tanuki)) & 1) continue;
  const r = exactDistance(state, geom, { maxLimit: 7 });
  const d = r ? r.distance : 0;
  hist[d] = (hist[d] || 0) + 1;
  if (d !== target) continue;
  if (r.moves.length > 4) continue;
  cands.push({ ...st, distance: d, firstMoves: r.moves.length, first: r.moves.map((m) => cellKey(m.cell)), cluster: wallClusterScore(walls) });
}
cands.sort((a, b) => a.firstMoves - b.firstMoves || b.cluster - a.cluster || a.walls.length - b.walls.length);
console.log(`target=${target} samples=${samples} found=${cands.length} ${(Date.now() - t0) / 1000}s hist=${JSON.stringify(hist)}`);
for (const c of cands.slice(0, 8)) {
  const geom = makeGeometry(c.walls);
  console.log(
    `\n--- walls=${c.walls.length} traps=${c.traps.length} firstMoves=${c.firstMoves} cluster=${c.cluster}\n${renderState(stateFromStage(c), geom)}\n${JSON.stringify(c)}`
  );
}
const outFile = "tools/candidates.json";
let all = [];
try {
  all = JSON.parse(fs.readFileSync(outFile, "utf8"));
} catch {}
all = all.filter((x) => x.distance !== target).concat(cands.slice(0, 12).map((c) => ({ ...c, target })));
fs.writeFileSync(outFile, JSON.stringify(all, null, 1));
