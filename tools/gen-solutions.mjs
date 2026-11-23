/**
 * 各ステージの最善手順（PV）を事前計算して src/solutions.js に書き出す。
 * 実行時はこれを読むだけにして、ステージ開始を一瞬にする。
 */
import fs from "node:fs";
import { STAGES } from "../src/stages.js";
import { makeGeometry, stateFromStage, principalLine, cellKey } from "../src/solver.js";

const out = {};
for (const stage of STAGES) {
  const geom = makeGeometry(stage.walls);
  const line = principalLine(stateFromStage(stage), geom, { limit: stage.par });
  out[stage.id] = line.map((s) => ({
    player: cellKey(s.player),
    tanuki: s.tanuki == null ? null : cellKey(s.tanuki),
  }));
  console.log(stage.id, line.length, "plies", "lastCaught=", line[line.length - 1].caught);
  if (line.length !== stage.par || !line[line.length - 1].caught) {
    throw new Error(`${stage.id}: 手順が par と一致しない (${line.length})`);
  }
}

const body = `/**
 * 各ステージの最善手順（自動生成: tools/gen-solutions.mjs）
 * player = プレイヤーのタップ位置, tanuki = そのあとタヌキが逃げた位置（null なら捕まえた）
 * 座標は "行,列"（0始まり）。
 */
export const SOLUTIONS = ${JSON.stringify(out, null, 2)};
`;
fs.writeFileSync("src/solutions.js", body);
console.log("wrote src/solutions.js");
