/** 端末内の保存（進行状況・設定・PRO）。localStorage だけを使う。 */
const KEY = "kachi.b1.v1";

const DEFAULTS = () => ({
  cleared: {}, // { stageId: true }
  hints: {}, // { stageId: 使用数 }
  daily: {}, // { "YYYY-MM-DD": true }
  taBest: 0,
  pro: false,
  settings: { bgm: true, se: true, haptics: true, lang: null },
});

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
      };
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
  get taBest() {
    return read().taBest || 0;
  },
  setTaBest(score) {
    const d = read();
    if (score > (d.taBest || 0)) {
      d.taBest = score;
      write();
      return true;
    }
    return false;
  },
};
