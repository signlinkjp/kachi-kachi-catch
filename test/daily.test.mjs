/**
 * デイリー（120問）の検証と日付ロジック
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DAILY, DAILY_COUNT, DAILY_EPOCH } from "../src/daily.js";
import { dailyIndexFor, dailyPuzzleFor, pastDailies, dateKey, dayNumber } from "../src/dailylogic.js";
import { makeGeometry, stateFromStage, solveState, exactDistance, isCaught } from "../src/solver.js";
import { STAGES } from "../src/stages.js";

test("デイリーは120問・ID重複なし・盤面の使い回しなし", () => {
  assert.equal(DAILY.length, 120);
  assert.equal(DAILY_COUNT, 120);
  assert.equal(new Set(DAILY.map((d) => d.id)).size, 120);
  const sig = new Set(DAILY.map((s) => [s.walls.slice().sort().join("|"), s.traps.slice().sort().join("|"), s.tanuki].join("#")));
  assert.equal(sig.size, 120);
  // 通常ステージと重ならない
  const stageSig = new Set(STAGES.map((s) => [s.walls.slice().sort().join("|"), s.traps.slice().sort().join("|"), s.tanuki].join("#")));
  for (const s of sig) assert.ok(!stageSig.has(s), "通常ステージと同じ盤面がある");
});

test("デイリーは全問 1〜7手詰（パリティは問わない）", () => {
  for (const d of DAILY) {
    assert.ok([1, 3, 5, 7].includes(d.par), `${d.id}: par=${d.par}`);
  }
});

for (const d of DAILY) {
  test(`daily ${d.id}: 最短手数はちょうど ${d.par} 手`, () => {
    const geom = makeGeometry(d.walls);
    const state = stateFromStage(d);
    assert.equal(isCaught(state.traps, state.pos, geom), false);
    assert.equal(solveState(state, geom, { limit: d.par - 1 }), null, `${d.par - 1}手では詰まない`);
    const exact = exactDistance(state, geom, { maxLimit: d.par });
    assert.ok(exact, `${d.id}: ${d.par}手で詰むこと`);
    assert.equal(exact.distance, d.par);
  });
}

test("日付 → 問題 index は決定的で、120日で一巡する", () => {
  const base = new Date(2026, 10, 24); // 2026-11-24 (ローカル)
  const i0 = dailyIndexFor(base);
  assert.equal(i0, dailyIndexFor(new Date(2026, 10, 24, 23, 59)));
  const next = dailyIndexFor(new Date(2026, 10, 25));
  assert.equal(next, (i0 + 1) % DAILY_COUNT);
  const later = dailyIndexFor(new Date(2027, 2, 24)); // 120日後
  assert.equal(later, i0);
  assert.equal(dailyPuzzleFor(base).id, DAILY[i0].id);
});

test("過去のデイリーは30日分・重複なし・今日は含まない", () => {
  const today = new Date(2026, 10, 24);
  const past = pastDailies(30, today);
  assert.equal(past.length, 30);
  assert.equal(new Set(past.map((p) => p.key)).size, 30);
  assert.equal(past[0].key, "2026-11-23");
  assert.ok(!past.some((p) => p.key === dateKey(today)));
  for (const p of past) {
    assert.ok(p.stage && p.stage.id, p.key);
    assert.equal(p.index, dailyIndexFor(p.date));
  }
});

test("日付ユーティリティ", () => {
  assert.equal(dateKey(new Date(2026, 0, 5)), "2026-01-05");
  assert.equal(DAQ(new Date(2026, 0, 5)) - DAQ(new Date(2026, 0, 4)), 1);
  assert.equal(DAILY_EPOCH, "2026-01-01");
});

function DAQ(d) {
  return dayNumber(d);
}
