// Applies filter.ts to the drawn board: hides boxes and wires, draws the edges D2 never routed
// (minor ones, arrows into shared parts), and shows a note on the canvas while anything is filtered.
import { CATS, DEFAULTS, flt, hiddenCounts, isDefault, loadFlags, saveFlags, nodeKindOn, visible, type Cat } from "./filter.ts";
import { storeMarkers } from "./collections.ts";
import { refocus } from "./focus.ts";
import { extraPath, type Rect } from "./xwire.ts";
import { roundPath } from "./curves.ts";
import { storeRoute } from "./storewire.ts";
import { pillSize } from "./labels.ts";
import { STACK } from "./shapes.ts";
import { $, S, board, edgeClass, wireLabel, esc, isOpenable, nameOf, onStoreBoard, st, storeFocus, type PageEdge } from "./state.ts";

/** One unrouted edge as a wire group. */
export function extraWire(e: PageEdge, rects: Map<string, Rect>, shown: Set<string>): string {
  const near = [...rects].filter(([id]) => id !== e.a && id !== e.b && shown.has(id)), others = near.map(([, r]) => r);
  // an openable box's stacked cards count as part of it, so an extra wire never runs over them (#281)
  // a store board's arrows run through its gutters and carry no verb: the arrowheads and the panel say it
  const store = onStoreBoard();
  const { d, lx, ly } = store ? { d: roundPath(storeRoute(rects.get(e.a)!, rects.get(e.b)!, others), 8), lx: 0, ly: 0 } : extraPath(rects.get(e.a)!, rects.get(e.b)!, near.map(([id, r]) => (isOpenable(id) ? [r[0], r[1], r[2] + STACK[0], r[3] + STACK[0]] : r)), isOpenable(e.b) ? STACK[0] : 0);
  const cls = edgeClass(e), t = store ? "" : wireLabel(e), w = pillSize(t)[0];
  return `<g class="wire xw ${cls}${e.hub ? " xhub" : ""}" data-hit="e:${esc(e.a)}>${esc(e.b)}" tabindex="0" role="button" aria-label="${esc(nameOf(e.a))} to ${esc(nameOf(e.b))}"><path class="hitline" d="${d}"/><path class="line" d="${d}" ${storeMarkers(e, cls)}/>${t ? `<g class="lab"><rect class="pill" x="${lx - w / 2}" y="${ly - 9}" width="${w}" height="18" rx="9"/><text class="n" x="${lx}" y="${ly + 4}" text-anchor="middle">${esc(t)}</text></g>` : ""}</g>`;
}

/** Re-applies the filters to the current board. Called after every draw and every toggle. */
export function applyFilters(): void {
  const svg = st.svgEl, layout = st.data.layout[st.cur];
  if (!svg || !layout) return;
  if (flt.board !== st.cur) { flt.board = st.cur; flt.focus = null; }
  const rects = new Map(layout.n.map(([id, x, y, w, h]) => [id, [x, y, w, h] as Rect]));
  const sel = flt.focus ? null : storeFocus();
  const v = visible(board(), new Set(rects.keys()), S(), flt.on, flt.focus ?? sel, new Set(layout.e.map(([a, b]) => `${a}>${b}`)));
  // a store board keeps every box when the selection draws its arrows; focus lighting dims the rest
  if (sel) for (const id of rects.keys()) if (nodeKindOn(id, board(), S(), flt.on)) v.nodes.add(id);
  svg.querySelector("g.xwires")?.remove();
  if (v.extra.length) {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", "xwires");
    g.innerHTML = v.extra.map((e) => extraWire(e, rects, v.nodes)).join("");
    // under the boxes, like the routed wires
    svg.insertBefore(g, svg.querySelector("g[data-hit^='n:']"));
  }
  for (const g of svg.querySelectorAll<SVGGElement>("g[data-hit]")) {
    const hit = g.dataset.hit!;
    g.classList.toggle("f-off", hit.startsWith("n:") ? !v.nodes.has(hit.slice(2)) : !v.edges.has(hit.slice(2)));
    if (hit === st.selected) g.classList.add("sel");
  }
  renderBar();
}

function renderBar(): void {
  let bar = document.getElementById("fbar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "fbar";
    bar.className = "fbar";
    $("canvas").append(bar);
  }
  const parts: string[] = [];
  if (flt.focus) parts.push(`<span>Focused on <b>${esc(nameOf(flt.focus))}</b></span><button data-unfocus>Clear</button>`);
  if (!isDefault(flt.on)) parts.push(`<span>Filters on</span><button data-freset>Reset</button>`);
  bar.innerHTML = parts.join("");
  bar.hidden = !parts.length;
}

/** "Focus" button for a box's panel. */
export const focusButton = (id: string) => `<button class="focus-btn" data-focus="${esc(id)}" aria-pressed="${flt.focus === id}">${flt.focus === id ? "Show whole board" : "Focus on this box"}</button>`;

/** One reveal toggle per non-major edge type present on the board, for the legend. */
export function revealCounts(): { hubs: number; minor: number } {
  const layout = st.data.layout[st.cur];
  return hiddenCounts(board(), new Set(layout?.n.map((n) => n[0]) ?? []));
}

function syncButtons(): void {
  for (const b of document.querySelectorAll<HTMLElement>("[data-filter]")) b.setAttribute("aria-pressed", String(flt.on[b.dataset.filter as Cat]));
  for (const b of document.querySelectorAll<HTMLElement>("[data-focus]")) {
    const on = flt.focus === b.dataset.focus;
    b.setAttribute("aria-pressed", String(on));
    b.textContent = on ? "Show whole board" : "Focus on this box";
  }
}

export function installFilters(): void {
  flt.on = loadFlags();
  document.addEventListener("click", (ev) => {
    const t = (ev.target as Element).closest<HTMLElement>("[data-filter],[data-focus],[data-unfocus],[data-freset]");
    if (!t) return;
    const d = t.dataset;
    if (d.filter && (CATS as readonly string[]).includes(d.filter)) { flt.on[d.filter as Cat] = !flt.on[d.filter as Cat]; saveFlags(flt.on); }
    else if (d.focus) flt.focus = flt.focus === d.focus ? null : d.focus;
    else if (t.hasAttribute("data-unfocus")) flt.focus = null;
    else if (t.hasAttribute("data-freset")) { flt.on = { ...DEFAULTS }; saveFlags(flt.on); }
    applyFilters();
    refocus();
    syncButtons();
  });
}
