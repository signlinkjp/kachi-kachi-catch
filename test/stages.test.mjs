/**
 * 通常ステージ 50問の厳密検証
 * 1) 最短手数がちょうど par（par-1 では詰まない）
 * 2) 初手のあと、ポコ丸がどの合法手を選んでも par-1 手以内に詰む（AND/OR）
 * 3) 浅い問題は素朴実装（メモ化なし）でも同じ結論
 */
import test from "node:test";
import assert from "node:assert/strict";
import { STAGES, DIFFICULTIES, PAR_OF, stageById, stagesOf } from "../src/stages.js";
import {
  makeGeometry,
  stateFromStage,
  solveState,
  exactDistance,
  isCaught,
  tanukiOptionsMask,
  tanukiReply,
  flipAt,
  bits,
  parseCell,
  cellKey,
} from "../src/solver.js";

const expectedPar = { beginner: 1, middle: 3, advanced: 5, expert: 7 };

function naiveSolve(stage, limit) {
  const W = new Set(stage.walls.map(parseCell));
  const T = new Set(stage.traps.map(parseCell));
  const dirs8 = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -1], [-1, 1], [1, -1], [1, 1],
  ];
  const inside = (r, c) => r >= 0 && r < 5 && c >= 0 && c < 5;
  const options = (tr, pos) => {
    const r = Math.floor(pos / 5);
    const c = pos % 5;
    const out = [];
    if (!tr.has(pos)) out.push(pos);
    for (const [dr, dc] of dirs8) {
      const nr = r + dr;
      const nc = c + dc;
      if (!inside(nr, nc)) continue;
      const j = nr * 5 + nc;
      if (W.has(j) || tr.has(j)) continue;
      out.push(j);
    }
    return out;
  };
  const flip = (cell) => {
    const r = Math.floor(cell / 5);
    const c = cell % 5;
    const out = [cell];
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = r + dr;
      const nc = c + dc;
      if (!inside(nr, nc)) continue;
      const j = nr * 5 + nc;
      if (W.has(j)) continue;
      out.push(j);
    }
    return out;
  };
  function search(tr, pos, n) {
    if (options(tr, pos).length === 0) return 0;
    if (n === 0) return Infinity;
    let best = Infinity;
    for (let cell = 0; cell < 25; cell++) {
      if (W.has(cell) || cell === pos) continue;
      const nt = new Set(tr);
      for (const f of flip(cell)) {
        if (nt.has(f)) nt.delete(f);
        else nt.add(f);
      }
      const opts = options(nt, pos);
      if (opts.length === 0) return 1;
      let worst = 0;
      let ok = true;
      for (const o of opts) {
        const d = search(nt, o, n - 1);
        if (!Number.isFinite(d)) {
          ok = false;
          break;
        }
        worst = Math.max(worst, d + 1);
      }
      if (ok && worst < best) best = worst;
    }
    return best;
  }
  const d = search(T, parseCell(stage.tanuki), limit);
  return Number.isFinite(d) ? d : null;
}

test("50問の構成（初級10・中級15・上級15・激ムズ10）", () => {
  assert.equal(STAGES.length, 50);
  assert.equal(new Set(STAGES.map((s) => s.id)).size, 50);
  assert.equal(stagesOf("beginner").length, 10);
  assert.equal(stagesOf("middle").length, 15);
  assert.equal(stagesOf("advanced").length, 15);
  assert.equal(stagesOf("expert").length, 10);
  for (const s of STAGES) {
    assert.equal(s.par, expectedPar[s.difficulty], s.id);
    assert.equal(s.par, PAR_OF[s.difficulty]);
    assert.ok(DIFFICULTIES.includes(s.difficulty));
    assert.ok(!s.walls.includes(s.tanuki), s.id);
    assert.ok(!s.traps.includes(s.tanuki), s.id);
    assert.ok(s.traps.every((k) => !s.walls.includes(k)), s.id);
    assert.ok(s.walls.length >= 1 && s.walls.length <= 6, `${s.id} walls=${s.walls.length}`);
    assert.ok(s.traps.length >= 0 && s.traps.length <= 5, `${s.id} traps=${s.traps.length}`);
  }
  // 同じ盤面の使い回しが無いこと
  const sig = new Set(STAGES.map((s) => [s.walls.slice().sort().join("|"), s.traps.slice().sort().join("|"), s.tanuki].join("#")));
  assert.equal(sig.size, 50);
});

for (const stage of STAGES) {
  test(`stage ${stage.id}: 最短手数はちょうど ${stage.par} 手`, () => {
    const geom = makeGeometry(stage.walls);
    const state = stateFromStage(stage);
    assert.equal(isCaught(state.traps, state.pos, geom), false, "開始時点で詰んでいてはいけない");
    assert.equal(solveState(state, geom, { limit: stage.par - 1 }), null, `${stage.par - 1}手では詰まない`);
    const exact = exactDistance(state, geom, { maxLimit: stage.par });
    assert.ok(exact);
    assert.equal(exact.distance, stage.par);
    assert.ok(exact.moves.length >= 1);
  });
}

for (const stage of STAGES) {
  test(`stage ${stage.id}: ポコ丸がどの逃げ方をしても ${stage.par - 1} 手以内に詰む`, () => {
    const geom = makeGeometry(stage.walls);
    const state = stateFromStage(stage);
    const sol = solveState(state, geom, { limit: stage.par });
    for (const move of sol.moves) {
      const t2 = flipAt(state.traps, move.cell, geom);
      const opts = tanukiOptionsMask(t2, state.pos, geom);
      if (opts === 0) {
        assert.equal(stage.par, 1, "初手で詰むのは1手詰だけ");
        continue;
      }
      for (const o of bits(opts)) {
        const r = solveState({ traps: t2, pos: o }, geom, { limit: stage.par - 1 });
        assert.ok(r, `${stage.id}: ポコ丸が (${cellKey(o)}) へ逃げると詰まない`);
        assert.ok(r.distance <= stage.par - 1);
      }
    }
  });
}

for (const stage of STAGES.filter((s) => s.par <= 3)) {
  test(`stage ${stage.id}: 素朴実装でも同じ結論（独立検証）`, () => {
    assert.equal(naiveSolve(stage, stage.par - 1), null);
    assert.equal(naiveSolve(stage, stage.par), stage.par);
  });
}

test("中級・上級・激ムズは初手の選択肢が絞られている（1〜3通り）", () => {
  for (const stage of STAGES.filter((s) => s.par >= 3)) {
    const geom = makeGeometry(stage.walls);
    const sol = solveState(stateFromStage(stage), geom, { limit: stage.par });
    assert.ok(sol.moves.length >= 1 && sol.moves.length <= 3, `${stage.id}: ${sol.moves.length}通り`);
  }
});

test("stageById で引ける", () => {
  assert.equal(stageById("s01").index, 1);
  assert.equal(stageById("s50").index, 50);
  assert.equal(stageById("nope"), undefined);
});
