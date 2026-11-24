/* ============================================================
   Kachi Kachi Catch — Build 3 controller
   ============================================================ */
import { STAGES, DIFFICULTIES, PAR_OF, stageById, stagesOf } from "./stages.js";
import { DAILY } from "./daily.js";
import { dailyPuzzleFor, dailyIndexFor, pastDailies, dateKey, DAILY_COUNT } from "./dailylogic.js";
import { Game } from "./game.js";
import { makeGeometry, bits, tanukiOptionsMask, cellKey, parseCell } from "./solver.js";
import {
  LANGS,
  STRINGS,
  resolveLang,
  makeT,
  stringsOf,
} from "./i18n.js";
import { store, TA_DURATIONS, normalizeTextSize, normalizeTaDuration } from "./storage.js";
import { shareTextFor, shareButtonLabel } from "./share.js";
import {
  sfx,
  unlockAudio,
  startBgm,
  stopBgm,
  suspendAudio,
  recoverAudio,
  applySettings,
  bootAudio,
  playClip,
  stopVoice,
  preloadVoices,
  audioDebug,
} from "./audio.js";
import { voiceFor, allVoiceUrls } from "./voices.js";
import { haptics } from "./haptics.js";
import {
  PRODUCT_ID,
  isPro,
  canPlayStage,
  canTimeAttack,
  canPastDaily,
  hintsLeft,
  canUseHint,
  purchase,
  restore,
  refreshEntitlement,
  getProduct,
  isStoreAvailable,
  devUnlock,
  isFreeTierFinale,
} from "./pro.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const VERSION = "1.0.0";
const BUILD = 6;

const app = {
  screen: "opening",
  lang: "ja",
  t: makeT("ja"),
  session: null, // {mode, stage, game, dailyKey}
  /** ステージ世代。ステージを移るたびに増える（古い処理はこれを比べて黙って抜ける） */
  epoch: 0,
  timers: new Set(),
  ta: null,
  product: null,
  /** 直近のシェア（検証用）: { kind, text, via, at } */
  lastShare: null,
};

/* ---------------- 結果カードのゴーストタップ防止（Build 6） ----------------
   iOS の WKWebView では、盤面を押していた指を離した瞬間の click が
   「そのとき指の下にある要素」へ飛ぶ。失敗カードは 1手の 240ms 後に出すので、
   盤面の下段を押したまま（あるいは素早く2回叩いて）カードが出ると、
   その click がカードの「ステージをえらぶ」に当たり、
   ゲーム終了とほぼ同時にステージ選択画面へ飛ばされていた。
   対策は2段構え:
     1) カードが出た瞬間から OVERLAY_ARM_MS のあいだ、カード内のボタンを
        CSS（pointer-events: none）と JS の両方で受け付けない
     2) カードが出る前に始まったタップ（＝終わりの1手）から出た click は、
        いつ届いても捨てる（次に新しいタップが始まるまで有効）
*/
const OVERLAY_ARM_MS = 520;
/** カードが出る前に始まったタップの click を待つ上限（これを過ぎたら普通の click として通す） */
const GHOST_MAX_MS = 1200;
/** 直近の pointerdown / touchstart の時刻（performance.now） */
let lastDownAt = 0;
/** この時刻より前に始まったタップの click は捨てる（0 = 解除） */
let armFrom = 0;
/** この時刻まではカードのボタンを受け付けない */
let armUntil = 0;
let armTimer = null;
const nowMs = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());

/** 結果カードを出した直後に呼ぶ: 開幕の連打とゴーストクリックを止める */
function armOverlayGuard() {
  const now = nowMs();
  armFrom = now;
  armUntil = now + OVERLAY_ARM_MS;
  const ov = $("#overlay");
  if (ov) ov.classList.add("arming");
  clearTimeout(armTimer);
  armTimer = setTimeout(() => {
    armUntil = 0;
    const o = $("#overlay");
    if (o) o.classList.remove("arming");
  }, OVERLAY_ARM_MS);
}

/** カードを閉じる・画面を移るときにガードを解く */
function clearOverlayGuard() {
  clearTimeout(armTimer);
  armTimer = null;
  armFrom = 0;
  armUntil = 0;
  const ov = $("#overlay");
  if (ov) ov.classList.remove("arming");
}

/**
 * いま来た click は捨てるべきか（前のタップの click / カード開幕の連打）。
 * 指から出た click（isTrusted）だけが対象。スクリプトや支援技術の click は通す。
 */
function isGhostClick(e) {
  if (e && e.isTrusted === false) return false;
  const now = nowMs();
  if (!armFrom) return false;
  // 取り残されないよう期限を切る（前のタップの click は 1 秒以上遅れて来ない）
  if (now - armFrom > GHOST_MAX_MS) {
    armFrom = 0;
    return false;
  }
  if (lastDownAt <= armFrom) return true; // カードが出る前から始まっていたタップ
  return now < armUntil; // カード開幕直後（カードの登場アニメのあいだ）の連打
}

/* ---------------- 操作ロックの安全装置 ----------------
   Build 3 では「タップを待たせるロック」そのものを廃止した。
   手は tapped の瞬間に同期で決まり、アニメーションは投げっぱなしにする。
   だから待ち行列が残ってマスが押せなくなる状態が原理的に作れない。
   ここに残るのは「ステージを移ったときに見た目を畳む」処理だけ。
*/
/** 直前のタップ（同じマスの二度打ち・合成 click の重複をはじく） */
let tapSeq = 0;
let lastTapAt = 0;
let lastTapCell = -1;
let handledPointer = null;
/**
 * ステージを移るとき・画面を離れるときに、進行中のアニメーションとタイマーを
 * すべて捨てて見た目を初期状態に戻す。
 */
function resetInteraction() {
  app.epoch += 1;
  clearLater();
  finishHop();
  stopVoice();
  // クリア/失敗カード（透明になった全画面の受け皿）も必ず畳む
  const ov = $("#overlay");
  if (ov) ov.classList.remove("show");
  clearOverlayGuard();
  handledPointer = null;
  $$(".cell.preview, .cell.hint, #board .cell.flip, #board .cell.netted").forEach((c) =>
    c.classList.remove("preview", "hint", "flip", "netted")
  );
  const usa = $("#usagiro");
  if (usa) usa.classList.remove("swing");
  const tanuki = $("#tanuki");
  if (tanuki) tanuki.classList.remove("sweating", "wobble", "caught");
  lastTapCell = -1;
  lastTapAt = 0;
}

/** ステージをまたいで残ってはいけないタイマー（setTimeout はここに集める） */
function later(fn, ms) {
  const id = setTimeout(() => {
    app.timers.delete(id);
    fn();
  }, ms);
  app.timers.add(id);
  return id;
}
function clearLater() {
  for (const id of app.timers) clearTimeout(id);
  app.timers.clear();
}

/** ボイス（設定OFF・音が出せないときは静かに何もしない） */
const voiceState = { lastAt: new Map() };

/**
 * 声を鳴らす。
 * - Build 4 から声は1本ずつ（audio.js の掛け合いキューが排他する）
 * - throttle: 同じ場面の声を続けて鳴らさない（語尾が切れないように）
 * - delay: 掛け合いの間合い（前の声が終わったあとに鳴る）
 */
function speak(who, situation, opts = {}) {
  try {
    const v = voiceFor(app.lang, who, situation);
    if (!v) return null;
    const key = `${who}:${situation}`;
    const delay = opts.delay || 0;
    const throttle = opts.throttle || 0;
    if (!delay && throttle && Date.now() - (voiceState.lastAt.get(key) || 0) < throttle) return v;
    voiceState.lastAt.set(key, Date.now());
    if (delay) later(() => playClip(v.url, { who }), delay);
    else playClip(v.url, { who });
    return v;
  } catch {
    return null;
  }
}

/* ---------------- 言語 ---------------- */
function detectLang() {
  const saved = store.settings.lang;
  if (saved && STRINGS[saved]) return saved;
  const nav = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
  for (const tag of nav) {
    const code = resolveLang(tag);
    if (STRINGS[code]) return code;
  }
  return "en";
}

function setLang(code, { persist = true } = {}) {
  const next = STRINGS[code] ? code : "en";
  app.lang = next;
  app.t = makeT(next);
  if (persist) store.setSetting("lang", next);
  document.documentElement.lang = next;
  relocalize();
  // 言語を変えたら、その言語の声を先に読み込んでおく
  try {
    preloadVoices(allVoiceUrls(next));
  } catch {}
}

function applyI18n(root = document) {
  const t = app.t;
  $$("[data-i18n]", root).forEach((el) => {
    const key = el.getAttribute("data-i18n");
    el.textContent = t(key);
  });
}

/**
 * 画面を移るときに、前の画面のモーダル・カード・トーストを必ず畳む。
 *
 * Build 3 の実機不具合「ステージ選択画面で何も押せない・スクロールできない」の原因は
 * これだった: クリアカードの「ステージをえらぶ」で nav() したとき、
 * #overlay の .show（透明になった全画面の受け皿）が残り、
 * 次の画面のタップもスクロールも全部食べていた。
 * .screen は pointer-events: none でも、子の .overlay.show が auto のままなら
 * 透明でもヒットテストに引っかかる（CSS の仕様どおりの動き）。
 * だから「画面を移る = オーバーレイを閉じる」を必ずセットにする。
 */
function closeOverlays() {
  const ov = $("#overlay");
  if (ov) ov.classList.remove("show");
  clearOverlayGuard();
  closeAllSheets();
  const toast = $("#toast");
  if (toast) toast.classList.remove("show");
}

