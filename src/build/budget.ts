// Digestibility budget (#102): whether a laid-out board can be taken in at once, or holds enough
// that it wants another level below it. Measured on what the viewer draws, reusing the layout lint.
// `build` prints the boards over budget and writes them into lint.json; the /map skill's retry loop
// (#103) reads them to decide which groups to split.
import type { Model } from "../model/rollup.ts";
import { FILE } from "../model/fileboards.ts";
import type { BoardLayout } from "./layout.ts";
import { isFileBoard } from "./filelayout.ts";
import { STORY } from "../viewer/state.ts";
import { lintModel, summarizeLint, type BoardLint, type LintSummary } from "./lint.ts";
import { sayLines, soleSay } from "../viewer/figures.ts";
import { drawingRungs } from "../model/drawn.ts";
import { MORE } from "../model/fileboards.ts";
import type { Facts } from "../model/schema.ts";
import { coverageOf, type Coverage } from "../model/coverage.ts";

/**
 * The thresholds, in one place so they can be tuned. A board is over budget when it draws more than
 * `boxes` boxes or `edges` wires, its box names fall below `namePx` at the 1280×800 desktop fit, or a
 * file board hides more than `hiddenFiles` files behind its "+N more" box.
 */
export const BUDGET = { boxes: 12, edges: 20, namePx: 11.5, hiddenFiles: 0 } as const;

export type BudgetKind = "boxes" | "edges" | "names" | "hidden";
export interface BudgetReason { kind: BudgetKind; value: number; limit: number; detail: string }

/**
 * What a board shows, which says how it gets back within budget: a "group" or "files" board by
 * splitting its group into sub-groups; the "story" level, when its names are small, by shorter
 * phrases on the actors' arrows (storyHint), since it reads left to right and its width, not its
 * box count, sets the name size (#236); a "store" board draws a database's collections, with its
 * readers folded up a level, or listed in the panel, when they don't fit (storeboards.ts
 * storeReaders); no grouping changes it.
 */
export type BoardKind = "story" | "group" | "files" | "store";

export interface BoardBudget {
  board: string;
  kind: BoardKind;
  /** Boxes and wires drawn on the board, everything included (context boxes, services, stores). */
  boxes: number;
  edges: number;
  /** Not budgeted yet: reported so the thresholds can be tuned against it. */
  crossings: number;
  namePx: number;
  /** File boards only: files folded into the "+N more" box. */
  hiddenFiles: number;
  /** Empty when the board is within budget. */
  over: BudgetReason[];
}

export interface BudgetSummary {
  boards: number;
  /** Boards over budget, worst first, each with its reasons ("web-billing: 20 boxes > 12, …"). */
  over: string[];
}

/** How many of a file board's files the "+N more" box stands in for. */
export const boardKind = (model: Model, boardId: string): BoardKind =>
  boardId === STORY ? "story" : model.stores?.[boardId] ? "store" : isFileBoard(model, boardId) ? "files" : "group";

export function hiddenFiles(model: Model, boardId: string): number {
  if (!isFileBoard(model, boardId)) return 0;
  const shown = model.boards[boardId].nodes.filter((id) => id.startsWith(FILE)).length;
  return Math.max(0, model.nodes[boardId].files.length - shown);
}

/** One board's budget, from its layout and its lint. */
export function budgetBoard(model: Model, layout: BoardLayout, lint: BoardLint): BoardBudget {
  const b: BoardBudget = {
    board: lint.board, kind: boardKind(model, lint.board), boxes: layout.n.length, edges: layout.e.length, crossings: lint.metrics.crossings,
    namePx: lint.metrics.namePx, hiddenFiles: hiddenFiles(model, lint.board), over: [],
  };
  if (b.boxes > BUDGET.boxes) b.over.push({ kind: "boxes", value: b.boxes, limit: BUDGET.boxes, detail: `${b.boxes} boxes > ${BUDGET.boxes}` });
  if (b.edges > BUDGET.edges) b.over.push({ kind: "edges", value: b.edges, limit: BUDGET.edges, detail: `${b.edges} arrows > ${BUDGET.edges}` });
  if (b.namePx < BUDGET.namePx) b.over.push({ kind: "names", value: b.namePx, limit: BUDGET.namePx, detail: `names ${b.namePx}px < ${BUDGET.namePx}px${b.kind === "story" ? storyHint(model) : ""}` });
  if (b.hiddenFiles > BUDGET.hiddenFiles) b.over.push({ kind: "hidden", value: b.hiddenFiles, limit: BUDGET.hiddenFiles, detail: `${b.hiddenFiles} files hidden in "+${b.hiddenFiles} more"` });
  return b;
}

