/**
 * ゲーム進行（DOM非依存）。UI はここに購読して描画する。
 */
import {
  makeGeometry,
  stateFromStage,
  tanukiOptionsMask,
  tanukiReply,
  flipAt,
  bits,
  isLegalMove,
  isCaught,
  solveState,
  principalLine,
  playableCells,
  parseCell,
  MAX_MOVES,
} from "./solver.js";
import { SOLUTIONS } from "./solutions.js";

export class Game {
  constructor(stage) {
    this.stage = stage;
    this.geom = makeGeometry(stage.walls);
    this.state = stateFromStage(stage);
    this.movesUsed = 0;
    this.history = [];
    this.status = "playing"; // playing | clear | fail
    this.lastFlip = null;
    // 最善手順は事前計算済み（未登録なら初回ヒント時に計算）
    this.pv = (SOLUTIONS[stage.id] || []).map((s) => ({
      player: parseCell(s.player),
      tanuki: s.tanuki == null ? null : parseCell(s.tanuki),
      caught: s.tanuki == null,
    }));
    this.pvIndex = 0;
  }

  /** 事前計算が無いステージ用のフォールバック */
  ensurePv() {
    if (!this.pv.length) {
      this.pv = principalLine(stateFromStage(this.stage), this.geom, { limit: Math.min(this.stage.par, MAX_MOVES) });
    }
    return this.pv;
  }

  get remaining() {
    return Math.max(0, this.stage.par - this.movesUsed);
  }

  canTap(cell) {
    return this.status === "playing" && isLegalMove(this.state, cell, this.geom);
  }

  /** タップしたときに反転するマス一覧 */
  previewCells(cell) {
    return bits(this.geom.plus[cell]).filter((i) => !this.geom.walls[i]);
  }

  captureCells(cell) {
    return this.previewCells(cell);
  }

  /**
   * 1手打つ。反転 → タヌキの応手 までモデル上で解決して結果を返す。
   * @returns {{flipped:number[], tanukiFrom:number, tanukiTo:number|null, caught:boolean, status:string, distance:number|null}}
   */
  play(cell) {
    if (!this.canTap(cell)) return null;
    const tanukiFrom = this.state.pos;
    const trapsBefore = this.state.traps;
    const flipped = this.previewCells(cell);
    const trapsAfter = flipAt(this.state.traps, cell, this.geom);
    this.movesUsed += 1;
    this.lastFlip = { cell, flipped, trapsBefore, trapsAfter };

    const opts = tanukiOptionsMask(trapsAfter, tanukiFrom, this.geom);
    if (opts === 0) {
      this.state = { traps: trapsAfter, pos: tanukiFrom };
      this.status = "clear";
      this.history.push({ cell, flipped, tanukiFrom, tanukiTo: null, caught: true });
      return { flipped, tanukiFrom, tanukiTo: null, caught: true, status: this.status, distance: 0 };
    }

    // タヌキの応手（残り手数に合わせた深さで評価。同点は動く方を優先）
    // ここで「この局面がまだ詰むか」をもう一度解くと、深い面で 1手あたり数百ms かかる。
    // ゲームの進行には要らないので解かない（重さ = 操作の引っかかりの原因だった）。
    const limit = Math.max(1, Math.min(this.remaining, 5));
    const next = tanukiReply({ traps: trapsAfter, pos: tanukiFrom }, this.geom, { limit });
    this.state = { traps: trapsAfter, pos: next };
    this.history.push({ cell, flipped, tanukiFrom, tanukiTo: next, caught: false });

    if (this.remaining <= 0) {
      // 手数切れ: まだ詰んでいなければ失敗
      this.status = "fail";
    }
    return {
      flipped,
      tanukiFrom,
      tanukiTo: next,
      caught: false,
      status: this.status,
      distance: null,
      outOfMoves: this.remaining <= 0,
    };
  }

  /** ヒント: ソルバーの最善手（残り手数以内に詰む手） */
  hint() {
    if (this.status !== "playing") return null;
    // キャッシュした最善手順と今の局面が一致していればそれを使う
    const pvMove = this.pvMoveForCurrent();
    if (pvMove != null) return pvMove;
    // 深い盤面では探索に時間がかかるので、500ms で打ち切る（実機で固まらないため）
    const sol = solveState(this.state, this.geom, { limit: this.remaining, budgetMs: 500 });
    if (sol && sol.moves.length) return sol.moves.map((m) => m.cell).sort((a, b) => a - b)[0];
    // 時間切れ・見つからないときの保険: ポコ丸の逃げ場がいちばん減るマス（すぐ返る）
    return this.greedyMove();
  }

  /** 近似ヒント: 反転後にポコ丸の逃げ場がいちばん少なくなるマス */
  greedyMove() {
    const { traps, pos } = this.state;
    let best = null;
    let bestCount = Infinity;
    for (const cell of playableCells(this.geom, pos)) {
      const t2 = flipAt(traps, cell, this.geom);
      const count = bits(tanukiOptionsMask(t2, pos, this.geom)).length;
      if (count < bestCount) {
        bestCount = count;
        best = cell;
      }
    }
    return best;
  }

  /** 現在の局面に対応する PV の手（なければ null） */
  pvMoveForCurrent() {
    const pv = this.ensurePv();
    if (!pv || this.history.length >= pv.length) return null;
    let s = stateFromStage(this.stage);
    for (let i = 0; i < this.history.length; i++) {
      const step = pv[i];
      const h = this.history[i];
      if (!step || step.player !== h.cell) return null;
      if (h.caught) return null;
      if (step.tanuki !== h.tanukiTo) return null;
      s = { traps: flipAt(s.traps, h.cell, this.geom), pos: h.tanukiTo ?? s.pos };
    }
    const step = pv[this.history.length];
    return step ? step.player : null;
  }

  reset() {
    this.state = stateFromStage(this.stage);
    this.movesUsed = 0;
    this.history = [];
    this.status = "playing";
    this.lastFlip = null;
    this.pvIndex = 0;
  }

  /** 検証用: 残り手数でまだ詰めるか */
  stillWinnable() {
    const sol = solveState(this.state, this.geom, { limit: this.remaining });
    return sol ? sol.distance : null;
  }
}
