/** ゲーム進行（Game クラス）と事前計算した手順（solutions.js）の検証 */
import test from "node:test";
import assert from "node:assert/strict";
import { Game } from "../src/game.js";
import { STAGES, stageById } from "../src/stages.js";
import { DAILY } from "../src/daily.js";
import { SOLUTIONS } from "../src/solutions.js";
import { makeGeometry, stateFromStage, solveState, isCaught } from "../src/solver.js";

const SAMPLE = ["s01", "s10", "s11", "s20", "s26", "s30", "s41", "s50"];

test("全ステージ・全デイリーに最善手順（PV）が用意されている", () => {
  for (const s of [...STAGES, ...DAILY]) {
    const pv = SOLUTIONS[s.id];
    assert.ok(Array.isArray(pv), `${s.id} の PV が無い`);
    assert.equal(pv.length, s.par, `${s.id}: PV の長さが par と違う`);
    assert.equal(pv[pv.length - 1].tanuki, null, `${s.id}: 最後が捕まえた になっていない`);
  }
});

for (const id of SAMPLE) {
  test(`stage ${id}: ヒントに従えばちょうど par 手で捕まえられる`, () => {
    const stage = stageById(id);
    const g = new Game(stage);
    let guard = 0;
    while (g.status === "playing" && guard++ < 12) {
      const cell = g.hint();
      assert.notEqual(cell, null, `${id}: 途中で詰み手が無くなった`);
      const res = g.play(cell);
      assert.ok(res);
      assert.equal(isCaught(g.state.traps, g.state.pos, g.geom), g.status === "clear");
    }
    assert.equal(g.status, "clear");
    assert.equal(g.movesUsed, stage.par);
  });
}

test("ポコ丸のマス・壁はタップできない", () => {
  const g = new Game(stageById("s01"));
  const pos = g.state.pos;
  assert.equal(g.canTap(pos), false);
  assert.equal(g.play(pos), null);
  const wall = stageById("s01").walls.map((k) => {
    const [r, c] = k.split(",").map(Number);
    return r * 5 + c;
  });
  for (const w of wall) assert.equal(g.canTap(w), false);
});

test("十字プレビューは壁を除く", () => {
  const stage = stageById("s01");
  const g = new Game(stage);
  const geom = makeGeometry(stage.walls);
  for (const cell of [0, 6, 12, 24].filter((i) => !geom.walls[i] && i !== g.state.pos)) {
    const preview = g.previewCells(cell);
    assert.ok(preview.length >= 1 && preview.length <= 5);
    assert.ok(preview.every((i) => !geom.walls[i]));
    assert.ok(preview.includes(cell));
  }
});

test("初手を外すと手数を使い切って失敗になる", () => {
  const stage = stageById("s11"); // 3手詰
  const g = new Game(stage);
  const win = g.hint();
  const bad = Array.from({ length: 25 }, (_, i) => i).find((i) => i !== win && g.canTap(i));
  g.play(bad);
  let guard = 0;
  while (g.status === "playing" && guard++ < 10) {
    const cell = g.hint() ?? Array.from({ length: 25 }, (_, i) => i).find((i) => g.canTap(i));
    g.play(cell);
  }
  assert.equal(g.status, "fail");
});

test("やりなおしで初期状態に戻る", () => {
  const stage = stageById("s01");
  const g = new Game(stage);
  g.play(g.hint());
  assert.equal(g.status, "clear");
  g.reset();
  assert.equal(g.status, "playing");
  assert.equal(g.movesUsed, 0);
  assert.equal(g.remaining, stage.par);
  assert.equal(g.state.pos, stateFromStage(stage).pos);
});

test("ヒントはソルバーの最善手と一致する（浅い問題）", () => {
  for (const id of ["s01", "s12", "s27"]) {
    const stage = stageById(id);
    const g = new Game(stage);
    const sol = solveState(g.state, g.geom, { limit: g.remaining });
    const expected = sol.moves.map((m) => m.cell).sort((a, b) => a - b)[0];
    assert.equal(g.hint(), expected, id);
  }
});

test("デイリー問題も同じルールで遊べる", () => {
  const d = DAILY[0];
  const g = new Game(d);
  let guard = 0;
  while (g.status === "playing" && guard++ < 10) {
    const cell = g.hint();
    assert.notEqual(cell, null);
    g.play(cell);
  }
  assert.equal(g.status, "clear");
  assert.equal(g.movesUsed, d.par);
});