/* ---------------- 画面遷移 ---------------- */
function nav(screen) {
  if (screen !== "game") {
    // ゲーム画面を離れたら、進行中の手・タイマー・ロックを全部たたむ
    if (app.ta) stopTimeAttack();
    if (app.screen === "game") resetInteraction();
  }
  // オープニングの追いかけアニメは「オープニング中」だけ動かす。
  // 離れたら .playing が外れ、chase の要素は opacity 0 / animation なしに戻る
  // （タップを受けない・描画も残らない）。
  const opening = $("#screen-opening");
  if (opening) opening.classList.toggle("playing", screen === "opening");
  // どの画面へ移っても、前の画面のモーダルは残さない（タップを食べる透明な幕を作らない）
  closeOverlays();
  app.screen = screen;
  $$(".screen").forEach((el) => el.classList.toggle("active", el.id === `screen-${screen}`));
  if (screen === "select") renderSelect();
  if (screen === "daily") renderDaily();
  if (screen === "settings") renderSettings();
  if (screen === "title") renderTitle();
}

function openSheet(id) {
  const el = $(`#${id}`);
  if (el) el.classList.add("show");
}
function closeSheet(id) {
  const el = $(`#${id}`);
  if (el) el.classList.remove("show");
}
function closeAllSheets() {
  $$(".sheet").forEach((s) => s.classList.remove("show"));
}

/* ---------------- 壁の絵 ---------------- */
function rockSVG(kind) {
  if (kind === "stump") {
    return `<svg viewBox="0 0 64 64" aria-hidden="true">
      <ellipse cx="32" cy="55" rx="25" ry="7" fill="rgba(40,24,10,.35)"/>
      <path d="M11 26 h42 v22 q0 6-6 6 h-30 q-6 0-6-6 z" fill="#96683a"/>
      <path d="M11 26 h42 v7 q-21 6-42 0 z" fill="#835733"/>
      <path d="M17 38 q4 10 2 16" stroke="#7a4f2c" stroke-width="1.6" fill="none" opacity=".7"/>
      <path d="M46 36 q-3 10-1 18" stroke="#7a4f2c" stroke-width="1.6" fill="none" opacity=".7"/>
      <ellipse cx="32" cy="24" rx="22" ry="9" fill="#c48f55"/>
      <ellipse cx="32" cy="23" rx="18" ry="7" fill="#e5bb85"/>
      <ellipse cx="32" cy="23" rx="12" ry="4.6" fill="#c89258"/>
      <ellipse cx="32" cy="23" rx="6" ry="2.4" fill="#eec99a"/>
    </svg>`;
  }
  return `<svg viewBox="0 0 64 64" aria-hidden="true">
    <ellipse cx="32" cy="57" rx="27" ry="6" fill="rgba(40,24,10,.35)"/>
    <path d="M5 52 q-1-17 8-26 q7-8 19-8 q12 0 19 8 q9 9 8 26 q0 4-5 4 h-44 q-5 0-5-4 z" fill="#8d8377" stroke="#5f574d" stroke-width="1.4"/>
    <path d="M9 42 q4-14 15-19 q10-4 19 0 q10 5 13 18 q-11 6-24 6 q-13 0-23-5 z" fill="#a49a8c"/>
    <path d="M20 22 q6-6 14-6 q-8 2-11 8 z" fill="#bcb2a3"/>
    <path d="M17 25 q9-7 18-6 q10 1 15 7 q-9-4-17-4 q-9 0-16 3 z" fill="#93b167"/>
    <path d="M25 21 q5-4 11-4 q-6 0-9 5 z" fill="#a9c47d"/>
    <path d="M12 47 q9 5 21 5 q13 0 21-4" stroke="#6b6154" stroke-width="1.6" fill="none" opacity=".5"/>
  </svg>`;
}
const wallArt = (i) => ((Math.floor(i / 5) * 3 + (i % 5) * 7) % 3 === 0 ? "stump" : "rock");

/* ---------------- 盤面 ---------------- */
function buildBoard(stage) {
  const board = $("#board");
  board.innerHTML = "";
  const geom = makeGeometry(stage.walls);
  for (let i = 0; i < 25; i++) {
    const cell = document.createElement("div");
    cell.className = "cell" + (geom.walls[i] ? " is-wall" : "");
    cell.dataset.i = i;
    cell.innerHTML = `<div class="floor"></div><div class="rock">${rockSVG(wallArt(i))}</div>`;
    board.appendChild(cell);
  }
}

function paintBoard(game) {
  const board = $("#board");
  const geom = game.geom;
  const traps = game.state.traps;
  const opts = tanukiOptionsMask(traps, game.state.pos, geom);
  for (let i = 0; i < 25; i++) {
    const cell = board.children[i];
    const wall = !!geom.walls[i];
    cell.classList.toggle("is-wall", wall);
    cell.classList.toggle("is-trap", !wall && ((traps >>> i) & 1) === 1);
    cell.classList.toggle("escape", !wall && ((opts >>> i) & 1) === 1 && i !== game.state.pos);
  }
  placeToken(game);
  paintMeter(game, opts);
}

function cellCenter(boardIdx) {
  const geom = boardGeometry();
  return geom.cells[boardIdx] || { x: 0, y: 0, s: 56 };
}

/**
 * マスの位置はステージが変わるだけでは動かない。
 * タップのたびに25マス分 getBoundingClientRect を呼ぶと（iOS では）レイアウトが詰まるので、
 * 盤面が組み終わったとき・回転や文字サイズが変わったときだけ測り直す。
 */
let cellGeom = null;
function measureCells() {
  const board = $("#board");
  const wrap = $("#board-wrap");
  if (!board || !wrap || board.children.length !== 25) return null;
  const wrapRect = wrap.getBoundingClientRect();
  const cells = new Array(25);
  for (let i = 0; i < 25; i++) {
    const r = board.children[i].getBoundingClientRect();
    cells[i] = { x: r.left - wrapRect.left, y: r.top - wrapRect.top, s: r.width };
  }
  const token = $("#tanuki");
  cellGeom = {
    cells,
    w: wrapRect.width,
    h: wrapRect.height,
    token: token ? token.getBoundingClientRect().width || 56 : 56,
  };
  return cellGeom;
}
function boardGeometry() {
  const wrap = $("#board-wrap");
  if (!wrap) return { cells: [], token: 56 };
  const w = wrap.getBoundingClientRect().width;
  if (!cellGeom || cellGeom.cells.length !== 25 || Math.abs(cellGeom.w - w) > 0.5) measureCells();
  return cellGeom || { cells: [], token: 56 };
}
/** 画面の大きさ・向き・文字サイズが変わったら測り直して置き直す */
function refreshBoardLayout() {
  cellGeom = null;
  if (!app.session) return;
  measureCells();
  placeToken(app.session.game);
}

function tokenSize() {
  const g = boardGeometry();
  return g.token || 56;
}

function placeToken(game) {
  const tanuki = $("#tanuki");
  const c = cellCenter(game.state.pos);
  const size = tokenSize();
  tanuki.style.transform = `translate(${c.x + (c.s - size) / 2}px, ${c.y + (c.s - size) / 2}px)`;
}

function paintMeter(game, optsMask) {
  const opts = tanukiOptionsMask(game.state.traps, game.state.pos, game.geom);
  const total = bits(opts).length; // その場に留まるのも1つ（0 ＝ 捕まった）
  const pips = $("#pips");
  if (pips.children.length !== 9) {
    pips.innerHTML = "";
    for (let k = 0; k < 9; k++) pips.appendChild(Object.assign(document.createElement("i"), { className: "pip" }));
  }
  Array.from(pips.children).forEach((el, k) => el.classList.toggle("on", k < total));
  $("#meter-num").textContent = String(total);
  const unit = $("#meter-unit");
  if (unit) unit.textContent = app.t("stage.escapeUnit");
  $(".meter").classList.toggle("danger", total <= 2);
  $("#meter-label").textContent = app.t("stage.escape", { name: app.t("char.tanuki") });
}

/* ---------------- アニメーション ---------------- */
/* 見た目のアニメーションはすべて投げっぱなし。
   ゲームの状態はタップした瞬間に決まっているので、待つ必要はない。
   途中で次のタップが来たら、前のアニメは畳んで新しい位置へ飛ぶ。 */
let hopAnim = null;

function setTokenTransform(x, y, scale = 1) {
  const el = $("#tanuki");
  if (el) el.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
}

function startHop(from, to) {
  const tanuki = $("#tanuki");
  if (!tanuki || to == null) return;
  const size = tokenSize();
  const a = cellCenter(from);
  const b = cellCenter(to);
  const ax = a.x + (a.s - size) / 2;
  const ay = a.y + (a.s - size) / 2;
  const bx = b.x + (b.s - size) / 2;
  const by = b.y + (b.s - size) / 2;
  finishHop();
  setTokenTransform(ax, ay);
  puff(ax, ay, size);
  sfx.hop();
  haptics.hop();
  const dx = bx - ax;
  const dy = by - ay;
  const air = Math.max(18, size * 0.55); // 放物線の高さ
  const tilt = dx >= 0 ? 9 : -9;
  try {
    if (typeof tanuki.animate !== "function") throw new Error("no animate");
    // transform と opacity だけ（GPU 合成）。await しないので連打を止めない
    hopAnim = tanuki.animate(
      [
        { transform: `translate(${ax}px,${ay}px) scale(1,1) rotate(0deg)`, offset: 0 },
        // ビクッ（叩かれた瞬間に身をすくめる）
        { transform: `translate(${ax}px,${ay - size * 0.22}px) scale(.9,1.14) rotate(${tilt * 0.4}deg)`, offset: 0.12 },
        // ぴょーん（放物線の頂点）
        { transform: `translate(${ax + dx * 0.34}px,${ay + dy * 0.34 - air}px) scale(.94,1.08) rotate(${tilt}deg)`, offset: 0.42 },
        { transform: `translate(${ax + dx * 0.72}px,${ay + dy * 0.72 - air * 0.6}px) scale(1.02,.98) rotate(${tilt * 0.6}deg)`, offset: 0.68 },
        // 着地（つぶれて戻る）
        { transform: `translate(${bx}px,${by}px) scale(1.14,.86) rotate(0deg)`, offset: 0.84 },
        { transform: `translate(${bx}px,${by}px) scale(1,1) rotate(0deg)`, offset: 1 },
      ],
      { duration: 420, easing: "cubic-bezier(.3,.6,.4,1)" }
    );
    hopAnim.onfinish = () => {
      hopAnim = null;
      setTokenTransform(bx, by);
      puff(bx, by, size);
    };
    hopAnim.oncancel = () => {
      hopAnim = null;
    };
  } catch {
    // アニメーションが使えなくても、位置は必ず合わせる
    hopAnim = null;
    setTokenTransform(bx, by);
    puff(bx, by, size);
  }
}

