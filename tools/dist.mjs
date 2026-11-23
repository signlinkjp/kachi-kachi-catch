import { makeGeometry, stateFromStage, exactDistance } from "../src/solver.js";

let seed = 987654321;
const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const keys = [...Array(25).keys()].map((i) => `${Math.floor(i / 5)},${i % 5}`);

function randStage(nWalls, nTraps) {
  const pool = [...keys];
  const take = (n) => {
    const out = [];
    while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    return out;
  };
  const walls = take(nWalls);
  const tanuki = take(1)[0];
  const traps = take(nTraps);
  return { walls, traps, tanuki };
}

const hist = {};
let maxMs = 0;
const t0 = Date.now();
for (const nWalls of [0, 2, 4, 6, 8])
  for (const nTraps of [0, 3, 6, 9, 12])
    for (let k = 0; k < 40; k++) {
      const st = randStage(nWalls, nTraps);
      const geom = makeGeometry(st.walls);
      const s = Date.now();
      const r = exactDistance(stateFromStage(st), geom, { maxLimit: 7 });
      maxMs = Math.max(maxMs, Date.now() - s);
      const d = r ? r.distance : "X";
      const kk = `${nWalls}/${nTraps}:${d}`;
      hist[kk] = (hist[kk] || 0) + 1;
    }
console.log("maxMs", maxMs, "total", Date.now() - t0);
console.log(hist);
