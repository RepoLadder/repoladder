// Pan and zoom by rewriting the board SVG's viewBox: wheel, drag, two-finger pinch, and the buttons.
import { dragged } from "./deselect.ts";
import { limits, reframe, pinchView } from "./fit.ts";
import { zoomClass } from "./focus.ts";
import { $, st } from "./state.ts";
import { clampFactor, clampView, wheelFactor } from "./zoomlimits.ts";

const apply = () => { st.svgEl.setAttribute("viewBox", st.view.join(" ")); zoomClass(); };

/** Shows view v, held within the board's zoom and pan bounds (zoomlimits.ts); (ax, ay) is the zoom anchor. */
export function setView(v: number[], ax = 0.5, ay = 0.5): void {
  st.view = clampView(v, st.svgEl.clientWidth, st.svgEl.clientHeight, limits(), ax, ay);
  apply();
}

function zoom(f0: number, cx = 0.5, cy = 0.5): void {
  const v = st.view, f = clampFactor(v, f0, st.svgEl.clientWidth, st.svgEl.clientHeight, limits());
  const w = v[2] * f, h = v[3] * f;
  setView([v[0] + (v[2] - w) * cx, v[1] + (v[3] - h) * cy, w, h]);
}

/** Zoom in (f < 1) or out (f > 1) about the canvas center: what the buttons and the +/- keys share. */
export { zoom as zoomBy };
/** Back to the fit, as the Reframe button does. */
export const reframeNow = (): void => setView(reframe());

type Pt = [number, number];
const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function installPanZoom(): void {
  const canvas = $("canvas");
  // Fingers (or the mouse) currently down on the canvas, and where the gesture started from.
  const down = new Map<number, Pt>();
  let drag: { x: number; y: number; v: number[] } | null = null;
  let pinch: { c: Pt; d: number; v: number[] } | null = null;

  const begin = () => {
    const pts = [...down.values()];
    drag = pinch = null;
    if (pts.length === 1) drag = { x: pts[0][0], y: pts[0][1], v: [...st.view] };
    else if (pts.length >= 2) pinch = { c: mid(pts[0], pts[1]), d: dist(pts[0], pts[1]), v: [...st.view] };
  };

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = st.svgEl.getBoundingClientRect();
    // proportional to the scroll, so a trackpad's stream of small deltas zooms no faster than a wheel
    zoom(wheelFactor(e.deltaY, e.deltaMode, e.ctrlKey), (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  }, { passive: false });
  canvas.addEventListener("pointerdown", (e) => {
    if ((e.target as Element).closest(".zoom,.hist,.walk-card,.exp-ui") || (e.pointerType === "mouse" && e.button !== 0)) return;
    if (!down.size) st.dragged = false;
    down.set(e.pointerId, [e.clientX, e.clientY]);
    // a second finger turns the drag into a pinch, which is never a tap
    if (down.size > 1) st.dragged = true;
    begin();
  });
  window.addEventListener("pointermove", (e) => {
    if (!down.has(e.pointerId)) return;
    down.set(e.pointerId, [e.clientX, e.clientY]);
    const r = st.svgEl.getBoundingClientRect();
    if (pinch) {
      const [a, b] = [...down.values()];
      const m = mid(a, b);
      return setView(pinchView(pinch.v, r, pinch.c, m, pinch.d, dist(a, b)), (m[0] - r.left) / r.width, (m[1] - r.top) / r.height);
    }
    if (!drag) return;
    const s = Math.max(st.view[2] / r.width, st.view[3] / r.height);
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (dragged(dx, dy, e.pointerType)) st.dragged = true;
    setView([drag.v[0] - dx * s, drag.v[1] - dy * s, st.view[2], st.view[3]]);
  });
  const up = (e: PointerEvent) => {
    if (!down.delete(e.pointerId)) return;
    // lifting one finger of a pinch carries on as a drag from where the other one is
    begin();
    if (!down.size) setTimeout(() => (st.dragged = false), 0);
  };
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
  $("zin").onclick = () => zoom(1 / 1.25);
  $("zout").onclick = () => zoom(1.25);
  $("zfit").onclick = () => { reframeNow(); $("zin").focus(); };
}
