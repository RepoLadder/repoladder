// The walkthrough's framing bounds on a canvas under floating chrome (dock.ts): the board stays below the header
// (from `y0`) and left of the wide-window panel (to `x1`), the same open region the fit uses (region.ts).
import { dock } from "./dock.ts";
import { openRegion } from "./region.ts";

export interface Bounds { y0: number; x1: number }

/** The open part of a cw-wide canvas, as the top and right bounds walkfit.ts frames within. */
export function walkBounds(cw: number): Bounds {
  const r = openRegion(cw, 0, dock());
  return { y0: r.y, x1: r.w };
}
