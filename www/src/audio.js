/**
 * WebAudio の効果音・BGM・ボイス。
 *
 * iOS の WKWebView はホーム画面へ行って戻ると AudioContext が
 * suspended / interrupted のままになり、そのままでは音が戻らない。
 * そのため
 *   - 復帰（visibilitychange / pageshow / focus / appStateChange）で必ず起こし直す
 *   - 次のタップでも state が running でなければ起こし直す
 *   - それでも戻らない（interrupted など）ときは AudioContext を作り直す
 * という3段構えにしている。効果音・ボイスは絶対に例外を投げない
 * （音が出ないだけで、ゲームの操作が止まってはいけない）。
 */
import { store } from "./storage.js";

let ctx = null;
let master = null;
let bgmGain = null;
let sfxGain = null;
let voiceGain = null;
let bgmTimer = null;
let step = 0;
let nextTime = 0;
let bgmOn = false;
let generation = 0;
let building = false;
// 一度でも「鳴っている」状態になったことがあるか。
// まだのとき（オートプレイ制限で suspended のまま）は作り直さず、最初のタップを待つ。
let everRan = false;
let lastRecoverAt = 0;

let voiceStarts = 0;
let voiceStops = 0;
let lastVoice = null;
let lastVoiceError = null;
let nativeVoice = false;
const clipCache = new Map(); // `${generation}|${url}` -> AudioBuffer
/** 話者ごとの再生中の声。who -> {src, audio} */
const voiceNodes = new Map();
const voiceAudios = new Map();
let voiceEndTimer = null;
let duckTimer = null;

function activeVoiceCount() {
  return voiceNodes.size + voiceAudios.size;
}

