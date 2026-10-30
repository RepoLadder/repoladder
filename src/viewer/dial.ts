// The detail dial (docs/detail-dial-v2.md): a narrow column of dots under the zoom buttons, one per
// stop of this repo (budget.ts stopsFor), More (everything) at the top and Less (Simple) at the
// bottom, the current one filled and Default's dot notched so home shows at rest. No text at rest
// (#185): on hover or keyboard focus the title "Detail" and the names of the ends and Default pop
// out to the left over the board, so the column never widens; the stops between are plain
// dots with no text, even on hover (#325; a screen reader says each one's place, counted up from Default). On a
// phone the first tap opens the names and the next tap elsewhere closes them. A turn shows the stop's
// layers (#327): when it removes your board you land on its nearest surviving board with the drawn box
// that held your selection selected (dialmap.ts), and turning back down returns you to the board you
// left. Opening a container turns the dial down to where it has a board (openDown); nothing
// pulses (#168). [ and ] (or Alt+down/up) step down and up; a double-click goes back to Default.
// Remembered per viewer in localStorage relative to Default (dialmap.ts landOn), never in the hash;
// Default is where a first visit lands. Not a history step.
import { ELK_NOTE, elkState, loadElk, onElkState } from "./elkload.ts";
import { landOn, landTurn, mapHit, stepFrom, type Jump } from "./dialmap.ts";
import type { StopDef } from "./budget.ts";
import { here, select } from "./navigate.ts";
import { record, typing, type Place } from "./history.ts";
import { boardAtStop, hasBoardAt, onStop, stopDefs, viewStopDef } from "./stopview.ts";
import { playingId, stopAfter } from "./tour.ts";
import { $, st } from "./state.ts";

export const DETAIL_KEY = "repoladder.detail";

let el: HTMLElement;
let defs: StopDef[] = [];
/** The stop the dial points at. */
let at = "default";
let turning = false;
/** Where you were before a turn took your board away (#327): kept across turns, cleared by any other move. */
let jump: Jump | null = null;
export const forgetJump = (): void => { if (!turning) jump = null; };

const stored = (): string | null => { try { return localStorage.getItem(DETAIL_KEY); } catch { return null; } };
const remember = (s: string) => { try { localStorage.setItem(DETAIL_KEY, s); } catch { /* storage blocked */ } };
const keys = () => (elkState() === "failed" ? ["default"] : defs.map((d) => d.key));

const MIDDLE = "Between Default and More";
/** A middle stop's spoken name: its place counted up from Default ("+1" is 1), as the keys run (budget.ts stopsFor). */
const midLabel = (key: string, n: number) => `${MIDDLE}, ${key.slice(1)} of ${n}`;
const STEP_KEY: Record<string, -1 | 1> = { "]": -1, "[": 1 }, STEP_ALT: Record<string, -1 | 1> = { ArrowUp: -1, ArrowDown: 1 };

function paint(): void {
  const failed = elkState() === "failed", ks = keys();
  // repainting replaces the buttons: a keyboard user keeps focus on the same stop, and the names open
  const had = el.querySelector<HTMLElement>(":focus")?.dataset.stop;
  const mids = defs.filter((d) => d.key.startsWith("+")).length;
  el.style.display = ks.length < 2 && !failed ? "none" : "";
  // the name is the button's aria-label too, so a screen reader says it once
  el.innerHTML = `<b aria-hidden="true">Detail</b>` + defs.filter((d) => ks.includes(d.key)).map((d) =>
    `<button data-stop="${d.key}" aria-pressed="${d.key === at}" aria-label="${d.label || midLabel(d.key, mids)}">${d.label ? `<span>${d.label}</span>` : ""}<i></i></button>`).join("") + (failed ? `<p role="status">${ELK_NOTE}</p>` : "");
  if (had) el.querySelector<HTMLElement>(`[data-stop="${had}"]`)?.focus();
}

/** The names' panel: as wide as the widest fixed name or the title (laid out, hidden, at rest). */
const size = () => el.style.setProperty("--names", `${Math.max(...[...el.querySelectorAll<HTMLElement>("span, b")].map((s) => s.offsetWidth))}px`);

/**
 * Turns the dial to the stop `to` (a StopDef key). Your board stays if it exists there, with the
 * selection kept where it went (dialmap.ts mapHit); else you land on its nearest surviving board
 * (dialmap.ts landTurn). `open` lands on that board instead (a container opened, openDown).
 */
