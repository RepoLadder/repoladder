// Up, across, down (docs/tours-v2.md): the one move between any two boards, for the tour player
// and any caller that goes sideways. The camera climbs in one zoom to the nearest board where both
// ends show (their lowest common ancestor), the box you came from lit; the data dot runs the real
// arrow across to the box you're going to; then it dives into that box, one zoom per level, so
// every level on the way is seen. The move owns no state of its own beyond the run in progress:
// every hop is an ordinary show() (transition.ts zooms, the breadcrumb follows), so cutting it
// short (finishTravel) just shows the end.
import { unrecorded } from "./history.ts";
import { show } from "./navigate.ts";
import { dot, reduced } from "./pulse.ts";
import { N, home, st } from "./state.ts";
import { currentStop, hasBoardAt, viewStop } from "./stopview.ts";
import { setView } from "./panzoom.ts";
import { aimNext, finishTransition, pace, settled } from "./transition.ts";

/** A board at a detail stop ("default", "+1", "everything", … as the dial stores it). */
export interface Spot { board: string; stop: string }

/**
 * The phases in ms, tuned by feel (a full up, across and down is ~1.5s); `__repoladder.travelTiming`
 * for scripts. `look` holds on both ends lit before the dot runs, `hold` on the box you're about to enter,
 * `dive` is shared by the levels on the way down (each at least `level`), `pass` the dot across a level on the way. `fade` is reduced motion's.
 */
export const travelTiming = { climb: 380, look: 80, cross: 380, hold: 60, dive: 440, level: 240, pass: 280, fade: 150 };

/**
 * The path between two boards in a tree given by `parent`: `top` the lowest common ancestor, `up`
 * the box on `top` that holds `from` (null when `from` is `top`), `down` the boards shown from
 * there on, the box on `top` first and `to` last (empty when `to` is `top`). Null with no common ancestor.
 */
export function route(from: string, to: string, parent: (id: string) => string | null | undefined): { top: string; up: string | null; down: string[] } | null {
  const line = (id: string) => { const a: string[] = []; for (let c: string | null | undefined = id; c && !a.includes(c); c = parent(c)) a.push(c); return a; };
  const f = line(from), t = line(to), i = t.findIndex((id) => f.includes(id));
  if (i < 0) return null;
  return { top: t[i], up: f[f.indexOf(t[i]) - 1] ?? null, down: t.slice(0, i).reverse() };
}

/** The board above `id` at this stop (a Simple-only id: in the page's tree); a level-1 part's is the top board. */
const parentOf = (id: string) => {
  if (id === home()) return null;
  const p = (N()[id] ?? st.data.tree?.[id])?.parent;
  return !p || p === "root" ? home() : p;
};

/** `parentOf` skipping boards with no layer at `stop` (#327), so a move down passes only boards that exist there. */
const parentAt = (stop: string) => (id: string) => {
  let p = parentOf(id);
  while (p && !hasBoardAt(stop, p)) p = parentOf(p);
  return p;
};

let live: { end: () => void } | null = null;

/** Jumps a move in progress to its end (Next or Back pressed mid-move); its promise resolves there. */
export function finishTravel(): void {
  const l = live;
  live = null;
  l?.end();
}

function light(boxes: (string | null)[], wire?: string): void {
  const svg = st.svgEl;
  svg.classList.add("walking");
  svg.querySelectorAll<SVGGElement>("g[data-hit]").forEach((g) => {
    const h = g.dataset.hit!, on = h === `e:${wire}` || boxes.some((b) => h === `n:${b}`);
    g.classList.toggle("wk-off", !on);
    g.classList.toggle("wk-now", on);
  });
}
const unlight = () => {
  light([]);
  st.svgEl.querySelectorAll(".wk-off").forEach((g) => g.classList.remove("wk-off"));
  st.svgEl.classList.remove("walking");
};

/**
 * Pans the board just shown, zooming out only if it must, so boxes `ids` are in the part of the canvas
 * you can see: a phone opens a big board cropped, with the sheet over its lower half.
 */
function frame(ids: (string | null)[]): void {
  const rs = ids.flatMap((id) => [...st.svgEl.querySelectorAll<SVGGElement>(`g[data-hit="n:${id}"]`)].map((g) => g.getBoundingClientRect()));
  if (!rs.length) return;
  const c = st.svgEl.getBoundingClientRect(), a = document.querySelector("main > aside")?.getBoundingClientRect();
  // the sheet may still be rising to half (sheet.ts heights)
  const bot = a && a.left < c.right && a.top > c.top ? Math.min(c.bottom, a.top, innerHeight / 2) : c.bottom;
  const l = Math.min(...rs.map((r) => r.left)) - 20, t = Math.min(...rs.map((r) => r.top)) - 20;
  const w = Math.max(...rs.map((r) => r.right)) + 20 - l, h = Math.max(...rs.map((r) => r.bottom)) + 20 - t;
  // only a box cut off moves it (the 20px margin is for the framing, not the test)
  if (l + 20 >= c.left && t + 20 >= c.top && l + w - 20 <= c.right && t + h - 20 <= bot) return;
  const v = st.view, k = Math.min(c.width / v[2], c.height / v[3]), K = k * Math.min(1, c.width / w, (bot - c.top) / h);
  // the boxes' center, in board units
  const x = v[0] + (l + w / 2 - c.left - (c.width - v[2] * k) / 2) / k, y = v[1] + (t + h / 2 - c.top - (c.height - v[3] * k) / 2) / k;
  setView([x - c.width / 2 / K, y - (bot - c.top) / 2 / K, c.width / K, c.height / K]);
}