/** Capacitor のネイティブ音声プラグイン（iOS 実機のときだけある） */
function nativeAudio() {
  const cap = typeof window !== "undefined" ? window.Capacitor : null;
  return cap && cap.Plugins && cap.Plugins.KachiAudio ? cap.Plugins.KachiAudio : null;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- 状態 ---------------- */

/** テスト用の差し込み（iOS の interrupted を再現する）。通常は null。 */
function forcedState() {
  if (typeof window === "undefined") return null;
  return window.__kachiAudioForceState || null;
}

/** いまの AudioContext の状態（テストの差し込みがあればそちら） */
export function audioState() {
  const forced = forcedState();
  if (forced) return forced;
  return ctx ? ctx.state : "none";
}

export function audioDebug() {
  return {
    state: audioState(),
    generation,
    bgm: bgmOn && !!bgmTimer,
    voice: activeVoiceCount() > 0,
    voiceStarts,
    voiceStops,
    lastVoice,
    lastVoiceError,
    nativeVoice,
    bgmGain: bgmGain ? Math.round(bgmGain.gain.value * 1000) / 1000 : null,
    voices: Array.from(voiceNodes.keys()).concat(Array.from(voiceAudios.keys())),
    clips: clipCache.size,
  };
}

function gainFor(name) {
  if (name === "bgm") return store.settings.bgm === false ? 0 : 0.3;
  // 声は BGM・効果音より一段大きく（埋もれないように）
  if (name === "voice") return store.settings.voice === false ? 0 : 1;
  return store.settings.se === false ? 0 : 0.42;
}

/** AudioContext を作る（作り直しにも使う） */
function build() {
  const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;
  building = true;
  try {
    if (ctx) {
      try {
        ctx.close();
      } catch {}
    }
    ctx = new AC();
    generation += 1;
    clipCache.clear();
    voiceNodes.clear();
    // テスト用の差し込みは「新しい AudioContext を作った」時点で解除する
    if (typeof window !== "undefined" && window.__kachiAudioForceState) {
      try {
        window.__kachiAudioForceState = null;
      } catch {}
    }
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    sfxGain = ctx.createGain();
    sfxGain.gain.value = gainFor("se");
    sfxGain.connect(master);
    bgmGain = ctx.createGain();
    bgmGain.gain.value = gainFor("bgm");
    bgmGain.connect(master);
    voiceGain = ctx.createGain();
    voiceGain.gain.value = gainFor("voice");
    voiceGain.connect(master);
    ctx.onstatechange = () => {
      if (ctx && ctx.state === "running") everRan = true;
    };
    return ctx;
  } catch {
    ctx = null;
    return null;
  } finally {
    building = false;
  }
}

/** 使える AudioContext を返す（無ければ作り、止まっていれば起こす） */
function ensure() {
  if (building) return ctx;
  if (!ctx || audioState() === "closed") build();
  if (!ctx) return null;
  if (audioState() !== "running" && !forcedState()) nudge();
  return ctx;
}

/** resume を投げるだけ投げる（結果は待たない） */
function nudge() {
  if (!ctx) return;
  try {
    const p = ctx.resume();
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch {}
}

/**
 * 音を必ず戻す。suspended なら resume、それで戻らなければ作り直す。
 * @returns {Promise<boolean>} 鳴らせる状態になったか
 */
export async function recoverAudio() {
  const now = Date.now();
  if (now - lastRecoverAt < 250 && !forcedState()) return audioState() === "running";
  lastRecoverAt = now;
  if (!ctx) {
    if (!build()) return false;
  }
  if (audioState() === "running") {
    everRan = true;
    restartBgmIfNeeded();
    return true;
  }
  if (!forcedState()) {
    try {
      await Promise.race([Promise.resolve(ctx.resume()), wait(260)]);
    } catch {}
    if (audioState() === "running") {
      everRan = true;
      restartBgmIfNeeded();
      return true;
    }
  }
  // まだ一度も鳴っていない（最初のタップ前）なら、作り直しても鳴らないので待つ
  if (!everRan && !forcedState()) return false;
  // resume では戻らない（iOS の interrupted / closed）→ 作り直す
  const wasBgm = bgmOn || store.settings.bgm !== false;
  stopBgmTimer();
  if (!build()) return false;
  if (wasBgm) {
    bgmOn = true;
    startBgmTimer();
  }
  try {
    await Promise.race([Promise.resolve(ctx.resume()), wait(260)]);
  } catch {}
  if (audioState() === "running") everRan = true;
  return audioState() === "running";
}

export function unlockAudio() {
  if (!ctx) build();
  // タップと同じ瞬間に resume を投げる（iOS はここでしか起きない）
  if (ctx && audioState() !== "running") nudge();
  else if (ctx && audioState() === "running") everRan = true;
  if (ctx && audioState() !== "running") recoverAudio();
  // iOS は操作のたびに AudioSession を起こし直すと安定する（AppDelegate 側）
  const cap = window.Capacitor;
  if (cap && cap.Plugins && cap.Plugins.KachiAudio) {
    try {
      const r = cap.Plugins.KachiAudio.activate();
      if (r && typeof r.catch === "function") r.catch(() => {});
    } catch {}
  }
}

export function applySettings() {
  const s = store.settings;
  if (sfxGain) sfxGain.gain.value = gainFor("se");
  if (bgmGain) bgmGain.gain.value = gainFor("bgm");
  if (voiceGain) voiceGain.gain.value = gainFor("voice");
  if (s.bgm === false) stopBgm();
  else if (!bgmTimer) startBgm();
  if (s.voice === false) stopVoice();
}

/* ---------------- 効果音 ---------------- */

function tone({ freq = 440, type = "sine", dur = 0.12, gain = 0.25, delay = 0, slide = null, attack = 0.005, bus = null }) {
  try {
    const c = ensure();
    if (!c) return;
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide != null) osc.frequency.exponentialRampToValueAtTime(Math.max(30, slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, gain), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(bus || sfxGain || master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  } catch {}
}

function noise({ dur = 0.18, gain = 0.18, delay = 0, filter = 1200, bus = null }) {
  try {
    const c = ensure();
    if (!c) return;
    const t0 = c.currentTime + delay;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
    const src = c.createBufferSource();
    src.buffer = buf;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = filter;
    bp.Q.value = 0.8;
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(bp);
    bp.connect(g);
    g.connect(bus || sfxGain || master);
    src.start(t0);
  } catch {}
}

export const sfx = {
  ui() {
    tone({ freq: 660, type: "sine", dur: 0.05, gain: 0.09 });
  },
  tap() {
    tone({ freq: 720, type: "triangle", dur: 0.05, gain: 0.1 });
  },
  /** 十字反転（タップした瞬間） */
  flip() {
    for (let i = 0; i < 4; i++) {
      tone({ freq: 380 + i * 55, type: "square", dur: 0.04, gain: 0.05, delay: i * 0.022 });
    }
    noise({ dur: 0.09, gain: 0.06, filter: 2400 });
  },
  /** ウサギローの木槌「ポンッ」 */
  mallet() {
    tone({ freq: 210, type: "sine", dur: 0.11, gain: 0.22, slide: 120 });
    noise({ dur: 0.08, gain: 0.12, filter: 900 });
    tone({ freq: 940, type: "triangle", dur: 0.05, gain: 0.07, delay: 0.01 });
  },
  hop() {
    tone({ freq: 500, type: "sine", dur: 0.09, gain: 0.14, slide: 900 });
    noise({ dur: 0.06, gain: 0.05, filter: 1800 });
  },
  sweat() {
    tone({ freq: 300, type: "triangle", dur: 0.14, gain: 0.09, slide: 210 });
  },
  catch_() {
    [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, type: "triangle", dur: 0.2, gain: 0.18, delay: i * 0.085 }));
    tone({ freq: 1568, type: "sine", dur: 0.45, gain: 0.1, delay: 0.36 });
    noise({ dur: 0.25, gain: 0.06, filter: 3200, delay: 0.02 });
  },
  fail() {
    [440, 370, 294, 220].forEach((f, i) =>
      tone({ freq: f, type: "sawtooth", dur: 0.24, gain: 0.1, delay: i * 0.11, slide: f * 0.94 })
    );
  },
  hint() {
    tone({ freq: 880, type: "sine", dur: 0.07, gain: 0.08 });
    tone({ freq: 1180, type: "sine", dur: 0.09, gain: 0.06, delay: 0.07 });
  },
  stageClear() {
    [659, 784, 988, 1319].forEach((f, i) => tone({ freq: f, type: "square", dur: 0.16, gain: 0.07, delay: i * 0.09 }));
  },
  tick() {
    tone({ freq: 1250, type: "sine", dur: 0.03, gain: 0.05 });
  },
  timeUp() {
    [784, 659, 523].forEach((f, i) => tone({ freq: f, type: "triangle", dur: 0.22, gain: 0.12, delay: i * 0.12 }));
  },
};

/* ---------------- ボイス ---------------- */
/*
  声が実機 iPhone で聴こえなかった理由と、この作り:

   1. Web Audio は「タップと同じ瞬間」に resume しないと起きない。
      以前は fetch と decodeAudioData をはさんでから再生していたので、
      実機では AudioContext が起きないまま声だけが無音になっていた。
      → ネイティブの AVAudioPlayer（KachiAudioPlugin）で直接鳴らす。
        無い環境（ブラウザ）では Web Audio → HTMLAudioElement へ落とす。

   2. 声を鳴らすたびに前の声を止めていたため、
      「ウサギローのひと声 → ポコ丸のセリフ」が続く場面で
      後から来た声に食われて、ほぼ何も聞こえない状態だった。
      → 話者ごとに別の声として鳴らす（同じ話者だけ差し替え）。

   3. BGM（0.3）と効果音の下に埋もれていた。
      → 声は 1.0、鳴っている間だけ BGM を 28% まで下げる（ダッキング）。
*/

/** 話者ごとの声を止める。who を省くと全部。 */
export function stopVoice(who) {
  let stopped = false;
  for (const [key, entry] of Array.from(voiceNodes.entries())) {
    if (who && who !== key) continue;
    try {
      entry.src.stop(0);
    } catch {}
    voiceNodes.delete(key);
    stopped = true;
  }
  for (const [key, el] of Array.from(voiceAudios.entries())) {
    if (who && who !== key) continue;
    try {
      el.pause();
      el.currentTime = 0;
    } catch {}
    voiceAudios.delete(key);
    stopped = true;
  }
  if (stopped) voiceStops += 1;
  const native = nativeAudio();
  if (stopped && native) {
    try {
      const r = native.stopVoice(who ? { who } : {});
      if (r && typeof r.catch === "function") r.catch(() => {});
    } catch {}
  }
}

/** BGM を声の間だけ下げる（声が終わったら戻す） */
function duckBgm(ms) {
  if (!ctx || !bgmGain) return;
  try {
    const t = ctx.currentTime;
    bgmGain.gain.cancelScheduledValues(t);
    bgmGain.gain.setTargetAtTime(gainFor("bgm") * 0.28, t, 0.04);
  } catch {}
  clearTimeout(duckTimer);
  duckTimer = setTimeout(() => {
    try {
      if (!ctx || !bgmGain) return;
      const t = ctx.currentTime;
      bgmGain.gain.cancelScheduledValues(t);
      bgmGain.gain.setTargetAtTime(gainFor("bgm"), t, 0.12);
    } catch {}
  }, Math.max(260, ms - 140));
}

/** ネイティブ（iOS 実機）で鳴らす。鳴らせたら true */
async function nativePlayVoice(url, who, volume) {
  const native = nativeAudio();
  if (!native || typeof native.playVoice !== "function") return false;
  try {
    const r = await native.playVoice({ path: url, who, volume });
    if (r && r.ok) {
      if (voiceNodes.has(who) || voiceAudios.has(who)) voiceStops += 1;
      voiceNodes.delete(who);
      voiceAudios.delete(who);
      nativeVoice = true;
      voiceStarts += 1;
      lastVoice = url;
      lastVoiceError = null;
      const ms = Math.round((Number(r.duration) || 1) * 1000);
      duckBgm(ms);
      return true;
    }
    lastVoiceError = (r && (r.reason || r.path)) || "native failed";
  } catch (e) {
    lastVoiceError = String(e);
  }
  return false;
}

/** Web Audio で鳴らす（ブラウザ・開発用） */
async function webPlayVoice(url, who, volume) {
  if (!ctx) build();
  if (!ctx) return false;
  if (audioState() !== "running") {
    // タップの合図のままなら即座に戻る。待たない（操作を止めない）。
    nudge();
    if (audioState() !== "running") {
      try {
        await Promise.race([Promise.resolve(ctx.resume()), wait(180)]);
      } catch {}
    }
  }
  const c = ctx;
  if (!c || audioState() !== "running") return false;
  const id = generation + "|" + url;
  let buffer = clipCache.get(id);
  if (!buffer) {
    const res = await fetch(url, { cache: "force-cache" });
    if (!res.ok) {
      lastVoiceError = `fetch ${res.status}`;
      return false;
    }
    const arr = await res.arrayBuffer();
    buffer = await c.decodeAudioData(arr);
    if (!buffer) {
      lastVoiceError = "decode failed";
      return false;
    }
    clipCache.set(id, buffer);
  }
  if (voiceNodes.has(who)) stopVoice(who);
  const src = c.createBufferSource();
  src.buffer = buffer;
  const g = c.createGain();
  g.gain.value = volume;
  src.connect(g);
  g.connect(voiceGain || master);
  voiceNodes.set(who, { src });
  voiceStarts += 1;
  lastVoice = url;
  lastVoiceError = null;
  src.onended = () => {
    const cur = voiceNodes.get(who);
    if (cur && cur.src === src) voiceNodes.delete(who);
  };
  try {
    src.start(0);
  } catch {
    voiceNodes.delete(who);
    return false;
  }
  duckBgm(Math.round((buffer.duration || 1) * 1000));
  return true;
}

/** 最後の手段: HTMLAudioElement（Web Audio が使えないとき） */
function htmlPlayVoice(url, who, volume) {
  if (typeof Audio === "undefined") return false;
  try {
    stopVoice(who);
    const el = new Audio(url);
    el.volume = Math.max(0, Math.min(1, volume));
    el.setAttribute("playsinline", "");
    voiceAudios.set(who, el);
    ellisten(el, who);
    voiceStarts += 1;
    lastVoice = url;
    const p = el.play();
    if (p && typeof p.then === "function") p.then(() => duckBgm(Math.round((el.duration || 1) * 1000))).catch(() => {});
    return true;
  } catch (e) {
    lastVoiceError = String(e);
    return false;
  }
}

function ellisten(el, who) {
  const done = () => {
    const cur = voiceAudios.get(who);
    if (cur === el) voiceAudios.delete(who);
  };
  el.addEventListener("ended", done, { once: true });
  el.addEventListener("error", done, { once: true });
}

/**
 * 声を1本鳴らす。
 * - who ごとに別の声（同じ話者だけ差し替え）
 * - 非同期・ノンブロッキング。例外は投げない
 * @returns {Promise<boolean>} 鳴らせたか
 */
export async function playClip(url, opts = {}) {
  if (!url) return false;
  if (store.settings.voice === false) return false;
  const who = opts.who || "voice";
  const volume = opts.volume == null ? 1 : opts.volume;
  const delay = opts.delay || 0;
  if (delay > 0) {
    setTimeout(() => {
      playClip(url, { ...opts, delay: 0 }).catch(() => {});
    }, delay);
    return true;
  }
  try {
    if (await nativePlayVoice(url, who, volume)) return true;
    if (await webPlayVoice(url, who, volume)) return true;
    return htmlPlayVoice(url, who, volume);
  } catch (e) {
    lastVoiceError = String(e);
    return false;
  }
}

/** 声のファイルを先に読み込む（最初のタップから間を空けない） */
export function preloadVoices(urls) {
  if (!Array.isArray(urls) || !urls.length) return;
  const native = nativeAudio();
  if (native && typeof native.preloadVoices === "function") {
    try {
      const r = native.preloadVoices({ paths: urls });
      if (r && typeof r.catch === "function") r.catch(() => {});
    } catch {}
  }
  // ブラウザ用: アイドルに decode しておく
  const warm = () => {
    if (!ctx) return;
    for (const url of urls) {
      const id = generation + "|" + url;
      if (clipCache.has(id)) continue;
      fetch(url, { cache: "force-cache" })
        .then((res) => (res.ok ? res.arrayBuffer() : null))
        .then((arr) => (arr && ctx ? ctx.decodeAudioData(arr) : null))
        .then((buffer) => {
          if (buffer) clipCache.set(id, buffer);
        })
        .catch(() => {});
    }
  };
  if (typeof requestIdleCallback === "function") requestIdleCallback(warm, { timeout: 2500 });
  else setTimeout(warm, 600);
}

/* ---------------- BGM ---------------- */
const N = {
  D3: 146.83,
  G3: 196.0,
  A3: 220.0,
  B3: 246.94,
  D4: 293.66,
  E4: 329.63,
  G4: 392.0,
  A4: 440.0,
  B4: 493.88,
  D5: 587.33,
};

// 8小節 × 8分音符8 = 64ステップ
const MELODY = [
  N.D4, null, N.E4, null, N.G4, null, N.A4, null,
  N.G4, null, N.E4, null, N.D4, null, N.E4, null,
  N.B4, null, N.A4, null, N.G4, null, N.E4, null,
  N.D4, null, N.E4, null, N.G4, null, null, null,
  N.A4, null, N.B4, null, N.D5, null, N.B4, null,
  N.A4, null, N.G4, null, N.E4, null, N.D4, null,
  N.E4, null, N.G4, null, N.A4, null, N.G4, null,
  N.E4, null, N.D4, null, null, null, null, null,
];
const BASS = [N.D3, N.D3, N.G3, N.G3, N.A3, N.A3, N.D3, N.D3];

const BPM = 104;
const STEP = 60 / BPM / 2;

function playStep(i, time) {
  const c = ctx;
  if (!c) return;
  const bus = bgmGain || master;
  try {
    const mel = MELODY[i];
    if (mel) {
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(mel, time);
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(0.16, time + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.26);
      osc.connect(g);
      g.connect(bus);
      osc.start(time);
      osc.stop(time + 0.3);
      // きらっと1オクターブ上を薄く
      if (i % 8 === 0) {
        const o2 = c.createOscillator();
        const g2 = c.createGain();
        o2.type = "sine";
        o2.frequency.setValueAtTime(mel * 2, time);
        g2.gain.setValueAtTime(0.0001, time);
        g2.gain.exponentialRampToValueAtTime(0.04, time + 0.01);
        g2.gain.exponentialRampToValueAtTime(0.0001, time + 0.4);
        o2.connect(g2);
        g2.connect(bus);
        o2.start(time);
        o2.stop(time + 0.45);
      }
    }
    if (i % 8 === 0) {
      const root = BASS[(i / 8) % BASS.length];
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(root, time);
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(0.18, time + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.5);
      osc.connect(g);
      g.connect(bus);
      osc.start(time);
      osc.stop(time + 0.55);
    }
    if (i % 8 === 4) {
      // 太鼓（やわらかい低音）
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(120, time);
      osc.frequency.exponentialRampToValueAtTime(70, time + 0.12);
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(0.12, time + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
      osc.connect(g);
      g.connect(bus);
      osc.start(time);
      osc.stop(time + 0.2);
    }
    if (i % 2 === 1) {
      noise({ dur: 0.04, gain: 0.02, filter: 5200, bus });
    }
  } catch {}
}

function schedule() {
  const c = ctx;
  if (!c || !bgmOn) return;
  try {
    if (c.state !== "running") return;
    while (nextTime < c.currentTime + 0.25) {
      playStep(step, nextTime);
      step = (step + 1) % 64;
      nextTime += STEP;
    }
  } catch {}
}

function startBgmTimer() {
  if (!ctx || bgmTimer) return;
  nextTime = ctx.currentTime + 0.05;
  bgmTimer = setInterval(schedule, 90);
  schedule();
}

function stopBgmTimer() {
  if (bgmTimer) {
    clearInterval(bgmTimer);
    bgmTimer = null;
  }
}

function restartBgmIfNeeded() {
  if (!bgmOn) return;
  if (store.settings.bgm === false) return;
  if (!bgmTimer) startBgmTimer();
}

export function startBgm() {
  const c = ensure();
  if (!c) return;
  if (store.settings.bgm === false) {
    bgmOn = false;
    return;
  }
  bgmOn = true;
  startBgmTimer();
}

export function stopBgm() {
  bgmOn = false;
  stopBgmTimer();
}

export function isBgmPlaying() {
  return bgmOn && !!bgmTimer;
}

export function suspendAudio() {
  stopBgm();
  stopVoice();
  if (ctx && ctx.state === "running") {
    try {
      ctx.suspend();
    } catch {}
  }
}

/** バックグラウンドから戻ったとき（BGMがONなら再開する） */
export function resumeAudio() {
  recoverAudio();
}

/**
 * 復帰のきっかけを受け取る配線。
 * visibilitychange / pageshow / focus / 次のタップ / ネイティブの appStateChange。
 */
export function installAudioLifecycle() {
  if (typeof document === "undefined") return;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") suspendAudio();
    else recoverAudio();
  });
  window.addEventListener("pageshow", () => recoverAudio());
  window.addEventListener("focus", () => recoverAudio());
  const gesture = () => {
    if (audioState() !== "running") recoverAudio();
  };
  window.addEventListener("pointerdown", gesture, { capture: true, passive: true });
  window.addEventListener("touchstart", gesture, { capture: true, passive: true });
  window.addEventListener("keydown", gesture, { passive: true });
  const cap = window.Capacitor;
  if (cap && cap.Plugins && cap.Plugins.App) {
    try {
      cap.Plugins.App.addListener("appStateChange", ({ isActive }) => {
        if (isActive) recoverAudio();
        else suspendAudio();
      });
    } catch {}
  }
}

/** 起動時に一度だけ（BGMの設定を反映する） */
export function bootAudio() {
  installAudioLifecycle();
  applySettings();
}
