// Filters: which kinds of boxes and wires the reader wants to see, and an optional "focus on this
// box". Pure decisions live here (tested in node); filterui.ts applies them to the drawn board.
// Filter state is per viewer (localStorage), never in the #hash, so deep links stay one token.
import type { PageBoard, PageEdge } from "./state.ts";

/** Toggleable categories. `hubs` and `minor` reveal non-major edges the rollup left undrawn. */
export const CATS = ["imports", "calls", "svc", "stores", "ctx", "hubs", "minor"] as const;
export type Cat = (typeof CATS)[number];
export type Flags = Record<Cat, boolean>;

export const DEFAULTS: Flags = { imports: true, calls: true, svc: true, stores: true, ctx: true, hubs: false, minor: false };
const KEY = "repoladder.filters";

export function loadFlags(): Flags {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return Object.fromEntries(CATS.map((c) => [c, typeof saved?.[c] === "boolean" ? saved[c] : DEFAULTS[c]])) as Flags;
  } catch { return { ...DEFAULTS }; }
}
export function saveFlags(f: Flags): void {
  try { localStorage.setItem(KEY, JSON.stringify(f)); } catch { /* private window or blocked storage: filters just won't persist */ }
}
export const isDefault = (f: Flags) => CATS.every((c) => f[c] === DEFAULTS[c]);

export const flt = { on: { ...DEFAULTS } as Flags, focus: null as string | null, board: "" };

export const isStoreId = (id: string, services: Record<string, string>) => id.startsWith("store-") && !!services[id];

/** True when the edge's own content (imports, calls, SDK use, reads/writes) passes the toggles. */
export function kindOn(e: PageEdge, on: Flags): boolean {
  // Story arrows (an actor's uses) carry no code counts, and no toggle is about them.
  if (e.says) return true;
  if (e.reads || e.writes) return on.stores;
  if (e.uses) return on.svc;
  return (!!e.imports && on.imports) || (!!e.calls && on.calls);
}

export function nodeKindOn(id: string, b: PageBoard, services: Record<string, string>, on: Flags): boolean {
  if (b.context.includes(id)) return on.ctx;
  if (isStoreId(id, services)) return on.stores;
  if (services[id]) return on.svc;
  return true;
}

export interface Visible {
  nodes: Set<string>;
  /** Keys `a>b` of every edge to show, drawn by D2 or not. */
  edges: Set<string>;
  /** Shown edges that have no D2 route, so the viewer draws them itself. */
  extra: PageEdge[];
}

/**
 * What to show on a board. `drawn` is the set of boxes in its layout: an edge to anything else
 * (services listed as "used throughout") has nowhere to go and stays hidden. Focus keeps the box,
 * every neighbor it has through an edge that passes the toggles, and only the edges touching it;
 * those edges show even when minor, since "what does this touch" is the point of focusing.
 */
export function visible(b: PageBoard, drawn: Set<string>, services: Record<string, string>, on: Flags, focused: string | null, routed: Set<string>): Visible {
  const nodeOn = (id: string) => drawn.has(id) && nodeKindOn(id, b, services, on);
  // focusing a box that a toggle then hides would empty the board; ignore the focus instead
  const focus = focused && nodeOn(focused) ? focused : null;
  const touches = (e: PageEdge) => !!focus && (e.a === focus || e.b === focus);
  const pass = (e: PageEdge) => nodeOn(e.a) && nodeOn(e.b) && kindOn(e, on);
  const shown = b.edges.filter((e) => {
    if (!pass(e)) return false;
    if (focus) return touches(e);
    return e.major || (e.hub ? on.hubs : on.minor);
  });
  const nodes = new Set([...drawn].filter(nodeOn));
  if (focus) {
    const keep = new Set([focus, ...shown.flatMap((e) => [e.a, e.b])]);
    for (const id of [...nodes]) if (!keep.has(id)) nodes.delete(id);
  }
  const key = (e: PageEdge) => `${e.a}>${e.b}`;
  return { nodes, edges: new Set(shown.map(key)), extra: shown.filter((e) => !routed.has(key(e))) };
}

/** How many edges each reveal toggle would add on this board (0 hides the toggle). */
export function hiddenCounts(b: PageBoard, drawn: Set<string>): { hubs: number; minor: number } {
  const off = b.edges.filter((e) => !e.major && drawn.has(e.a) && drawn.has(e.b));
  return { hubs: off.filter((e) => e.hub).length, minor: off.filter((e) => !e.hub).length };
}
