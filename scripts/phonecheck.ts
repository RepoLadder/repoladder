// The phone overlap detector (run by `npm run design`): the floating elements of the viewer at phone width
// (top bar, zoom cluster, dock, sheet) may not intersect unless one contains the other, and none may reach
// outside the viewport. `overlaps()` and `clipped()` are pure; `phoneCheck()` drives the page.
type Page = import("playwright").Page;

export interface Rect { name: string; left: number; top: number; right: number; bottom: number }

const EPS = 0.5;
const inside = (a: Rect, b: Rect) => a.left >= b.left - EPS && a.right <= b.right + EPS && a.top >= b.top - EPS && a.bottom <= b.bottom + EPS;

/** Pairs of rects that intersect by more than a hair without one containing the other (touching edges and containment are fine). */
export function overlaps(rects: Rect[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]!, b = rects[j]!;
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > EPS && h > EPS && !inside(a, b) && !inside(b, a)) out.push([a.name, b.name]);
    }
  }
  return out;
}

/** Names of the rects that reach outside a vw×vh viewport. */
export const clipped = (rects: Rect[], vw: number, vh: number): string[] =>
  rects.filter((r) => r.left < -EPS || r.top < -EPS || r.right > vw + EPS || r.bottom > vh + EPS).map((r) => r.name);

/** The floating elements, by name; a visible one only. */
export const FLOATERS = { topbar: "header.topbar", zoom: ".zoom", dock: "#dock > *", sheet: "aside[data-sheet]", search: "div.search[role=dialog]" } as const;

/** The visible floating elements' rects in the page as it is now. */
export const floaterRects = (p: Page): Promise<Rect[]> => p.evaluate((sel) => {
  const out: { name: string; left: number; top: number; right: number; bottom: number }[] = [];
  for (const [name, s] of Object.entries(sel)) {
    document.querySelectorAll(s).forEach((e, i) => {
      const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
      if (r.width && r.height && cs.visibility !== "hidden" && cs.display !== "none") out.push({ name: i ? `${name}${i}` : name, left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    });
  }
  return out;
}, FLOATERS);

/** Prints PHONE_OVERLAP and PHONE_CLIPPED lines for one state; returns how many it printed. */
export async function report(p: Page, state: string, vw: number, vh: number, write: (s: string) => void): Promise<number> {
  const rs = await floaterRects(p);
  // the search dialog is a modal over everything: only it against the viewport counts
  const flat = state.startsWith("search") ? rs.filter((r) => r.name.startsWith("search")) : rs;
  const bad = overlaps(flat).map(([a, b]) => `PHONE_OVERLAP ${state} ${a} ${b}`).concat(clipped(flat, vw, vh).map((n) => `PHONE_CLIPPED ${state} ${n}`));
  for (const l of bad) write(`${l}\n`);
  return bad.length;
}
