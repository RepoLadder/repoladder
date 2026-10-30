// depthbadge.ts: "Where am I" on a deep diagram, right after the breadcrumbs. Two forms: plain text ("3 rungs
// down"), which reads at a glance, and a gauge, one short step per rung from the overview (top
// left) down to the deepest board, indented like an outline, with the rung you're on in ink.
// By default ("auto") the text shows, on a phone too: the owner picked the words over the gauge, and on the phone they sit on the breadcrumbs' own row, which has the room.
// localStorage "repoladder.depth" = "text" | "gauge" | "off".
import { $, esc } from "./state.ts";

export const DEPTH_KEY = "repoladder.depth";
/** Shallow diagrams (overview plus two levels) say all this in their breadcrumbs already. */
export const MIN_LEVELS = 4;

export const levelsDown = (d: number) => (d === 0 ? "Overview" : d === 1 ? "1 rung down" : `${d} rungs down`);

/** The gauge: `max + 1` steps, the ones above `d` darker (the path you came down), `d` itself in ink. */
export function gauge(d: number, max: number): string {
  const steps = Array.from({ length: max + 1 }, (_, i) => `<i class="${i === d ? "at" : i < d ? "up" : ""}" style="--i:${i}"></i>`).join("");
  return `<span class="gauge" aria-hidden="true">${steps}</span>`;
}

export type DepthMode = "auto" | "text" | "gauge" | "off";

function mode(): DepthMode {
  let m: string | null = null;
  try { m = localStorage.getItem(DEPTH_KEY); } catch { /* sandboxed storage */ }
  return m === "text" || m === "gauge" || m === "off" ? m : "auto";
}

/** What to draw for depth `d` of `max` (rungs below the overview), or null for nothing. */
export function depthView(d: number, max: number, m: DepthMode): { text: string | null; gauge: string | null; say: string } | null {
  if (m === "off" || max + 1 < MIN_LEVELS || d === 0 && m !== "gauge") return null;
  return {
    text: m === "gauge" ? null : levelsDown(d),
    gauge: m === "gauge" ? gauge(d, max) : null,
    say: d === 0 ? `Overview, ${max} rungs deep` : `${levelsDown(d)} of ${max}`,
  };
}

/** Shows depth `d` of `max` next to the breadcrumbs. */
export function renderDepth(d: number, max: number): void {
  let el = document.getElementById("depth");
  if (!el) {
    el = document.createElement("span");
    el.id = "depth";
    el.className = "depth";
    el.setAttribute("role", "img");
    $("crumbs").after(el);
  }
  const m = mode(), v = depthView(d, max, m);
  el.hidden = !v;
  if (!v) return;
  el.dataset.mode = m;
  el.title = v.say;
  el.setAttribute("aria-label", v.say);
  el.innerHTML = `${v.text ? `<span class="dtext">${esc(v.text)}</span>` : ""}${v.gauge ?? ""}`;
}
