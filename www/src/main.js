/* ============================================================
   Kachi Kachi Catch — Build 2 controller
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
  audioDebug,
} from "./audio.js";
import { voiceFor } from "./voices.js";
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
} from "./pro.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const VERSION = "1.0.0";
const BUILD = 2;
/** タップ1回のロックが続く最大時間。これを過ぎたら「古いロック」とみなして解除する */
const TAP_LOCK_MS = 2200;

const app = {
  screen: "opening",
  lang: "ja",
  t: makeT("ja"),
  session: null, // {mode, stage, game, dailyKey}
  busy: false,
  busySince: 0,
  epoch: 0,
  timers: new Set(),
  ta: null,
  product: null,
};

/* ---------------- 操作ロックの安全装置 ---------------- */
/**
 * ステージを移るとき・画面を離れるときに、進行中のアニメーションとタイマーを
 * すべて捨ててロックを解除する。ここが漏れると「マスが押せない」状態になる。
 */
function resetInteraction() {
  app.epoch += 1;
  clearLater();
  app.busy = false;
  app.busySince = 0;
  finishHop();
  stopVoice();
  $$(".cell.preview, .cell.hint").forEach((c) => c.classList.remove("preview", "hint"));
  $$("#board .cell.flip, #board .cell.netted").forEach((c) => c.classList.remove("flip", "netted"));
  const usa = $("#usagiro");
  if (usa) usa.classList.remove("swing");
  const tanuki = $("#tanuki");
  if (tanuki) tanuki.classList.remove("sweating", "wobble", "caught");
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
function speak(who, situation) {
  try {
    const v = voiceFor(app.lang, who, situation);
    if (v) playClip(v.url);
  } catch {}
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
}

function applyI18n(root = document) {
  const t = app.t;
  $$("[data-i18n]", root).forEach((el) => {
    const key = el.getAttribute("data-i18n");
    el.textContent = t(key);
  });
}

/* ---------------- 画面遷移 ---------------- */
function nav(screen) {
  if (screen !== "game") {
    // ゲーム画面を離れたら、進行中の手・タイマー・ロックを全部たたむ
    if (app.ta) stopTimeAttack();
    if (app.screen === "game") resetInteraction();
  }
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
  const board = $("#board");
  const wrap = $("#board-wrap");
  const cell = board.children[boardIdx];
  const wrapRect = wrap.getBoundingClientRect();
  const r = cell.getBoundingClientRect();
  return {
    x: r.left - wrapRect.left,
    y: r.top - wrapRect.top,
    s: r.width,
  };
}

function tokenSize() {
  const el = $("#tanuki");
  return el.getBoundingClientRect().width || 56;
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
  $(".meter").classList.toggle("danger", total <= 2);
  $("#meter-label").textContent = app.t("stage.escape", { name: app.t("char.tanuki") });
}

/* ---------------- アニメーション ---------------- */
let hopAnim = null;

function setTokenTransform(x, y, scale = 1) {
  $("#tanuki").style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
}

async function hop(game, from, to) {
  const tanuki = $("#tanuki");
  const size = tokenSize();
  const a = cellCenter(from);
  const b = cellCenter(to);
  const ax = a.x + (a.s - size) / 2;
  const ay = a.y + (a.s - size) / 2;
  const bx = b.x + (b.s - size) / 2;
  const by = b.y + (b.s - size) / 2;
  setTokenTransform(ax, ay);
  sfx.hop();
  haptics.hop();
  puff(ax, ay, size);
  const dx = bx - ax;
  const dy = by - ay;
  if (hopAnim) {
    try {
      hopAnim.cancel();
    } catch {}
  }
  hopAnim = tanuki.animate(
    [
      { transform: `translate(${ax}px,${ay}px) scale(1,1)` },
      { transform: `translate(${ax + dx * 0.28}px,${ay + dy * 0.28 - size * 0.42}px) scale(.94,1.1)`, offset: 0.3 },
      { transform: `translate(${ax + dx * 0.62}px,${ay + dy * 0.62 - size * 0.5}px) scale(1.06,.94)`, offset: 0.62 },
      { transform: `translate(${bx}px,${by}px) scale(1,1)` },
    ],
    { duration: 340, easing: "cubic-bezier(.32,.9,.36,1)" }
  );
  try {
    await hopAnim.finished;
  } catch {}
  hopAnim = null;
  setTokenTransform(bx, by);
  puff(bx, by, size);
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
  for (let k = 0; k < 3; k++) {
    const d = document.createElement("div");
    d.className = "dustpuff";
    d.style.left = x + size / 2 - 8 + (k - 1) * 9 + "px";
    d.style.top = y + size - 10 + (k % 2) * 4 + "px";
    d.style.animationDelay = k * 40 + "ms";
    fx.appendChild(d);
    setTimeout(() => d.remove(), 600);
  }
}

/** ウサギローがタップ位置に現れて木槌をポン（0.3秒・連打を止めない） */
function usagiroSwing(cellIdx) {
  const el = $("#usagiro");
  const c = cellCenter(cellIdx);
  const size = el.getBoundingClientRect().width || 40;
  const x = c.x + (c.s - size) / 2;
  const y = c.y + (c.s - size) / 2;
  el.style.setProperty("--pos", `translate(${x}px, ${y}px)`);
  el.classList.remove("swing");
  void el.offsetWidth;
  el.classList.add("swing");
  sfx.mallet();
  haptics.flip();
  setTimeout(() => el.classList.remove("swing"), 340);
}

async function flipAnimation(cells, game) {
  const board = $("#board");
  cells.forEach((i, k) => {
    if (game.geom.walls[i]) return;
    setTimeout(() => {
      const cell = board.children[i];
      cell.classList.add("flip", "netted");
      setTimeout(() => cell.classList.remove("flip", "netted"), 320);
    }, k * 26);
  });
  await wait(26 * cells.length + 130);
  paintBoard(game);
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
function tanukiSpeak(situation, mood = "") {
  const v = voiceFor(app.lang, "pokomaru", situation);
  setNote((v && NOTE_KEY_FOR_VOICE[v.key]) || "note.start", mood);
  if (v) playClip(v.url);
}

function reactNote(game) {
  const opts = bits(tanukiOptionsMask(game.state.traps, game.state.pos, game.geom)).length;
  if (opts <= 2) tanukiSpeak("panic", "panic");
  else tanukiSpeak("taunt");
}

/* ---------------- タイトル ---------------- */
function nextStageToPlay() {
  return STAGES.find((s) => !store.isCleared(s.id)) || STAGES[0];
}
function renderTitle() {
  const t = app.t;
  const cleared = store.clearCount(STAGES.map((s) => s.id));
  $("#credit-line").textContent = `${t("stage.progress", { a: cleared, b: STAGES.length })} ・ ${t("menu.daily")}`;
  $("#lang-chip").textContent = (LANGS.find((l) => l.code === app.lang) || LANGS[0]).label;
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
  speak("usagiro", "start");
  requestAnimationFrame(() => {
    if (epoch !== app.epoch) return; // もう別のステージに移っている
    paintBoard(game);
    const tanuki = $("#tanuki");
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
        { duration: 380, easing: "cubic-bezier(.34,1.56,.5,1)" }
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
 * 1手打つ。
 * - app.busy は try/finally と epoch（ステージ世代）で必ず戻す
 * - ステージを移ったあとの古い処理は何もしないで抜ける
 * - 音・アニメーションが失敗してもゲームは止めない
 * これで「1ステージごとにマスが押せなくなる」状態を作らない。
 */
async function tapCell(i) {
  const s = app.session;
  if (!s || s.game.status !== "playing") return false;
  if (app.busy) {
    // 進行中のタップがある。長く続いている（＝古いロック）なら解除して進む
    if (Date.now() - app.busySince < TAP_LOCK_MS) return false;
    app.busy = false;
  }
  const game = s.game;
  if (!game.canTap(i)) {
    if (i === game.state.pos) showToast(app.t("game.cellBlocked", { name: app.t("char.tanuki") }));
    return false;
  }
  const epoch = app.epoch;
  app.busy = true;
  app.busySince = Date.now();
  try {
    finishHop();
    clearHint();
    usagiroSwing(i);
    speak("usagiro", "tap");
    const result = game.play(i);
    if (!result) return false;
    sfx.flip();
    await flipAnimation(result.flipped, game);
    if (epoch !== app.epoch) return false;
    $("#hud-moves").textContent = String(game.remaining);
    if (game.remaining <= 1) $("#hud-moves-wrap").classList.add("low");

    if (result.caught) {
      await onCaught(game, i, epoch);
      return true;
    }

    const tanuki = $("#tanuki");
    tanuki.classList.add("sweating", "wobble");
    sfx.sweat();
    await wait(170);
    if (epoch !== app.epoch) return false;
    if (result.tanukiTo != null) await hop(game, result.tanukiFrom, result.tanukiTo);
    if (epoch !== app.epoch) return false;
    paintBoard(game);
    tanuki.classList.remove("sweating", "wobble");
    reactNote(game);

    if (s.mode === "ta") {
      if (result.outOfMoves) {
        haptics.warning();
        sfx.fail();
        app.busy = false;
        app.busySince = 0;
        taPenalty();
        return true;
      }
    } else if (result.outOfMoves) {
      await wait(180);
      if (epoch !== app.epoch) return false;
      tanukiSpeak("escape", "panic");
      speak("usagiro", "fail");
      haptics.warning();
      sfx.fail();
      showFail(game);
    }
    return true;
  } catch (e) {
    // 何が起きても操作を止めない（音・アニメーションの失敗を含む）
    console.warn("tap failed:", e);
    return false;
  } finally {
    if (epoch === app.epoch) {
      app.busy = false;
      app.busySince = 0;
    }
  }
}

async function onCaught(game, cellIdx, epoch) {
  const tanuki = $("#tanuki");
  tanuki.classList.add("caught");
  speak("usagiro", "clear");
  tanukiSpeak("caught", "happy");
  sfx.catch_();
  haptics.success();
  spawnSparks(cellIdx);
  const s = app.session;
  if (s.mode === "ta") {
    await wait(240);
    if (epoch !== app.epoch) return;
    taScore();
    return;
  }
  await wait(720);
  if (epoch !== app.epoch) return;
  spawnConfetti();
  sfx.stageClear();
  if (s.mode === "daily" && s.dailyKey) store.markDailyCleared(s.dailyKey);
  const isNew = s.mode === "stage" ? store.markCleared(game.stage.id) : false;
  showClear(game, isNew);
}

/* ---------------- ヒント ---------------- */
function clearHint() {
  $$(".cell.hint").forEach((c) => c.classList.remove("hint"));
}
function showHint() {
  const s = app.session;
  if (!s || s.game.status !== "playing" || app.busy) return null;
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

/* ---------------- クリア / 失敗カード ---------------- */
function cardButton(label, sub, cls, onClick) {
  const b = document.createElement("button");
  b.className = "btn" + (cls ? " " + cls : "");
  b.innerHTML = sub ? `<span class="btn-main">${label}</span><span class="btn-sub">${sub}</span>` : `<span class="btn-main">${label}</span>`;
  b.addEventListener("click", onClick);
  return b;
}

function showClear(game, isNew) {
  const t = app.t;
  const stage = game.stage;
  const perfect = game.movesUsed === stage.par;
  $("#card-img").innerHTML = `<img src="assets/rabbit_face.png" alt="" />`;
  $("#card-title").textContent = t("game.clearTitle");
  $("#card-text").textContent = `${t("game.clearText", { n: game.movesUsed })}${perfect ? " " + t("game.clearPerfect") : ""}`;
  const actions = $("#card-actions");
  actions.innerHTML = "";
  const s = app.session;
  const idx = STAGES.indexOf(stage);
  const next = s.mode === "stage" && idx >= 0 ? STAGES[idx + 1] : null;
  if (next) {
    const playable = canPlayStage(next);
    actions.appendChild(
      cardButton(t("game.next"), t("stage.stageNo", { n: next.index }), "", () => (playable ? openStage(next.id) : openProSheet()))
    );
  }
  actions.appendChild(cardButton(t("game.again"), "", "ghost", () => openStage(stage.id, { mode: s.mode, dailyKey: s.dailyKey })));
  actions.appendChild(cardButton(t("game.choose"), "", "ghost", () => nav(s.mode === "daily" ? "daily" : "select")));
  $("#overlay").classList.add("show");
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
    paintBoard(app.session.game);
    const size = tokenSize();
    const c = cellCenter(app.session.game.state.pos);
    const tanuki = $("#tanuki");
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
  openingTimer = setTimeout(finishOpening, 1900);
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
  $("#btn-lang").addEventListener("click", () => {
    sfx.ui();
    renderLangSheet();
    openSheet("lang-sheet");
  });
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
  board.addEventListener("pointerdown", (e) => {
    const cell = e.target.closest(".cell");
    if (!cell) return;
    unlockAudio();
    const s = app.session;
    // 古いロックが残っていてもここで掃除する（押せないままにしない）
    if (app.busy && Date.now() - app.busySince > TAP_LOCK_MS) {
      app.busy = false;
      app.busySince = 0;
    }
    if (!s || s.game.status !== "playing" || app.busy) return;
    const i = Number(cell.dataset.i);
    if (!s.game.canTap(i)) return;
    for (const c of s.game.previewCells(i)) board.children[c].classList.add("preview");
  });
  board.addEventListener("pointerup", (e) => {
    const cell = e.target.closest(".cell");
    $$(".cell.preview").forEach((c) => c.classList.remove("preview"));
    if (!cell) return;
    app.lastPointerTap = Date.now();
    tapCell(Number(cell.dataset.i));
  });
  // iOS では pointerup が来ないまま終わることがあるので touch でも拾う
  board.addEventListener("click", (e) => {
    const cell = e.target.closest(".cell");
    if (!cell) return;
    if (Date.now() - (app.lastPointerTap || 0) < 400) return; // pointerup と二重にしない
    tapCell(Number(cell.dataset.i));
  });
  board.addEventListener("pointercancel", () => $$(".cell.preview").forEach((c) => c.classList.remove("preview")));
  board.addEventListener("pointerleave", () => $$(".cell.preview").forEach((c) => c.classList.remove("preview")));

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

  // ライフサイクル: タブが隠れたらタイマーを止めるだけ（音の復帰は audio.js が面倒を見る）
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (app.ta) app.ta.paused = true;
    } else if (app.ta) {
      app.ta.paused = false;
    }
  });
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
    closeSheets: () => closeAllSheets(),
    openStage: (id) => openStage(id),
    openDaily: () => openStage(dailyPuzzleFor(new Date()), { mode: "daily", dailyKey: dateKey() }),
    openPast: (n = 1) => {
      const p = pastDailies(n, new Date())[n - 1];
      if (p) openStage(p.stage, { mode: "daily", dailyKey: p.key });
    },
    startTa: (seconds) => startTimeAttack(seconds),
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
    busy: () => app.busy,
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
    playVoice: (who, situation) => {
      speak(who, situation);
      return audioDebug();
    },
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
