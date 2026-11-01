// The floating chrome (header, wide-window side panel) sits over a full-window canvas. Its size is
// measured here and published as --dock-top and --dock-right (px) on the root, for CSS and for the fit
// (region.ts): the board is framed in what the chrome leaves open. Embedded mode and full screen have none.
export interface Dock { top: number; right: number }
interface R { top: number; bottom: number; left: number; right: number; width: number }

/** How far the header reaches down into the canvas and the panel in from its right edge (0: not floating over it). */
export function dockOf(canvas: R, header: R | null, aside: R | null, narrow: boolean, full: boolean): Dock {
  if (full) return { top: 0, right: 0 };
  const top = header && header.width ? Math.max(0, header.bottom - canvas.top) : 0;
  const over = !!aside && aside.width > 0 && !narrow && aside.left < canvas.right && aside.right > canvas.left;
  return { top, right: over ? Math.max(0, canvas.right - aside.left) : 0 };
}

let last: Dock = { top: 0, right: 0 };
/** The last measured dock. */
export const dock = (): Dock => last;

const closed = () => document.querySelector<HTMLElement>("main > aside")?.dataset.inspector === "closed";

/** Measures now, publishes the variables, and returns whether anything changed. */
function measure(): boolean {
  const canvas = document.getElementById("canvas"), root = document.documentElement;
  if (!canvas) return false;
  const rect = (s: string) => document.querySelector(s)?.getBoundingClientRect() ?? null;
  const d = dockOf(canvas.getBoundingClientRect(), rect("header"), closed() ? null : rect("main > aside"), matchMedia("(max-width: 760px)").matches, !!document.fullscreenElement);
  const same = d.top === last.top && d.right === last.right;
  last = d;
  root.style.setProperty("--dock-top", `${d.top}px`);
  root.style.setProperty("--dock-right", `${d.right}px`);
  return !same;
}

/** Call once the shell exists, before the first fit. A change after that is announced as a `dockchange` event on window. */
export function installDock(): void {
  measure();
  const again = () => { if (measure()) window.dispatchEvent(new Event("dockchange")); };
  const ro = new ResizeObserver(again);
  for (const s of ["header", "main > aside", "#canvas"]) { const e = document.querySelector(s); if (e) ro.observe(e); }
  addEventListener("resize", again);
  document.addEventListener("fullscreenchange", again);
}
