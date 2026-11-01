// The +, - and F shortcuts: the same zoom and Reframe as the buttons, and silent while typing or with a modifier held.
import { reframeNow, zoomBy } from "./panzoom.ts";

export type ZoomKey = "in" | "out" | "fit";
// a search box is a [role=dialog], so the one selector covers it
const KEYS: Record<string, ZoomKey> = { "+": "in", "=": "in", "-": "out", _: "out", f: "fit", F: "fit" };
const SKIP = "input,textarea,select,[contenteditable],.crumbmenu,.xmenu,[role=dialog]";

/** What a key does; null when it isn't ours: a modifier is held (the browser's own zoom keeps working) or the target is editable. */
export function zoomKeyAction(key: string, m: { ctrl: boolean; meta: boolean; alt: boolean }, editable: boolean): ZoomKey | null {
  if (m.ctrl || m.meta || m.alt || editable) return null;
  return KEYS[key] ?? null;
}

export function installZoomKeys(): void {
  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented) return;
    const a = zoomKeyAction(e.key, { ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey }, !!(e.target as Element).closest?.(SKIP));
    if (!a) return;
    if (a === "fit") {
      const b = document.getElementById("zfit");
      if (e.repeat || b?.hidden !== false) return;
      reframeNow();
    } else zoomBy(a === "in" ? 1 / 1.25 : 1.25);
    e.preventDefault();
  });
}
