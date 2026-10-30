// Focus: hovering or keyboard-focusing a box lights it, its wires and its neighbors; a wire lights
// itself and its two ends. Everything else fades. With nothing hovered, the selection is the focus.
// Same mechanism as a tour step (a class on the svg, opacity on the unlit parts); while a tour
// plays, its own dimming wins (styles.css). Also tracks the zoom level, which shows or hides the
// labels labels.ts could not place without overlap.
// Only a pointer that moves can hover: when the view glides (focus zoom) or the reader zooms, the
// browser reports the part now under a still cursor as hovered, and that part would take the focus
// from the selection (#117: selecting KioskPage lit only the wire that slid under the cursor).
import { $, st } from "./state.ts";
import { syncReframe } from "./reframe.ts";
import { everyLit } from "./everyview.ts";

let hovered: string | null = null;
let forSvg: SVGSVGElement | null = null;
/** Where the pointer last was, in client pixels. */
let at: [number, number] | null = null;

/** Whether a pointer event comes from the pointer moving, rather than the view moving under it. Exported for tests. */
export function moved(last: [number, number] | null, x: number, y: number): boolean {
  return !last || Math.abs(last[0] - x) > 0.5 || Math.abs(last[1] - y) > 0.5;
}

const ends = (hit: string) => hit.slice(2).split(">");

/** The data-hit keys lit by focusing `hit`. Exported for tests. */
export function litBy(hit: string, hits: string[]): Set<string> {
  const on = new Set([hit]);
  if (hit.startsWith("e:")) {
    for (const id of ends(hit)) on.add(`n:${id}`);
    return on;
  }
  const id = hit.slice(2);
  for (const h of hits) {
    if (!h.startsWith("e:")) continue;
    const [a, b] = ends(h);
    if (a === id || b === id) on.add(h).add(`n:${a}`).add(`n:${b}`);
  }
  return on;
}

/** Re-applies focus after a hover, a keyboard focus or a selection change. */
export function refocus(): void {
  const svg = st.svgEl;
  if (!svg) return;
  if (forSvg !== svg) { hovered = null; forSvg = svg; zoomClass(); }
  const gs = [...svg.querySelectorAll<SVGGElement>("g[data-hit]")];
  gs.forEach((g) => g.classList.remove("lit"));
  const hit = hovered ?? st.selected;
  const hits = gs.map((g) => g.dataset.hit!), on = hit ? everyLit(hit, litBy(hit, hits), hits) : new Set<string>();
  const lit = gs.filter((g) => on.has(g.dataset.hit!));
  lit.forEach((g) => g.classList.add("lit"));
  svg.classList.toggle("focusing", lit.length > 0);
}

function hover(hit: string | null): void {
  if (hit === hovered) return;
  hovered = hit;
  refocus();
}

/**
 * Called whenever the viewBox or the canvas size changes. `z-in`: zoomed past the fit, so the
 * labels that could not be placed clear of others show too.
 */
export function zoomClass(): void {
  syncReframe();
  const svg = st.svgEl;
  if (!svg.clientWidth || !svg.clientHeight) return;
  svg.classList.toggle("z-in", st.base[2] / st.view[2] >= 1.5);
}

export function installFocus(): void {
  const canvas = $("canvas");
  const hitOf = (t: EventTarget | null) => (t as Element | null)?.closest?.<SVGGElement>("g[data-hit]")?.dataset.hit ?? null;
  // touch has no hover: a tap selects, and the selection carries the focus
  const point = (e: PointerEvent) => {
    if (e.pointerType === "touch" || !moved(at, e.clientX, e.clientY)) return;
    at = [e.clientX, e.clientY];
    hover(hitOf(e.target));
  };
  canvas.addEventListener("pointerover", point);
  canvas.addEventListener("pointermove", point);
  canvas.addEventListener("pointerleave", () => { at = null; hover(null); });
  canvas.addEventListener("focusin", (e) => hover(hitOf(e.target)));
  window.addEventListener("resize", () => st.svgEl && zoomClass());
  canvas.addEventListener("focusout", (e) => { if (!hitOf(e.relatedTarget)) hover(null); });
}