export async function turn(to: string, save = true, open?: string): Promise<boolean> {
  const def = defs.find((d) => d.key === to);
  if (!def || to === at || turning) return to === at;
  const hit = st.selected, cur: Jump = { board: st.cur, hit, view: [...st.view], stop: at }, memo = jump;
  const land = open ? { board: open, restore: false, jump: null } : landTurn(cur, memo, (id) => boardAtStop(to, id), (id) => boardAtStop("default", id));
  const back: Place | undefined = land.restore && memo!.stop === to ? { ...memo!, board: land.board } : undefined;
  turning = true;
  let ok = false;
  try { ok = await viewStopDef(def, land.board, back); } finally { turning = false; }
  if (ok) at = to;
  paint();
  if (!ok) return false;
  jump = land.jump;
  if (save) remember(to);
  if (back || open) return true;
  const b = st.data.boards[st.cur], tree = st.data.tree ?? st.data.nodes;
  const map = (x: string | null) => (b && x ? mapHit(x, st.cur, b, tree, st.data.paths) : null);
  // the box you had selected, else the container or box now holding where you were
  const h = map(hit ?? memo?.hit ?? null) ?? (land.board !== boardAtStop("default", cur.board) ? map(`n:${memo?.board ?? cur.board}`) : null);
  if (h) select(h);
  return true;
}

/**
 * Opens container `id`, which has no board at this stop (#327): turns the dial down to the first stop
 * where it has one and lands on it, as one Back step from where it was opened.
 */
export async function openDown(id: string): Promise<void> {
  const ks = keys(), k = ks.slice(ks.indexOf(at) + 1).find((x) => x !== "simple" && hasBoardAt(x, id)), before = here();
  if (k && (await turn(k, true, id))) record(before);
}

/** Adds the dial under the zoom buttons, and turns to the viewer's remembered stop. */
export function installDial(): void {
  defs = stopDefs();
  el = document.createElement("nav");
  el.className = "dial";
  el.setAttribute("aria-label", "Detail");
  $("canvas").append(el);
  paint();
  // a tour or the script hook changed the stop: follow it, unless it is the view the dial points at
  onStop((s) => { at = s; paint(); });
  // the note shows for a few seconds when the engine fails, then on hover or focus
  onElkState((s) => {
    if (s !== "failed") return;
    paint();
    el.classList.add("told");
    setTimeout(() => el.classList.remove("told"), 6000);
  });
  // the first turn shouldn't wait for elkjs: start it as soon as the dial is reached for. The names'
  // panel is sized then too, before it opens
  const warm = () => {
    size();
    if (elkState() === "idle") void loadElk();
  };
  el.addEventListener("pointerenter", warm);
  el.addEventListener("focusin", warm);
  // home: a double-click anywhere on the dial goes back to Default
  // (after the turn its first click started, which may still be laying out)
  const home = (): void => void (turning ? setTimeout(home, 60) : turn("default"));
  el.addEventListener("dblclick", home);
  // a tap anywhere else closes the names a tap opened
  document.addEventListener("pointerdown", (e) => el.contains(e.target as Node) || el.classList.remove("named"), true);
  el.addEventListener("click", (ev) => {
    const b = (ev.target as Element).closest<HTMLButtonElement>("button[data-stop]");
    if (!b) return;
    // a phone has no hover: its first tap shows the names, so the stop can be read before it is picked
    if (!el.classList.contains("named") && matchMedia("(hover:none)").matches) return el.classList.add("named");
    // a mouse click shouldn't leave every name showing (:focus-within)
    if (!b.matches(":focus-visible")) b.blur();
    // a phone closes the stops a tap opened once turned, giving the board back
    void turn(b.dataset.stop!).then(() => el.classList.remove("named"));
  });
  window.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || typing(e.target)) return;
    // [ and ] step down (toward Less) and up (toward More); Alt+arrows as before
    const dir = e.altKey ? STEP_ALT[e.key] : STEP_KEY[e.key];
    if (!dir) return;
    e.preventDefault();
    const to = stepFrom(keys(), at, dir);
    if (to) void turn(to);
  });
  const raw = stored();
  // the dial's first version stored "detailed": it is the first stop above Default now
  if (raw === "detailed") remember("+1");
  const s = landOn(raw, keys());
  // a tour link plays at its step's own stop (already playing, maybe still laying it out), and the
  // remembered stop is where leaving the tour lands
  if (playingId() !== undefined) stopAfter(s);
  else if (s !== "default") void turn(s, false);
}
