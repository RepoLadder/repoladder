// Keeps the canvas's corner buttons, zoom and the dial under it (top right) and Back/Forward (top left,
// history.ts), off the boxes in a board's opening view. A board that fills the canvas would otherwise put
// its top corner boxes under them.
import { scaleOf } from "./zoomlimits.ts";

type View = number[];
/** [x, y, w, h] */
export type Box4 = [number, number, number, number];

/** Where board rect r lands on a cw×ch canvas showing view v with preserveAspectRatio "xMidYMid meet". */
export function onScreen(v: View, cw: number, ch: number, r: Box4): Box4 {
  const s = scaleOf(v, cw, ch), ox = (cw - v[2] * s) / 2, oy = (ch - v[3] * s) / 2;
  return [ox + (r[0] - v[0]) * s, oy + (r[1] - v[1]) * s, r[2] * s, r[3] * s];
}

export const hits = (a: Box4, b: Box4) => a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];

/** Whether any of `boxes` (board units) lands under one of `rs` (canvas pixels) in view v. */
export const covers = (v: View, cw: number, ch: number, boxes: number[][], rs: number[][]) => boxes.some((r) => rs.some((b) => hits(onScreen(v, cw, ch, r as Box4), b as Box4)));

/**
 * The view, grown just enough that no box lies under `btn` (the buttons' rects in canvas pixels, with
 * a small margin). It grows the view upwards, rightwards or leftwards, whichever keeps the bigger zoom;
 * a view cropped to a readable zoom (phone) moves down instead of growing, so names keep their size
 * and the board's left edge stays near; when moving down alone can't clear the dial's column, it
 * also slides right across the board, by as little as clears, up to view x `maxX` (slideCap, #287).
 */
export function clearCorner(v: View, boxes: Box4[], cw: number, ch: number, btn: Box4 | Box4[], cropped = false, maxX = v[0]): View {
  const btns = (typeof btn[0] === "number" ? [btn] : btn) as Box4[];
  if (!cw || !ch || !boxes.length) return v;
  const clear = (u: View) => !covers(u, cw, ch, boxes, btns);
  if (clear(v)) return v;
  const step = Math.max(v[2], v[3]) / 100;
  // a cropped view slides right as well as up, by as little as clears (its x is v[0] when not cropped)
  for (let j = 0, n = cropped ? Math.ceil((maxX - v[0]) / step) : 0; j <= n; j++) {
    const x = Math.min(maxX, v[0] + j * step);
    for (let i = 0; i <= 40; i++) {
      const d = step * i, y = v[1] - d;
      const ok = (cropped ? [[x, y, v[2], v[3]]] : [[x, y, v[2], v[3] + d], [x, v[1], v[2] + d, v[3]], [x - d, v[1], v[2] + d, v[3]]]).filter(clear).sort((a, b) => scaleOf(b, cw, ch) - scaleOf(a, cw, ch));
      if (ok.length) return ok[0];
    }
  }
  return v;
}

/** The furthest a cropped view v may slide (view x): the dial's `px` width in board units, never past the board's (`whole`) right edge nor below v[0]. */
export const slideCap = (v: View, whole: View, px: number, cw: number, ch: number): number =>
  Math.max(v[0], Math.min(v[0] + px / scaleOf(v, cw, ch), whole[0] + whole[2] - v[2]));