function finishHop() {
  if (hopAnim) {
    try {
      hopAnim.finish();
    } catch {}
    hopAnim = null;
  }
}

function puff(x, y, size) {
  const fx = $("#fx");
  for (let k = 0; k < 4; k++) {
    const d = document.createElement("div");
    d.className = "dustpuff";
    d.style.left = x + size / 2 - 8 + (k - 1.5) * 9 + "px";
    d.style.top = y + size - 10 + (k % 2) * 4 + "px";
    d.style.animationDelay = k * 35 + "ms";
    fx.appendChild(d);
    setTimeout(() => d.remove(), 620);
  }
}

/** 木槌が当たった瞬間の衝撃波リング（transform と opacity だけの軽い演出） */
function shockwave(x, y, size) {
  const fx = $("#fx");
  if (!fx) return;
  const ring = document.createElement("div");
  ring.className = "shockwave";
  const d = Math.max(20, Math.round(size * 0.46));
  ring.style.left = Math.round(x) + "px";
  ring.style.top = Math.round(y) + "px";
  ring.style.width = d + "px";
  ring.style.height = d + "px";
  fx.appendChild(ring);
  setTimeout(() => ring.remove(), 460);
}

/**
 * ウサギローがタップ位置にポンと出て、木槌を振り上げて「ドン！」と叩く。
 * 約 0.52 秒（Build 3 は 0.3 秒）。await しないので連打しても次の手は即通る。
 */
let swingSeq = 0;
function usagiroSwing(cellIdx) {
  const el = $("#usagiro");
  if (!el) return;
  const c = cellCenter(cellIdx);
  const size = el.getBoundingClientRect().width || 40;
  const x = c.x + (c.s - size) / 2;
  const y = c.y + (c.s - size) / 2;
  el.style.setProperty("--pos", `translate(${x}px, ${y}px)`);
  el.classList.remove("swing");
  void el.offsetWidth;
  el.classList.add("swing");
  const epoch = app.epoch;
  const seq = ++swingSeq;
  // 振り下ろす瞬間（アニメの約 58% ＝ 290ms）に音・バイブ・衝撃波を合わせる
  later(() => {
    if (epoch !== app.epoch || seq !== swingSeq) return;
    sfx.mallet();
    haptics.flip();
    shockwave(c.x + c.s / 2, c.y + c.s / 2, c.s);
  }, 290);
  later(() => {
    if (seq !== swingSeq) return;
    el.classList.remove("swing");
  }, 560);
}

function flipPulse(cells) {
  const board = $("#board");
  if (!board) return;
  cells.forEach((i, k) => {
    const cell = board.children[i];
    if (!cell || cell.classList.contains("is-wall")) return;
    later(() => {
      cell.classList.add("flip", "netted");
      later(() => {
        cell.classList.remove("flip", "netted");
      }, 300);
    }, k * 22);
  });
}

function spawnSparks(cellIdx) {
  const fx = $("#fx");
  const c = cellCenter(cellIdx);
  for (let k = 0; k < 12; k++) {
    const s = document.createElement("div");
    s.className = "spark";
    const ang = (Math.PI * 2 * k) / 12;
    const dist = 30 + Math.random() * 20;
    s.style.left = c.x + c.s / 2 + "px";
    s.style.top = c.y + c.s / 2 + "px";
    s.style.setProperty("--dx", Math.cos(ang) * dist + "px");
    s.style.setProperty("--dy", Math.sin(ang) * dist + "px");
    s.style.background = ["#f5b942", "#ff8a5c", "#fff2c9"][k % 3];
    fx.appendChild(s);
    setTimeout(() => s.remove(), 780);
  }
}

function spawnConfetti() {
  const fx = $("#fx");
  const colors = ["#e2572e", "#f5b942", "#7fb069", "#2f5db0", "#ff8a5c"];
  for (let k = 0; k < 24; k++) {
    const d = document.createElement("div");
    d.className = "confetti";
    d.style.left = Math.random() * 330 + 10 + "px";
    d.style.top = -8 + Math.random() * 30 + "px";
    d.style.background = colors[k % colors.length];
    d.style.animationDelay = Math.random() * 0.25 + "s";
    fx.appendChild(d);
    setTimeout(() => d.remove(), 1800);
  }
}

/* ---------------- トースト ---------------- */
let toastTimer = null;
function showToast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2000);
}

/* ---------------- ポコ丸のセリフとボイス ---------------- */
/**
 * ポコ丸のセリフ吹き出しとボイスは同じ台本から出す。
 * ボイスを先に選び、その種類に対応する文言を吹き出しに出す（声と文字がずれない）。
 */
const NOTE_KEY_FOR_VOICE = {
  taunt0: "note.start",
  taunt1: "note.taunt1",
  taunt2: "note.taunt2",
  taunt3: "note.taunt3",
  panic1: "note.panic1",
  panic2: "note.panic2",
  panic3: "note.panic3",
  caught1: "note.caught1",
  caught2: "note.caught2",
  escape1: "note.escape1",
  escape2: "note.escape2",
};

function setNote(key, mood = "") {
  const el = $("#note-text");
  if (el) el.textContent = app.t(key);
  const note = $("#note");
  if (!note) return;
  note.classList.toggle("panic", mood === "panic");
  note.classList.toggle("happy", mood === "happy");
  const av = $("#note-av");
  if (av) av.src = "assets/tanuki_face.png";
}

/** ポコ丸がしゃべる（吹き出し＋ボイス）。situation: start / taunt / panic / caught / escape */
function tanukiSpeak(situation, mood = "", opts = {}) {
  const v = voiceFor(app.lang, "pokomaru", situation);
  const delay = opts.delay || 0;
  if (delay) {
    later(() => setNote((v && NOTE_KEY_FOR_VOICE[v.key]) || "note.start", mood), delay);
  } else {
    setNote((v && NOTE_KEY_FOR_VOICE[v.key]) || "note.start", mood);
  }
  if (v) {
    if (delay) later(() => playClip(v.url, { who: "pokomaru" }), delay);
    else playClip(v.url, { who: "pokomaru" });
  }
}

function reactNote(game) {
  const opts = bits(tanukiOptionsMask(game.state.traps, game.state.pos, game.geom)).length;
  if (opts <= 2) tanukiSpeak("panic", "panic");
  else tanukiSpeak("taunt");
}

/* ---------------- タイトル ---------------- */
const HERO_RATIO = 1400 / 840;

/**
 * ホームのキャラ絵を「木槌の先端からポコ丸のしっぽまで」全体が入る大きさに置く。
 * 幅と高さの両方を見て小さいほうに合わせるので、どの機種・文字サイズでも見切れない。
 * 名前ラベルは画像内の頭の位置（％）に合わせ、画面の端ではみ出さないよう寄せる。
 */
function layoutHero() {
  const hero = $(".hero");
  const stage = $("#hero-stage");
  if (!hero || !stage) return;
  const vw = document.documentElement.clientWidth || 393;
  const availW = Math.min(hero.clientWidth || vw, vw);
  const availH = hero.clientHeight || availW / HERO_RATIO;
  let w = Math.min(availW, availH * HERO_RATIO);
  w = Math.max(140, Math.floor(w));
  const h = Math.round(w / HERO_RATIO);
  stage.style.width = w + "px";
  stage.style.height = h + "px";
  placeCharName($("#label-rabbit"), 0.305, 0.105, w);
  placeCharName($("#label-tanuki"), 0.735, 0.095, w);
}

function placeCharName(el, xPct, yPct, stageW) {
  if (!el) return;
  const stage = el.parentElement;
  if (!stage) return;
  const vw = document.documentElement.clientWidth || 393;
  const ts = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ts")) || 1;
  const base = Math.max(14, stageW * 0.055) * Math.min(ts, 1.15);
  el.style.fontSize = base.toFixed(1) + "px";
  let width = el.getBoundingClientRect().width;
  const maxW = Math.max(120, Math.min(stageW * 0.52, vw * 0.5));
  if (width > maxW) {
    el.style.fontSize = Math.max(11, base * (maxW / width)).toFixed(1) + "px";
    width = el.getBoundingClientRect().width;
  }
  const half = Math.min(width, maxW) / 2;
  const rect = stage.getBoundingClientRect();
  let cx = rect.left + rect.width * xPct;
  cx = Math.max(half + 5, Math.min(vw - half - 5, cx));
  el.style.left = Math.round(cx - rect.left) + "px";
  el.style.top = Math.round(rect.height * yPct) + "px";
}

function nextStageToPlay() {
  return STAGES.find((s) => !store.isCleared(s.id)) || STAGES[0];
}
function renderTitle() {
  const t = app.t;
  const cleared = store.clearCount(STAGES.map((s) => s.id));
  $("#credit-line").textContent = `${t("stage.progress", { a: cleared, b: STAGES.length })} ・ ${t("menu.daily")}`;
  const langChip = $("#lang-chip");
  if (langChip) langChip.textContent = (LANGS.find((l) => l.code === app.lang) || LANGS[0]).label;
  const todayKey = dateKey();
  $("#daily-dot").classList.toggle("show", !store.isDailyCleared(todayKey));
  const next = nextStageToPlay();
  const stageLabel = next.difficulty === "beginner" || next.difficulty === "middle" ? t("stage.stageNo", { n: next.index }) : t("common.pro");
  $("#btn-play-main").textContent = cleared > 0 ? t("menu.continue") : t("menu.play");
  $("#btn-play-sub").textContent = stageLabel;
  // ロゴ（日本語はカタカナ2行、他言語は1行）
  if (app.lang === "ja") {
    $("#logo-l1").textContent = "カチカチ";
    $("#logo-l2").textContent = "キャッチ";
  } else {
    const words = t("app.title").split(" ");
    $("#logo-l1").textContent = words.slice(0, Math.ceil(words.length / 2)).join(" ");
    $("#logo-l2").textContent = words.slice(Math.ceil(words.length / 2)).join(" ") || "";
  }
  $("#title-tagline").textContent = t("app.tagline");
  const nr = $("#name-rabbit");
  if (nr) nr.textContent = t("char.rabbit");
  const nt = $("#name-tanuki");
  if (nt) nt.textContent = t("char.tanuki");
  layoutHero();
}

