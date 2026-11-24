/**
 * Build 5 — シェア文言（DOM に触れない純粋な部分）。
 *
 * 画面（main.js）は navigator.share / クリップボードを扱い、
 * ここでは「どの結果を、どの言語で、どんな文面にするか」だけを決める。
 * 3行構成（見出し／サブ／ハッシュタグ）で、12言語ぶんの辞書は i18n.js の share.*。
 */

/**
 * @param {(key: string, vars?: object) => string} t その言語の翻訳関数（i18n.js の makeT）
 * @param {"stage"|"daily"|"ta"} kind
 * @param {{stage?: string, moves?: number, date?: string, seconds?: number, score?: number}} data
 * @returns {string} 共有する本文（改行区切り）
 */
export function shareTextFor(t, kind, data = {}) {
  const appName = t("app.title");
  let head;
  if (kind === "daily") head = t("share.daily", { app: appName, date: data.date || "" });
  else if (kind === "ta") head = t("share.ta", { app: appName, n: data.seconds, score: data.score });
  else head = t("share.stage", { app: appName, stage: data.stage || "", moves: data.moves });
  return [head, t("share.sub"), t("share.tags")].join("\n");
}

/**
 * 結果カードのシェアボタンに出すラベル（絵文字つき）。
 * @param {(key: string) => string} t
 */
export function shareButtonLabel(t) {
  return `\u{1F4E4} ${t("share.button")}`;
}
