// A board with containers laid out by ELK (docs/detail-dial-v2.md, "Layout"): any cut (cutboard.ts),
// Everything being the root's cut at Infinity, every group a container and every file in its leaf.
// A container that holds only closed boxes (files, or groups drawn as on Default) lays them out
// layered, with their arrows. A container that holds containers packs what it holds (ELK
// rectpacking), so the board fills the screen instead of stretching into long layers, and the
// arrows between them are routed along the gutters (gutters.ts). An arrow is always between two
// boxes of one container (cutboard.ts draws each connection between the two boxes where its ends
// split). Pure: the caller runs the graphs.
import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api.js";
import type { BoardLayout } from "../build/layout.ts";
import { separateWires } from "../build/outline.ts";
import type { StopBoard } from "./stops.ts";
import { routeGutters, type Rect } from "./gutters.ts";
import { boundsOf, CANVAS_ASPECT, laneRects, laneSide, type LaneSide } from "./everyfit.ts";
import type { PageNode, ViewerData } from "./state.ts";

/** Room around a leaf's files. */
export const EVERY_PAD = { side: 14 };
/** The gap between packed containers: wide enough for a few wires side by side. */
export const EVERY_GAP = 36;
/** Width of a name's character, per pixel of font size (Geist, bold), and a file name's (13px). */
const NAME_EM = 0.73, FILE_CH = 8.4;
/** A file box: its name and a line count, as on a file board but without the exports line. */
const FILE_H = 45;
/** The screen's shape, which the packing aims for. */
const ASPECT = 1.5;
/** A closed group box counts as a file box for the name sizes: bigger names would crowd the boxes, which already read at the fit. */
const GROUP_AREA = 160 * FILE_H;
/** The board's own id: the container its top-level boxes sit in. */
export const topOf = (b: StopBoard) => b.cut?.board ?? "root";

/**
 * A container's name size, by depth (1 = a top-level part). Names grow with the board, like a map's
 * place names, so the top-level parts and the next level read at the fit and the rest on zooming in.
 */
export function nameSize(b: StopBoard, depth: number, nodes?: Record<string, PageNode>): number {
  const held = new Set(Object.values(b.inside ?? {}));
  const groups = nodes ? b.nodes.filter((id) => nodes[id] && !held.has(id)).length : 0;
  const u = Math.sqrt(b.nodes.filter((id) => id[0] === "@").length * 160 * FILE_H + groups * GROUP_AREA);
  const c = (v: number, lo: number, hi: number) => Math.round(Math.max(lo, Math.min(hi, v)));
  return depth <= 1 ? c(u / 16, 22, 120) : depth === 2 ? c(u / 30, 15, 64) : 13;
}
/** The band at a container's top that holds its name. */
export const bandOf = (px: number) => Math.round(px * 1.6 + 12);
/** A container's depth: 1 for a top-level part. */
export function depthOf(b: StopBoard, id: string): number {
  let d = 0;
  for (let c: string | undefined = id, top = topOf(b); c && c !== top; c = b.inside?.[c]) d++;
  return d;
}

/**
 * How a board of containers is laid out. `lane`: where its "elsewhere" boxes and services go: "edge"
 * (the default) at the board's edge, right or bottom (everyfit.ts), as Default's lane (build/lane.ts);
 * "packed" packs them with the parts, an experimental variant. `aspect`:
 * the canvas's shape (width over height), which the packing aims for. `side`: the edge the lane
 * sits at, by default everyfit.ts laneSide of `aspect`.
 */
export interface EveryOpts { lane?: "packed" | "edge"; aspect?: number; side?: LaneSide }

/** The lane boxes taken out of the packing: the board's elsewhere boxes and services, when its top holds containers. */
function laneOut(data: ViewerData, b: StopBoard, o: EveryOpts): Set<string> {
  if (o.lane === "packed") return new Set();
  const top = topOf(b), kids = contents(b), inside = b.inside ?? {};
  if (!(kids.get(top) ?? []).some((k) => kids.has(k))) return new Set();
  return new Set(b.nodes.filter((id) => (inside[id] ?? top) === top && (b.context.includes(id) || !!data.services[id])));
}