/* ---------------- ステージ一覧 ---------------- */
function renderSelect() {
  const t = app.t;
  const list = $("#select-list");
  list.innerHTML = "";
  const cleared = store.clearCount(STAGES.map((s) => s.id));
  $("#select-progress").textContent = t("stage.progress", { a: cleared, b: STAGES.length });
  for (const diff of DIFFICULTIES) {
    const stages = stagesOf(diff);
    if (!stages.length) continue;
    const group = document.createElement("div");
    group.className = "diff-group";
    const done = stages.filter((s) => store.isCleared(s.id)).length;
    group.innerHTML = `<div class="diff-head"><h2>${t("difficulty." + diff)}</h2><span class="par">${t("stage.par", { n: PAR_OF[diff] })}</span><span class="bar"></span><span class="par">${done}/${stages.length}</span></div>`;
    const grid = document.createElement("div");
    grid.className = "stage-list";
    for (const st of stages) {
      const playable = canPlayStage(st);
      const btn = document.createElement("button");
      btn.className =
        "stage-item" + (store.isCleared(st.id) ? " cleared" : "") + (playable ? "" : " locked");
      btn.innerHTML = `<span class="num">${t("stage.stageNo", { n: st.index })}</span>
        <div class="pg">${t("stage.par", { n: st.par })}</div>
        ${store.isCleared(st.id) ? '<span class="mark">✓</span>' : playable ? "" : '<span class="lock">🔒</span>'}
        ${!playable ? `<span class="tiny-pro">${t("common.pro")}</span>` : ""}`;
      btn.addEventListener("click", () => {
        unlockAudio();
        if (playable) openStage(st.id);
        else openProSheet();
      });
      grid.appendChild(btn);
    }
    group.appendChild(grid);
    list.appendChild(group);
  }
}

/* ---------------- デイリー ---------------- */
function renderDaily() {
  const t = app.t;
  const now = new Date();
  const today = dailyPuzzleFor(now);
  const key = dateKey(now);
  $("#daily-date").textContent = key;
  $("#daily-badge").textContent = t("daily.today");
  $("#daily-title").textContent = t("daily.title");
  $("#daily-par").textContent = t("stage.par", { n: today.par });
  $("#daily-state").textContent = store.isDailyCleared(key) ? t("daily.done") : t("daily.todo");
  $("#btn-daily-play").textContent = t("daily.play");

  const list = $("#past-list");
  list.innerHTML = "";
  const past = pastDailies(30, now);
  const unlocked = canPastDaily();
  $("#past-pro").style.display = unlocked ? "none" : "";
  $("#past-pro").textContent = t("common.pro");
  for (const p of past) {
    const row = document.createElement("button");
    row.className = "past-row" + (store.isDailyCleared(p.key) ? " done" : "");
    row.innerHTML = `<span class="d">${p.key}</span><span class="p">${t("stage.par", { n: p.stage.par })}</span>
      <span class="lock">${unlocked ? (store.isDailyCleared(p.key) ? "✓" : "") : "🔒"}</span>`;
    row.addEventListener("click", () => {
      unlockAudio();
      if (!unlocked) {
        openProSheet();
        return;
      }
      openStage(p.stage, { mode: "daily", dailyKey: p.key });
    });
    list.appendChild(row);
  }
}

/* ---------------- ステージ開始（通常 / デイリー / TA） ---------------- */
function openStage(stageOrId, opts = {}) {
  const stage = typeof stageOrId === "string" ? stageById(stageOrId) : stageOrId;
  if (!stage) return;
  const mode = opts.mode || "stage";
  if (mode === "stage" && !canPlayStage(stage)) {
    openProSheet();
    return;
  }
  // 前のステージのアニメーション・タイマー・ロックを必ず捨ててから始める
  resetInteraction();
  const epoch = app.epoch;
  app.session = {
    mode,
    stage,
    game: new Game(stage),
    dailyKey: opts.dailyKey || null,
  };
  const t = app.t;
  const game = app.session.game;
  $("#screen-game").classList.toggle("ta", mode === "ta");
  $("#hud-difficulty").textContent =
    mode === "daily" ? t("daily.title") : mode === "ta" ? t("menu.ta") : t("difficulty." + stage.difficulty);
  $("#hud-name").textContent = mode === "daily" ? stage.id.toUpperCase() : t("stage.stageNo", { n: stage.index });
  $("#hud-par").textContent = t("stage.par", { n: stage.par });
  $("#hud-strip").textContent = t("tip.general", { name: t("char.tanuki") });
  $("#hud-moves-unit").textContent = t("stage.movesUnit");
  $("#hud-moves").textContent = String(game.remaining);
  $("#hud-moves-wrap").classList.remove("low");
  $("#hud-moves-wrap").querySelector("span").textContent = t("stage.remaining");
  $("#btn-retry").querySelector("span:last-child").textContent = t("game.retry");
  updateHintLabel();
  $("#overlay").classList.remove("show");
  buildBoard(stage);
  nav("game");
  renderProgress();
  tanukiSpeak("start");
  speak("usagiro", "start"); // 声は1本ずつ（ポコ丸のあとにウサギローが続く）
  requestAnimationFrame(() => {
    if (epoch !== app.epoch) return; // もう別のステージに移っている
    measureCells();
    paintBoard(game);
    const tanuki = $("#tanuki");
    if (!tanuki) return;
    tanuki.classList.remove("sweating", "caught", "wobble");
    const size = tokenSize();
    const c = cellCenter(game.state.pos);
    const x = c.x + (c.s - size) / 2;
    const y = c.y + (c.s - size) / 2;
    try {
      tanuki.animate(
        [
          { transform: `translate(${x}px,${y}px) scale(.2)`, opacity: 0 },
          { transform: `translate(${x}px,${y}px) scale(1)`, opacity: 1 },
        ],
        { duration: 340, easing: "cubic-bezier(.34,1.56,.5,1)" }
      );
    } catch {} // アニメーションが使えなくても盤面は出す
  });
}

function renderProgress() {
  const s = app.session;
  const strip = $("#prog-strip");
  if (!s || s.mode !== "stage") {
    strip.style.display = "none";
    return;
  }
  strip.style.display = "";
  const total = STAGES.length;
  const cleared = store.clearCount(STAGES.map((x) => x.id));
  $("#prog-label").textContent = `${app.t("stage.stageNo", { n: s.stage.index })} / ${total}`;
  $("#prog-fill").style.width = Math.round((cleared / total) * 100) + "%";
}

function updateHintLabel() {
  const s = app.session;
  if (!s) return;
  const t = app.t;
  if (s.mode === "ta") {
    $("#hint-label").textContent = t("game.hint");
    return;
  }
  if (isPro()) {
    $("#hint-label").textContent = t("game.hint");
  } else {
    const left = hintsLeft(s.stage.id, store.hintsUsed(s.stage.id));
    $("#hint-label").textContent = `${t("game.hint")} ${left}`;
  }
}

/* ---------------- タップ ---------------- */
/**
 * 1手打つ。Build 3 のタップは完全に同期で、ロックも await も無い。
 *   - 盤面の状態はタップした瞬間に決まる（model が先）
 *   - 木槌・バイブ・音・声は同時に出す
 *   - ポコ丸の跳ね・トラップの反転は見た目だけを後から追いかける
 * だから「アニメーションが終わらないと次のマスが押せない」状態が存在しない。
 */
function tapCell(i) {
  const s = app.session;
  if (!s || s.game.status !== "playing") return false;
  const game = s.game;
  if (!Number.isInteger(i) || i < 0 || i > 24) return false;
  // 同じマスの連打（180ms 以内）は 1回と数える。
  // iOS の合成 click や指の震えで同じマスが二度打ちになるのを防ぐ（別のマスは即座に受け付ける）。
  const now = Date.now();
  if (i === lastTapCell && now - lastTapAt < 180) return false;
  if (!game.canTap(i)) {
    if (i === game.state.pos) showToast(app.t("game.cellBlocked", { name: app.t("char.tanuki") }));
    return false;
  }
  const epoch = app.epoch;
  const seq = ++tapSeq;
  lastTapAt = now;
  lastTapCell = i;
  try {
    clearHint();
    usagiroSwing(i);
    speak("usagiro", "tap", { throttle: 1700 });
    const result = game.play(i);
    if (!result) return false;
    sfx.flip();
    flipPulse(result.flipped);
    paintBoard(game);
    updateMovesHud(game);

    const tanuki = $("#tanuki");
    if (result.caught) {
      onCaught(game, i, epoch, seq);
      return true;
    }

    if (tanuki) tanuki.classList.add("sweating", "wobble");
    sfx.sweat();
    if (result.tanukiTo != null) startHop(result.tanukiFrom, result.tanukiTo);
    later(() => {
      if (epoch !== app.epoch || seq !== tapSeq) return;
      if (tanuki) tanuki.classList.remove("sweating", "wobble");
    }, 380);
    reactNote(game);

    if (s.mode === "ta") {
      if (result.outOfMoves) {
        haptics.warning();
        sfx.fail();
        taPenalty();
      }
    } else if (result.outOfMoves) {
      tanukiSpeak("escape", "panic");
      speak("usagiro", "fail", { delay: 620 });
      haptics.warning();
      sfx.fail();
      later(() => {
        if (epoch !== app.epoch || seq !== tapSeq) return;
        showFail(game);
      }, 240);
    }
    return true;
  } catch (e) {
    // 何が起きても操作は止めない（音・アニメーションの失敗を含む）
    console.warn("tap failed:", e);
    return false;
  }
}

