/* ============================================================
   Kachi Kachi Catch — Build 1 controller
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
import { store } from "./storage.js";
import {
  sfx,
  unlockAudio,
  startBgm,
  stopBgm,
  suspendAudio,
  resumeAudio,
  applySettings,
} from "./audio.js";
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
const BUILD = 1;

const app = {
  screen: "opening",
  lang: "ja",
  t: makeT("ja"),
  session: null, // {mode, stage, game, dailyKey}
  busy: false,
  ta: null,
  product: null,
};

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

/* ---------------- ポコ丸のセリフ ---------------- */
function setNote(key, mood = "") {
  $("#note-text").textContent = app.t(key);
  const note = $("#note");
  note.classList.toggle("panic", mood === "panic");
  note.classList.toggle("happy", mood === "happy");
}
function reactNote(game) {
  const opts = bits(tanukiOptionsMask(game.state.traps, game.state.pos, game.geom)).length;
  if (opts <= 2) setNote(["note.panic1", "note.panic2", "note.panic3"][Math.floor(Math.random() * 3)], "panic");
  else setNote(["note.taunt1", "note.taunt2", "note.taunt3"][Math.floor(Math.random() * 3)]);
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
  $("#hero-tag").textContent = t("app.tagline");
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
  setNote("note.start", "");
  requestAnimationFrame(() => {
    paintBoard(game);
    const tanuki = $("#tanuki");
    tanuki.classList.remove("sweating", "caught", "wobble");
    const size = tokenSize();
    const c = cellCenter(game.state.pos);
    const x = c.x + (c.s - size) / 2;
    const y = c.y + (c.s - size) / 2;
    tanuki.animate(
      [
        { transform: `translate(${x}px,${y}px) scale(.2)`, opacity: 0 },
        { transform: `translate(${x}px,${y}px) scale(1)`, opacity: 1 },
      ],
      { duration: 380, easing: "cubic-bezier(.34,1.56,.5,1)" }
    );
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
async function tapCell(i) {
  const s = app.session;
  if (!s || app.busy || s.game.status !== "playing") return false;
  const game = s.game;
  if (!game.canTap(i)) {
    if (i === game.state.pos) showToast(app.t("game.cellBlocked", { name: app.t("char.tanuki") }));
    return false;
  }
  app.busy = true;
  finishHop();
  clearHint();
  usagiroSwing(i);
  const result = game.play(i);
  if (!result) {
    app.busy = false;
    return false;
  }
  sfx.flip();
  await flipAnimation(result.flipped, game);
  $("#hud-moves").textContent = String(game.remaining);
  if (game.remaining <= 1) $("#hud-moves-wrap").classList.add("low");

  if (result.caught) {
    setNote("note.caught", "happy");
    await onCaught(game, i);
    app.busy = false;
    return true;
  }

  const tanuki = $("#tanuki");
  tanuki.classList.add("sweating", "wobble");
  sfx.sweat();
  await wait(170);
  if (result.tanukiTo != null) await hop(game, result.tanukiFrom, result.tanukiTo);
  paintBoard(game);
  tanuki.classList.remove("sweating", "wobble");
  reactNote(game);

  if (s.mode === "ta") {
    if (result.outOfMoves) {
      haptics.warning();
      sfx.fail();
      app.busy = false;
      taPenalty();
      return true;
    }
  } else if (result.outOfMoves) {
    await wait(180);
    setNote("note.failed", "panic");
    haptics.warning();
    sfx.fail();
    showFail(game);
  }
  app.busy = false;
  return true;
}

async function onCaught(game, cellIdx) {
  const tanuki = $("#tanuki");
  tanuki.classList.add("caught");
  sfx.catch_();
  haptics.success();
  spawnSparks(cellIdx);
  const s = app.session;
  if (s.mode === "ta") {
    await wait(240);
    taScore();
    return;
  }
  await wait(720);
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
  setTimeout(clearHint, 2600);
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
const TA_SECONDS = 60;
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

function startTimeAttack() {
  if (!canTimeAttack()) {
    openProSheet();
    return;
  }
  $("#overlay").classList.remove("show");
  app.ta = { left: TA_SECONDS * 1000, score: 0, index: 0, timer: null, running: true, pool: taPool() };
  openTaPuzzle();
  app.ta.timer = setInterval(taTick, 100);
}

function openTaPuzzle() {
  const ta = app.ta;
  if (!ta) return;
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
  setNote("note.start", "");
  requestAnimationFrame(() => {
    paintBoard(app.session.game);
    const size = tokenSize();
    const c = cellCenter(app.session.game.state.pos);
    $("#tanuki").classList.remove("caught", "sweating", "wobble");
    $("#tanuki").animate(
      [
        { transform: `translate(${c.x + (c.s - size) / 2}px,${c.y + (c.s - size) / 2}px) scale(.2)`, opacity: 0 },
        { transform: `translate(${c.x + (c.s - size) / 2}px,${c.y + (c.s - size) / 2}px) scale(1)`, opacity: 1 },
      ],
      { duration: 300, easing: "ease-out" }
    );
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
  setTimeout(() => {
    if (ta.running) openTaPuzzle();
  }, 420);
}

function taPenalty() {
  const ta = app.ta;
  if (!ta) return;
  ta.left = Math.max(0, ta.left - TA_PENALTY * 1000);
  showToast(`−${TA_PENALTY}s`);
  setNote("note.failed", "panic");
  setTimeout(() => {
    if (ta.running) openTaPuzzle();
  }, 420);
}

function endTimeAttack() {
  const ta = app.ta;
  if (!ta) return;
  ta.running = false;
  clearInterval(ta.timer);
  sfx.timeUp();
  const best = store.taBest;
  const isNew = store.setTaBest(ta.score);
  const t = app.t;
  $("#card-img").innerHTML = `<img src="assets/tanuki_face.png" class="tanuki-img" alt="" />`;
  $("#card-title").textContent = t("ta.title");
  $("#card-text").innerHTML = `${t("ta.result", { n: ta.score })}<br>${t("ta.best")} ${Math.max(best, ta.score)}${isNew ? " ・ " + t("ta.newBest") : ""}`;
  const actions = $("#card-actions");
  actions.innerHTML = "";
  actions.appendChild(cardButton(t("ta.again"), "", "", () => {
    $("#overlay").classList.remove("show");
    startTimeAttack();
  }));
  actions.appendChild(cardButton(t("common.back"), "", "ghost", () => {
    $("#overlay").classList.remove("show");
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
function renderSettings() {
  const t = app.t;
  const s = store.settings;
  $("#tg-bgm").classList.toggle("on", s.bgm !== false);
  $("#tg-se").classList.toggle("on", s.se !== false);
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
}

/* ---------------- PRO ---------------- */
function renderProSheet() {
  const t = app.t;
  $("#pro-title").textContent = t("pro.title", { app: t("app.title") });
  $("#pro-lead").textContent = t("pro.lead");
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
    else startTimeAttack();
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
    if (!s || s.game.status !== "playing" || app.busy) return;
    const i = Number(cell.dataset.i);
    if (!s.game.canTap(i)) return;
    for (const c of s.game.previewCells(i)) board.children[c].classList.add("preview");
  });
  board.addEventListener("pointerup", (e) => {
    const cell = e.target.closest(".cell");
    $$(".cell.preview").forEach((c) => c.classList.remove("preview"));
    if (!cell) return;
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
  $("#tg-haptics").addEventListener("click", (e) => toggleSetting("haptics", e.currentTarget));
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

  // pro
  $("#pro-close").addEventListener("click", () => closeSheet("pro-sheet"));
  $("#pro-sheet").addEventListener("click", (e) => {
    if (e.target.id === "pro-sheet") closeSheet("pro-sheet");
  });
  $("#pro-buy").addEventListener("click", doPurchase);
  $("#pro-restore").addEventListener("click", doRestore);
  $("#btn-pro-from-select").addEventListener("click", () => openProSheet());

  // ライフサイクル: バックグラウンドで BGM 停止
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      suspendAudio();
      if (app.ta) app.ta.paused = true;
    } else {
      resumeAudio();
      if (app.ta) app.ta.paused = false;
    }
  });
  const cap = window.Capacitor;
  if (cap && cap.Plugins && cap.Plugins.App) {
    try {
      cap.Plugins.App.addListener("appStateChange", ({ isActive }) => {
        if (isActive) resumeAudio();
        else suspendAudio();
      });
    } catch {}
  }
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
    startTa: () => startTimeAttack(),
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
    taState: () => (app.ta ? { score: app.ta.score, left: Math.ceil(app.ta.left / 1000), running: app.ta.running } : null),
    counts: () => ({
      stages: STAGES.length,
      daily: DAILY.length,
      freeStages: STAGES.filter((s) => canPlayStage(s, false)).length,
      dailyToday: dailyIndexFor(new Date()),
    }),
    busy: () => app.busy,
  };
}

/* ---------------- init ---------------- */
async function init() {
  app.lang = detectLang();
  app.t = makeT(app.lang);
  document.documentElement.lang = app.lang;
  const dev = devUnlock();
  applyI18n();
  buildMiniDiagrams();
  bind();
  renderTitle();
  renderRules();
  renderSettings();
  renderLangSheet();
  renderProSheet();
  exposeApi();
  applySettings();
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
