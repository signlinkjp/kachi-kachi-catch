/**
 * PRO（jp.signlink.KachiCatch.pro）と無料/PROの境界。
 *
 * 課金は iOS の StoreKit 2 プラグイン（AppDelegate.swift の StoreKitPlugin）が行い、
 * ここは「画面の判断」だけを持つ。プラグインが無い（ブラウザ・審査前）ときは
 * 購入できない旨を返し、アプリは落とさない。
 */
import { store } from "./storage.js";

export const PRODUCT_ID = "jp.signlink.KachiCatch.pro";
export const FREE_HINTS_PER_STAGE = 3;
export const FREE_DAILY_PAST = 0; // 過去のデイリーは PRO のみ

function plugin() {
  const cap = typeof window !== "undefined" ? window.Capacitor : null;
  return cap && cap.Plugins ? cap.Plugins.StoreKit || null : null;
}

export function isStoreAvailable() {
  return !!plugin();
}

/** Apple に問い合わせて権利を確認する（起動時・復元時） */
export async function refreshEntitlement() {
  const sk = plugin();
  if (!sk) return { entitled: store.pro, available: false };
  try {
    const r = await sk.entitlement({ id: PRODUCT_ID });
    const entitled = !!r.entitled;
    if (entitled !== store.pro) store.setPro(entitled);
    return { entitled, available: true };
  } catch (e) {
    return { entitled: store.pro, available: true, error: String(e && e.message ? e.message : e) };
  }
}

export async function getProduct() {
  const sk = plugin();
  if (!sk) return null;
  try {
    const r = await sk.getProducts({ ids: [PRODUCT_ID] });
    return (r.products && r.products[0]) || null;
  } catch {
    return null;
  }
}

export async function purchase() {
  const sk = plugin();
  if (!sk) return { status: "unavailable", entitled: false };
  try {
    const r = await sk.purchase({ id: PRODUCT_ID });
    if (r.entitled) store.setPro(true);
    return r;
  } catch (e) {
    return {
      status: "failed",
      entitled: false,
      message: String(e && e.message ? e.message : e),
    };
  }
}

export async function restore() {
  const sk = plugin();
  if (!sk) return { status: "unavailable", entitled: false };
  try {
    const r = await sk.restore({ id: PRODUCT_ID });
    if (r.entitled) store.setPro(true);
    return r;
  } catch (e) {
    return { status: "failed", entitled: false, message: String(e && e.message ? e.message : e) };
  }
}

/** テスト・スクリーンショット用（?dev=1 のときだけ有効） */
export function devUnlock() {
  try {
    const dev = new URLSearchParams(location.search).get("dev") === "1";
    if (dev) {
      store.setPro(true);
      return true;
    }
  } catch {}
  return false;
}

export const isPro = () => store.pro;

/* ---------------- 無料 / PRO の線引き ---------------- */
const GROUP_START = { beginner: 1, middle: 11, advanced: 26, expert: 41 };

/** 難易度グループ内での通し番号（1始まり） */
export function stageNoInGroup(stage) {
  const start = GROUP_START[stage.difficulty] || 1;
  return stage.index - start + 1;
}

/** ステージが遊べるか */
export function canPlayStage(stage, pro = store.pro) {
  if (!stage) return false;
  if (stage.difficulty === "beginner") return true; // 初級10問は無料
  if (stage.difficulty === "middle") return stageNoInGroup(stage) <= 10 || !!pro; // 前半10問は無料、残りは PRO
  return !!pro; // 上級・激ムズは PRO
}

export const canTimeAttack = (pro = store.pro) => !!pro;

export function canPastDaily(pro = store.pro) {
  return FREE_DAILY_PAST > 0 ? true : !!pro;
}

/** ヒントの残り（PRO は無制限 = null） */
export function hintsLeft(stageId, used, pro = store.pro) {
  if (pro) return null;
  return Math.max(0, FREE_HINTS_PER_STAGE - used);
}

export function canUseHint(stageId, used, pro = store.pro) {
  return pro || used < FREE_HINTS_PER_STAGE;
}
