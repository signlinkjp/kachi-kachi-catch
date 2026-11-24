/**
 * ボイスの台本とファイルの置き場所。
 *
 * 音声は tools/gen_voices.py（edge-tts）が assets/voices/<lang>/ に作る。
 * 日本語と英語だけ音声を持ち、ほかの言語は英語の音声で鳴らす
 * （画面のセリフはその言語のまま）。
 */

export const VOICE_LANGS = ["ja", "en"];

/** キャラ × 場面 → セリフの種類（同じ場面で順番に切り替える） */
export const VOICE_SETS = {
  usagiro: {
    start: ["start1", "start2"],
    tap: ["tap1", "tap2"],
    clear: ["clear1", "clear2"],
    fail: ["fail1", "fail2"],
  },
  pokomaru: {
    taunt: ["taunt0", "taunt1", "taunt2", "taunt3"],
    panic: ["panic1", "panic2", "panic3"],
    caught: ["caught1", "caught2"],
    escape: ["escape1", "escape2"],
  },
};

export function voiceLangFor(lang) {
  return VOICE_LANGS.includes(lang) ? lang : "en";
}

export function voiceUrl(lang, who, key) {
  return `assets/voices/${voiceLangFor(lang)}/${who}-${key}.mp3`;
}

const lastPick = new Map();

/** 場面ごとに順番に切り替える（直前と同じものは避ける） */
export function nextVoiceKey(who, situation) {
  const list = (VOICE_SETS[who] || {})[situation];
  if (!list || !list.length) return null;
  const id = `${who}:${situation}`;
  const prev = lastPick.get(id);
  let index = Math.floor(Math.random() * list.length);
  if (list.length > 1 && list[index] === prev) index = (index + 1) % list.length;
  const key = list[index];
  lastPick.set(id, key);
  return key;
}

/** 場面から音声のURLを作る（設定や言語は呼び出し側が渡す） */
export function voiceFor(lang, who, situation) {
  const key = nextVoiceKey(who, situation);
  if (!key) return null;
  return { key, url: voiceUrl(lang, who, key) };
}
