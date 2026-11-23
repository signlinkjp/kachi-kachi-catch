/**
 * ソルバー単体テスト
 * - 盤面ルール（十字5マス反転・8方向の逃げ道・タヌキのマスはタップ不可）
 * - 素朴な実装（配列ベース）との総当たり照合
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  makeGeometry,
  makeState,
  stateFromStage,
  tanukiOptionsMask,
  isCaught,
  flipAt,
  bits,
  playableCells,
  solveState,
  exactDistance,
  tanukiReply,
  principalLine,
  renderState,
  isLegalMove,
  parseCell,
  cellKey,
} from "../src/solver.js";

/* ------------------------------------------------------------------ */
/* 素朴な参照実装（ビット演算なし・そのままの盤面配列で解く）           */
/* ------------------------------------------------------------------ */
function naiveSolve(walls, traps, tanuki, limit) {
  const W = new Set(walls.map((k) => parseCell(k)));
  const T = new Set(traps.map((k) => parseCell(k)));
  const dirs8 = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ];
  const inside = (r, c) => r >= 0 && r < 5 && c >= 0 && c < 5;

  function options(tr, pos) {
    const r = Math.floor(pos / 5);
    const c = pos % 5;
    const out = [];
    const onTrap = tr.has(pos);
    if (!onTrap) out.push(pos);
    for (const [dr, dc] of dirs8) {
      const nr = r + dr;
      const nc = c + dc;
      if (!inside(nr, nc)) continue;
      const j = nr * 5 + nc;
      if (W.has(j) || tr.has(j)) continue;
      out.push(j);
    }
    return out;
  }

  function search(tr, pos, n) {
    if (options(tr, pos).length === 0) return 0;
    if (n === 0) return Infinity;
    let best = Infinity;
    for (let cell = 0; cell < 25; cell++) {
      if (W.has(cell) || cell === pos) continue;
      const r = Math.floor(cell / 5);
      const c = cell % 5;
      const flip = [cell];
      for (const [dr, dc] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        const nr = r + dr;
        const nc = c + dc;
        if (!inside(nr, nc)) continue;
        const j = nr * 5 + nc;
        if (W.has(j)) continue;
        flip.push(j);
      }
      const nt = new Set(tr);
      for (const f of flip) {
        if (nt.has(f)) nt.delete(f);
        else nt.add(f);
      }
      const opts = options(nt, pos);
      if (opts.length === 0) {
        best = 1;
        break;
      }
      let worst = 0;
      let ok = true;
      for (const o of opts) {
        const d = search(nt, o, n - 1);
        if (!isFinite(d)) {
          ok = false;
          break;
        }
        worst = Math.max(worst, d + 1);
      }
      if (ok && worst < best) best = worst;
    }
    return best;
  }

  const d = search(T, parseCell(tanuki), limit);
  return isFinite(d) ? d : null;
}

/* ------------------------------------------------------------------ */
test("十字フリップは中心＋上下左右の5マス（壁と盤外は除外）", () => {
  const geom = makeGeometry([]);
  assert.equal(bits(geom.plus[parseCell("2,2")]).length, 5);
  assert.deepEqual(
    bits(geom.plus[12]).sort((a, b) => a - b),
    [7, 11, 12, 13, 17]
  );
  // 四隅は3マス
  assert.equal(bits(geom.plus[0]).length, 3);
  // 壁は反転対象から外れる
  const geom2 = makeGeometry(["1,2"]);
  assert.equal(bits(geom2.plus[12]).includes(parseCell("1,2")), false);
  assert.equal(bits(geom2.plus[12]).length, 4);
});

test("タヌキの逃げ道は 現在地＋8方向の安全床", () => {
  const geom = makeGeometry([]);
  const opts = bits(tanukiOptionsMask(0, parseCell("2,2"), geom));
  assert.equal(opts.length, 9); // 中心＋8方向
  // 角は4か所（自分＋3方向）
  assert.equal(bits(tanukiOptionsMask(0, parseCell("0,0"), geom)).length, 4);
  // 罠に入ったマスは候補から外れる
  const traps = 1 << parseCell("1,1");
  const opts2 = bits(tanukiOptionsMask(traps, parseCell("2,2"), geom));
  assert.equal(opts2.includes(parseCell("1,1")), false);
  assert.equal(opts2.length, 8);
});

