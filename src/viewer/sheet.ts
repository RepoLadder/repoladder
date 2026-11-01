// Below 760px (styles.css) the side panel is a bottom sheet over a full-width canvas. It rests at
// one of three heights: peek (the title and its Open button), half, and full. Selecting something
// raises it to half and pans the board so the selection stays in view above it (a tour drops it to peek);
// going back to a board's overview lowers it to peek. The grip drags it or, tapped, steps it up.
import { topEdge } from "./embed.ts";
import { MIN_NAME_PX, NAME_PX, pinchView } from "./fit.ts";
import { setView } from "./panzoom.ts";
import { $, STORY, st } from "./state.ts";
import { settled } from "./transition.ts";

export type Snap = "peek" | "half" | "full";

/** Sheet heights for a viewport `vh` tall whose header ends at `top`. Exported for tests. */
export function heights(vh: number, top: number): Record<Snap, number> {
  const peek = Math.round(Math.min(148, vh * 0.3));
  return { peek, half: Math.round(vh * 0.5), full: Math.round(Math.max(vh - top, vh * 0.5)) };
}

/** Where a drag let go at height `h`, moving at `vy` px/ms (positive is downward), comes to rest. */
export function snapTo(h: number, vy: number, hs: Record<Snap, number>): Snap {
  if (vy > 0.4) return h > hs.half ? "half" : "peek";
  if (vy < -0.4) return h < hs.half ? "half" : "full";
  const order: Snap[] = ["peek", "half", "full"];
  return order.reduce((a, b) => (Math.abs(hs[b] - h) < Math.abs(hs[a] - h) ? b : a));
}

const NEXT: Record<Snap, Snap> = { peek: "half", half: "full", full: "peek" };
export const narrow = () => matchMedia("(max-width: 760px)").matches;

let snap: Snap = "peek";
let aside: HTMLElement, grip: HTMLButtonElement;

const hs = () => heights(innerHeight, topEdge());

function setH(h: number): void {
  aside.style.setProperty("--sheet-h", `${Math.round(h)}px`);
  // floating controls (phone.css) ride above the sheet
  document.documentElement.style.setProperty("--sheet-h", `${Math.round(h)}px`);
}

export function setSnap(s: Snap): void {
  snap = s;
  aside.dataset.sheet = s;
  const h = hs();
  setH(h[s]);
  document.documentElement.style.setProperty("--peek", `${h.peek}px`);
  grip.setAttribute("aria-expanded", String(s !== "peek"));
  grip.setAttribute("aria-label", s === "full" ? "Collapse details" : "Show more details");
}

/**
 * Pans the board so the selection sits in the part of the canvas the sheet leaves open. A connection
 * counts with both of its ends, zooming out if that is what it takes to show them together.
 */
function reveal(): void {
  const sel = st.selected;
  if (!sel) return;
  const ids = sel.startsWith("e:") ? [sel, ...sel.slice(2).split(">").map((x) => `n:${x}`)] : [sel];
  const rect = (id: string) => [...st.svgEl.querySelectorAll<SVGGElement>("g[data-hit]")].filter((g) => g.dataset.hit === id).map((g) => g.getBoundingClientRect());
  let rs = ids.flatMap(rect);
  if (!rs.length) return;
  // ends too far apart to show both at a readable zoom (#210): show where the arrow starts
  const k = Math.min(st.svgEl.clientWidth / st.view[2], st.svgEl.clientHeight / st.view[3]);
  if (ids.length > 1 && k * (innerWidth - 40) / (Math.max(...rs.map((r) => r.right)) - Math.min(...rs.map((r) => r.left))) < MIN_NAME_PX / NAME_PX) rs = rect(ids[1]);
  if (!rs.length) return;
  const l = Math.min(...rs.map((r) => r.left)), rt = Math.max(...rs.map((r) => r.right));
  const t = Math.min(...rs.map((r) => r.top)), b = Math.max(...rs.map((r) => r.bottom));
  // clear of the floating top bar as well as the sheet
  const c = $("canvas").getBoundingClientRect(), bottom = Math.min(c.bottom, innerHeight - hs()[snap]), m = 20, top = Math.max(c.top, topEdge());
  if (l >= c.left + m && rt <= c.right - m && t >= top + m && b <= bottom - m) return;
  const f = Math.max(1, (rt - l) / (c.width - 2 * m), (b - t) / (bottom - top - 2 * m));
  setView(pinchView(st.view, st.svgEl.getBoundingClientRect(), [(l + rt) / 2, (t + b) / 2], [(c.left + c.right) / 2, (top + bottom) / 2], f, 1));
}

