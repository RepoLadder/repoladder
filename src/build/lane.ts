// The "lane" layout option (#74): on a busy board, the dashed "elsewhere" boxes and the services sit
// in a lane at the board's edge instead of among the parts, so their arrows run in parallel channels
// rather than converging through the middle of the board. On by default (`build --no-lane` turns it
// off): the owner picked it on every board asked ("I do lean towards having the
// elsewhere portion live kind of on the edge, rather than in the middle of the diagram").
//
// It is done in D2 itself: lane boxes go into an invisible container, which ELK lays out as one column
// (one row on a down-flowing board), the same trick as the story level's actor column. Boxes that only
// receive arrows (and services) take the lane after the parts, boxes that only send take one before
// them. A box with arrows both ways stays among the parts: in a lane, half its arrows would run backward.
// On a down-flowing board a row of lane boxes wider than the parts would set the board's width and
// shrink every name, so a "rows" candidate wraps such a lane onto two rows (#286, wideLanes).
import type { Model } from "../model/rollup.ts";
import type { BoardLayout } from "./layout.ts";
import { STORY } from "../viewer/state.ts";
import { isStoreBoard } from "./storelayout.ts";

export const LANE_IN = "lane-in", LANE_OUT = "lane-out";
export const LANES = new Set([LANE_IN, LANE_OUT]);
export type Side = typeof LANE_IN | typeof LANE_OUT;

/**
 * How the lanes are made: "edge" adds layout-only edges from the parts to the lanes, which hold each
 * lane in its own outermost layer; "loose" leaves the lanes where ELK layers them, which costs no
 * extra column but may not reach the edge (layoutBoards keeps it only when it does, laneAtEdge).
 * "rows" is edge mode plus each lane named in LaneOpts.rows laid out as two rows; it is tried only on
 * down-flowing boards, for a lane wider than the parts (wideLanes). All are candidates, and the one
 * that fills the screen best wins.
 */
export type LaneMode = "edge" | "loose" | "rows";
/**
 * How layout.ts d2Source makes the lanes: the mode, the order of the lane boxes (laneOrder), and, in
 * "rows" mode, which lanes wrap onto two rows.
 */
export interface LaneOpts { mode: LaneMode; order?: string[]; rows?: Side[] }

/**
 * Gap between two boxes in a lane, in board units. ELK packs a layer's boxes 20 D2 units apart, which
 * layoutBoards' spread shrinks to as little as 5: fine between parts whose wires run between layers,
 * but a lane is one long run of boxes, and that close they read as cramped ("the cloud backend node
 * and stripe node at too close together"). Invisible spacers make up the rest.
 */
export const LANE_GAP = 24;
/** ELK's own gap between boxes in a layer, in D2 units (before the spread). */
export const ELK_GAP = 20;
const SPACER = "lane-gap";
/** Whether a D2 id (as reported back) is a spacer withLanes added, which layoutBoards drops. */
export const isSpacer = (sid: string): boolean => [...LANES].some((l) => sid.startsWith(`${l}.${SPACER}`));
/** A lane needs this many boxes before wrapping it onto two rows pays off. */
const MIN_ROW_WRAP = 3;

/**
 * Whether an edge D2 reports back (ids as D2 reports them) is one withLanes added only to lay a lane
 * out on two rows: one touching a spacer, or one between two boxes of the same lane. No real arrow
 * joins two boxes of one lane: a lane-out box only receives and a lane-in box only sends (laneSides).
 */
export function isLaneLayoutEdge(a: string, b: string): boolean {
  if (isSpacer(a) || isSpacer(b)) return true;
  return [...LANES].some((l) => a.startsWith(`${l}.`) && b.startsWith(`${l}.`));
}
/** A spacer's [width, height] for a board laid out at `spread` in `direction`, or null when ELK's gap is enough. */
export function spacerSize(direction: "right" | "down", spread: number): [number, number] | null {
  const run = Math.round(LANE_GAP * spread - 2 * ELK_GAP);
  return run <= 0 ? null : direction === "right" ? [1, run] : [run, 1];
}

/** Lanes only pay off where several arrows run to them; on a quiet board they only cost room. */
const MIN_WIRES = 4;

/** Which lane each context box and service takes on a board; empty where the option does not apply. */
export function laneSides(model: Model, boardId: string): Map<string, Side> {
  const out = new Map<string, Side>(), b = model.boards[boardId];
  if (boardId === STORY || !b || isStoreBoard(model, boardId)) return out;
  const major = b.edges.filter((e) => e.major);
  for (const id of b.nodes) {
    if (!b.context.includes(id) && !model.services[id]) continue;
    const into = major.some((e) => e.b === id), from = major.some((e) => e.a === id);
    if (into !== from) out.set(id, into ? LANE_OUT : LANE_IN);
  }
  const wires = major.filter((e) => out.has(e.a) || out.has(e.b)).length;
  // the overview has no "elsewhere" boxes, and a board without them keeps its services among the parts
  if (wires < MIN_WIRES || ![...out.keys()].some((id) => b.context.includes(id))) out.clear();
  return out;
}

