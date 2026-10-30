// Deep links to a tour step, `#tour.<id>.<n>` (tokens in deeplink.ts), and the tour as history:
// every step is a Back/Forward step, and a link lands on its step with no animation.
import { copyText, linkBox, parseTourToken, shareLink, tourLinks, tourToken, writeHash } from "./deeplink.ts";
import { depth, mark, record, rewind, tourHistory, type Place } from "./history.ts";
import { st } from "./state.ts";
import { leaveTour, onTourStep, playingId, playTour } from "./tour.ts";
import type { Tour } from "../model/compose.ts";
import { findTour } from "./walk.ts";
import { here, show } from "./navigate.ts";
import { finishTransition } from "./transition.ts";

/**
 * The tour's id in a link: the grouping's own, or a board's tour (`@0`, `@read`, ids only that board
 * knows) prefixed with its board, `<board>@<i>`.
 */
const linkId = (t: Tour) => (t.id.startsWith("@") ? `${t.steps[0]?.board ?? st.cur}${t.id}` : t.id);

/** Plays the tour a link id names from step `i`, opening a board tour's board first; false if none. */
function start(id: string, i: number): boolean {
  const k = id.indexOf("@");
  if (k > 0) {
    if (!st.data.layout[id.slice(0, k)]) return false;
    if (st.cur !== id.slice(0, k)) show(id.slice(0, k));
    id = id.slice(k);
  }
  const t = findTour(id);
  if (!t) return false;
  i = Math.min(i, t.steps.length - 1);
  // opened cold, nothing is drawn yet: the step's board is the first one shown
  if (!st.svgEl) show(t.steps[i].board);
  playTour(id, i);
  return true;
}

let at: [string, number] | null = null;
/** The step showing, as a Place, and the back stack's depth when it was recorded. */
let cur: { p: Place; keep: number } | null = null;
/**
 * A step replayed by Back/Forward: the stacks to rewind to, so the player's own board change isn't
 * recorded. Starting a tour while one plays leaves it first, so it holds until a step shows.
 */
let replay: { m: ReturnType<typeof mark>; leave: boolean } | null = null;

function stepped(tour: Tour | null, i: number): void {
  const was = at;
  at = tour ? [linkId(tour), i] : null;
  if (replay) {
    rewind(replay.m);
    if (tour || replay.leave) replay = null;
  } else if (was && cur) record(cur.p, cur.keep); // a new step: the one before it is a place to go back to, not its board alone
  cur = at ? { p: { ...here(), tour: at }, keep: depth() } : null;
  writeHash();
  if (at) addCopy();
}

function play(t: [string, number]): void {
  replay = { m: mark(), leave: false };
  if (!start(...t)) replay = null;
}

/** Opens a tour link; false when the hash is not one, or names no tour here. */
function open(hash: string): boolean {
  const t = parseTourToken(hash);
  const cold = !st.svgEl;
  if (!t || !start(t.id, t.step)) return false;
  // opened cold, the steps before the linked one are behind it, so Back walks the tour from its start
  const tour = cold && playingId() !== undefined ? findTour(playingId()!) : undefined;
  if (tour) {
    const keep = depth(), first = Math.min(t.step, tour.steps.length - 1);
    for (let k = 0; k < first; k++) record({ board: tour.steps[k].board, hit: null, view: [], tour: [t.id, k] }, keep + k);
    if (cur) cur.keep = depth();
  }
  // a link lands on the step, with no zoom from wherever the page was
  finishTransition();
  return true;
}
// a chain link, drawn in the button's text color
const ICON = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6.5 9.5l3-3M7 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1M9 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1"/></svg>`;

/** The small "copy link" button in the tour's strip; the clipboard write stays inside the click. */
function addCopy(): void {
  const nav = document.querySelector("#tour .tour-nav");
  if (!nav || nav.querySelector(".tour-link")) return;
  const b = document.createElement("button");
  b.className = "tour-link";
  b.innerHTML = ICON;
  b.title = "Copy a link to this step";
  b.setAttribute("aria-label", "Copy a link to this step");
  nav.querySelector("[data-tour-exit]")?.before(b) ?? nav.append(b);
  b.onclick = () => {
    const url = shareLink();
    // blocked in a sandboxed frame: the link shows under the buttons, selected
    copyText(url, () => linkBox(nav, url), (label) => {
      b.textContent = label;
      setTimeout(() => (b.innerHTML = ICON), 1200);
    });
  };
}

export function installTourLinks(): void {
  tourLinks(() => (at ? tourToken(...at) : null), open);
  tourHistory({ at: () => at, play, end: () => { if (at) { replay = { m: mark(), leave: true }; leaveTour(false); } } });
  onTourStep(stepped);
}
