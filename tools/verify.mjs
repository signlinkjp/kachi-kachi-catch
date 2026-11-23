import { STAGES } from "../src/stages.js";
import { makeGeometry, stateFromStage, exactDistance, renderState, cellKey, principalLine, tanukiReply, flipAt, tanukiOptionsMask, makeState, solveState } from "../src/solver.js";

for (const st of STAGES) {
  const geom = makeGeometry(st.walls);
  const state = stateFromStage(st);
  const t0 = Date.now();
  const r = exactDistance(state, geom, { maxLimit: st.par });
  const ms = Date.now() - t0;
  const ok = r && r.distance === st.par;
  console.log(`${ok ? "OK " : "NG "} ${st.id} ${st.name} par=${st.par} dist=${r ? r.distance : "none"} firstMoves=${r ? r.moves.length : 0} ${ms}ms first=${r ? r.moves.map((m) => cellKey(m.cell)).join(" ") : ""}`);
  if (!ok) console.log(renderState(state, geom));
}
