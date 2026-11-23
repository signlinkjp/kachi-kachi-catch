/** デイリー問題の日付ロジック（端末のローカル日付基準） */
import { DAILY, DAILY_EPOCH, DAILY_COUNT } from "./daily.js";

const DAY_MS = 86400000;

/** "YYYY-MM-DD" → 1970-01-01 からの日数（UTC の暦で計算するので夏時間の影響を受けない） */
export function dayNumberFor(y, m, d) {
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function dayNumber(date = new Date()) {
  return dayNumberFor(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

export function dateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const EPOCH_DAY = (() => {
  const [y, m, d] = DAILY_EPOCH.split("-").map(Number);
  return dayNumberFor(y, m, d);
})();

/** その日のデイリー index（0..DAILY_COUNT-1） */
export function dailyIndexFor(date = new Date()) {
  const offset = dayNumber(date) - EPOCH_DAY;
  return ((offset % DAILY_COUNT) + DAILY_COUNT) % DAILY_COUNT;
}

export function dailyPuzzleFor(date = new Date()) {
  return DAILY[dailyIndexFor(date)];
}

/** 過去のデイリー（1日前から n 日分）。{key, index, stage} の配列 */
export function pastDailies(n = 30, date = new Date()) {
  const out = [];
  const base = dayNumber(date);
  for (let i = 1; i <= n; i++) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate() - i);
    const index = (((base - i) - EPOCH_DAY) % DAILY_COUNT + DAILY_COUNT) % DAILY_COUNT;
    out.push({ key: dateKey(d), index, stage: DAILY[index], daysAgo: i, date: d });
  }
  return out;
}

export { DAILY, DAILY_COUNT, DAILY_EPOCH };
