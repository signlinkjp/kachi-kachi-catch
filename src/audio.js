/** WebAudio の効果音とBGM（すべて合成・外部ファイルなし） */
import { store } from "./storage.js";

let ctx = null;
let master = null;
let bgmGain = null;
let sfxGain = null;
let bgmTimer = null;
let step = 0;
let nextTime = 0;
let bgmOn = false;

function ensure() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    sfxGain = ctx.createGain();
    sfxGain.gain.value = store.settings.se === false ? 0 : 0.42;
    sfxGain.connect(master);
    bgmGain = ctx.createGain();
    bgmGain.gain.value = store.settings.bgm === false ? 0 : 0.3;
    bgmGain.connect(master);
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

export function unlockAudio() {
  ensure();
  // iOS は操作のたびに AudioSession を起こし直すと安定する（AppDelegate 側）
  const cap = window.Capacitor;
  if (cap && cap.Plugins && cap.Plugins.KachiAudio) {
    try {
      cap.Plugins.KachiAudio.activate();
    } catch {}
  }
}

export function applySettings() {
  const s = store.settings;
  if (sfxGain) sfxGain.gain.value = s.se === false ? 0 : 0.42;
  if (bgmGain) bgmGain.gain.value = s.bgm === false ? 0 : 0.3;
  if (s.bgm === false) stopBgm();
  else if (s.bgm === true && bgmOn) startBgm();
}

function tone({ freq = 440, type = "sine", dur = 0.12, gain = 0.25, delay = 0, slide = null, attack = 0.005, bus = null }) {
  const c = ensure();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide != null) osc.frequency.exponentialRampToValueAtTime(Math.max(30, slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(bus || sfxGain);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise({ dur = 0.18, gain = 0.18, delay = 0, filter = 1200, bus = null }) {
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
  g.connect(bus || sfxGain);
  src.start(t0);
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
    g.connect(bgmGain);
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
      g2.connect(bgmGain);
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
    g.connect(bgmGain);
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
    g.connect(bgmGain);
    osc.start(time);
    osc.stop(time + 0.2);
  }
  if (i % 2 === 1) {
    noise({ dur: 0.04, gain: 0.02, filter: 5200, bus: bgmGain });
  }
}

function schedule() {
  const c = ctx;
  if (!c || !bgmOn) return;
  while (nextTime < c.currentTime + 0.25) {
    playStep(step, nextTime);
    step = (step + 1) % 64;
    nextTime += STEP;
  }
}

export function startBgm() {
  const c = ensure();
  if (!c) return;
  bgmOn = true;
  if (store.settings.bgm === false) return;
  if (bgmTimer) return;
  nextTime = c.currentTime + 0.05;
  bgmTimer = setInterval(schedule, 90);
  schedule();
}

export function stopBgm() {
  bgmOn = false;
  if (bgmTimer) {
    clearInterval(bgmTimer);
    bgmTimer = null;
  }
}

export function isBgmPlaying() {
  return bgmOn && !!bgmTimer;
}

export function suspendAudio() {
  stopBgm();
  if (ctx && ctx.state === "running") {
    try {
      ctx.suspend();
    } catch {}
  }
}

export function resumeAudio() {
  if (ctx && ctx.state === "suspended") {
    try {
      ctx.resume();
    } catch {}
  }
  if (store.settings.bgm !== false) startBgm();
}