/** Both candidates: each leaf's files left to right, or top to bottom. The one whose names read bigger at fit wins. */
export function everyGraphs(data: ViewerData, nodes: Record<string, PageNode>, b: StopBoard, o: EveryOpts = {}): ElkNode[] {
  return [0, 1].map((flip) => everyGraph(data, nodes, b, flip, laneOut(data, b, o)));
}

/** Container -> the boxes directly in it. */
export function contents(b: StopBoard): Map<string, string[]> {
  const inside = b.inside ?? {}, kids = new Map<string, string[]>();
  for (const id of b.nodes) { const c = inside[id] ?? topOf(b); kids.set(c, [...(kids.get(c) ?? []), id]); }
  return kids;
}

function everyGraph(data: ViewerData, nodes: Record<string, PageNode>, b: StopBoard, flip: number, out: Set<string>): ElkNode {
  const inside = b.inside ?? {}, kids = contents(b);
  // a closed group, "elsewhere" box or service keeps its size on the Default board that draws it
  const top = topOf(b), sized = (board: string, id: string) => data.layout[board]?.n.find((n) => n[0] === id);
  const sizeOf = (id: string) => { const n = sized(inside[id] ?? top, id) ?? sized(top, id); return n ? [n[3], n[4]] : [120, 74]; };
  const fileName = (id: string) => { const p = data.paths[Number(id.slice(1))] ?? ""; return data.names?.[id] ?? p.slice(p.lastIndexOf("/") + 1); };
  // one size for the files of a leaf, from its longest name (the owner prefers one width per kind)
  const fileW = (leaf: string) => Math.ceil(Math.max(120, ...(kids.get(leaf) ?? []).map((f) => fileName(f).length * FILE_CH)) + 32);
  const holder = new Map<string, ElkNode>();
  const box = (id: string, depth: number): ElkNode => {
    const ch = kids.get(id);
    if (!ch) {
      if (id[0] === "@") return { id, width: fileW(inside[id]), height: FILE_H };
      const [w, h] = sizeOf(id);
      return { id, width: w, height: h };
    }
    const leaf = ch.every((c) => !kids.has(c)), groups = leaf && ch.some((c) => c[0] !== "@");
    const name = nodes[id]?.name ?? "", px = nameSize(b, depth, nodes);
    const side = leaf ? EVERY_PAD.side : EVERY_GAP, top = depth ? bandOf(px) + (leaf ? 0 : EVERY_GAP / 2) : side;
    const n: ElkNode = {
      id,
      layoutOptions: {
        ...(leaf ? {
          "elk.algorithm": "layered",
          "elk.direction": flip ? "DOWN" : "RIGHT",
          "elk.edgeRouting": "ORTHOGONAL",
          "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
          "elk.layered.cycleBreaking.strategy": "GREEDY_MODEL_ORDER",
          // group boxes are bigger and carry more arrows than files: more room, as on Default
          "elk.spacing.nodeNode": groups ? "28" : "16",
          "elk.layered.spacing.nodeNodeBetweenLayers": groups ? "64" : "40",
          "elk.spacing.edgeNode": "12",
          "elk.aspectRatio": String(ASPECT),
        } : {
          "elk.algorithm": "rectpacking",
          "elk.aspectRatio": String(ASPECT),
          "elk.spacing.nodeNode": String(EVERY_GAP),
        }),
        "elk.padding": `[top=${top},left=${side},bottom=${side},right=${side}]`,
        ...(depth ? { "elk.nodeSize.constraints": "MINIMUM_SIZE", "elk.nodeSize.minimum": `(${Math.ceil(name.length * px * NAME_EM + 2 * side)}, ${top + 40})` } : {}),
      },
      children: ch.filter((c) => !out.has(c)).map((c) => box(c, depth + 1)),
      edges: [],
    };
    if (leaf) holder.set(id, n);
    return n;
  };
  const root = box(top, 0);
  b.edges.forEach((e, i) => {
    const c = holder.get(inside[e.a] ?? top);
    if (c && (inside[e.b] ?? top) === c.id) c.edges!.push({ id: `e${i}`, sources: [e.a], targets: [e.b] });
  });
  return root;
}