/** Lines of an actor's pill longer than this widen the whole story (figures.ts sayLines). */
export const SAY_LONG = 20;

/**
 * What to shorten when the story's names are small. The story is one row read left to right: the
 * actors' column, as wide as their widest pill, then a column of parts per step. Part names already
 * go on two lines when that helps (namewrap.ts), so the widest pill line is what a grouping can fix.
 */
export function storyHint(model: Model): string {
  const edges = model.story?.board.edges ?? [];
  const lines = edges.flatMap((e) => (e.says ? sayLines(e.says, soleSay(edges, e.a)) : []));
  const long = lines.filter((t) => t.length > SAY_LONG).sort((a, b) => b.length - a.length || a.localeCompare(b));
  return long.length ? ` (the story is too wide: shorten what actors do, "${long[0]}", to ${SAY_LONG} characters or less)` : " (the story is too wide)";
}

/** How far over: each reason as a share of its limit, summed, so the most crowded board comes first. */
const excess = (b: BoardBudget) => b.over.reduce((s, r) => s + (r.kind === "names" ? (r.limit - r.value) / r.limit : (r.value - r.limit) / Math.max(1, r.limit)), 0);

/** The boards over budget, worst first. */
export const overBudget = (budgets: BoardBudget[]) => budgets.filter((b) => b.over.length).sort((a, b) => excess(b) - excess(a) || a.board.localeCompare(b.board));

export const describeBudget = (b: BoardBudget) => `${b.board} (${b.kind}): ${b.over.map((r) => r.detail).join(", ")}`;

export function summarizeBudget(budgets: BoardBudget[]): BudgetSummary {
  return { boards: budgets.length, over: overBudget(budgets).map(describeBudget) };
}

export interface LintReport {
  summary: LintSummary;
  boards: BoardLint[];
  budget: BudgetSummary & { byBoard: BoardBudget[] };
  /** Connections with no arrow at the Default dial, and tour steps on a board that doesn't draw them (coverage.ts). */
  coverage: Coverage;
}

/** The layout lint and the budget of every board: what lint.json holds. */
export function lintReport(model: Model, layouts: Record<string, BoardLayout>, facts?: Facts): LintReport {
  const boards = lintModel(model, layouts);
  const byBoard = boards.map((l) => budgetBoard(model, layouts[l.board], l));
  return { summary: summarizeLint(boards), boards, budget: { ...summarizeBudget(byBoard), byBoard }, coverage: coverageOf(model, facts) };
}

/**
 * The lines `build` prints, one per board over budget, each starting OVER_BUDGET so the skill's
 * retry loop can find them. Not an error: the build still succeeds.
 */
export const budgetLines = (r: LintReport) => r.budget.over.map((s) => `OVER_BUDGET ${s}`);

/**
 * For a grouping Claude wrote (never split mechanically): the file boards that draw every connection
 * of their files and are over budget for it, or that hide connected files in "+N more" (#449). The
 * arrows are drawn regardless; the lines say which leaf to split. Default builds split instead.
 */
export function fileArrowWarnings(model: Model, report: LintReport, facts: Facts): string[] {
  const out: string[] = [];
  const hiddenPairs = new Map<string, number>();
  for (const u of drawingRungs(facts, model).list) {
    if (u.reason !== "hidden") continue;
    const leaf = model.nodes[Object.keys(model.nodes).find((id) => model.nodes[id].files.includes(u.from)) ?? ""]?.id;
    if (leaf) hiddenPairs.set(leaf, (hiddenPairs.get(leaf) ?? 0) + 1);
  }
  for (const b of report.budget.byBoard) {
    if (b.kind !== "files") continue;
    const edges = model.boards[b.board]?.edges ?? [];
    if (b.over.some((r) => r.kind === "boxes" || r.kind === "edges")) out.push(`${b.board}: over budget because of ${edges.filter((e) => e.major).length} file arrows`);
    if (b.hiddenFiles) {
      const n = edges.filter((e) => e.a === MORE || e.b === MORE).reduce((s, e) => s + e.imports + e.calls + e.uses, 0) + (hiddenPairs.get(b.board) ?? 0);
      if (n) out.push(`${b.board}: ${n} connection${n === 1 ? "" : "s"} touch files hidden in +${b.hiddenFiles} more`);
    }
  }
  return out;
}
