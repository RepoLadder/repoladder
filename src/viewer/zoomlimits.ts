// Zoom bounds and wheel sensitivity (#130). The view never zooms out past a little beyond the whole
// board's fit, never in past box names a few times their fitted size, and never pans the board off the
// canvas. Pure functions: panzoom.ts applies them with the current board's fit (fit.ts).
type View = number[];

/** Zoomed out at most this far past the whole board's fit, so the board never shrinks into a speck. */
export const OUT_MARGIN = 1.1;
/** Zoomed in at most this many times the opening fit... */
export const IN_TIMES = 4;
/** ...but always at least this far (2 px per board unit: box names 29px), so small fits can still read up close. */
export const IN_MIN_K = 2;
/** At least a third of the canvas (or the whole board, if smaller) keeps board in it. */
export const KEEP = 1 / 3;

/** Pixels per board unit for view v on a cw×ch canvas (preserveAspectRatio "xMidYMid meet"). */
export const scaleOf = (v: View, cw: number, ch: number) => Math.min(cw / v[2], ch / v[3]);

export interface Limits { kMin: number; kMax: number; whole: View }

/** The zoom range for a board whose whole extent is `whole` and whose opening view is `base`. */
export function limitsFor(whole: View, base: View, cw: number, ch: number): Limits {
  const kWhole = Math.min(scaleOf(whole, cw, ch), scaleOf(base, cw, ch)), kBase = scaleOf(base, cw, ch);
  return { kMin: kWhole / OUT_MARGIN, kMax: Math.max(IN_TIMES * kBase, IN_MIN_K, kWhole), whole };
}

/** The factor that scales a view's size by `f` (f > 1 zooms out) clamped so the result stays within limits. */
export function clampFactor(v: View, f: number, cw: number, ch: number, l: Limits): number {
  const k = scaleOf(v, cw, ch);
  return k / Math.max(l.kMin, Math.min(l.kMax, k / f));
}

/**
 * The view, zoomed into range about the point at fractions (ax, ay) of the canvas, and then panned so
 * the board still covers at least KEEP of the canvas on each axis (or all of the board, when smaller).
 */
export function clampView(v: View, cw: number, ch: number, l: Limits, ax = 0.5, ay = 0.5): View {
  if (!cw || !ch || !l.whole[2] || !l.whole[3] || !v[2] || !v[3]) return v;
  const f = clampFactor(v, 1, cw, ch, l);
  const w = v[2] * f, h = v[3] * f;
  let x = v[0] + (v[2] - w) * ax, y = v[1] + (v[3] - h) * ay;
  // the part of the board plane the canvas shows: the view, letterboxed to the canvas's aspect
  const k = scaleOf([x, y, w, h], cw, ch), sw = cw / k, sh = ch / k;
  const cx = shift(x + w / 2, sw, l.whole[0], l.whole[2]), cy = shift(y + h / 2, sh, l.whole[1], l.whole[3]);
  x += cx; y += cy;
  return [x, y, w, h];
}

/** How far to move a visible span of `span` centered at `c` so it overlaps the board [b0, b0 + bw] by enough. */
function shift(c: number, span: number, b0: number, bw: number): number {
  const m = Math.min(KEEP * span, bw);
  const lo = b0 + m - span / 2, hi = b0 + bw - m + span / 2;
  return c < lo ? lo - c : c > hi ? hi - c : 0;
}

/** Pixels per wheel "line" and "page" (deltaMode 1 and 2), as browsers that report lines mean them. */
const LINE = 33, PAGE = 800;
/** One mouse-wheel notch (100px in Chrome, Safari and Edge) zooms by this much. */
export const NOTCH = 1.1;
/** A trackpad pinch (ctrl+wheel, small deltas) is steeper per pixel, as the fingers' spread is. */
const PINCH_PER_PX = 0.01;
/** No single event zooms by more than one notch, so a burst of events or a fast flick stays gentle. */
const MAX_PX = 100;

/** The view-size factor for one wheel event (> 1 zooms out). */
export function wheelFactor(deltaY: number, deltaMode = 0, ctrl = false): number {
  const px = deltaY * (deltaMode === 1 ? LINE : deltaMode === 2 ? PAGE : 1);
  if (!ctrl) return Math.exp((Math.log(NOTCH) / 100) * Math.max(-MAX_PX, Math.min(MAX_PX, px)));
  return Math.exp(Math.max(-Math.log(NOTCH), Math.min(Math.log(NOTCH), PINCH_PER_PX * px)));
}