/**
 * ELK's answer in page coordinates: containers first, parents before their children (so drawing
 * in order paints a container under what it holds), then files and services, all absolute. Arrows
 * inside a leaf are ELK's; arrows between containers are routed here.
 */
export function everyLayout(data: ViewerData, b: StopBoard, r: ElkNode, o: EveryOpts = {}): BoardLayout {
  const cont: BoardLayout["n"] = [], leaves: BoardLayout["n"] = [], e: BoardLayout["e"] = [];
  const R = (v: number) => Math.round(v * 10) / 10;
  const abs = new Map<string, Rect>();
  const walk = (n: ElkNode, ox: number, oy: number, top: boolean) => {
    const x = ox + (top ? 0 : n.x ?? 0), y = oy + (top ? 0 : n.y ?? 0);
    abs.set(n.id, { x, y, w: n.width!, h: n.height! });
    if (!top) (n.children?.length ? cont : leaves).push([n.id, R(x), R(y), R(n.width!), R(n.height!), data.services[n.id] ? 1 : 0]);
    for (const c of n.children ?? []) walk(c, x, y, false);
    for (const ed of (n.edges ?? []) as ElkExtendedEdge[]) {
      const s = ed.sections?.[0], src = b.edges[Number(ed.id.slice(1))];
      if (!s) continue;
      e.push([src.a, src.b, 0, ...[s.startPoint, ...(s.bendPoints ?? []), s.endPoint].flatMap((p) => [R(x + p.x), R(y + p.y)])]);
    }
  };
  walk(r, 0, 0, true);
  placeLane(data, b, o, abs, leaves);
  const inside = b.inside ?? {}, kids = contents(b), between = new Map<string, number[]>(), top = topOf(b);
  b.edges.forEach((ed, i) => {
    const c = inside[ed.a] ?? top;
    if (c === (inside[ed.b] ?? top) && (kids.get(c) ?? []).some((k) => kids.has(k))) between.set(c, [...(between.get(c) ?? []), i]);
  });
  for (const [c, ids] of [...between].sort()) {
    const box = Object.fromEntries((kids.get(c) ?? []).map((k) => [k, abs.get(k)!]));
    const routes = routeGutters(box, ids.map((i) => [b.edges[i].a, b.edges[i].b]), EVERY_GAP / 2);
    ids.forEach((i, j) => { if (routes[j].length >= 4) e.push([b.edges[i].a, b.edges[i].b, 0, ...routes[j].map(R)]); });
  }
  return separateWires({ n: [...cont, ...leaves], e });
}

/** The lane's boxes with their sizes on the Default board, in the board's order. */
export function laneBoxes(data: ViewerData, b: StopBoard, o: EveryOpts): [string, number, number][] {
  const out = laneOut(data, b, o), top = topOf(b);
  const size = (id: string): [number, number] => { const n = data.layout[top]?.n.find((x) => x[0] === id); return n ? [n[3], n[4]] : [120, 74]; };
  return b.nodes.filter((id) => out.has(id)).map((id) => [id, ...size(id)]);
}

/** The lane at the board's edge (everyfit.ts laneRects), beside the packed parts. */
function placeLane(data: ViewerData, b: StopBoard, o: EveryOpts, abs: Map<string, Rect>, leaves: BoardLayout["n"]): void {
  const boxes = laneBoxes(data, b, o);
  if (!boxes.length) return;
  const top = topOf(b), parts = boundsOf([...abs].filter(([id]) => id !== top).map(([, r]) => r));
  for (const [id, r] of laneRects(boxes, parts, o.side ?? laneSide(o.aspect ?? CANVAS_ASPECT), EVERY_GAP)) {
    abs.set(id, r);
    leaves.push([id, Math.round(r.x * 10) / 10, Math.round(r.y * 10) / 10, r.w, r.h, data.services[id] ? 1 : 0]);
  }
}
