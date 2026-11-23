/**
 * バイブ（iOS ネイティブ KachiHapticsPlugin / ブラウザは navigator.vibrate）。
 * 設定の ON/OFF を見てから鳴らす。
 */
import { store } from "./storage.js";

function plugin() {
  const cap = typeof window !== "undefined" ? window.Capacitor : null;
  return cap && cap.Plugins ? cap.Plugins.KachiHaptics || null : null;
}

export function hapticsAvailable() {
  return !!plugin() || (typeof navigator !== "undefined" && typeof navigator.vibrate === "function");
}

function enabled() {
  return store.settings.haptics !== false;
}

function call(name, arg) {
  if (!enabled()) return;
  const h = plugin();
  if (h && typeof h[name] === "function") {
    try {
      h[name](arg);
      return;
    } catch {}
  }
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    const ms = name === "success" ? [12, 40, 18] : name === "warning" ? [24, 60, 24] : 10;
    try {
      navigator.vibrate(ms);
    } catch {}
  }
}

export const haptics = {
  tap: () => call("impact", { style: "light" }),
  flip: () => call("impact", { style: "medium" }),
  hop: () => call("impact", { style: "light" }),
  success: () => call("success"),
  warning: () => call("warning"),
};
