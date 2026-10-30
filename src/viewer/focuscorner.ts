// On a phone the focus zoom (focuszoom.ts) fits a selection into a canvas as narrow as the corner
// buttons are wide: Back/Forward top left, zoom top right. Nothing between them is free, so a selection framed tall enough reaches up under one of
// them (#152). fit.ts and corner.ts keep the board's opening view clear the same way.
import { onScreen, hits, type Box4 } from "./corner.ts";
import { buttons } from "./fit.ts";

interface Area { x: number; y: number; w: number; h: number }
type View = number[];

/** Room left between a button's bottom edge (its margin included) and the boxes framed below it. */
const GAP = 8;

/** The corner buttons on the canvas now, as svg-pixel rects with a margin. */
export const cornerButtons = (): Box4[] => [".zoom", ".dial", ".canvas > .hist"].map(buttons).filter((b) => b[2] > 0);

export interface FocusFrame {
  /** The focus view centered in an area of the canvas, `m` pixels in from its edges (focusView). */
  fit: (a: Area) => View;
  /** The open part of the canvas (svg pixels), the selection's union and its boxes (board units). */
  area: Area; union: Area; boxes: Box4[];
  /** The selected box or arrow itself (board units): when not all of the selection fits, it does. */
  sel?: Box4 | null;
  /** The svg's size, the buttons on it, and the least zoom panzoom.ts allows (pixels per unit). */
  w: number; h: number; btns: Box4[]; kMin: number; m?: number;
}

/**
 * The focus view with none of `boxes` under a corner button: the plain fit when it is clear already;
 * else the fit into the area below the lowest button; and when that would zoom out past `kMin` (the
 * view would be zoomed back in about its center, lifting the boxes again), the least zoom with the
 * selection's top just below the buttons, its bottom running under the sheet, but never so far that
 * the selected box itself leaves the open area. Exported for tests.
 */
export function clearOfButtons(f: FocusFrame): View {
  const { fit, area, union: u, boxes, w, h, btns, kMin, m = 28 } = f;
  const k = (v: View) => w / v[2];
  // what panzoom.ts's clamp would make of a view zoomed out too far: zoomed in about its center
  // (on a phone kMin is the readable zoom, #210), moved so the selected box stays in the open area
  const atLeast = (v: View): View => {
    if (k(v) >= kMin) return v;
    let x = v[0] + (v[2] - w / kMin) / 2, y = v[1] + (v[3] - h / kMin) / 2;
    if (f.sel) {
      x = into(x, f.sel[0], f.sel[2], kMin, area.x + GAP, area.x + area.w - GAP);
      y = into(y, f.sel[1], f.sel[3], kMin, area.y + GAP, area.y + area.h - GAP);
    }
    return [x, y, w / kMin, h / kMin];
  };
  // a box under a button, or lifted off the top of the canvas by that clamp
  const hidden = (v: View) => boxes.some((r) => { const s = onScreen(v, w, h, r); return s[1] < 0 || btns.some((b) => hits(s, b)); });
  const v = atLeast(fit(area));
  if (!btns.length || !hidden(v)) return v;
  const below = Math.max(...btns.map((b) => b[1] + b[3])) + GAP;
  const top = Math.max(area.y, below - m);
  const v2 = fit({ x: area.x, y: top, w: area.w, h: Math.max(area.y + area.h - top, 2 * m + 1) });
  if (k(v2) >= kMin) return v2;
  const lo = Math.max(below, area.y + m);
  let x = u.x + u.w / 2 - (area.x + area.w / 2) / kMin, y = u.y - lo / kMin;
  if (f.sel) {
    // the selected box keeps clear of the buttons, the sheet and the sides, its neighbors give way
    const [sx, sy, sw, sh] = f.sel;
    x = into(x, sx, sw, kMin, area.x + GAP, area.x + area.w - GAP);
    y = into(y, sy, sh, kMin, lo, area.y + area.h - GAP);
  }
  return [x, y, w / kMin, h / kMin];
}

/** The view origin `o`, moved as little as possible so [s, s + len] lands within screen [a, b] at zoom k (its start wins). */
function into(o: number, s: number, len: number, k: number, a: number, b: number): number {
  if ((s + len - o) * k > b) o = s + len - b / k;
  if ((s - o) * k < a) o = s - a / k;
  return o;
}