test("逃げ道が全部ふさがったら捕まった（詰み）", () => {
  const geom = makeGeometry(["0,1", "1,0", "1,1"]);
  // 角(0,0)の周りは全部壁。足元も罠になれば詰み（なければ留まれる＝まだ詰みでない）
  assert.equal(isCaught(1 << parseCell("0,0"), parseCell("0,0"), geom), true);
  assert.equal(isCaught(0, parseCell("0,0"), geom), false);
  // 壁が無ければ、足元が罠でも斜めへ逃げられる
  const geom2 = makeGeometry(["0,1", "1,0"]);
  assert.equal(isCaught(1 << parseCell("0,0"), parseCell("0,0"), geom2), false);
});

test("タヌキのいるマスはタップできない", () => {
  const geom = makeGeometry([]);
  const state = makeState(0, parseCell("2,2"));
  assert.equal(isLegalMove(state, parseCell("2,2"), geom), false);
  assert.equal(isLegalMove(state, parseCell("2,3"), geom), true);
  assert.equal(playableCells(geom, state.pos).length, 24);
  assert.deepEqual(playableCells(geom, state.pos).includes(state.pos), false);
});

test("壁のマスはタップできない", () => {
  const geom = makeGeometry(["0,0"]);
  const state = makeState(0, parseCell("4,4"));
  assert.equal(isLegalMove(state, parseCell("0,0"), geom), false);
});

test("ソルバーは素朴実装と一致する（ランダム局面・深さ1〜3）", () => {
  let seed = 20261124;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const keys = [...Array(25).keys()].map(cellKey);
  let checked = 0;
  for (let t = 0; t < 60; t++) {
    const nWalls = Math.floor(rnd() * 5);
    const pool = [...keys].sort(() => rnd() - 0.5);
    const walls = pool.slice(0, nWalls);
    const tanuki = pool[nWalls];
    const nTraps = Math.floor(rnd() * 5);
    const traps = pool.slice(nWalls + 1, nWalls + 1 + nTraps);
    if (traps.includes(tanuki)) continue;
    const geom = makeGeometry(walls);
    const state = stateFromStage({ walls, traps, tanuki });
    if (isCaught(state.traps, state.pos, geom)) continue;
    for (const limit of [1, 2, 3]) {
      const mine = solveState(state, geom, { limit });
      const ref = naiveSolve(walls, traps, tanuki, limit);
      assert.equal(
        mine ? mine.distance : null,
        ref,
        `不一致: limit=${limit}\n${renderState(state, geom)}\nwalls=${walls} traps=${traps}`
      );
      checked++;
    }
  }
  assert.ok(checked >= 60, `照合件数が足りない: ${checked}`);
});

test("exactDistance は最短手数ちょうどの値を返す", () => {
  // 角のタヌキ＋壁＋罠で1手詰の局面を作る
  const stage = { walls: ["0,1", "0,2", "0,3"], traps: ["0,4"], tanuki: "0,0" };
  const geom = makeGeometry(stage.walls);
  const r = exactDistance(stateFromStage(stage), geom, { maxLimit: 5 });
  assert.equal(r.distance, 1);
  assert.equal(r.moves.length, 1);
  assert.equal(cellKey(r.moves[0].cell), "1,0");
});

test("タヌキAIは合法手だけを返し、詰んでいれば null", () => {
  const geom = makeGeometry(["0,1", "1,0", "1,1"]);
  const trapped = makeState(1 << parseCell("0,0"), parseCell("0,0"));
  assert.equal(tanukiReply(trapped, geom, { limit: 3 }), null);

  const open = makeState(0, parseCell("2,2"));
  const reply = tanukiReply(open, geom, { limit: 3 });
  assert.equal(isLegalMove(open, reply, geom), true);
  assert.equal(isCaught(open.traps, reply, geom), false);
});

test("principalLine は指定手数以内に捕まえ切る", () => {
  const stage = { walls: ["1,1", "1,2", "2,1", "2,2"], traps: [], tanuki: "3,0" };
  const geom = makeGeometry(stage.walls);
  const line = principalLine(stateFromStage(stage), geom, { limit: 3 });
  assert.ok(line.length <= 3, `手数超過: ${line.length}`);
  assert.equal(line[line.length - 1].caught, true);
});