function updateMovesHud(game) {
  const el = $("#hud-moves");
  if (el) el.textContent = String(game.remaining);
  const wrap = $("#hud-moves-wrap");
  if (wrap) wrap.classList.toggle("low", game.remaining <= 1);
}

function onCaught(game, cellIdx, epoch, seq) {
  const tanuki = $("#tanuki");
  if (tanuki) {
    tanuki.classList.add("caught");
    tanuki.classList.remove("sweating", "wobble");
  }
  speak("usagiro", "clear");
  tanukiSpeak("caught", "happy", { delay: 950 });
  sfx.catch_();
  haptics.success();
  spawnSparks(cellIdx);
  const s = app.session;
  if (!s) return;
  if (s.mode === "ta") {
    later(() => {
      if (epoch !== app.epoch || seq !== tapSeq) return;
      taScore();
    }, 240);
    return;
  }
  later(() => {
    if (epoch !== app.epoch || seq !== tapSeq) return;
    spawnConfetti();
    sfx.stageClear();
    if (s.mode === "daily" && s.dailyKey) store.markDailyCleared(s.dailyKey);
    const isNew = s.mode === "stage" ? store.markCleared(game.stage.id) : false;
    showClear(game, isNew);
  }, 620);
}

/* ---------------- ヒント ---------------- */
function clearHint() {
  $$(".cell.hint").forEach((c) => c.classList.remove("hint"));
}
function showHint() {
  const s = app.session;
  if (!s || s.game.status !== "playing") return null;
  if (s.mode !== "ta" && !isPro() && !canUseHint(s.stage.id, store.hintsUsed(s.stage.id))) {
    showToast(app.t("pro.item5"));
    openProSheet();
    return null;
  }
  const cell = s.game.hint();
  if (cell == null) {
    showToast(app.t("game.noHint"));
    return null;
  }
  if (s.mode !== "ta" && !isPro()) store.useHint(s.stage.id);
  updateHintLabel();
  sfx.hint();
  haptics.tap();
  clearHint();
  $("#board").children[cell].classList.add("hint");
  showToast(app.t("game.tapHint"));
  later(clearHint, 2600);
  return cell;
}

/* ---------------- シェア（Build 5） ---------------- */
/**
 * 結果カードの「シェアする」。
 * - iOS の WKWebView では navigator.share() が標準の共有シートを開く（タップから直接呼ぶ）
 * - 使えない環境（PC ブラウザ等）ではクリップボードにコピーしてトーストで知らせる
 * 文言は src/share.js（12言語は i18n.js の share.*）。
 */
async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  // クリップボード API が無い/拒否されたときの手（WKWebView でもユーザーのタップ中なら通る）
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand("copy");
    ta.remove();
    return !!ok;
  } catch {
    return false;
  }
}

/** 実際に共有する。返り値: "share" | "clipboard" | "cancelled" | "failed" */
async function shareResult(kind, data = {}) {
  const text = shareTextFor(app.t, kind, { date: dateKey(), ...data });
  app.lastShare = { kind, text, via: null, at: Date.now() };
  let via = "";
  try {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: app.t("app.title"), text });
        via = "share";
      } catch (e) {
        const name = e && e.name;
        // ユーザーがシートを閉じただけのときは、勝手にコピーしない
        if (name === "AbortError" || name === "NotAllowedError" || name === "DataError") via = "cancelled";
      }
    }
  } catch {}
  if (via === "cancelled") {
    app.lastShare.via = via;
    return via;
  }
  if (!via) {
    const ok = await copyToClipboard(text);
    via = ok ? "clipboard" : "failed";
    showToast(app.t(ok ? "share.copied" : "share.failed"));
  }
  app.lastShare.via = via;
  return via;
}

function priceLabel() {
  return (app.product && app.product.displayPrice) || "\u00a5300";
}

/* ---------------- クリア / 失敗カード ---------------- */
function cardButton(label, sub, cls, onClick) {
  const b = document.createElement("button");
  b.className = "btn" + (cls ? " " + cls : "");
  b.innerHTML = sub ? `<span class="btn-main">${label}</span><span class="btn-sub">${sub}</span>` : `<span class="btn-main">${label}</span>`;
  // Build 6: カードが出た瞬間のゴーストタップでは何も起きない（二重の保険）
  b.addEventListener("click", (e) => {
    if (isGhostClick(e)) {
      e.preventDefault();
      return;
    }
    onClick(e);
  });
  return b;
}

function showClear(game, isNew) {
  const t = app.t;
  const stage = game.stage;
  const perfect = game.movesUsed === stage.par;
  const s = app.session;
  const isStageMode = !!s && s.mode === "stage";
  // Build 5: 中級 STAGE 25（無料分の最後）をクリアした無料ユーザーへ、達成感に寄り添う PRO 案内
  const promoTier = isFreeTierFinale(stage, s && s.mode, isPro());
  const card = $("#card");
  if (card) card.classList.toggle("promo", promoTier);
  $("#card-img").innerHTML = `<img src="assets/rabbit_face.png" alt="" />`;
  if (promoTier) {
    $("#card-title").textContent = t("pro.clear25Title");
    $("#card-text").textContent = t("pro.clear25Text", { price: priceLabel() });
  } else {
    $("#card-title").textContent = t("game.clearTitle");
    $("#card-text").textContent = `${t("game.clearText", { n: game.movesUsed })}${perfect ? " " + t("game.clearPerfect") : ""}`;
  }
  const actions = $("#card-actions");
  actions.innerHTML = "";
  if (promoTier) {
    // まず「PRO を開く」（自然に目立つ位置）。その下にシェアと通常の導線
    actions.appendChild(cardButton(t("pro.clear25Btn"), "", "pro-cta", () => openProSheet()));
  } else {
    const idx = STAGES.indexOf(stage);
    const next = isStageMode && idx >= 0 ? STAGES[idx + 1] : null;
    if (next) {
      const playable = canPlayStage(next);
      actions.appendChild(
        cardButton(t("game.next"), t("stage.stageNo", { n: next.index }), "", () => (playable ? openStage(next.id) : openProSheet()))
      );
    }
  }
  if (isStageMode) {
    actions.appendChild(
      cardButton(shareButtonLabel(t), "", "share", () => shareResult("stage", { stage: t("stage.stageNo", { n: stage.index }), moves: game.movesUsed }))
    );
  } else {
    actions.appendChild(
      cardButton(shareButtonLabel(t), "", "share", () => shareResult("daily", { date: (s && s.dailyKey) || dateKey() }))
    );
  }
  actions.appendChild(cardButton(t("game.again"), "", "ghost", () => openStage(stage.id, { mode: s.mode, dailyKey: s.dailyKey })));
  actions.appendChild(cardButton(t("game.choose"), "", "ghost", () => nav(s.mode === "daily" ? "daily" : "select")));
  $("#overlay").classList.add("show");
  armOverlayGuard();
}

function showFail(game) {
  const t = app.t;
  $("#card-img").innerHTML = `<img src="assets/tanuki_face.png" class="tanuki-img" alt="" />`;
  $("#card-title").textContent = t("game.failTitle");
  $("#card-text").textContent = t("game.failText");
  const actions = $("#card-actions");
  actions.innerHTML = "";
  const s = app.session;
  actions.appendChild(cardButton(t("game.again"), t("stage.par", { n: game.stage.par }), "", () => openStage(game.stage.id, { mode: s.mode, dailyKey: s.dailyKey })));
  actions.appendChild(cardButton(t("game.hintSee"), "", "ghost", () => {
    openStage(game.stage.id, { mode: s.mode, dailyKey: s.dailyKey });
    setTimeout(showHint, 260);
  }));
  actions.appendChild(cardButton(t("game.choose"), "", "ghost", () => nav(s.mode === "daily" ? "daily" : "select")));
  $("#overlay").classList.add("show");
  armOverlayGuard();
}

/* ---------------- タイムアタック ---------------- */
const TA_PENALTY = 3;

