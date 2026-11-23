/**
 * 見た目の良い壁テンプレート × ランダムな罠・タヌキ位置 で、
 * 「最短手数がちょうど target」のステージを集める。
 * node tools/gen3.mjs
 */
import fs from "node:fs";
import { makeGeometry, stateFromStage, exactDistance, isCaught, renderState, cellKey, parseCell } from "../src/solver.js";

const keys = [...Array(25).keys()].map((i) => `${Math.floor(i / 5)},${i % 5}`);

function rngFrom(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// 見た目の壁パターン（岩・切り株の配置）
const TEMPLATES = {
  "両脇の岩": ["1,0", "1,4"],
  "四隅の岩": ["0,0", "0,4", "4,0", "4,4"],
  "三隅の岩": ["0,0", "0,4", "4,0"],
  "中央の切り株": ["2,2"],
  "十字の切り株": ["1,2", "3,2", "2,1", "2,3"],
  "左上の岩場": ["0,0", "0,1", "1,0"],
  "右下の岩場": ["4,4", "4,3", "3,4"],
  "対角の岩": ["0,0", "1,1", "3,3", "4,4"],
  "中央2x2": ["1,1", "1,2", "2,1", "2,2"],
  "中央2x2_右下": ["2,2", "2,3", "3,2", "3,3"],
  "上下の岩": ["0,2", "4,2"],
  "左右の岩": ["2,0", "2,4"],
  "斜めの切り株": ["0,4", "1,3", "3,1", "4,0"],
  "上段の岩": ["0,1", "0,2", "0,3"],
  "下段の岩": ["4,1", "4,2", "4,3"],
  "中央と四隅": ["2,2", "0,0", "0,4", "4,0", "4,4"],
  "左右の岩場": ["1,0", "2,0", "1,4", "2,4"],
  "千鳥の岩": ["0,0", "1,2", "2,4", "3,1", "4,3"],
};

const results = {};
const t0 = Date.now();
const targets = [1, 3, 5, 7];
for (const target of targets) results[target] = [];

let seed = Number(process.argv[2] || 777);
const SAMPLES = Number(process.argv[3] || 900);
for (let i = 0; i < SAMPLES; i++) {
  const rng = rngFrom(seed + i * 131);
  const tplNames = Object.keys(TEMPLATES);
  const tpl = tplNames[Math.floor(rng() * tplNames.length)];
  const walls = [...TEMPLATES[tpl]];
  const free = keys.filter((k) => !walls.includes(k));
  const pool = [...free].sort(() => rng() - 0.5);
  const tanuki = pool[0];
  const nTraps = Math.floor(rng() * 6);
  const traps = pool.slice(1, 1 + nTraps).sort();
  const geom = makeGeometry(walls);
  const state = stateFromStage({ walls, traps, tanuki });
  if (isCaught(state.traps, state.pos, geom)) continue;
  const r = exactDistance(state, geom, { maxLimit: 7 });
  const d = r ? r.distance : 0;
  if (!targets.includes(d)) continue;
  const need = d === 1 ? 3 : d === 3 ? 4 : d === 5 ? 3 : 2;
  if (results[d].length >= need * 4) continue;
  if (r.moves.length > 2) continue;
  const sig = walls.join("|") + "#" + traps.join("|") + "#" + tanuki;
  if (results[d].some((x) => x.sig === sig)) continue;
  results[d].push({ tpl, walls, traps, tanuki, distance: d, firstMoves: r.moves.length, first: r.moves.map((m) => cellKey(m.cell)), sig });
  console.log(`d=${d} tpl=${tpl} traps=${nTraps} first=${r.moves.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}

fs.writeFileSync("tools/curated.json", JSON.stringify(results, null, 1));
for (const t of targets) {
  console.log(`\n========== ${t}手詰 (${results[t].length} 候補) ==========`);
  for (const c of results[t]) {
    console.log(`\n[${c.tpl}] traps=${c.traps.length} firstMoves=${c.firstMoves}\n${renderState(stateFromStage(c), makeGeometry(c.walls))}\n${JSON.stringify({ walls: c.walls, traps: c.traps, tanuki: c.tanuki })}`);
  }
}
