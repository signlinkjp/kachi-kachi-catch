/**
 * ステージ自動生成（山登り法）
 * 「最短手数がちょうど target 手」になる盤面を探す。
 *
 * 使い方: node tools/gen_stages.mjs [--write]
 */
import fs from "node:fs";
import path from "node:path";
import { makeGeometry, stateFromStage, exactDistance, isCaught } from "../src/solver.js";

const keys = [...Array(25).keys()].map((i) => `${Math.floor(i / 5)},${i % 5}`);

function rngFrom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const shuffle = (arr, rng) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

function valid(st) {
  const geom = makeGeometry(st.walls);
  const s = stateFromStage(st);
  if (st.walls.includes(st.tanuki)) return false;
  if (st.traps.includes(st.tanuki)) return false;
  if (isCaught(s.traps, s.pos, geom)) return false;
  return true;
}

function distanceOf(st, maxLimit = 7) {
  const geom = makeGeometry(st.walls);
  const r = exactDistance(stateFromStage(st), geom, { maxLimit });
  return r ? r.distance : Infinity;
}

function signature(st) {
  return [st.walls.slice().sort().join("|"), st.traps.slice().sort().join("|"), st.tanuki].join("#");
}

function randomStage(rng, nWalls, nTraps) {
  const pool = shuffle(keys, rng);
  const walls = pool.slice(0, nWalls);
  const tanuki = pool[nWalls];
  const traps = pool.slice(nWalls + 1, nWalls + 1 + Math.min(nTraps, 24 - nWalls));
  return { walls, traps, tanuki };
}

function mutate(st, rng) {
  const next = { walls: [...st.walls], traps: [...st.traps], tanuki: st.tanuki };
  const op = rng();
  const pickRand = (arr) => arr[Math.floor(rng() * arr.length)];
  if (op < 0.3) {
    next.tanuki = pickRand(keys);
  } else if (op < 0.55) {
    const k = pickRand(keys);
    next.walls = next.walls.includes(k) ? next.walls.filter((x) => x !== k) : [...next.walls, k].slice(0, 8);
  } else if (op < 0.85) {
    const k = pickRand(keys);
    if (next.traps.includes(k)) next.traps = next.traps.filter((x) => x !== k);
    else if (next.traps.length < 12) next.traps = [...next.traps, k];
  } else {
    // 2マスまとめて入れ替え
    const a = pickRand(keys);
    const b = pickRand(keys);
    next.traps = next.traps.filter((x) => x !== a);
    if (!next.traps.includes(b) && next.traps.length < 12) next.traps.push(b);
  }
  return next;
}

function searchTarget(target, { tries = 4000, restarts = 40, seed = 1 } = {}) {
  const rng = rngFrom(seed);
  let found = null;
  for (let r = 0; r < restarts && !found; r++) {
    let cur = randomStage(rng, 3, 4);
    let curD = valid(cur) ? distanceOf(cur, Math.max(target, 5)) : Infinity;
    let bestD = Math.min(curD, target);
    for (let i = 0; i < tries / restarts; i++) {
      const cand = mutate(cur, rng);
      if (!valid(cand)) continue;
      const d = distanceOf(cand, Math.max(target, 5));
      // target に近づく方を優先（超過は遠ざかる）
      const score = d >= target ? target - (d - target) * 2 : d;
      const curScore = curD >= target ? target - (curD - target) * 2 : curD;
      if (score >= curScore) {
        cur = cand;
        curD = d;
        bestD = Math.max(bestD, Math.min(d, target));
      }
      if (d === target) {
        found = cand;
        break;
      }
    }
  }
  return found;
}

/** 深さを伸ばす: 見つけた盤面をさらに伸ばして target まで押し上げる */
function growFrom(stage, target, { seed = 1, tries = 6000 } = {}) {
  const rng = rngFrom(seed);
  let cur = stage;
  let curD = distanceOf(cur, target);
  for (let i = 0; i < tries; i++) {
    if (curD === target) return cur;
    const cand = mutate(cur, rng);
    if (!valid(cand)) continue;
    const d = distanceOf(cand, target);
    if (d > curD) {
      cur = cand;
      curD = d;
    }
  }
  return curD === target ? cur : null;
}

function evaluate(st) {
  const geom = makeGeometry(st.walls);
  const s = stateFromStage(st);
  const r = exactDistance(s, geom, { maxLimit: 9 });
  return r;
}

const targets = [
  { key: "beginner", need: 3, dist: 1, walls: [0, 1, 2], traps: [2, 4, 6] },
  { key: "middle", need: 4, dist: 3, walls: [1, 2, 3], traps: [2, 5, 8] },
  { key: "advanced", need: 3, dist: 5, walls: [3, 4, 5], traps: [2, 5, 8] },
  { key: "expert", need: 2, dist: 7, walls: [4, 5, 6], traps: [3, 6, 9] },
];

const out = {};
let seed = 20261124;
for (const t of targets) {
  out[t.key] = [];
  const seen = new Set();
  let guard = 0;
  while (out[t.key].length < t.need && guard < 400) {
    guard++;
    seed += 7919;
    let st = searchTarget(t.dist, { seed, tries: 3000, restarts: 30 });
    if (!st) continue;
    if (distanceOf(st, t.dist + 1) !== t.dist) continue;
    const r = evaluate(st);
    if (!r || r.distance !== t.dist) continue;
    const sig = signature(st);
    if (seen.has(sig)) continue;
    seen.add(sig);
    out[t.key].push({ stage: st, moves: r.moves.map((m) => m.cell), distance: r.distance });
    console.log(`${t.key} #${out[t.key].length}: dist=${r.distance} walls=${st.walls.length} traps=${st.traps.length} firstMoves=${r.moves.length}`);
  }
  if (out[t.key].length < t.need) console.log(`!! ${t.key}: only ${out[t.key].length}/${t.need}`);
}

fs.writeFileSync(
  path.join(process.cwd(), "tools", "generated-stages.json"),
  JSON.stringify(out, null, 1)
);
console.log("written tools/generated-stages.json");
