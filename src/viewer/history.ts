// Back and forward through the boards you visited, kept in the page: the hash is mirrored with
// replaceState (deeplink.ts) and sandboxed artifact frames may refuse history calls, so the
// browser's own back button can't be relied on. Back is "where I just was" (which, after a jump to
// an "elsewhere" box, is a different branch entirely); "up" stays the breadcrumbs and Escape.
// The buttons sit on the canvas's top left, mirroring the zoom buttons on its right;
// fit.ts keeps the board's opening view clear of both.
import { boardName } from "./jump.ts";
import { $ } from "./state.ts";

/** Where you were: the board, its selection and the pan/zoom, and the detail stop it was seen in (dial.ts),
 *  and the tour step it showed, if one was playing (tourlink.ts): going back to it replays that step. */
export interface Place { board: string; hit: string | null; view: number[]; stop?: string; tour?: [string, number] }

export interface Stack<T> { back: T[]; fwd: T[] }

/** Long enough for any session; bounded so a page left open does not grow forever. */
export const LIMIT = 100;

export const stack = <T>(): Stack<T> => ({ back: [], fwd: [] });

/** Leaving `left` for somewhere new: it goes on the back stack and the forward branch is dropped. */
export function push<T>(s: Stack<T>, left: T): void {
  s.back.push(left);
  if (s.back.length > LIMIT) s.back.shift();
  s.fwd.length = 0;
}

/** The place to go back to, with `here` kept for forward; null when there is nothing behind. */
export function back<T>(s: Stack<T>, here: T): T | null {
  const t = s.back.pop();
  if (t !== undefined) s.fwd.push(here);
  return t ?? null;
}

export function forward<T>(s: Stack<T>, here: T): T | null {
  const t = s.fwd.pop();
  if (t !== undefined) s.back.push(here);
  return t ?? null;
}

/** ←'s tooltip names where it goes: after a jump it is the one way back (#165). */
export const backTitle = (s: Stack<{ board: string }>, name: (id: string) => string): string => {
  const to = s.back.at(-1);
  return to ? `Back to ${name(to.board)} (Alt+←)` : "Back (Alt+←)";
};

let h = stack<Place>();
let ui: { b: HTMLButtonElement; f: HTMLButtonElement } | null = null;

function sync(): void {
  if (!ui) return;
  ui.b.disabled = !h.back.length;
  ui.f.disabled = !h.fwd.length;
  ui.b.title = backTitle(h, boardName);
}

let quiet = false;
/** Runs `f` without recording a step: turning the detail dial isn't one. */
export function unrecorded(f: () => void): void {
  quiet = true;
  try { f(); } finally { quiet = false; }
}

/** How the history steps through a tour (tourlink.ts): the step showing, replaying one, leaving. */
export interface TourSteps { at(): [string, number] | null; play(at: [string, number]): void; end(): void }
let tours: TourSteps | null = null;
export const tourHistory = (t: TourSteps) => void (tours = t);

/** Records a step that didn't come from show() (a tour step); `keep` drops what was pushed since then. */
export function record(p: Place, keep = h.back.length): void {
  h.back.length = Math.min(keep, h.back.length);
  push(h, p);
  sync();
}
export const depth = () => h.back.length;
/** The stacks as they are, for `rewind`. */
export const mark = (): { n: number; fwd: Place[] } => ({ n: h.back.length, fwd: [...h.fwd] });
/** Undoes what a replayed tour step's own board change recorded, Forward included. */
export function rewind(m: { n: number; fwd: Place[] }): void {
  h.back.length = Math.min(m.n, h.back.length);
  h.fwd = [...m.fwd];
  sync();
}

/** Called by show() when the board changes, with where we were just before. */
export function leaving(p: Place): void {
  if (quiet) return;
  push(h, p);
  sync();
}


export const typing = (t: EventTarget | null) => !!(t as Element | null)?.closest?.("input,textarea,select,[contenteditable],dialog[open]");

/** Adds the Back/Forward buttons to the canvas; `here` reads the current place, `go` restores one. */
export function installHistory(here: () => Place, go: (p: Place) => void): void {
  const nav = document.createElement("span");
  nav.className = "hist";
  nav.innerHTML = `<button id="hback" aria-label="Back" title="Back (Alt+←)">←</button><button id="hfwd" aria-label="Forward" title="Forward (Alt+→)">→</button>`;
  $("canvas").append(nav);
  ui = { b: nav.querySelector("#hback")!, f: nav.querySelector("#hfwd")! };
  const step = (dir: -1 | 1) => {
    const now = tours?.at();
    const t = (dir < 0 ? back : forward)(h, now ? { ...here(), tour: now } : here());
    sync();
    if (!t) return;
    if (t.tour && tours) return tours.play(t.tour);
    if (now) tours?.end();
    go(t);
  };
  ui.b.onclick = () => step(-1);
  ui.f.onclick = () => step(1);
  sync();
  window.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || typing(e.target) || e.ctrlKey || e.metaKey) return;
    const isBack = (e.altKey && e.key === "ArrowLeft") || (!e.altKey && !e.shiftKey && e.key === "Backspace");
    const isFwd = e.altKey && e.key === "ArrowRight";
    if (!isBack && !isFwd) return;
    e.preventDefault();
    step(isBack ? -1 : 1);
  });
}
