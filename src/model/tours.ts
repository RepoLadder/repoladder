import type { Grouping } from "./schema.ts";
import type { Board, Model } from "./rollup.ts";
import { resolveChainTour, slug, tourGraph } from "./chaintours.ts";
import type { TourGraph } from "./compose.ts";
import { drawsEdge } from "./draws.ts";

/** A validated tour step: the board it plays on and what to highlight there. */
export interface ModelTourStep {
  text: string;
  board: string;
  edge?: [string, string];
  node?: string;
  /** The dial stop it plays at (any step; left out at Default), and for chain tours (docs/tours-v2.md) what to light and the file hop shown. */
  stop?: string;
  lit?: { boxes: string[]; edges: [string, string][] };
  via?: [string, string];
}

export interface ModelTour { id: string; title: string; steps: ModelTourStep[]; source?: "claude" | "derived" | "flow" }

/** Default is left out, so a grouping without stops builds the same model as before. */
const stopOf = (s: { stop?: string }) => (s.stop && s.stop !== "default" ? { stop: s.stop } : {});

const depthOf = (model: Model, id: string) => {
  let d = 0;
  for (let p = model.nodes[id]?.parent; p; p = model.nodes[p].parent) d++;
  return d;
};

/**
 * Tours never invent connections: each edge step must be an edge the rollup produced (drawn or
 * listed) on some board. When several boards show it, the shallowest board that draws it as an
 * arrow wins (drawsEdge: major, both ends boxes); a board that only lists it never beats one
 * that draws it. Ties go to a board where both ends are boxes, then real parts rather than
 * "elsewhere" boxes. With no drawing board the shallowest listing board is used and the build
 * dives first: a step whose edge no board draws as boxes plays on the shallowest board inside
 * the source group that draws an arrow from it to the target (or the part holding it), lighting
 * all of those arrows (`lit`, no `edge`). Only a connection no board draws warns and keeps the
 * shallowest listing board (the step card says the board does not draw it). A step's own `board:` is never moved.
 */
export function resolveTours(grouping: Grouping, model: Model): { tours: ModelTour[]; errors: string[]; warnings: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];
  const tours: ModelTour[] = [];
  const ids = new Set<string>();
  const known = (id: string) => !!model.nodes[id] || !!model.services[id];
  // store boards (storeboards.ts) hold collections, which tours do not name; a step may still pin one
  const boardIds = Object.keys(model.boards).sort();
  const searched = boardIds.filter((id) => !model.stores?.[id]);
  const shows = (b: Board, id: string) => b.nodes.includes(id);
  const rank = (bid: string, drawn: boolean, boxes: boolean, ctx: boolean) => [drawn ? 0 : 1, depthOf(model, bid), boxes ? 0 : 1, ctx ? 1 : 0];
  const best = (cands: { bid: string; key: number[] }[]) =>
    cands.sort((x, y) => x.key.reduce((d, k, i) => d || k - y.key[i], 0) || x.bid.localeCompare(y.bid))[0]?.bid;

  const dive = (a: string, b: string): { board: string; lit: NonNullable<ModelTourStep["lit"]> } | undefined => {
    const targets = [b];
    for (let p = model.nodes[b]?.parent; p && p !== "root"; p = model.nodes[p]?.parent) targets.push(p);
    for (let level = [a]; level.length; level = level.flatMap((x) => model.nodes[x]?.children ?? [])) {
      const found = level.flatMap((id) => {
        const d = model.boards[id];
        if (!d || model.stores?.[id]) return [];
        const hits = d.edges.filter((e) => e.a !== a && targets.includes(e.b) && drawsEdge(d, e.a, e.b));
        return hits.length ? [{ id, hits }] : [];
      }).sort((x, y) => y.hits.length - x.hits.length || x.id.localeCompare(y.id))[0];
      if (found) return { board: found.id, lit: { boxes: [...new Set(found.hits.flatMap((e) => [e.a, e.b]))], edges: found.hits.map((e): [string, string] => [e.a, e.b]) } };
    }
  };

  let graph: TourGraph | undefined;
  (grouping.tours ?? []).forEach((t, ti) => {
    const tid = t.id ?? slug(t.title);
    if (ids.has(tid)) errors.push(`tours[${ti}]: duplicate tour id "${tid}"${t.id ? "" : " (from its title; give it an id)"}`);
    ids.add(tid);
    if ("chain" in t) {
      const r = resolveChainTour(t, tid, (graph ??= tourGraph(model)), `tours[${ti}] "${tid}"`);
      errors.push(...r.errors);
      warnings.push(...r.warnings);
      if (r.tour) tours.push(r.tour);
      return;
    }
    const steps: ModelTourStep[] = [];
    t.steps.forEach((s, si) => {
      const at = `tours[${ti}] "${t.id}" step ${si + 1}`;
      if (s.board !== undefined && !model.boards[s.board]) {
        errors.push(`${at}: board "${s.board}" is not a board (boards: ${boardIds.join(", ")})`);
        return;
      }
      const pool = s.board !== undefined ? [s.board] : searched;
      if ("edge" in s) {
        const [a, b] = s.edge;
        const bad = [a, b].filter((x) => !known(x));
        if (bad.length) { errors.push(`${at}: unknown id${bad.length > 1 ? "s" : ""} ${bad.map((x) => `"${x}"`).join(", ")}`); return; }
        const cands = pool.flatMap((bid) => {
          const bd = model.boards[bid], e = bd.edges.find((x) => x.a === a && x.b === b);
          return e ? [{ bid, key: rank(bid, drawsEdge(bd, a, b), shows(bd, a) && shows(bd, b), bd.context.includes(a) || bd.context.includes(b)) }] : [];
        });
        const bid = best(cands);
        if (!bid) {
          const rev = boardIds.some((id) => model.boards[id].edges.some((x) => x.a === b && x.b === a));
          errors.push(`${at}: there is no edge ${a} -> ${b}${s.board ? ` on board "${s.board}"` : " on any board"}${rev ? ` (there is one ${b} -> ${a}; edges point from the code that imports or calls)` : ""}`);
          return;
        }
        if (s.board === undefined && !drawsEdge(model.boards[bid], a, b)) {
          const d = dive(a, b);
          if (d) { steps.push({ text: s.text, ...d, ...stopOf(s) }); return; }
          warnings.push(`${at}: edge ${a} -> ${b} is listed on board "${bid}" but no board draws it as an arrow (minor, or into a service used throughout)`);
        }
        steps.push({ text: s.text, board: bid, edge: [a, b], ...stopOf(s) });
      } else {
        const id = s.node;
        if (!known(id)) { errors.push(`${at}: unknown id "${id}"`); return; }
        const cands = pool.filter((bid) => shows(model.boards[bid], id)).map((bid) => ({ bid, key: [0, 0, model.boards[bid].context.includes(id) ? 1 : 0, depthOf(model, bid)] }));
        const bid = best(cands);
        if (!bid) { errors.push(`${at}: "${id}" is not drawn on ${s.board ? `board "${s.board}"` : "any board"}`); return; }
        steps.push({ text: s.text, board: bid, node: id, ...stopOf(s) });
      }
    });
    tours.push({ id: t.id, title: t.title, steps });
  });
  return { tours, errors, warnings };
}
