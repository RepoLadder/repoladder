// The Key card at the foot of the overview panel: a collapsible card that is open by default and
// remembers a close (module variable, plus localStorage where the page may use it), and the
// grouper for the notes under the cards (`notesBox` folds them into one collapsed box). No board or DOM at import time, so node can test it.
import { box } from "./box.ts";

let closed: boolean | undefined;
let installed = false;

const read = (): boolean => {
  if (closed === undefined) {
    closed = false;
    try { closed = localStorage.getItem("repoladder.key") === "closed"; } catch { /* storage may be blocked */ }
  }
  return closed;
};

export const keyClosed = (): boolean => read();

export function setKeyClosed(v: boolean): void {
  closed = v;
  try { localStorage.setItem("repoladder.key", v ? "closed" : "open"); } catch { /* the variable still holds for the session */ }
}

/** The legend rows in a card that opens and closes; a re-render keeps the reader's choice. */
export function keyCard(rows: string): string {
  const shut = read();
  if (!installed && typeof document !== "undefined") {
    installed = true;
    // toggle does not bubble, so listen in the capture phase
    document.addEventListener("toggle", (ev) => {
      const d = ev.target as HTMLDetailsElement;
      if (d.matches?.("details.key")) setKeyClosed(!d.open);
    }, true);
  }
  return box("Key", `<ul class="legend">${rows}</ul>`, { open: !shut, cls: "key" });
}

/** The notes under the cards, grouped so they sit as one block. */
export const foots = (...parts: string[]): string => {
  const p = parts.filter(Boolean);
  return p.length ? `<div class="foots">${p.join("")}</div>` : "";
};

/** The notes folded into one collapsed "Notes" box, or nothing when there are none. */
export const notesBox = (...parts: string[]): string => {
  const body = foots(...parts);
  return body ? box("Notes", body, { cls: "notes" }) : "";
};