/** The id of a box as D2 reports it back, minus its lane container. */
export const unLane = (sid: string): string => {
  for (const l of LANES) if (sid.startsWith(`${l}.`)) return sid.slice(l.length + 1);
  return sid;
};

/**
 * Rewrites a board's D2 source (layout.ts d2Source) so lane boxes sit in their lane container.
 * `token` maps a node id to how the source writes it (quoted id, or n<i> on file boards). ELK keeps a
 * container's children in the order they are declared, so `lane.order` (laneOrder) declares the lane
 * boxes in the order of the parts they connect to; without it they keep the board's order. In "rows"
 * mode each lane in `lane.rows` with at least 3 boxes goes on two rows: the boxes at even positions in
 * the near row (next to the parts), the odd ones in the far row, held there by layout-only edges from
 * near[j] to far[j] (isLaneLayoutEdge), so both rows span the board in the order of what they connect to.
 */
export function withLanes(model: Model, boardId: string, src: string, token: (id: string) => string, lane: LaneOpts, spacer: [number, number] | null = null): string {
  const sides = laneSides(model, boardId);
  if (!sides.size) return src;
  const { mode } = lane, order = lane.order ?? [];
  const b = model.boards[boardId], moved = new Map<string, string>();
  for (const [id, side] of sides) moved.set(token(id), `${side}.${token(id)}`);
  const swap = (t: string) => moved.get(t) ?? t;
  const lines = src.trimEnd().split("\n").map((line) => {
    const arrow = line.indexOf(" -> ");
    if (arrow >= 0) {
      const rest = line.slice(arrow + 4), colon = rest.indexOf(": ");
      const to = colon >= 0 ? rest.slice(0, colon) : rest;
      return `${swap(line.slice(0, arrow))} -> ${swap(to)}${colon >= 0 ? rest.slice(colon) : ""}`;
    }
    const colon = line.indexOf(": ");
    return colon > 0 ? `${swap(line.slice(0, colon))}${line.slice(colon)}` : line;
  });
  const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length + b.nodes.indexOf(id));
  const ranked = [...sides.keys()].sort((x, y) => rank(x) - rank(y));
  // the lanes that wrap onto two rows: near row = even positions, far row = odd ones
  const wrap = new Map<Side, { near: string[]; far: string[] }>();
  for (const side of mode === "rows" ? lane.rows ?? [] : []) {
    const box = ranked.filter((id) => sides.get(id) === side);
    if (box.length >= MIN_ROW_WRAP) wrap.set(side, { near: box.filter((_, i) => i % 2 === 0), far: box.filter((_, i) => i % 2 === 1) });
  }
  // a wrapped lane's boxes take its places in the ranked order, near row first
  const next = new Map([...wrap].map(([side, r]) => [side, [...r.near, ...r.far]]));
  const ids = ranked.map((id) => next.get(sides.get(id)!)?.shift() ?? id);
  const declared = ids.map((id) => lines.findIndex((l) => l.startsWith(`${swap(token(id))}: `)));
  const decl = declared.map((i) => lines[i]), at = Math.min(...declared);
  for (const i of [...declared].sort((x, y) => y - x)) lines.splice(i, 1);
  // a spacer between each two boxes of a lane (of a row, in a wrapped lane), declared between them so ELK keeps it there
  const seen = new Map<string, number>(), farGaps: [Side, string, number][] = [];
  lines.splice(at, 0, ...decl.flatMap((line, i) => {
    const side = sides.get(ids[i])!, far = wrap.get(side)?.far.includes(ids[i]) ?? false, row = `${side}${far ? "-f" : ""}`;
    const k = seen.get(row) ?? 0;
    seen.set(row, k + 1);
    if (!spacer || k === 0) return [line];
    const name = `${SPACER}${far ? "-f" : ""}${k}`;
    if (wrap.has(side)) farGaps.push([side, name, far ? k : k - 1]);
    return [`${side}.${name}: "" { width: ${spacer[0]}; height: ${spacer[1]} }`, line];
  }));
  // layout-only edges that put a wrapped lane's far row past its near row (below the parts' out lane,
  // above them for the in lane); a far-row spacer k hangs off near[k] and a near-row spacer k off far[k-1]
  for (const [side, { near, far }] of wrap) {
    const inLane = (id: string) => `${side}.${token(id)}`;
    const pair = (n: string, f: string) => lines.push(side === LANE_OUT ? `${n} -> ${f}` : `${f} -> ${n}`);
    far.forEach((f, j) => pair(inLane(near[j]), inLane(f)));
    for (const [gapSide, name, j] of farGaps) {
      if (gapSide !== side) continue;
      if (name.startsWith(`${SPACER}-f`)) pair(inLane(near[j]), `${side}.${name}`);
      else if (side === LANE_IN) pair(`${side}.${name}`, inLane(far[j]));
    }
  }
  const used = new Set(sides.values());
  if (mode === "edge" || mode === "rows") {
    // every part with no drawn arrow onward points at the out lane, and the in lane points at every
    // part with no drawn arrow into it; layoutBoards drops these edges. A part with no arrows at all
    // (a hub, whose arrows are not drawn) is left alone rather than pulled toward a lane.
    const major = b.edges.filter((e) => e.major);
    for (const id of b.nodes.filter((n) => !sides.has(n) && major.some((e) => e.a === n || e.b === n))) {
      if (used.has(LANE_OUT) && !major.some((e) => e.a === id && !sides.has(e.b))) lines.push(`${token(id)} -> ${LANE_OUT}`);
      if (used.has(LANE_IN) && !major.some((e) => e.b === id && !sides.has(e.a))) lines.push(`${LANE_IN} -> ${token(id)}`);
    }
  }
  for (const l of [...used].sort()) lines.push(`${l}.label: ""`);
  return lines.join("\n") + "\n";
}

