// Coverage of the "every connection is an arrow on some rung" guarantee (#449), as a number and a
// list: how many connections have no arrow at the Default dial, and which tour steps land on a board
// that does not draw their edge. Pure, model-only (no layout). The definition of "drawn" is
// drawn.ts's (a `major` edge between the two boxes holding the ends); this wraps it.
import { drawingRungs } from "./drawn.ts";
import type { Model } from "./rollup.ts";
import type { Facts } from "./schema.ts";
import type { Profile } from "./profile.ts";

export interface UndrawnEntry {
  from: string;
  /** The other file, or the service or store id for a use. */
  to: string;
  kind: "file" | "service" | "store";
  /** "hidden": both ends sit behind the same "+N more" box; "minor": a board has the edge but lists it only. */
  reason: "hidden" | "minor";
}

export interface TourStepIssue { tour: string; step: number; board: string; edge: [string, string] }

export interface Coverage {
  /** Connections counted: file pairs, plus service and store uses when the facts were given. */
  total: number;
  drawn: number;
  undrawn: UndrawnEntry[];
  /** Connections with an end in no leaf: on no board, so not counted in `total`. */
  noBoard: number;
  /** False when no facts were given: only file-to-file connections (from `model.fgraph`) were checked. */
  usesChecked: boolean;
  tourSteps: TourStepIssue[];
}

// a service or store id is a key of model.services; a file path (even one named store-x.ts) is not
const kindOf = (model: Model, to: string): UndrawnEntry["kind"] => (to in model.services ? (to.startsWith("store-") ? "store" : "service") : "file");

/** The facts a model alone can stand in for: its file graph as imports. */
const factsOfModel = (model: Model): Facts => ({
  imports: (model.fgraph ?? []).map(([from, to, , , line]) => ({ from, to, line, kind: "static" })),
  calls: [], serviceUses: [], storeUses: [], stores: [], services: [],
}) as unknown as Facts;

/** Every connection once, and whether some board draws it as an arrow (at the Default dial). */
export function connectionCoverage(model: Model, facts?: Facts): Omit<Coverage, "tourSteps"> {
  const r = drawingRungs(facts ?? factsOfModel(model), model);
  const undrawn = r.list
    .map((u): UndrawnEntry => ({ from: u.from, to: u.to, kind: kindOf(model, u.to), reason: u.reason }))
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  return { total: r.connections, drawn: r.connections - r.undrawn, undrawn, noBoard: r.outsideLeaves, usesChecked: !!facts };
}

/**
 * Tour steps at the Default stop whose board does not draw the step's edge, or has no box for an
 * end. Other dial stops' boards exist only in the page (npm run tourcheck covers them).
 */
export function tourStepIssues(model: Model): TourStepIssue[] {
  const out: TourStepIssue[] = [];
  for (const t of [...(model.tours ?? []), ...(model.derivedTours ?? [])]) {
    t.steps.forEach((s, i) => {
      if (s.stop && s.stop !== "default") return;
      const edges = "edge" in s && s.edge ? [s.edge] : s.lit?.edges ?? [];
      const board = model.boards[s.board];
      for (const [a, b] of edges) {
        const drawn = !!board && board.nodes.includes(a) && board.nodes.includes(b) && board.edges.some((e) => e.major && e.a === a && e.b === b);
        if (!drawn) out.push({ tour: t.id, step: i, board: s.board, edge: [a, b] });
      }
    });
  }
  return out;
}

export const coverageOf = (model: Model, facts?: Facts): Coverage => ({ ...connectionCoverage(model, facts), tourSteps: tourStepIssues(model) });

/** `1,595 connections, 0 undrawn` */
export const describeCoverage = (c: { total: number; undrawn: readonly unknown[] | number }) => `${c.total.toLocaleString("en-US")} connections, ${typeof c.undrawn === "number" ? c.undrawn : c.undrawn.length} undrawn`;

const CAP = 20;

/** The lines `build` prints: the summary always, then the undrawn ones and the tour steps, each capped. */
export function coverageLines(c: Coverage): string[] {
  const out = [`CONNECTIONS ${describeCoverage(c)}`];
  for (const u of c.undrawn.slice(0, CAP)) out.push(`UNDRAWN ${u.from} -> ${u.to}`);
  if (c.undrawn.length > CAP) out.push(`UNDRAWN +${c.undrawn.length - CAP} more (lint.json has every one)`);
  for (const s of c.tourSteps.slice(0, CAP)) out.push(`UNDRAWN_TOUR_STEP ${s.tour}/${s.step} -> ${s.board}`);
  if (c.tourSteps.length > CAP) out.push(`UNDRAWN_TOUR_STEP +${c.tourSteps.length - CAP} more (lint.json has every one)`);
  return out;
}

/** Whether the build should be flagged: any undrawn connection or tour step. Never in the hosted profile, where minor arrows are listed, not drawn. */
export const coverageFails = (c: Pick<Coverage, "undrawn" | "tourSteps">, profile: Profile = "full") => profile !== "hosted" && (c.undrawn.length > 0 || c.tourSteps.length > 0);
