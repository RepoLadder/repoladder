// The `overlay` option's viewer half (model/overlay.ts): marks boxes and connections by their stable `data-hit` ids on every
// board the viewer draws. It watches the canvas for each board svg the viewer inserts, so a lazily drawn child board is marked
// the first time it appears, however the viewer got there. Appended to the page only when an overlay is set.
import { legendModel, markFor, removedBetween, type Marks, type Rect } from "./overlaymarks.ts";

const NS = "http://www.w3.org/2000/svg";
const DONE = "data-ov";
const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
};

const rectOf = (g: SVGGElement): Rect => {
  const r = g.querySelector<SVGRectElement>("rect.body");
  if (r && r.hasAttribute("width")) return { x: +r.getAttribute("x")!, y: +r.getAttribute("y")!, w: +r.getAttribute("width")!, h: +r.getAttribute("height")! };
  const b = g.getBBox();
  return { x: b.x, y: b.y, w: b.width, h: b.height };
};

function decorate(svg: SVGSVGElement, marks: Marks, names: Map<string, string>): void {
  if (svg.hasAttribute(DONE)) return;
  svg.setAttribute(DONE, "");
  const boxes = new Map<string, SVGGElement>();
  const drawn = new Set<string>();
  for (const g of svg.querySelectorAll<SVGGElement>("g[data-hit]")) {
    const hit = g.dataset.hit!, mark = markFor(marks, hit);
    if (hit.startsWith("n:")) boxes.set(hit, g); else if (hit.startsWith("e:")) drawn.add(hit);
    if (!mark) continue;
    g.classList.add(`ov-${mark}`);
    if (mark === "new" && hit.startsWith("n:")) {
      const r = rectOf(g);
      const tag = el("text", { class: "ov-tag", x: String(r.x + r.w - 6), y: String(r.y - 6), "text-anchor": "end" });
      tag.textContent = "New";
      g.append(tag);
    }
  }
  const first = svg.querySelector("g.node, g[data-hit^='n:']");
  let defs: SVGDefsElement | null = null;
  for (const hit of marks.removedEdges) {
    const [a, b] = hit.slice(2).split(">"), ga = boxes.get(`n:${a}`), gb = boxes.get(`n:${b}`);
    if (!ga || !gb || drawn.has(hit)) continue;
    if (!defs) {
      defs = svg.querySelector("defs") ?? svg.insertBefore(el("defs", {}), svg.firstChild);
      const m = el("marker", { id: "ov-arw", viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "8", markerHeight: "8", markerUnits: "userSpaceOnUse", orient: "auto-start-reverse" });
      m.append(el("path", { d: "M0 1L10 5L0 9z", class: "ov-arw" }));
      defs.append(m);
    }
    const label = `Removed connection from ${names.get(a) ?? a} to ${names.get(b) ?? b}`;
    const path = el("path", { class: "ov-removed", d: removedBetween(rectOf(ga), rectOf(gb)), "marker-end": "url(#ov-arw)", role: "img", "aria-label": label });
    const title = el("title", {});
    title.textContent = label;
    path.append(title);
    // before the first box, so the boxes cover the line's ends
    (first?.parentNode ?? svg).insertBefore(path, first);
  }
}

function legend(marks: Marks, stage: HTMLElement): HTMLElement {
  const m = legendModel(marks);
  const root = document.createElement("div");
  root.className = "ov-ui";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "ov-toggle";
  toggle.textContent = "Marks";
  toggle.setAttribute("aria-pressed", "true");
  toggle.addEventListener("click", () => {
    const off = stage.classList.toggle("ov-off");
    toggle.setAttribute("aria-pressed", String(!off));
  });
  const d = document.createElement("details");
  d.className = "ov-legend";
  const s = document.createElement("summary");
  s.textContent = "Changes";
  const ul = document.createElement("ul");
  ul.className = "ov-counts";
  for (const [k, label] of [["changed", "changed"], ["new", "new"], ["added", "added connections"], ["removed", "removed connections"]] as const) {
    if (!m.counts[k]) continue;
    const li = document.createElement("li");
    li.className = `ov-key ov-key-${k}`;
    li.textContent = `${m.counts[k]} ${label}`;
    ul.append(li);
  }
  d.append(s, ul);
  if (m.parts.length) {
    const h = document.createElement("p");
    h.className = "ov-head";
    h.textContent = "Touched parts";
    const list = document.createElement("ul");
    list.className = "ov-parts";
    for (const p of m.parts) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = `#${p.id}`;
      a.textContent = p.name;
      li.append(a);
      if (p.files !== undefined) li.append(` (${p.files} ${p.files === 1 ? "file" : "files"})`);
      list.append(li);
    }
    d.append(h, list);
  }
  // the canvas pans on pointer drags; the controls are not part of the drawing
  root.addEventListener("pointerdown", (e) => e.stopPropagation());
  root.append(toggle, d);
  return root;
}

/** Called once, before the viewer starts. */
export function install(marks: Marks): void {
  const canvas = document.getElementById("canvas"), stage = document.getElementById("stage") ?? document.body;
  if (!canvas) return;
  const names = new Map(marks.parts.map((p) => [p.id, p.name]));
  const run = () => canvas.querySelectorAll<SVGSVGElement>("svg.board").forEach((s) => decorate(s, marks, names));
  new MutationObserver(run).observe(canvas, { childList: true });
  canvas.append(legend(marks, stage));
  run();
}