function taPool() {
  const pool = [...STAGES, ...DAILY].filter((s) => s.par <= 3);
  let seed = 424242;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  return pool
    .map((s) => ({ s, k: rnd() }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.s);
}

/** タイムアタックの秒数だけでなくてもよいが、記録は秒ごとに別（60/120/180） */
function taBest(seconds) {
  return store.taBestFor(seconds);
}

/** 時間を選ぶシート（60 / 120 / 180 秒） */
function openTaSheet() {
  const t = app.t;
  if (!canTimeAttack()) {
    openProSheet();
    return;
  }
  const title = $("#ta-pick-title");
  if (title) title.textContent = t("ta.pickTime");
  const list = $("#ta-pick-list");
  if (!list) return;
  list.innerHTML = "";
  for (const sec of TA_DURATIONS) {
    const b = document.createElement("button");
    b.className = "ta-pick" + (normalizeTaDuration(store.settings.taDuration) === sec ? " sel" : "");
    b.dataset.sec = String(sec);
    b.innerHTML = `<span class="ta-pick-sec">${t("ta.seconds", { n: sec })}</span><span class="ta-pick-best">${t("ta.best")} ${taBest(sec)}</span>`;
    b.addEventListener("click", () => {
      unlockAudio();
      sfx.ui();
      closeSheet("ta-sheet");
      startTimeAttack(sec);
    });
    list.appendChild(b);
  }
  openSheet("ta-sheet");
}

function startTimeAttack(seconds) {
  if (!canTimeAttack()) {
    openProSheet();
    return;
  }
  const duration = normalizeTaDuration(seconds == null ? store.settings.taDuration : seconds);
  store.setSetting("taDuration", duration);
  stopTimeAttack();
  resetInteraction();
  $("#overlay").classList.remove("show");
  app.ta = { duration, left: duration * 1000, score: 0, index: 0, timer: null, running: true, pool: taPool() };
  $("#ta-time").textContent = String(duration);
  $("#ta-time").classList.remove("low");
  $("#ta-score").textContent = "0";
  openTaPuzzle();
  app.ta.timer = setInterval(taTick, 100);
}

function openTaPuzzle() {
  const ta = app.ta;
  if (!ta) return;
  resetInteraction();
  const epoch = app.epoch;
  const stage = ta.pool[ta.index % ta.pool.length];
  app.session = { mode: "ta", stage, game: new Game(stage), dailyKey: null };
  $("#screen-game").classList.add("ta");
  const t = app.t;
  $("#hud-difficulty").textContent = t("menu.ta");
  $("#hud-name").textContent = t("stage.stageNo", { n: ta.score + 1 });
  $("#hud-par").textContent = t("stage.par", { n: stage.par });
  $("#hud-strip").textContent = t("ta.rule");
  $("#hud-moves").textContent = String(app.session.game.remaining);
  $("#hud-moves-wrap").classList.remove("low");
  $("#ta-score").textContent = String(ta.score);
  $("#btn-retry").querySelector("span:last-child").textContent = t("common.back");
  $("#overlay").classList.remove("show");
  buildBoard(stage);
  nav("game");
  renderProgress();
  tanukiSpeak("start");
  requestAnimationFrame(() => {
    if (epoch !== app.epoch) return;
    measureCells();
    paintBoard(app.session.game);
    const size = tokenSize();
    const c = cellCenter(app.session.game.state.pos);
    const tanuki = $("#tanuki");
    if (!tanuki) return;
    tanuki.classList.remove("caught", "sweating", "wobble");
    try {
      tanuki.animate(
        [
          { transform: `translate(${c.x + (c.s - size) / 2}px,${c.y + (c.s - size) / 2}px) scale(.2)`, opacity: 0 },
          { transform: `translate(${c.x + (c.s - size) / 2}px,${c.y + (c.s - size) / 2}px) scale(1)`, opacity: 1 },
        ],
        { duration: 300, easing: "ease-out" }
      );
    } catch {}
  });
}

function taTick() {
  const ta = app.ta;
  if (!ta || !ta.running) return;
  ta.left -= 100;
  const secs = Math.max(0, Math.ceil(ta.left / 1000));
  $("#ta-time").textContent = String(secs);
  $("#ta-time").classList.toggle("low", secs <= 10);
  if (secs <= 10 && ta.left % 1000 < 120) sfx.tick();
  if (ta.left <= 0) endTimeAttack();
}

function taScore() {
  const ta = app.ta;
  if (!ta) return;
  ta.score += 1;
  ta.index += 1;
  $("#ta-score").textContent = String(ta.score);
  sfx.stageClear();
  later(() => {
    if (ta.running) openTaPuzzle();
  }, 420);
}

function taPenalty() {
  const ta = app.ta;
  if (!ta) return;
  ta.left = Math.max(0, ta.left - TA_PENALTY * 1000);
  showToast(`−${TA_PENALTY}s`);
  tanukiSpeak("escape", "panic");
  speak("usagiro", "fail");
  later(() => {
    if (ta.running) openTaPuzzle();
  }, 420);
}

function endTimeAttack() {
  const ta = app.ta;
  if (!ta) return;
  ta.running = false;
  clearInterval(ta.timer);
  resetInteraction();
  sfx.timeUp();
  const duration = normalizeTaDuration(ta.duration);
  const best = taBest(duration);
  const isNew = store.setTaBestFor(duration, ta.score);
  const t = app.t;
  $("#card-img").innerHTML = `<img src="assets/tanuki_face.png" class="tanuki-img" alt="" />`;
  $("#card-title").textContent = t("ta.title");
  $("#card-text").innerHTML = `${t("ta.seconds", { n: duration })} ・ ${t("ta.result", { n: ta.score })}<br>${t("ta.best")} ${Math.max(best, ta.score)}${isNew ? " ・ " + t("ta.newBest") : ""}`;
  const actions = $("#card-actions");
  actions.innerHTML = "";
  actions.appendChild(cardButton(t("ta.again"), t("ta.seconds", { n: duration }), "", () => {
    $("#overlay").classList.remove("show");
    startTimeAttack(duration);
  }));
  actions.appendChild(
    cardButton(shareButtonLabel(t), "", "share", () => shareResult("ta", { seconds: duration, score: ta.score }))
  );
  actions.appendChild(cardButton(t("ta.pickOther"), "", "ghost", () => {
    $("#overlay").classList.remove("show");
    app.ta = null;
    nav("title");
    openTaSheet();
  }));
  actions.appendChild(cardButton(t("common.back"), "", "ghost", () => {
    $("#overlay").classList.remove("show");
    app.ta = null;
    nav("title");
  }));
  $("#overlay").classList.add("show");
  armOverlayGuard();
}

function stopTimeAttack() {
  if (app.ta) {
    app.ta.running = false;
    clearInterval(app.ta.timer);
    app.ta = null;
  }
}

/* ---------------- 設定 ---------------- */
/** 文字サイズ（標準 / 大 / 特大）を画面全体に反映する */
function applyTextSize(value) {
  const size = normalizeTextSize(value);
  document.documentElement.setAttribute("data-text-size", size);
  return size;
}

function setTextSize(value) {
  const size = applyTextSize(value);
  store.setSetting("textSize", size);
  renderSettings();
  // 文字サイズでホームの高さが変わるので、キャラの大きさを測り直す
  layoutHero();
  refreshBoardLayout();
}

function renderSettings() {
  const t = app.t;
  const s = store.settings;
  $("#tg-bgm").classList.toggle("on", s.bgm !== false);
  $("#tg-se").classList.toggle("on", s.se !== false);
  const voiceBtn = $("#tg-voice");
  if (voiceBtn) voiceBtn.classList.toggle("on", s.voice !== false);
  $("#tg-haptics").classList.toggle("on", s.haptics !== false);
  $("#set-lang").textContent = (LANGS.find((l) => l.code === app.lang) || LANGS[0]).label;
  $("#settings-title").textContent = t("settings.title");
  $("#pro-row-label").textContent = isPro() ? t("settings.proActive") : t("settings.upgrade");
  $("#pro-row-state").textContent = isPro() ? "✓" : t("common.pro");
  $("#version-line").textContent = `${t("settings.version")} ${VERSION} (${BUILD})`;
  $("#privacy-kicker").textContent = t("settings.privacy");
  $("#privacy-title").textContent = t("privacy.title");
  $("#privacy-body").textContent = t("privacy.body");
  $("#privacy-link").textContent = t("privacy.open");
  // 文字サイズの3択
  const sizeRow = $("#text-size-seg");
  if (sizeRow) {
    const current = normalizeTextSize(s.textSize);
    $$("button", sizeRow).forEach((b) => {
      const on = b.dataset.size === current;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.textContent = t("textSize." + b.dataset.size);
    });
  }
  const sizeLabel = $("#set-textsize");
  if (sizeLabel) sizeLabel.textContent = t("textSize." + normalizeTextSize(s.textSize));
}

function toggleSetting(name, btn) {
  const next = store.settings[name] === false;
  store.setSetting(name, next);
  btn.classList.toggle("on", next);
  if (name === "bgm") {
    if (next) startBgm();
    else stopBgm();
  }
  if (name === "se" && next) {
    sfx.ui();
  }
  if (name === "voice" && next) speak("usagiro", "start");
  applySettings();
  if (name === "haptics" && next) haptics.tap();
}

/* ---------------- ルール ---------------- */
function renderRules() {
  const t = app.t;
  $("#howto-title").textContent = t("howto.title");
  $("#r1t").textContent = t("howto.r1t");
  $("#r1b").textContent = t("howto.r1b");
  $("#r2t").textContent = t("howto.r2t");
  $("#r2b").textContent = t("howto.r2b");
  $("#r3t").textContent = t("howto.r3t");
  $("#r3b").textContent = t("howto.r3b");
  $("#r4t").textContent = t("howto.r4t");
  $("#r4b").textContent = t("howto.r4b");
  const r5t = $("#r5t");
  if (r5t) r5t.textContent = t("howto.r5t");
  const r5b = $("#r5b");
  if (r5b) r5b.textContent = t("howto.r5b");
  const lgTrap = $("#lg-trap");
  if (lgTrap) lgTrap.textContent = t("howto.legendTrap");
  const lgRock = $("#lg-rock");
  if (lgRock) lgRock.textContent = t("howto.legendRock");
}

function buildMiniDiagrams() {
  const mk = (el, painter) => {
    const board = document.createElement("div");
    board.className = "board";
    for (let i = 0; i < 25; i++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.innerHTML = `<div class="floor"></div>`;
      board.appendChild(cell);
    }
    el.innerHTML = "";
    el.appendChild(board);
    painter(board);
  };
  mk($("#mini-1"), (b) => {
    for (const i of [7, 11, 12, 13, 17]) b.children[i].classList.add("preview");
  });
  mk($("#mini-2"), (b) => {
    b.children[12].innerHTML =
      `<div class="floor"></div><img src="assets/tanuki_token.png" alt="" style="position:absolute;inset:1px;width:calc(100% - 2px);height:100%" />`;
    for (const i of [6, 7, 8, 11, 13, 16, 17, 18]) b.children[i].classList.add("escape");
  });
  // ③ 罠（網のマス）と障害物（岩・切り株）を絵で見せる
  mk($("#mini-3"), (b) => {
    for (const i of [6, 7, 8, 11, 16, 18]) b.children[i].classList.add("is-trap");
    for (const i of [13, 17]) {
      b.children[i].classList.add("is-wall");
      b.children[i].innerHTML = `<div class="rock">${rockSVG(wallArt(i))}</div>`;
    }
    b.children[12].innerHTML =
      `<div class="floor"></div><img src="assets/tanuki_token.png" alt="" style="position:absolute;inset:1px;width:calc(100% - 2px);height:100%" />`;
  });
}

/* ---------------- PRO ---------------- */
function renderProSheet() {
  const t = app.t;
  $("#pro-title").textContent = t("pro.title", { app: t("app.title") });
  $("#pro-lead").textContent = t("pro.lead");
  const free = $("#pro-free");
  if (free) free.textContent = t("pro.free");
  $("#pro-items").innerHTML = ["pro.item1", "pro.item2", "pro.item3", "pro.item4", "pro.item5"]
    .map((k) => `<li><b>✓</b>${t(k)}</li>`)
    .join("");
  $("#pro-price").textContent = app.product && app.product.displayPrice ? app.product.displayPrice : t("pro.priceNote");
  $("#pro-buy").textContent = isStoreAvailable() ? t("pro.buy") : t("pro.unavailable");
  $("#pro-restore").textContent = t("pro.restore");
  $("#pro-note").textContent = "";
}

async function openProSheet() {
  renderProSheet();
  openSheet("pro-sheet");
  if (!app.product && isStoreAvailable()) {
    app.product = await getProduct();
    renderProSheet();
  }
}

async function doPurchase() {
  const t = app.t;
  if (!isStoreAvailable()) {
    $("#pro-note").textContent = t("pro.unavailable");
    return;
  }
  $("#pro-buy").disabled = true;
  const r = await purchase();
  $("#pro-buy").disabled = false;
  if (r && r.entitled) {
    $("#pro-note").textContent = t("pro.thanks");
    renderProSheet();
    renderSelect();
    renderSettings();
    setTimeout(() => closeSheet("pro-sheet"), 900);
  } else {
    $("#pro-note").textContent = r && r.status === "cancelled" ? "" : t("pro.failed") + (r && r.message ? ` (${r.message})` : "");
  }
}

async function doRestore() {
  const t = app.t;
  if (!isStoreAvailable()) {
    $("#pro-note").textContent = t("pro.unavailable");
    return;
  }
  const r = await restore();
  if (r && r.entitled) {
    $("#pro-note").textContent = t("pro.thanks");
    renderSelect();
    renderSettings();
  } else {
    $("#pro-note").textContent = t("pro.failed");
  }
}

/* ---------------- 言語シート ---------------- */
function renderLangSheet() {
  const list = $("#lang-list");
  list.innerHTML = "";
  for (const l of LANGS) {
    const row = document.createElement("button");
    row.className = "lang-row" + (l.code === app.lang ? " sel" : "");
    row.innerHTML = `<span>${l.label}</span>${l.code === app.lang ? "<small>✓</small>" : ""}`;
    row.addEventListener("click", () => {
      setLang(l.code);
      renderLangSheet();
      closeSheet("lang-sheet");
      sfx.ui();
    });
    list.appendChild(row);
  }
}

/* ---------------- 再ローカライズ ---------------- */
function relocalize() {
  applyI18n();
  renderTitle();
  renderRules();
  renderSettings();
  renderProSheet();
  renderLangSheet();
  if (app.screen === "select") renderSelect();
  if (app.screen === "daily") renderDaily();
  if (app.session) {
    const s = app.session;
    const t = app.t;
    $("#hud-difficulty").textContent =
      s.mode === "daily" ? t("daily.title") : s.mode === "ta" ? t("menu.ta") : t("difficulty." + s.stage.difficulty);
    $("#hud-par").textContent = t("stage.par", { n: s.stage.par });
    $("#hud-strip").textContent = s.mode === "ta" ? t("ta.rule") : t("tip.general", { name: t("char.tanuki") });
    $("#hud-moves-wrap").querySelector("span").textContent = t("stage.remaining");
    $("#hud-moves-unit").textContent = t("stage.movesUnit");
    $("#btn-retry").querySelector("span:last-child").textContent = t("game.retry");
    updateHintLabel();
    paintMeter(s.game);
    if ($("#card-title").textContent) {
      /* カードは次に開いたとき再生成されるので何もしない */
    }
  }
}

/* ---------------- 起動・オープニング ---------------- */
let openingTimer = null;
function startOpening() {
  nav("opening");
  $("#open-title").textContent = app.t("app.title");
  $("#open-tag").textContent = app.t("app.tagline");
  $("#open-skip").textContent = app.t("opening.skip");
  clearTimeout(openingTimer);
  // Build 6: 全身キャラが走り抜ける 1.5 秒＋タイトル。全体は 2.1 秒でホームへ（タップで即スキップ）
  openingTimer = setTimeout(finishOpening, 2100);
}
function finishOpening() {
  clearTimeout(openingTimer);
  if (app.screen !== "opening") return;
  nav("title");
  if (store.settings.bgm !== false) {
    unlockAudio();
    startBgm();
  }
}

function bind() {
  // Build 6: タップの起点を記録し、カード開幕のゴースト click を捨てる（capture で最優先）。
  // カードが出たあとに始まった「新しいタップ」なら、開幕ガードはその場で解く
  // （カードの登場アニメ中でも、本人が押しにいった操作は待たせない）。
  const markDown = (e) => {
    lastDownAt = e && e.timeStamp ? e.timeStamp : nowMs();
    if (armFrom && lastDownAt > armFrom && armUntil) {
      armUntil = 0;
      const ov = $("#overlay");
      if (ov) ov.classList.remove("arming");
    }
  };
  document.addEventListener("pointerdown", markDown, true);
  document.addEventListener("touchstart", markDown, { capture: true, passive: true });
  document.addEventListener(
    "click",
    (e) => {
      if (!isGhostClick(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true
  );

  // opening
  $("#screen-opening").addEventListener("pointerdown", () => {
    unlockAudio();
    finishOpening();
  });

  // title
  $("#btn-play").addEventListener("click", () => {
    unlockAudio();
    sfx.ui();
    const next = nextStageToPlay();
    if (!canPlayStage(next)) openProSheet();
    else openStage(next.id);
  });
  $("#btn-stages").addEventListener("click", () => {
    sfx.ui();
    nav("select");
  });
  $("#btn-daily").addEventListener("click", () => {
    sfx.ui();
    nav("daily");
  });
  $("#btn-ta").addEventListener("click", () => {
    sfx.ui();
    if (!canTimeAttack()) openProSheet();
    else openTaSheet();
  });
  $("#btn-howto").addEventListener("click", () => {
    sfx.ui();
    renderRules();
    openSheet("howto-sheet");
  });
  $("#btn-settings").addEventListener("click", () => {
    sfx.ui();
    nav("settings");
  });
  // 言語切替は「設定 > 言語」に一本化（Build 4 でホームの 🌐 チップを削除）
  $("#lang-close").addEventListener("click", () => closeSheet("lang-sheet"));
  $("#howto-close").addEventListener("click", () => closeSheet("howto-sheet"));
  $("#howto-ok").addEventListener("click", () => closeSheet("howto-sheet"));
  $("#howto-sheet").addEventListener("click", (e) => {
    if (e.target.id === "howto-sheet") closeSheet("howto-sheet");
  });
  $("#lang-sheet").addEventListener("click", (e) => {
    if (e.target.id === "lang-sheet") closeSheet("lang-sheet");
  });

  // back buttons
  $$("[data-back]").forEach((b) =>
    b.addEventListener("click", () => {
      sfx.ui();
      if (app.screen === "game") {
        stopTimeAttack();
        const mode = app.session ? app.session.mode : "stage";
        nav(mode === "daily" ? "daily" : "select");
      } else if (app.screen === "settings" || app.screen === "privacy") {
        nav("title");
      } else {
        nav("title");
      }
    })
  );
  $("#btn-back").addEventListener("click", () => {
    sfx.ui();
    stopTimeAttack();
    const mode = app.session ? app.session.mode : "stage";
    nav(mode === "daily" ? "daily" : "select");
  });

  // game
  $("#btn-retry").addEventListener("click", () => {
    sfx.ui();
    const s = app.session;
    if (!s) return;
    if (s.mode === "ta") {
      stopTimeAttack();
      $("#overlay").classList.remove("show");
      nav("title");
      return;
    }
    openStage(s.stage, { mode: s.mode, dailyKey: s.dailyKey });
  });
  $("#btn-hint").addEventListener("click", () => showHint());

  const board = $("#board");
  // タップは「押した瞬間」に反応させる（指を離すのを待たない）。
  // iOS では指の微動で pointerup が来ないことがあるので、押した時点で 1手を確定させる。
  board.addEventListener("pointerdown", (e) => {
    const cell = e.target.closest(".cell");
    if (!cell) return;
    unlockAudio();
    if (e.isPrimary === false) return;
    handledPointer = e.pointerId == null ? null : e.pointerId;
    tapCell(Number(cell.dataset.i));
  });
  // pointerdown を拾わなかった場合（古い WebView・検証用の合成イベント・指が外から入った等）
  board.addEventListener("pointerup", (e) => {
    if (handledPointer != null && e.pointerId === handledPointer) {
      handledPointer = null;
      return;
    }
    const cell = e.target.closest(".cell");
    if (!cell) return;
    tapCell(Number(cell.dataset.i));
  });
  // 最後の砦（支援技術・キーボード・click だけが来る環境）
  board.addEventListener("click", (e) => {
    const cell = e.target.closest(".cell");
    if (!cell) return;
    if (Date.now() - lastTapAt < 700) return; // pointerdown/up と二重にしない
    tapCell(Number(cell.dataset.i));
  });
  board.addEventListener("pointercancel", () => {
    handledPointer = null;
    $$(".cell.preview").forEach((c) => c.classList.remove("preview"));
  });
  // 指がマスとマスの間で離れても、押したマスの手は確定済み（何もしない）
  board.addEventListener("pointerleave", () => {});

  // daily
  $("#btn-daily-play").addEventListener("click", () => {
    unlockAudio();
    const today = dailyPuzzleFor(new Date());
    openStage(today, { mode: "daily", dailyKey: dateKey() });
  });

  // settings
  $("#tg-bgm").addEventListener("click", (e) => toggleSetting("bgm", e.currentTarget));
  $("#tg-se").addEventListener("click", (e) => toggleSetting("se", e.currentTarget));
  const voiceToggle = $("#tg-voice");
  if (voiceToggle) voiceToggle.addEventListener("click", (e) => toggleSetting("voice", e.currentTarget));
  $("#tg-haptics").addEventListener("click", (e) => toggleSetting("haptics", e.currentTarget));
  const sizeSeg = $("#text-size-seg");
  if (sizeSeg) {
    sizeSeg.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-size]");
      if (!b) return;
      sfx.ui();
      setTextSize(b.dataset.size);
    });
  }
  $("#row-lang").addEventListener("click", () => {
    renderLangSheet();
    openSheet("lang-sheet");
  });
  $("#row-pro").addEventListener("click", () => openProSheet());
  $("#row-restore").addEventListener("click", () => doRestore());
  $("#row-privacy").addEventListener("click", () => {
    renderSettings();
    nav("privacy");
  });

  // タイムアタックの時間選び
  const taClose = $("#ta-close");
  if (taClose) taClose.addEventListener("click", () => closeSheet("ta-sheet"));
  const taSheet = $("#ta-sheet");
  if (taSheet) {
    taSheet.addEventListener("click", (e) => {
      if (e.target.id === "ta-sheet") closeSheet("ta-sheet");
    });
  }

  // pro
  $("#pro-close").addEventListener("click", () => closeSheet("pro-sheet"));
  $("#pro-sheet").addEventListener("click", (e) => {
    if (e.target.id === "pro-sheet") closeSheet("pro-sheet");
  });
  $("#pro-buy").addEventListener("click", doPurchase);
  $("#pro-restore").addEventListener("click", doRestore);
  $("#btn-pro-from-select").addEventListener("click", () => openProSheet());

  // ライフサイクル: 裏に回ったら音を止め、戻ったら見た目と音を必ず戻す
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (app.ta) app.ta.paused = true;
      return;
    }
    if (app.ta) app.ta.paused = false;
    // 裏に回っている間にアニメが止まっていても、盤面と入力は生きている状態に戻す
    finishHop();
    if (app.session && app.screen === "game") {
      measureCells();
      paintBoard(app.session.game);
    }
  });

  // 画面の大きさ・向き・文字サイズが変わったらマスの位置を測り直す
  window.addEventListener("resize", () => {
    refreshBoardLayout();
    layoutHero();
  });
  window.addEventListener("orientationchange", () =>
    later(() => {
      refreshBoardLayout();
      layoutHero();
    }, 150)
  );

  // 見張り番: 見た目が固まっても、盤面と入力は必ず生きている状態に戻す
  setInterval(() => {
    // 透明なオーバーレイが残って次の画面のタップを食べていないか（実機の「固まった」対策）
    if (app.screen !== "game") {
      const ov0 = $("#overlay");
      if (ov0 && ov0.classList.contains("show")) ov0.classList.remove("show");
    }
    if (app.screen !== "game" || !app.session) return;
    const game = app.session.game;
    const ov = $("#overlay");
    // ゲーム中にオーバーレイが残っていたら畳む（モーダルは openTaSheet 等で開くので
    // ここでの対象はクリア/失敗カードだけ。TA 中は endTimeAttack のカードがあるので触らない）
    if (ov && ov.classList.contains("show") && game.status === "playing" && !app.ta) {
      ov.classList.remove("show");
    }
    // 決着したのにカードが出ていないなら、必ず出す（クリア/失敗の演出 0.6秒を待ってから）
    if (ov && !ov.classList.contains("show") && game.status !== "playing" && !app.ta) {
      if (Date.now() - lastTapAt > 1500) {
        if (game.status === "clear") showClear(game, false);
        else showFail(game);
      }
    }
    if (hopAnim && hopAnim.playState !== "running") {
      finishHop();
      placeToken(game);
    }
  }, 1200);
}

