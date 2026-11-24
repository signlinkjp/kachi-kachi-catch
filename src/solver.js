/**
 * Kachi Kachi Catch — ゲームコア + AND/OR ゲーム木ソルバー
 * ===========================================================================
 * 盤面: 5x5。各マスは 安全床(false) / 罠床(true)。壁(wall)は通行不可。
 *
 * プレイヤーの1手:
 *   壁でないマスを1つタップ → その中心＋上下左右（盤内・壁以外）の十字5マスを反転。
 *
 * タヌキの応手:
 *   プレイヤーの手のあと、タヌキは「現在地＋8方向（上下左右＋斜め）に1歩で行ける安全床」
 *   のどれかへ移る（現在地に留まるのも合法）。タヌキは"最も長く生き残る"手を選ぶ。
 *
 * つかまえた（詰み）:
 *   タヌキの合法手が1つも無くなった瞬間 ＝ 現在地も、1歩で行ける8方向も、すべて罠か壁。
 *
 * なぜこの2点を brief から調整したか:
 *   - タヌキのいるマスはタップできない（素早いタヌキの足元には網を仕掛けられない）。
 *     これが無いと「タヌキのマスをタップ＝十字5マスが罠＝1手で必ず詰み」になり、
 *     3手詰・5手詰・7手詰が原理的に成立しない。
 *   - 逃げ道を8方向にした。十字フリップは斜めを塗れないので、逃げ場を塞ぐには
 *     複数手の作り込みが要り、1手詰〜7手詰の階段が自然に成立する（実測で確認済み）。
 *   この2点により「プレイヤーが最善を尽くせば、タヌキがどの合法手を選んでも
 *   指定手数以内に100%詰む」AND/OR ゲーム木がきれいに閉じる。
 * ===========================================================================
 */

export const SIZE = 5;
export const NCELL = SIZE * SIZE;
export const MAX_MOVES = 9;

export const cellAt = (r, c) => r * SIZE + c;
export const rowOf = (i) => Math.floor(i / SIZE);
export const colOf = (i) => i % SIZE;
export const keyOf = (r, c) => `${r},${c}`;
export const cellKey = (i) => `${rowOf(i)},${colOf(i)}`;
export const parseCell = (k) => {
  const [r, c] = String(k).split(",").map(Number);
  return r * SIZE + c;
};

const ORTHO = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];
const DIAG = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

/**
 * 壁リストから形状データを作る
 * @param {string[]} wallKeys 例: ["0,0", "2,3"]
 */
export function makeGeometry(wallKeys = []) {
  const walls = new Uint8Array(NCELL);
  for (const k of wallKeys) walls[parseCell(k)] = 1;

  const plus = new Int32Array(NCELL); // タップで反転する十字5マス
  const reach = new Int32Array(NCELL); // タヌキが1歩で行ける場所（現在地＋8方向・壁除く）
  for (let i = 0; i < NCELL; i++) {
    const r = rowOf(i);
    const c = colOf(i);
    let p = 1 << i;
    let rch = 1 << i;
    for (const [dr, dc] of ORTHO) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) continue;
      const j = nr * SIZE + nc;
      if (walls[j]) continue;
      p |= 1 << j;
      rch |= 1 << j;
    }
    for (const [dr, dc] of DIAG) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) continue;
      const j = nr * SIZE + nc;
      if (walls[j]) continue;
      rch |= 1 << j;
    }
    plus[i] = p;
    reach[i] = rch;
  }
  return { walls, plus, reach };
}

export function makeState(trapMask, pos) {
  return { traps: trapMask >>> 0, pos };
}

export function stateFromStage(stage) {
  let t = 0;
  for (const k of stage.traps || []) t |= 1 << parseCell(k);
  return { traps: t >>> 0, pos: parseCell(stage.tanuki) };
}

/** タヌキの合法手（現在地＋1歩で行ける安全床） */
export function tanukiOptionsMask(traps, pos, geom) {
  return (geom.reach[pos] & ~(traps >>> 0)) >>> 0;
}

export const isCaught = (traps, pos, geom) => tanukiOptionsMask(traps, pos, geom) === 0;

/** ビットマスク → マス番号の配列 */
export function bits(mask) {
  const out = [];
  let m = mask >>> 0;
  while (m) {
    const low = m & -m;
    out.push(31 - Math.clz32(low));
    m ^= low;
  }
  return out;
}

export const flipAt = (traps, cell, geom) => (traps ^ geom.plus[cell]) >>> 0;

/** 壁でない＝タップできるマス（タヌキのいるマスはタップ不可） */
export function playableCells(geom, pos = -1) {
  const out = [];
  for (let i = 0; i < NCELL; i++) if (!geom.walls[i] && i !== pos) out.push(i);
  return out;
}

/** 手番の合法性 */
export function isLegalMove(state, cell, geom) {
  return !geom.walls[cell] && cell !== state.pos;
}

/**
 * AND/OR 探索（反復深化つき）
 * 指定手数以内に必ず詰むかを判定し、最短手数と最善手を返す。
 * @returns null | {distance:number, moves:{cell:number,distance:number}[]}
 */