/** Shows `board`, at `stop` when that differs from the stop on screen (a failed stop shows it at this one); a Back step only with `rec` (a stop change never is one). */
async function land(board: string, stop: string, rec = false): Promise<void> {
  if (stop !== currentStop() && (await viewStop(stop, board))) return;
  if (rec) show(board);
  else unrecorded(() => show(board));
}

/**
 * Moves from `from` to `to`: up to their common board, across `edge` (drawn ids on that board, as
 * `a>b` is drawn; when left out or not drawn there, the arrow between the two sides, run the way
 * you travel; none, and both sides are lit with no dot), and down.
 * Changes the detail stop on the way down when the two differ. Records one Back step, the departure.
 * Resolves when the move ends, also when cut short by finishTravel or another travel.
 */
export function travel(from: Spot, to: Spot, edge?: [string, string]): Promise<void> {
  finishTravel();
  const keep = { ...pace }, timers: Animation[] = [];
  let resolve!: () => void;
  const ended = new Promise<void>((r) => (resolve = r));
  const me = {
    end: () => {
      timers.forEach((a) => a.cancel());
      aimNext(() => {});
      unlight();
      const at = st.cur === to.board && currentStop() === to.stop;
      (at ? Promise.resolve() : land(to.board, to.stop)).then(() => {
        finishTransition();
        Object.assign(pace, keep);
        resolve();
      });
    },
  };
  const run = (a: Animation) => (timers.push(a), a.finished.catch(() => {}));
  // a still moment, scaled like the zooms when DevTools slows animations (frame strips)
  const wait = (ms: number) => run(st.svgEl.animate(null, ms));
  const on = () => live === me;
  live = me;
  void (async () => {
    if (st.cur !== from.board || currentStop() !== from.stop) { await land(from.board, from.stop); finishTransition(); }
    const T = travelTiming, r = from.board === to.board ? null : route(from.board, to.board, parentAt(to.stop));
    if (!r || reduced()) {
      pace.fade = T.fade;
      if (from.board !== to.board || from.stop !== to.stop) await land(to.board, to.stop, true);
      await settled();
      return on() && finishTravel();
    }
    const { top, up, down } = r, next = down[0] ?? null;
    let rec = true;
    // `ends`: the boxes the move crosses next, framed before the zoom is measured, so it lands on them
    const go = async (id: string, ms: number, ends: (string | null)[], stop = currentStop()) => {
      pace.zoom = ms;
      aimNext(() => frame(ends));
      await land(id, stop, rec);
      rec = false;
      await settled();
    };
    // the stop changes on the way down; a pure climb changes it here
    if (up) await go(top, T.climb, [up, next], next ? undefined : to.stop);
    if (!on()) return;
    // both ends and the arrow between them lit at once (the arrow given, else the one between them, never its reverse),
    // so the eye lands on where you were and where you're going, then the dot runs it the way you travel;
    // with no such arrow drawn the two ends light and hold (the move draws nothing the board doesn't)
    const across = async (a: string | null, b: string | null, ms: number, look: number, e?: [string, string]) => {
      const has = (k = "") => !!st.svgEl.querySelector(`g.wire[data-hit="e:${k}"]`);
      const wire = b && [e?.join(">"), `${a}>${b}`].find(has);
      light([a, b, ...(e && wire === e.join(">") ? e : [])], wire || undefined);
      await wait(look);
      const d = wire && on() ? dot(st.svgEl, wire, ms) : null;
      // no arrow to run: the lit pair still holds long enough for the dimming to read
      await (d ? run(d) : b && on() && wait(ms / 2));
      if (b && on()) await wait(T.hold);
    };
    await across(up, next, T.cross, T.look, edge);
    const ms = Math.max(T.level, T.dive / down.length);
    for (let k = 0; k < down.length && on(); k++) {
      await go(down[k], ms, k + 1 < down.length ? [up, down[k + 1]] : [], k === 0 && to.stop !== currentStop() ? to.stop : undefined);
      // a level on the way: the dot carries on from where you came from (an "elsewhere" box here) into the next part
      if (k + 1 < down.length && on()) await across(up, down[k + 1], T.pass, 0);
    }
    if (on()) finishTravel();
  })();
  return ended;
}
