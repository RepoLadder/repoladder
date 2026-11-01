// The edge cue: on a narrow canvas the opening view is cropped at a readable zoom (fit.ts), so a fade and a
// chevron mark each canvas side where boxes run past the edge. Imported by reframe.ts; must not import it or fit.ts.
import { onScreen, type Box4 } from "./corner.ts";
import { st } from "./state.ts";

export type Sides = { l: boolean; r: boolean; t: boolean; b: boolean };

/** Which canvas sides (cw×ch, view v) some box (board units) runs past by `min` pixels or more. */
export function clippedSides(v: number[], cw: number, ch: number, boxes: Box4[], min = 4): Sides {
  const s = { l: false, r: false, t: false, b: false };
  for (const box of boxes) {
    const [x, y, w, h] = onScreen(v, cw, ch, box);
    if (x + w > cw + min) s.r = true;
    if (x < -min) s.l = true;
    if (y + h > ch + min) s.b = true;
    if (y < -min) s.t = true;
  }
  return s;
}

/** Draws the cue for the current view. A no-op before the board exists; hidden while `owned` or on a wide canvas. */
export function syncEdgeCue(owned: boolean): void {
  if (typeof document === "undefined" || !st.svgEl) return;
  const canvas = document.getElementById("canvas");
  if (!canvas) return;
  let cue = document.getElementById("edgecue");
  if (!cue) {
    cue = document.createElement("div");
    cue.id = "edgecue";
    cue.className = "edge-cue";
    cue.setAttribute("aria-hidden", "true");
    cue.innerHTML = "<span class=l></span><span class=r></span><span class=t></span><span class=b></span>";
    canvas.prepend(cue);
  }
  const cw = st.svgEl.clientWidth, ch = st.svgEl.clientHeight;
  const rows = st.data.layout[st.cur]?.n ?? [];
  const on = owned || cw >= 760 ? { l: false, r: false, t: false, b: false } : clippedSides(st.view, cw, ch, rows.map(([, x, y, w, h]) => [x, y, w, h] as Box4));
  let letters = "";
  for (const k of ["l", "r", "t", "b"] as const) {
    const sp = cue.querySelector<HTMLElement>("." + k)!;
    sp.toggleAttribute("data-on", on[k]);
    if (on[k]) letters += k;
  }
  cue.dataset.sides = letters;
}
