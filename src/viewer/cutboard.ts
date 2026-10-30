// The board a cut draws (docs/detail-dial-v2.md): the board's group with some of its parts opened
// in place. Every opened group is a container and every closed box (a group, or a file of an
// opened leaf) sits in it; the board's "elsewhere" boxes and services sit at its top level, as on
// Default. A connection is drawn once, between the two boxes where its ends' paths split (two
// boxes of one container, or a box and the part elsewhere it reaches), so it rolls up as on any
// board (model/rollrules.ts via stops.ts). Everything is the root's cut at Infinity. Pure: no DOM.
import { EVIDENCE_PER_EDGE } from "../model/rollrules.ts";
import { idx as fileIdx, type Cut } from "./budget.ts";
import { roll, type Ends, type StopBoard } from "./stops.ts";
import type { PathRef, ViewerData } from "./state.ts";

export function cutBoard(data: ViewerData, c: Cut): StopBoard {
  const nodes = data.nodes, top = c.board, def = data.boards[top];
  const idx = (f: PathRef) => fileIdx(f, data.paths);
  // every file -> its groups from the root's child down to its leaf
  const full = new Map<number, string[]>();
  const down = (id: string, chain: string[]) => {
    if (id !== "root" && !nodes[id].children.length) for (const f of nodes[id].files) full.set(idx(f), chain);
    for (const k of nodes[id].children) down(k, [...chain, k]);
  };
  down("root", []);
  const own: string[] = [];
  for (let x = top; x !== "root"; x = nodes[x].parent!) own.unshift(x);
  const context = def?.context ?? [];
  const away = new Set(context);
  /** What the board draws a file as: the containers it sits in, then its box; or the part elsewhere it is in. */
  const drawn = (f: number): string[] | null => {
    const ch = full.get(f);
    if (!ch) return null;
    for (let i = 0; i < own.length; i++) if (ch[i] !== own[i]) return away.has(ch[i]) ? [ch[i]] : null;
    const out: string[] = [];
    for (let i = own.length; i < ch.length; i++) { out.push(ch[i]); if (!c.open[ch[i]]) return out; }
    return [...out, `@${f}`];
  };
  const ends: Ends = (from, to) => {
    const a = drawn(from), b = drawn(to);
    if (!a || !b || (away.has(a[0]) && away.has(b[0]))) return null;
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    const x = a[i], y = b[i];
    return !x || !y ? null : [x, y, away.has(x) || away.has(y)];
  };
  const { edges } = roll(data, ends, EVIDENCE_PER_EDGE, false);
  for (const e of edges.values()) e.major = true;
  const inside: Record<string, string> = {}, groups: string[] = [], files: string[] = [];
  // in Default's order (the cut walks the fine tree, where a bucketed group's children come bucket by bucket)
  const rank = (id: string) => {
    const n = nodes[id], at = new Map((n?.children.length ? n.children : (n?.files ?? []).map((f) => `@${idx(f)}`)).map((x, i) => [x, i]));
    return (x: string) => at.get(x) ?? at.size;
  };
  const walk = (id: string) => {
    const r = rank(id);
    for (const k of [...(c.open[id] ?? [])].sort((x, y) => r(x) - r(y))) {
      inside[k] = id;
      (k[0] === "@" ? files : groups).push(k);
      if (c.open[k]) walk(k);
    }
  };
  walk(top);
  // services drawn on the Default board, joined to the board's own parts as there
  const services = (def?.nodes ?? []).filter((id) => !nodes[id] && !away.has(id) && id[0] !== "@" && id !== "+more");
  const svc = (def?.edges ?? []).filter((e) => e.uses && services.includes(e.b) && inside[e.a] === top).map((e) => ({ ...e, ev: [...e.ev] }));
  for (const s of [...context, ...services]) inside[s] = top;
  return {
    nodes: [...groups, ...files, ...context, ...services], context, hubs: [], throughout: def?.throughout ?? [],
    edges: [...[...edges.values()].sort((x, y) => x.a.localeCompare(y.a) || x.b.localeCompare(y.b)), ...svc],
    ...(def?.collections ? { collections: def.collections } : {}),
    inside,
    cut: { board: top, budget: c.budget },
  };
}