/* ---------------- デモ・検証用 API ---------------- */
function exposeApi() {
  window.kachi = {
    version: { marketing: VERSION, build: BUILD },
    ready: true,
    screen: () => app.screen,
    lang: () => app.lang,
    setLang: (c) => setLang(c),
    showTitle: () => nav("title"),
    showOpening: () => startOpening(),
    showSelect: () => nav("select"),
    showDaily: () => nav("daily"),
    showSettings: () => nav("settings"),
    showHowto: () => {
      if (app.screen !== "title" && app.screen !== "select" && app.screen !== "daily") nav("title");
      renderRules();
      openSheet("howto-sheet");
      return true;
    },
    showPrivacy: () => {
      renderSettings();
      nav("privacy");
    },
    openPro: () => openProSheet(),
    /** Build 5: シェア（検証・実画面用） */
    shareText: (kind, data) => shareTextFor(app.t, kind, data || {}),
    share: (kind, data) => shareResult(kind, data || {}),
    lastShare: () => app.lastShare,
    cardActions: () =>
      Array.from(document.querySelectorAll("#card-actions .btn")).map((b) => ({
        label: (b.textContent || "").trim(),
        cls: typeof b.className === "string" ? b.className : "",
      })),
    closeSheets: () => closeAllSheets(),
    openStage: (id) => openStage(id),
    openDaily: () => openStage(dailyPuzzleFor(new Date()), { mode: "daily", dailyKey: dateKey() }),
    openPast: (n = 1) => {
      const p = pastDailies(n, new Date())[n - 1];
      if (p) openStage(p.stage, { mode: "daily", dailyKey: p.key });
    },
    startTa: (seconds) => startTimeAttack(seconds),
    /** 検証用: タイムアタックを即終了させてリザルトカードを出す */
    endTa: () => endTimeAttack(),
    openTaSheet: () => openTaSheet(),
    taDurations: () => TA_DURATIONS.slice(),
    setPro: (v) => {
      store.setPro(!!v);
      renderTitle();
      renderSelect();
      renderSettings();
      return store.pro;
    },
    isPro: () => isPro(),
    tap: (i) => tapCell(i),
    hint: () => showHint(),
    playPv: async (opts = {}) => {
      const gap = opts.gap == null ? 480 : opts.gap;
      let guard = 0;
      while (app.session && app.session.game.status === "playing" && guard++ < 12) {
        const cell = app.session.game.pvMoveForCurrent() ?? app.session.game.hint();
        if (cell == null) break;
        const ok = await tapCell(cell);
        if (!ok) break;
        await wait(gap);
      }
      return app.session ? app.session.game.status : null;
    },
    state: () => {
      const s = app.session;
      if (!s) return null;
      return {
        mode: s.mode,
        id: s.stage.id,
        par: s.stage.par,
        movesUsed: s.game.movesUsed,
        remaining: s.game.remaining,
        status: s.game.status,
        tanuki: cellKey(s.game.state.pos),
        traps: bits(s.game.state.traps).map(cellKey),
        history: s.game.history.map((h) => ({ cell: cellKey(h.cell), tanuki: h.tanukiTo == null ? null : cellKey(h.tanukiTo) })),
      };
    },
    taState: () => (app.ta ? { score: app.ta.score, left: Math.ceil(app.ta.left / 1000), running: app.ta.running, duration: app.ta.duration } : null),
    counts: () => ({
      stages: STAGES.length,
      daily: DAILY.length,
      freeStages: STAGES.filter((s) => canPlayStage(s, false)).length,
      dailyToday: dailyIndexFor(new Date()),
    }),
    busy: () => false,
    /** 検証用: マスの位置の測り直し（向き・文字サイズ変更の再現） */
    relayout: () => {
      refreshBoardLayout();
      return cellGeom ? cellGeom.cells.length : 0;
    },
    layout: () => {
      const wrap = $("#board-wrap");
      const w = wrap ? wrap.getBoundingClientRect() : { width: 0 };
      return { cells: cellGeom ? cellGeom.cells.length : 0, width: Math.round(w.width) };
    },
    /* ---- 設定・音・ボイス（検査用） ---- */
    textSize: () => normalizeTextSize(store.settings.textSize),
    setTextSize: (v) => {
      setTextSize(v);
      return normalizeTextSize(store.settings.textSize);
    },
    audio: () => audioDebug(),
    /** iOS の interrupted などを再現する（E2E 用） */
    forceAudioState: (state) => {
      window.__kachiAudioForceState = state || null;
      return audioDebug();
    },
    recoverAudio: () => recoverAudio(),
    /** 画面を裏に回して戻すのを再現（visibilitychange → 復帰） */
    simulateBackgroundReturn: async () => {
      suspendAudio();
      await wait(60);
      await recoverAudio();
      return audioDebug();
    },
    voice: (who, situation) => voiceFor(app.lang, who, situation),
    playVoice: (who, situation, opts = {}) => {
      const v = voiceFor(app.lang, who, situation || "start");
      if (v) playClip(v.url, { who, delay: opts.delay || 0 });
      return v ? { ...v, who } : null;
    },
    voices: () => allVoiceUrls(app.lang),
    note: () => ({
      text: $("#note-text") ? $("#note-text").textContent : "",
      tanuki: app.t("char.tanuki"),
    }),
  };
}

/* ---------------- init ---------------- */
async function init() {
  app.lang = detectLang();
  app.t = makeT(app.lang);
  document.documentElement.lang = app.lang;
  const dev = devUnlock();
  applyTextSize(store.settings.textSize);
  applyI18n();
  buildMiniDiagrams();
  bind();
  renderTitle();
  renderRules();
  renderSettings();
  renderLangSheet();
  renderProSheet();
  exposeApi();
  bootAudio();
  // 声は先に読み込んでおく（最初のタップから間を空けずに鳴らす）
  try {
    preloadVoices(allVoiceUrls(app.lang));
  } catch {}
  layoutHero();
  if (dev) {
    renderSelect();
  }
  startOpening();

  // PRO の権利を静かに確認（プラグインがあるときだけ）
  if (isStoreAvailable()) {
    const r = await refreshEntitlement();
    if (r.entitled) {
      renderTitle();
      renderSettings();
      renderSelect();
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  init().catch((e) => {
    console.error("init failed", e);
  });
});