/**
 * Whether each lane is at its edge of the board in the direction it flows: no part starts past the
 * out lane, and none ends before the in lane. A lane may share its layer with the parts at that edge.
 */
export function laneAtEdge(model: Model, boardId: string, layout: BoardLayout, direction: "right" | "down"): boolean {
  const sides = laneSides(model, boardId), [p, s] = direction === "right" ? [1, 3] : [2, 4];
  const lo = (n: BoardLayout["n"][number]) => n[p] as number, hi = (n: BoardLayout["n"][number]) => (n[p] as number) + (n[s] as number);
  const parts = layout.n.filter((n) => !sides.has(n[0])), lane = (side: Side) => layout.n.filter((n) => sides.get(n[0]) === side);
  if (!parts.length) return true;
  const first = Math.min(...parts.map(hi)), last = Math.max(...parts.map(lo));
  return lane(LANE_OUT).every((n) => lo(n) >= last) && lane(LANE_IN).every((n) => hi(n) <= first);
}

/**
 * The lanes of a down-flowing board's layout worth wrapping onto two rows ("rows" mode): those with at
 * least 3 boxes whose row is wider than the parts, so the lane, not the parts, sets the board's width.
 */
export function wideLanes(model: Model, boardId: string, layout: BoardLayout): Side[] {
  const sides = laneSides(model, boardId), parts = layout.n.filter((n) => !sides.has(n[0]));
  if (!parts.length) return [];
  const span = (ns: BoardLayout["n"]) => Math.max(...ns.map((n) => n[1] + n[3])) - Math.min(...ns.map((n) => n[1]));
  const partSpan = span(parts);
  return ([LANE_IN, LANE_OUT] as Side[]).filter((side) => {
    const box = layout.n.filter((n) => sides.get(n[0]) === side);
    return box.length >= MIN_ROW_WRAP && span(box) > partSpan;
  });
}

/**
 * Lane boxes in the order of what they connect to: each by the mean position, across the flow, of the
 * parts at the other end of its arrows in a first layout. Declaring them in this order lets the
 * lane's arrows run side by side instead of crossing each other on the way in.
 */
export function laneOrder(model: Model, boardId: string, layout: BoardLayout, direction: "right" | "down"): string[] {
  const sides = laneSides(model, boardId), b = model.boards[boardId], at = new Map<string, number>();
  const [p, s] = direction === "right" ? [2, 4] : [1, 3];
  for (const n of layout.n) at.set(n[0], (n[p] as number) + (n[s] as number) / 2);
  const mean = (id: string) => {
    const ends = b.edges.filter((e) => e.major && (e.a === id || e.b === id)).flatMap((e) => at.get(e.a === id ? e.b : e.a) ?? []);
    return ends.length ? ends.reduce((x, y) => x + y, 0) / ends.length : at.get(id) ?? 0;
  };
  const key = new Map([...sides.keys()].map((id) => [id, mean(id)]));
  return [...sides.keys()].sort((x, y) => key.get(x)! - key.get(y)! || b.nodes.indexOf(x) - b.nodes.indexOf(y));
}
