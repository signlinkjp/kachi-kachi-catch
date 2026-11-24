/** 端末内の保存（進行状況・設定・PRO）。localStorage だけを使う。 */
const KEY = "kachi.b1.v1";

export const TEXT_SIZES = ["normal", "large", "xlarge"];
export const TA_DURATIONS = [60, 120, 180];

const DEFAULTS = () => ({
  cleared: {}, // { stageId: true }
  hints: {}, // { stageId: 使用数 }
  daily: {}, // { "YYYY-MM-DD": true }
  taBest: { 60: 0, 120: 0, 180: 0 }, // タイムアタックのベスト（秒ごと）
  pro: false,
  settings: {
    bgm: true,
    se: true,
    voice: true,
    haptics: true,
    textSize: "normal",
    taDuration: 60,
    lang: null,
  },
});

/** 文字サイズの値を 3段階のどれかに寄せる（保存値が壊れていても落とさない） */
export function normalizeTextSize(value) {
  return TEXT_SIZES.includes(value) ? value : "normal";
}

/** タイムアタックの秒数を 60/120/180 のどれかに寄せる */
export function normalizeTaDuration(value) {
  const n = Number(value);
  return TA_DURATIONS.includes(n) ? n : TA_DURATIONS[0];
}

/** 古い保存（taBest が数字だけ）を秒ごとの記録に移す */
export function migrateTaBest(value) {
  const base = { 60: 0, 120: 0, 180: 0 };
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return { ...base, 60: Math.floor(value) };
  }
  if (value && typeof value === "object") {
    for (const sec of TA_DURATIONS) {
      const v = Number(value[sec]);
      if (Number.isFinite(v) && v > 0) base[sec] = Math.floor(v);
    }
  }
  return base;
}

let cache = null;

function read() {
  if (cache) return cache;
  const base = DEFAULTS();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      cache = {
        ...base,
        ...parsed,
        settings: { ...base.settings, ...(parsed.settings || {}) },
        cleared: { ...(parsed.cleared || {}) },
        hints: { ...(parsed.hints || {}) },
        daily: { ...(parsed.daily || {}) },
        taBest: migrateTaBest(parsed.taBest),
      };
      cache.settings.textSize = normalizeTextSize(cache.settings.textSize);
      cache.settings.taDuration = normalizeTaDuration(cache.settings.taDuration);
      if (cache.settings.voice == null) cache.settings.voice = true;
    } else {
      cache = base;
    }
  } catch {
    cache = base;
  }
  return cache;
}

function write() {
  try {
    localStorage.setItem(KEY, JSON.stringify(read()));
  } catch {}
}

export const store = {
  get data() {
    return read();
  },
  get settings() {
    return read().settings;
  },
  setSetting(name, value) {
    if (name === "textSize") value = normalizeTextSize(value);
    if (name === "taDuration") value = normalizeTaDuration(value);
    read().settings[name] = value;
    write();
  },
  isCleared(id) {
    return !!read().cleared[id];
  },
  markCleared(id) {
    const d = read();
    if (!d.cleared[id]) {
      d.cleared[id] = true;
      write();
      return true;
    }
    return false;
  },
  clearCount(ids) {
    const d = read();
    return ids.filter((id) => d.cleared[id]).length;
  },
  hintsUsed(id) {
    return read().hints[id] || 0;
  },
  useHint(id) {
    const d = read();
    d.hints[id] = (d.hints[id] || 0) + 1;
    write();
  },
  isDailyCleared(key) {
    return !!read().daily[key];
  },
  markDailyCleared(key) {
    const d = read();
    d.daily[key] = true;
    write();
  },
  get pro() {
    return !!read().pro;
  },
  setPro(value) {
    const d = read();
    d.pro = !!value;
    write();
  },
  /** タイムアタックのベスト（秒ごと） */
  taBestFor(seconds) {
    const sec = normalizeTaDuration(seconds);
    return read().taBest[sec] || 0;
  },
  /** 記録を更新したら true（自己ベスト更新） */
  setTaBestFor(seconds, score) {
    const sec = normalizeTaDuration(seconds);
    const d = read();
    const best = d.taBest[sec] || 0;
    if (score > best) {
      d.taBest[sec] = score;
      write();
      return true;
    }
    return false;
  },
  /** 互換: 60秒のベスト */
  get taBest() {
    return this.taBestFor(60);
  },
  setTaBest(score) {
    return this.setTaBestFor(60, score);
  },
};
