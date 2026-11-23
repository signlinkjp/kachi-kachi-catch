/** 通路（壁で囲った1マス幅の道）テンプレートで深い詰みを作る */
import { makeGeometry, stateFromStage, exactDistance, isCaught, principalLine, cellAt } from "../src/solver.js";

let s0 = Number(process.argv[2] || 7);
const rng = () => {
  s0 = (s0 * 1664525 + 1013904223) >>> 0;
  return s0 / 4294967296;
};
const N = 5;
const allCells = [...Array(25).keys()];
const k = (i) => `${Math.floor(i / N)},${i % N}`;

function neighbors(i) {
  const r = Math.floor(i / N), c = i % N;
  const out = [];
  if (r > 0) out.push(i - N);
  if (r < N - 1) out.push(i + N);
  if (c > 0) out.push(i - 1);
  if (c < N - 1) out.push(i + 1);
  return out;
}

/** ランダムな自己回避ウォーク（通路）を作る */
function randomPath(len) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const start = allCells[Math.floor(rng() * 25)];
    const path = [start];
    const used = new Set(path);
    while (path.length < len) {
      const cands = neighbors(path[path.length - 1]).filter((n) => !used.has(n));
      if (!cands.length) break;
      const nx = cands[Math.floor(rng() * cands.length)];
      path.push(nx);
      used.add(nx);
    }
    if (path.length >= len) return path;
  }
  return null;
}

const results = { 5: [], 7: [] };
const budget = Number(process.argv[3] || 60000);
const t0 = Date.now();
let tested = 0;
const hist = {};

while (Date.now() - t0 < budget) {
  const len = 6 + Math.floor(rng() * 6);
  const path = randomPath(len);
  if (!path) continue;
  const inPath = new Set(path);
  const walls = allCells.filter((i) => !inPath.has(i)).map(k);
  // 通路の終端以外のどこかにタヌキ、罠は0〜2個を通路内に
  const ti = Math.floor(rng() * (path.length - 1));
  const tanuki = k(path[ti]);
  const traps = [];
  const nTraps = Math.floor(rng() * 3);
  for (let i = 0; i < nTraps; i++) {
    const c = path[Math.floor(rng() * path.length)];
    if (k(c) !== tanuki) traps.push(k(c));
  }
  const st = { walls, traps, tanuki };
  const geom = makeGeometry(walls);
  const state = stateFromStage(st);
  if (isCaught(state.traps, state.pos, geom)) continue;
  tested++;
  const r = exactDistance(state, geom, { maxLimit: 7 });
  const d = r ? r.distance : 0;
  hist[d] = (hist[d] || 0) + 1;
  if (d >= 5) {
    const sig = walls.slice().sort().join("|") + "#" + traps.slice().sort().join("|") + "#" + tanuki;
    if (!results[d].some((x) => x.sig === sig)) {
      results[d].push({ ...st, sig, firstMoves: r.moves.length });
      console.log(`d=${d} pathLen=${path.length} walls=${walls.length} traps=${traps.length} first=${r.moves.length} tested=${tested}`);
    }
  }
}
console.log("tested", tested, "hist", hist);
console.log("--- best 7 ---");
for (const r of results[7].slice(0, 5)) console.log(JSON.stringify({ walls: r.walls, traps: r.traps, tanuki: r.tanuki, firstMoves: r.firstMoves }));
console.log("--- best 5 ---");
for (const r of results[5].slice(0, 5)) console.log(JSON.stringify({ walls: r.walls, traps: r.traps, tanuki: r.tanuki, firstMoves: r.firstMoves }));
