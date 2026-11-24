/**
 * Build 2 の検証。
 *  - ボイス（日本語/英語の mp3 が全部そろっていて、軽い）
 *  - タイムアタックのベストは 60/120/180 秒で別々
 *  - 文字サイズ（標準/大/特大）と、壊れた保存値の丸め
 *  - 無料範囲は25問（初級10＋中級15）
 *  - 12言語の新しい文言
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { VOICE_SETS, VOICE_LANGS, voiceUrl, voiceFor, nextVoiceKey } from "../src/voices.js";
import {
  store,
  TEXT_SIZES,
  TA_DURATIONS,
  normalizeTextSize,
  normalizeTaDuration,
  migrateTaBest,
} from "../src/storage.js";
import { STRINGS, LANGS, makeT } from "../src/i18n.js";
import { FREE_STAGE_COUNT, canPlayStage } from "../src/pro.js";
import { STAGES } from "../src/stages.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");

test("ボイスは日本語と英語の mp3 が全部そろっている", () => {
  assert.deepEqual(VOICE_LANGS, ["ja", "en"]);
  let total = 0;
  let count = 0;
  for (const lang of VOICE_LANGS) {
    for (const [who, situations] of Object.entries(VOICE_SETS)) {
      for (const keys of Object.values(situations)) {
        for (const key of keys) {
          const file = path.join(ROOT, voiceUrl(lang, who, key));
          assert.ok(fs.existsSync(file), `無い: ${lang}/${who}-${key}.mp3`);
          const buf = fs.readFileSync(file);
          assert.ok(buf.length > 800, `${lang}/${who}-${key}.mp3 が小さすぎる`);
          assert.ok(buf.length < 40 * 1024, `${lang}/${who}-${key}.mp3 が大きすぎる`);
          // MP3 のフレーム同期（ID3 か 0xFF Ex）
          const head = buf.subarray(0, 3).toString("latin1");
          assert.ok(head === "ID3" || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0), `${file} が mp3 ではない`);
          total += buf.length;
          count += 1;
        }
      }
    }
  }
  assert.ok(count >= 34, `本数 ${count}`);
  assert.ok(total < 400 * 1024, `合計 ${(total / 1024).toFixed(0)}KB は重すぎる`);
});

test("ボイスは場面ごとに複数のセリフを持ち、順番に切り替わる", () => {
  for (const [who, situations] of Object.entries(VOICE_SETS)) {
    for (const [situation, keys] of Object.entries(situations)) {
      if (who === "pokomaru" && situation === "start") continue;
      assert.ok(keys.length >= 2, `${who}/${situation} のパターンが少ない`);
    }
  }
  const seen = new Set();
  for (let i = 0; i < 12; i++) seen.add(nextVoiceKey("usagiro", "tap"));
  assert.ok(seen.size >= 2, "連打で同じセリフばかりになっている");
});

test("言語に応じたボイス（日本語以外は英語）", () => {
  assert.equal(voiceUrl("ja", "usagiro", "start1"), "assets/voices/ja/usagiro-start1.mp3");
  assert.equal(voiceUrl("ko", "usagiro", "start1"), "assets/voices/en/usagiro-start1.mp3");
  const v = voiceFor("ja", "pokomaru", "panic");
  assert.ok(v && v.url.startsWith("assets/voices/ja/pokomaru-panic"));
  assert.equal(voiceFor("ja", "pokomaru", "no-such-situation"), null);
});

test("タイムアタックは60/120/180秒で、ベストは秒ごとに別", () => {
  assert.deepEqual(TA_DURATIONS, [60, 120, 180]);
  assert.equal(store.taBestFor(60), 0);
  assert.equal(store.setTaBestFor(120, 7), true);
  assert.equal(store.taBestFor(120), 7);
  assert.equal(store.taBestFor(60), 0);
  assert.equal(store.taBestFor(180), 0);
  assert.equal(store.setTaBestFor(120, 5), false, "更新でないときは false");
  assert.equal(store.setTaBestFor(60, 9), true);
  assert.equal(store.taBestFor(60), 9);
  assert.equal(store.taBestFor(120), 7);
  // 変な秒数は60秒として扱う（90秒の記録は作らない）
  assert.equal(store.setTaBestFor(90, 3), false);
  assert.equal(store.taBestFor(60), 9);
  assert.equal(store.taBestFor(90), 9);
});

test("古い保存（taBest が数字）を60秒の記録に引き継ぐ", () => {
  assert.deepEqual(migrateTaBest(12), { 60: 12, 120: 0, 180: 0 });
  assert.deepEqual(migrateTaBest({ 60: 3, 120: 4, 180: 5 }), { 60: 3, 120: 4, 180: 5 });
  assert.deepEqual(migrateTaBest({ 60: "8", 120: -2 }), { 60: 8, 120: 0, 180: 0 });
  assert.deepEqual(migrateTaBest(null), { 60: 0, 120: 0, 180: 0 });
  assert.deepEqual(migrateTaBest("x"), { 60: 0, 120: 0, 180: 0 });
});

test("文字サイズは標準/大/特大の3段階だけ", () => {
  assert.deepEqual(TEXT_SIZES, ["normal", "large", "xlarge"]);
  assert.equal(normalizeTextSize("large"), "large");
  assert.equal(normalizeTextSize("xlarge"), "xlarge");
  assert.equal(normalizeTextSize("huge"), "normal");
  assert.equal(normalizeTextSize(undefined), "normal");
  store.setSetting("textSize", "xlarge");
  assert.equal(store.settings.textSize, "xlarge");
  store.setSetting("textSize", "nonsense");
  assert.equal(store.settings.textSize, "normal");
  assert.equal(normalizeTaDuration(120), 120);
  assert.equal(normalizeTaDuration(45), 60);
  store.setSetting("taDuration", "180");
  assert.equal(store.settings.taDuration, 180);
});

test("無料は25問（初級10＋中級15）、上級と激ムズはPRO", () => {
  assert.equal(FREE_STAGE_COUNT, 25);
  assert.equal(STAGES.filter((s) => canPlayStage(s, false)).length, 25);
  assert.equal(STAGES.filter((s) => s.difficulty === "middle" && canPlayStage(s, false)).length, 15);
  assert.equal(STAGES.filter((s) => s.difficulty === "advanced" && canPlayStage(s, false)).length, 0);
});

test("12言語にビルド2の文言がそろっている", () => {
  const keys = [
    "settings.voice",
    "settings.textSize",
    "textSize.normal",
    "textSize.large",
    "textSize.xlarge",
    "ta.pickTime",
    "ta.seconds",
    "ta.pickOther",
    "howto.r5t",
    "howto.r5b",
    "howto.legendTrap",
    "howto.legendRock",
    "note.caught1",
    "note.caught2",
    "note.escape1",
    "note.escape2",
    "pro.free",
    "pro.lead",
  ];
  for (const { code } of LANGS) {
    for (const k of keys) {
      const v = STRINGS[code][k];
      assert.ok(typeof v === "string" && v.trim().length > 0, `${code}: ${k} が無い`);
    }
    assert.ok(STRINGS[code]["howto.r1b"].includes(STRINGS[code]["char.rabbit"]), `${code}: r1b にウサギローの名前`);
    assert.ok(STRINGS[code]["howto.r2b"].includes(STRINGS[code]["char.tanuki"]), `${code}: r2b にポコ丸の名前`);
  }
  assert.equal(makeT("ja")("ta.seconds", { n: 180 }), "180秒");
  assert.equal(makeT("en")("ta.seconds", { n: 60 }), "60s");
});