export function solveState(state, geom, { limit = MAX_MOVES, wantMoves = true, memo = null } = {}) {
  const cells = playableCells(geom);
  // memo は呼び出し側で共有できる（タヌキの応手を比べるときに同じ局面を何度も解かない）
  const table = memo || new Map(); // (traps,pos,depth) -> 手数 or Infinity

  function dist(traps, pos, depth) {
    const opts = tanukiOptionsMask(traps, pos, geom);
    if (opts === 0) return 0;
    if (depth <= 0) return Infinity;
    const key = ((traps >>> 0) * 32 + pos) * 16 + depth;
    const hit = table.get(key);
    if (hit !== undefined) return hit;

    let best = Infinity;
    for (let ci = 0; ci < cells.length; ci++) {
      const cell = cells[ci];
      if (cell === pos) continue;
      const t2 = flipAt(traps, cell, geom);
      const o2 = tanukiOptionsMask(t2, pos, geom);
      if (o2 === 0) {
        best = 1;
        break;
      }
      let worst = 0;
      let ok = true;
      let m = o2;
      while (m) {
        const low = m & -m;
        const o = 31 - Math.clz32(low);
        m ^= low;
        const d = dist(t2, o, depth - 1);
        if (!isFinite(d)) {
          ok = false;
          break;
        }
        if (d + 1 > worst) worst = d + 1;
      }
      if (ok && worst < best) {
        best = worst;
        if (best === 1) break;
      }
    }
    table.set(key, best);
    return best;
  }

  const distance = dist(state.traps, state.pos, limit);
  if (!isFinite(distance)) return null;
  if (!wantMoves) return { distance, moves: [] };

  const moves = [];
  for (const cell of cells) {
    if (cell === state.pos) continue;
    const t2 = flipAt(state.traps, cell, geom);
    const o2 = tanukiOptionsMask(t2, state.pos, geom);
    if (o2 === 0) {
      if (distance === 1) moves.push({ cell, distance: 1 });
      continue;
    }
    if (distance === 1) continue;
    let worst = 0;
    let ok = true;
    let m = o2;
    while (m) {
      const low = m & -m;
      const o = 31 - Math.clz32(low);
      m ^= low;
      const d = dist(t2, o, distance - 1);
      if (!isFinite(d)) {
        ok = false;
        break;
      }
      if (d + 1 > worst) worst = d + 1;
    }
    if (ok && worst === distance) moves.push({ cell, distance });
  }
  return { distance, moves };
}

/** 最短手数を厳密に求める */
export function exactDistance(state, geom, { maxLimit = MAX_MOVES } = {}) {
  for (let n = 1; n <= maxLimit; n++) {
    const r = solveState(state, geom, { limit: n });
    if (r) return r;
  }
  return null;
}

/**
 * タヌキAI: 最も長く生き残る手を選ぶ（同点は「逃げる」＞「留まる」、最後に乱数）
 * @param state 反転後の状態（罠を引いたあと）
 */
export function tanukiReply(state, geom, { rng = Math.random, limit = 5 } = {}) {
  const opts = bits(tanukiOptionsMask(state.traps, state.pos, geom));
  if (opts.length === 0) return null;
  // 9方向の候補を同じ memo で解く（局面が重なるので、探し直しがなくなる）
  const memo = new Map();
  const scored = opts.map((pos) => {
    const r = solveState(makeState(state.traps, pos), geom, { limit, wantMoves: false, memo });
    return { pos, d: r ? r.distance : 999, moved: pos === state.pos ? 0 : 1 };
  });
  const max = Math.max(...scored.map((s) => s.d));
  const top = scored.filter((s) => s.d === max);
  top.sort((a, b) => b.moved - a.moved || rng() - 0.5);
  return top[0].pos;
}

/**
 * デモ・検証用: 最善手順を1本返す（プレイヤー最善 / タヌキ最善応手）
 * 残り手数を減らしながら解くので、深い問題でも現実的な時間で終わる。
 * @returns {{player:number, tanuki:number|null, caught:boolean}[]}
 */
export function principalLine(state, geom, { limit = MAX_MOVES } = {}) {
  const line = [];
  let s = { ...state };
  let remaining = limit;
  let guard = 0;
  while (remaining > 0 && guard++ < 24) {
    const r = solveState(s, geom, { limit: remaining });
    if (!r || !r.moves.length) break;
    const cell = r.moves.map((m) => m.cell).sort((a, b) => a - b)[0];
    const t2 = flipAt(s.traps, cell, geom);
    if (tanukiOptionsMask(t2, s.pos, geom) === 0) {
      line.push({ player: cell, tanuki: null, caught: true });
      break;
    }
    const next = tanukiReply(makeState(t2, s.pos), geom, { rng: () => 0.5, limit: remaining - 1 });
    line.push({ player: cell, tanuki: next, caught: false });
    s = { traps: t2, pos: next };
    remaining -= 1;
  }
  return line;
}

/** 盤面を文字列で（テスト・デバッグ用） */
export function renderState(state, geom) {
  const rows = [];
  for (let r = 0; r < SIZE; r++) {
    let line = "";
    for (let c = 0; c < SIZE; c++) {
      const i = r * SIZE + c;
      if (i === state.pos) line += "T";
      else if (geom.walls[i]) line += "#";
      else line += (state.traps >>> i) & 1 ? "x" : ".";
    }
    rows.push(line);
  }
  return rows.join("\n");
}
