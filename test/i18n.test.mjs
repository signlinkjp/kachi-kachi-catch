/** 12言語の完全性とフォールバック */
import test from "node:test";
import assert from "node:assert/strict";
import { LANGS, STRINGS, resolveLang, makeT, format, FALLBACK_LANG } from "../src/i18n.js";

const REQUIRED = [
  "ja",
  "en",
  "zh-Hans",
  "zh-Hant",
  "ko",
  "es",
  "fr",
  "de",
  "pt",
  "it",
  "hi",
  "id",
];

test("12言語がそろっている", () => {
  assert.equal(LANGS.length, 12);
  for (const code of REQUIRED) {
    assert.ok(STRINGS[code], `${code} が無い`);
    assert.ok(LANGS.some((l) => l.code === code), `${code} が LANGS に無い`);
  }
  assert.equal(FALLBACK_LANG, "en");
});

test("全言語でキーが一致し、空の値が無い（movesUnit は意図的に空）", () => {
  const base = Object.keys(STRINGS.en).sort();
  assert.ok(base.length >= 100, `キー数 ${base.length}`);
  for (const code of REQUIRED) {
    const table = STRINGS[code];
    const keys = Object.keys(table).sort();
    assert.deepEqual(keys, base, `${code} のキーが一致しない`);
    for (const k of keys) {
      if (k === "stage.movesUnit") continue;
      assert.ok(String(table[k]).trim().length > 0, `${code}: ${k} が空`);
    }
  }
});

test("キャラ名は各言語で表記される（ウサギロー / ポコ丸）", () => {
  assert.equal(STRINGS.ja["char.rabbit"], "ウサギロー");
  assert.equal(STRINGS.ja["char.tanuki"], "ポコ丸");
  assert.equal(STRINGS.en["char.rabbit"], "Usagiro");
  assert.equal(STRINGS.en["char.tanuki"], "Pokomaru");
  for (const code of REQUIRED) {
    assert.ok(STRINGS[code]["char.rabbit"].length > 0);
    assert.ok(STRINGS[code]["char.tanuki"].length > 0);
    // ルール文にキャラ名が入っている
    assert.ok(STRINGS[code]["howto.r2b"].includes(STRINGS[code]["char.tanuki"]), `${code}: howto にポコ丸の名前`);
  }
});

test("端末言語の解決（未対応は英語）", () => {
  assert.equal(resolveLang("ja-JP"), "ja");
  assert.equal(resolveLang("ja"), "ja");
  assert.equal(resolveLang("en-US"), "en");
  assert.equal(resolveLang("zh-CN"), "zh-Hans");
  assert.equal(resolveLang("zh-TW"), "zh-Hant");
  assert.equal(resolveLang("zh-HK"), "zh-Hant");
  assert.equal(resolveLang("ko-KR"), "ko");
  assert.equal(resolveLang("pt-BR"), "pt");
  assert.equal(resolveLang("id-ID"), "id");
  assert.equal(resolveLang("hi-IN"), "hi");
  assert.equal(resolveLang("ru-RU"), "en");
  assert.equal(resolveLang(undefined), "en");
  assert.equal(resolveLang(""), "en");
});

test("t() は差し込みと英語フォールバックを行う", () => {
  const ja = makeT("ja");
  assert.equal(ja("stage.par", { n: 3 }), "3手詰");
  assert.equal(ja("stage.escape", { name: "ポコ丸" }), "ポコ丸の逃げ場");
  const en = makeT("en");
  assert.equal(en("game.clearText", { n: 5 }), "Caught in 5 moves!");
  assert.equal(format("{a}/{b}", { a: 1, b: 2 }), "1/2");
  assert.equal(ja("no.such.key"), "no.such.key");
});

test("難易度名が12言語そろう", () => {
  for (const code of REQUIRED) {
    for (const k of ["beginner", "middle", "advanced", "expert"]) {
      assert.ok(STRINGS[code][`difficulty.${k}`], `${code}: difficulty.${k}`);
    }
  }
  assert.equal(STRINGS.ja["difficulty.beginner"], "初級");
  assert.equal(STRINGS.en["difficulty.expert"], "Expert");
});

test("今日の1問・PRO・プライバシーの文言がある", () => {
  for (const code of REQUIRED) {
    for (const k of ["daily.title", "daily.todo", "daily.done", "pro.title", "pro.item5", "privacy.body", "ta.rule"]) {
      assert.ok(STRINGS[code][k], `${code}: ${k}`);
    }
  }
});
