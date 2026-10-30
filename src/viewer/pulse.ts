// A soft pulse that travels along drawn arrows, wave after wave, then rests and goes again: the
// "little animation showing the flow of the data" of the walkthrough (walk.ts) and the story level.
// With reduced motion nothing moves; the lit path says it alone.

/** Pulse speed in px/s of board space, and the bounds on one wave's time. Slow on purpose: calm motion. */
const SPEED = 260, MIN_MS = 900, MAX_MS = 1800, REST_MS = 1100;
/** The pulse's dash length: its size is the stroke width (walk.css `.flow-pulse`). */
const DOT = 0.1;

export const reduced = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function layer(svg: SVGSVGElement): SVGGElement {
  let g = svg.querySelector<SVGGElement>("g.flow-fx");
  if (!g) {
    g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", "flow-fx");
    // above the wires, under the boxes
    svg.insertBefore(g, svg.querySelector("g[data-hit^='n:']"));
  }
  return g;
}

/** A pulse's own copy of a drawn arrow's path, in the effects layer. */
function trace(fx: SVGGElement, line: Element): SVGPathElement {
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("class", "flow-pulse");
  p.setAttribute("d", line.getAttribute("d")!);
  fx.append(p);
  return p;
}

export function stopPulse(svg: SVGSVGElement | null): void { svg?.querySelector("g.flow-fx")?.remove(); }

/** One dot along the drawn arrow `key` (`a>b`), once, start to end: travel.ts's crossing. */
export function dot(svg: SVGSVGElement, key: string, ms: number): Animation | null {
  const line = [...svg.querySelectorAll<SVGGElement>("g.wire[data-hit]")].find((g) => g.dataset.hit === `e:${key}`)?.querySelector("path.line");
  if (!line) return null;
  const p = trace(layer(svg), line);
  const L = p.getTotalLength?.() || 1, a = DOT, b = -L;
  p.style.strokeDasharray = `${DOT} ${L + DOT}`;
  // at least ~12px on screen: on a top board fitted small the walk's dot would read as a speck
  p.style.strokeWidth = String(Math.max(9, 12 / (svg.getScreenCTM?.()?.a || 1)));
  return p.animate([{ strokeDashoffset: a, opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 1, offset: 0.88 }, { strokeDashoffset: b, opacity: 0 }], { duration: ms, easing: "cubic-bezier(.45,0,.35,1)", fill: "forwards" });
}

/**
 * Pulses the arrows `waves` (hit keys `a>b`, one array per wave) in order, looping. `at` freezes it
 * as a still frame: 1.5 is halfway along the second wave (for screenshots and tests, and shown even
 * with reduced motion).
 */
export function pulse(svg: SVGSVGElement, waves: string[][], at?: number): void {
  stopPulse(svg);
  if (at === undefined && reduced()) return;
  const wires = new Map([...svg.querySelectorAll<SVGGElement>("g.wire[data-hit]")].map((g) => [g.dataset.hit!.slice(2), g.querySelector<SVGPathElement>("path.line")]));
  const fx = layer(svg);
  const ws = waves.map((w) => w.flatMap((k) => {
    const line = wires.get(k);
    if (!line) return [];
    const p = trace(fx, line);
    return [{ p, L: p.getTotalLength?.() || 1 }];
  })).filter((w) => w.length);
  const ms = ws.map((w) => Math.round(Math.min(MAX_MS, Math.max(MIN_MS, (Math.max(...w.map((x) => x.L)) / SPEED) * 1000))));
  const T = ms.reduce((a, b) => a + b, 0) + REST_MS;
  let t0 = 0, freeze: number | undefined;
  ws.forEach((w, k) => {
    if (at !== undefined && Math.floor(at) === k) freeze = t0 + (at - k) * ms[k];
    const s = t0 / T, e = (t0 + ms[k]) / T, d = e - s;
    for (const { p, L } of w) {
      // a dot, not a streak: a near-zero dash drawn as a round cap
      const seg = DOT, a = seg, b = -L;
      p.style.strokeDasharray = `${seg} ${L + seg}`;
      p.style.strokeDashoffset = String(a);
      p.style.opacity = "0";
      p.animate?.([
        { offset: 0, strokeDashoffset: a, opacity: 0 }, { offset: s, strokeDashoffset: a, opacity: 0 },
        { offset: s + d * 0.2, opacity: 1 }, { offset: e - d * 0.2, opacity: 1 },
        { offset: e, strokeDashoffset: b, opacity: 0 }, { offset: 1, strokeDashoffset: b, opacity: 0 },
      ], { duration: T, iterations: at === undefined ? Infinity : 1, fill: "both", easing: "linear" });
    }
    t0 += ms[k];
  });
  if (at !== undefined) fx.getAnimations?.({ subtree: true }).forEach((a) => { a.pause(); a.currentTime = freeze ?? 0; });
}
