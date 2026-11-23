/** 無料 / PRO の線引き（Build 1） */
import test from "node:test";
import assert from "node:assert/strict";
import {
  PRODUCT_ID,
  FREE_HINTS_PER_STAGE,
  stageNoInGroup,
  canPlayStage,
  canTimeAttack,
  canPastDaily,
  hintsLeft,
  canUseHint,
} from "../src/pro.js";
import { STAGES, stageById } from "../src/stages.js";
import { store } from "../src/storage.js";

test("商品IDは jp.signlink.KachiCatch.pro", () => {
  assert.equal(PRODUCT_ID, "jp.signlink.KachiCatch.pro");
});

test("無料で遊べるのは 初級10 + 中級前半10 = 20問", () => {
  const free = STAGES.filter((s) => canPlayStage(s, false));
  assert.equal(free.length, 20);
  assert.equal(free.filter((s) => s.difficulty === "beginner").length, 10);
  assert.equal(free.filter((s) => s.difficulty === "middle").length, 10);
  assert.equal(free.filter((s) => s.difficulty === "advanced").length, 0);
  assert.equal(free.filter((s) => s.difficulty === "expert").length, 0);
});

test("PROなら50問すべて遊べる", () => {
  const all = STAGES.filter((s) => canPlayStage(s, true));
  assert.equal(all.length, 50);
});

test("中級の11〜15（グループ内の番号）はPROのみ", () => {
  const middle = STAGES.filter((s) => s.difficulty === "middle");
  for (const s of middle) {
    const no = stageNoInGroup(s);
    assert.ok(no >= 1 && no <= 15, `中級の通し番号 ${no}`);
    assert.equal(canPlayStage(s, false), no <= 10, `中級${no}`);
    assert.equal(canPlayStage(s, true), true);
  }
});

test("タイムアタックと過去デイリーはPROのみ", () => {
  assert.equal(canTimeAttack(false), false);
  assert.equal(canTimeAttack(true), true);
  assert.equal(canPastDaily(false), false);
  assert.equal(canPastDaily(true), true);
});

test("無料ヒントは1ステージ3回まで・PROは無制限", () => {
  assert.equal(FREE_HINTS_PER_STAGE, 3);
  assert.equal(hintsLeft("s01", 0, false), 3);
  assert.equal(hintsLeft("s01", 2, false), 1);
  assert.equal(hintsLeft("s01", 3, false), 0);
  assert.equal(hintsLeft("s01", 99, false), 0);
  assert.equal(hintsLeft("s01", 99, true), null);
  assert.equal(canUseHint("s01", 2, false), true);
  assert.equal(canUseHint("s01", 3, false), false);
  assert.equal(canUseHint("s01", 999, true), true);
});

test("store の PRO フラグが canPlayStage の既定値に効く", () => {
  store.setPro(false);
  assert.equal(canPlayStage(stageById("s01")), true); // 初級1
  assert.equal(canPlayStage(stageById("s21")), false); // 中級11（PROのみ）
  assert.equal(canPlayStage(stageById("s26")), false); // 上級1
  store.setPro(true);
  assert.equal(canPlayStage(stageById("s21")), true);
  assert.equal(canPlayStage(stageById("s40")), true); // 激ムズ
  store.setPro(false);
  assert.equal(canPlayStage(stageById("s40")), false);
});