let last = "";

/** Reacts to a new board, selection or tour step (not to every re-render, such as a Copy button's label). */
function onChange(): void {
  const tour = document.getElementById("tour");
  const touring = !!tour && !tour.hidden;
  const key = `${st.cur}|${st.selected}|${touring ? tour.querySelector(".num")?.textContent : ""}`;
  if (key === last) return;
  last = key;
  const found = aside.querySelector(".found");
  if (found) found.scrollIntoView({ block: "center" });
  else aside.scrollTop = 0;
  // the story level opens with its narrative half up: it is what a first-time reader starts from
  // a tour's card is on the canvas: the player (tour.ts) drops the sheet to its peek and leaves it to the reader
  if (touring) return;
  if (!st.selected) return setSnap(st.cur === STORY ? "half" : "peek");
  if (snap === "peek") setSnap("half");
  // after the board change's zoom, which would skew the measurement (Back already restores the view)
  if (narrow()) void settled().then(() => { if (last === key) reveal(); });
}

function installGrip(): void {
  let start: { y: number; h: number; t: number; py: number; pt: number } | null = null;
  let moved = false;
  grip.addEventListener("pointerdown", (e) => {
    start = { y: e.clientY, h: aside.getBoundingClientRect().height, t: e.timeStamp, py: e.clientY, pt: e.timeStamp };
    moved = false;
    grip.setPointerCapture(e.pointerId);
  });
  grip.addEventListener("pointermove", (e) => {
    if (!start) return;
    const dy = e.clientY - start.y;
    if (Math.abs(dy) > 6) { moved = true; aside.classList.add("dragging"); }
    if (moved) setH(Math.max(hs().peek * 0.6, Math.min(hs().full, start.h - dy)));
    // keep the last ~100ms of motion so a flick reads as one
    if (e.timeStamp - start.pt > 100) { start.py = e.clientY; start.pt = e.timeStamp; }
  });
  const end = (e: PointerEvent) => {
    if (!start) return;
    aside.classList.remove("dragging");
    if (moved) {
      const vy = (e.clientY - start.py) / Math.max(e.timeStamp - start.pt, 1);
      setSnap(snapTo(aside.getBoundingClientRect().height, vy, hs()));
    }
    start = null;
  };
  grip.addEventListener("pointerup", end);
  grip.addEventListener("pointercancel", end);
  grip.addEventListener("click", () => { if (!moved) setSnap(NEXT[snap]); moved = false; });
}

export function installSheet(): void {
  aside = document.querySelector("aside")!;
  aside.insertAdjacentHTML("afterbegin", `<button class="grip" aria-controls="details"><i></i></button>`);
  grip = aside.querySelector(".grip")!;
  setSnap("peek");
  installGrip();
  new MutationObserver(onChange).observe(aside, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
  // keep the current level in view when the crumbs scroll sideways on a narrow header
  const crumbs = $("crumbs");
  new MutationObserver(() => (crumbs.scrollLeft = crumbs.scrollWidth)).observe(crumbs, { childList: true });
  // tapping the empty canvas puts the sheet away
  $("canvas").addEventListener("click", (e) => {
    if (!st.dragged && !(e.target as Element).closest("g[data-hit],.zoom,.exp-ui")) setSnap("peek");
  });
  window.addEventListener("resize", () => setH(hs()[snap]));
}
