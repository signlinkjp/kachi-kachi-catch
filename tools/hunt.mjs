/** 深い詰み（5手・7手）を探す総当たり探索。時間予算つき。 */
import { makeGeometry, stateFromStage, exactDistance, isCaught } from "../src/solver.js";

let s0 = 424242;
const rng = () => {
  s0 = (s0 * 1664525 + 1013904223) >>> 0;
  return s0 / 4294967296;
};
const keys = [...Array(25).keys()].map((i) => `${Math.floor(i / 5)},${i % 5}`);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];

const budgetMs = Number(process.argv[2] || 120000);
const start = Date.now();
const found = { 5: [], 6: [], 7: [] };
let n = 0;
const hist = {};

while (Date.now() - start < budgetMs) {
  const nWalls = 4 + Math.floor(rng() * 7);
  const nTraps = Math.floor(rng() * 7);
  const pool = [...keys].sort(() => rng() - 0.5);
  const walls = pool.slice(0, nWalls);
  const tanuki = pool[nWalls];
  const traps = pool.slice(nWalls + 1, nWalls + 1 + nTraps);
  const st = { walls, traps, tanuki };
  const geom = makeGeometry(st.walls);
  const state = stateFromStage(st);
  if (isCaught(state.traps, state.pos, geom)) continue;
  n++;
  const r = exactDistance(state, geom, { maxLimit: 7 });
  const d = r ? r.distance : 0;
  hist[d] = (hist[d] || 0) + 1;
  if (d >= 5) {
    found[d].push({ ...st, moves: r.moves.length });
    console.log(`d=${d} walls=${nWalls} traps=${nTraps} firstMoves=${r.moves.length} n=${n} ${((Date.now() - start) / 1000).toFixed(1)}s`);
  }
}
console.log("tested", n, "hist", hist);
console.log(JSON.stringify(found[7].slice(0, 5)));
console.log(JSON.stringify(found[5].slice(0, 5)));
