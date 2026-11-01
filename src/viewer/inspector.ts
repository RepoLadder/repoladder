// The inspector: a floating panel that is closed until something is selected, with a button (#insp) and
// the I key to show or hide it. The reader's choice ("open" | "closed"; none = automatic) is kept in a
// module variable and localStorage where the page may use it. Wide windows only: the phone's bottom sheet
// (sheet.ts) is unchanged. `shown`, `readPref` and `typing` are pure, so node can test them.
import { refitIfAtFit } from "./fit.ts";
import { hasSelection } from "./deselect.ts";
import { STORY, st } from "./state.ts";

export type Pref = "open" | "closed" | null;

let pref: Pref | undefined;

/** Whether the panel is up: an explicit choice wins; otherwise it follows the selection (the story level counts as selected). */
export const shown = (p: Pref, hasSel: boolean, onStory: boolean): boolean => p === "closed" ? false : p === "open" ? true : hasSel || onStory;

export function readPref(): Pref {
  if (pref === undefined) {
    pref = null;
    try { const v = localStorage.getItem("repoladder.inspector"); if (v === "open" || v === "closed") pref = v; } catch { /* storage may be blocked */ }
  }
  return pref;
}

export function setPref(v: "open" | "closed"): void {
  pref = v;
  try { localStorage.setItem("repoladder.inspector", v); } catch { /* the variable still holds for the session */ }
}

/** The I key is ours only when nothing else wants it: no modifier, not typing, not full screen. */
export const wants = (ev: { key: string; defaultPrevented: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }, inField: boolean, full: boolean): boolean =>
  (ev.key === "i" || ev.key === "I") && !ev.defaultPrevented && !ev.ctrlKey && !ev.metaKey && !ev.altKey && !inField && !full;

const wide = () => matchMedia("(min-width: 761px)").matches && !document.documentElement.classList.contains("embed");
const aside = () => document.querySelector<HTMLElement>("main > aside")!;
const open = () => aside().dataset.inspector === "open";

/** Applies the open or closed state to the panel and the button; refits only when it changed. */
export function syncInspector(): void {
  const a = document.querySelector<HTMLElement>("main > aside"), b = document.getElementById("insp");
  if (!a || !b) return;
  if (!wide()) { delete a.dataset.inspector; a.inert = false; return; }
  const on = shown(readPref(), hasSelection() || !!st.selected, st.cur === STORY), was = a.dataset.inspector;
  a.dataset.inspector = on ? "open" : "closed";
  a.inert = !on;
  b.setAttribute("aria-expanded", String(on));
  b.setAttribute("aria-pressed", String(on));
  if (was !== a.dataset.inspector) { window.dispatchEvent(new Event("dockchange")); refitIfAtFit(); }
}

export function toggleInspector(): void {
  setPref(open() ? "closed" : "open");
  syncInspector();
}

export function installInspector(): void {
  document.getElementById("insp")?.addEventListener("click", () => { if (wide()) toggleInspector(); });
  window.addEventListener("keydown", (ev) => {
    const t = ev.target as Element | null;
    if (!wide() || !wants(ev, !!t?.closest?.("input,textarea,select,[contenteditable]"), !!document.fullscreenElement)) return;
    ev.preventDefault();
    toggleInspector();
  });
  matchMedia("(min-width: 761px)").addEventListener("change", syncInspector);
  syncInspector();
}
