// Layout stability report (src/build/stability.ts, #462): how much of a board's arrangement holds
// across window shapes, between two commits, and between the Overview and the root board.
// Usage: npm run stability -- <src> [<src> ...] [--before <src> --after <src>] [--board <id>] [--json]
//   <src> is a build out dir (holds model.json) or fixture:<name> (a dir under test/fixtures/).
// Report-only: no thresholds, always exits 0. Never reads the private lab or the network.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import bundled from "elkjs/lib/elk.bundled.js";
import type { ELK as ElkApi, ElkNode } from "elkjs/lib/elk-api.js";
import { analyze } from "../src/analyze/index.ts";
import { pageData } from "../src/build/filepack.ts";
import { renderHtml } from "../src/build/html.ts";
import { resolveFeatures } from "../src/features.ts";
import { layoutBoards, type BoardLayout } from "../src/build/layout.ts";
import { pairStability, type Stability } from "../src/build/stability.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel, type Model } from "../src/model/rollup.ts";
import { Grouping } from "../src/model/schema.ts";
import { cut } from "../src/viewer/budget.ts";
import { LANE_TALL, laneSide } from "../src/viewer/everyfit.ts";
import { cutLayout, type ElkRun } from "../src/viewer/stoplayout.ts";
import { STORY, type ViewerData } from "../src/viewer/state.ts";

export const ASPECTS = [0.46, 1.0, 1.6, 2.2];

export interface Source { name: string; model: Model; data: ViewerData }
export interface Row { label: string; s: Stability }

export function elkRun(): ElkRun {
  const elk = new (bundled as unknown as new () => ElkApi)();
  return (g: ElkNode) => elk.layout(g);
}

/** Loads an out dir (model.json + its layout cache) or `fixture:<name>`. */
export async function loadSource(src: string): Promise<Source> {
  let model: Model, layouts: Record<string, BoardLayout>, name = src;
  if (src.startsWith("fixture:")) {
    const dir = fileURLToPath(new URL(`../test/fixtures/${src.slice(8)}`, import.meta.url));
    const facts = analyze(dir);
    const gp = join(dir, "grouping.json");
    const g = existsSync(gp) ? Grouping.parse(JSON.parse(readFileSync(gp, "utf8"))) : defaultGrouping(facts);
    model = buildModel(facts, g, assign(g, facts).leafOf);
    layouts = await layoutBoards(model);
  } else {
    const dir = resolve(src);
    model = JSON.parse(readFileSync(join(dir, "model.json"), "utf8"));
    layouts = await layoutBoards(model, { cacheDir: dir, readOnlyCache: true });
    name = dir;
  }
  return { name, model, data: pageData(renderHtml(model, layouts, resolveFeatures(process.env))) };
}

/** The board's Everything layout at each window shape (default-stop boards don't vary with it, so these are cuts). */
export async function aspectLayouts(data: ViewerData, board: string, aspects: number[], run: ElkRun): Promise<BoardLayout[]> {
  const c = cut(data.nodes, data.paths, board, Infinity);
  return Promise.all(aspects.map((aspect) => cutLayout(data, c, run, { aspect, side: laneSide(aspect) }).laid));
}

/** Adjacent window shapes, plus the pair straddling the lane flip, scored. */
export async function windowRows(data: ViewerData, board: string, run: ElkRun): Promise<Row[]> {
  const lo = LANE_TALL / 1.2, hi = LANE_TALL * 1.2;
  const out: Row[] = [];
  const ls = await aspectLayouts(data, board, [...ASPECTS, lo, hi], run);
  for (let i = 0; i + 1 < ASPECTS.length; i++) out.push({ label: `${ASPECTS[i]} -> ${ASPECTS[i + 1]}`, s: pairStability(ls[i], ls[i + 1]) });
  out.push({ label: `${lo.toFixed(2)} -> ${hi.toFixed(2)} (lane flip)`, s: pairStability(ls[ASPECTS.length], ls[ASPECTS.length + 1]) });
  return out;
}

export interface CommitRows { boards: number; mean: number | null; min: number | null; worst: { board: string; s: Stability }[] }

/** A layout with file boxes (`@<path index>`, numbered in first-seen order so they shift when a file is added) keyed by their path. */
export function byPath(data: ViewerData, l: BoardLayout): BoardLayout["n"] {
  return l.n.map(([k, ...r]) => [k[0] === "@" ? `@${data.paths[Number(k.slice(1))] ?? k}` : k, ...r] as BoardLayout["n"][number]);
}

/** Every board both commits have, scored between the two. */
export function commitRows(before: Source, after: Source): CommitRows {
  const scored: { board: string; s: Stability }[] = [];
  for (const [id, l] of Object.entries(before.data.layout)) {
    const o = after.data.layout[id];
    if (!o) continue;
    const s = pairStability(byPath(before.data, l), byPath(after.data, o));
    if (s.score !== null) scored.push({ board: id, s });
  }
  scored.sort((a, b) => a.s.score! - b.s.score! || a.board.localeCompare(b.board));
  const mean = scored.length ? scored.reduce((t, x) => t + x.s.score!, 0) / scored.length : null;
  return { boards: scored.length, mean, min: scored.length ? scored[0].s.score! : null, worst: scored.slice(0, 3) };
}

/** Shared boxes between the Overview and root boards (raw ids: the two boards share an id space only for ids that coincide). */
export function storyRows(data: ViewerData): Stability | null {
  const st = data.layout[STORY], root = data.layout.root;
  return st && root ? pairStability(st, root) : null;
}

const pct = (x: number | null) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);
const cell = (s: Stability) => (s.score === null ? `n/a (${s.shared} shared boxes)` : `${pct(s.score)} (${s.kept}/${s.total} pairs, ${s.shared} boxes${s.sampled ? ", sampled" : ""})`);

async function report(src: string, board: string, run: ElkRun) {
  const s = await loadSource(src);
  const win = s.data.boards[board] ? await windowRows(s.data, board, run) : [];
  const story = storyRows(s.data);
  const scores = win.map((r) => r.s.score).filter((x): x is number => x !== null);
  const mean = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  return { name: s.name, board, win, story, mean, min: scores.length ? Math.min(...scores) : null, boxes: win[0]?.s.shared ?? 0 };
}

async function main() {
  const argv = process.argv.slice(2);
  const val = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const board = val("--board") ?? "root", before = val("--before"), after = val("--after");
  const skip = new Set(["--before", "--after", "--board"].flatMap((f) => (argv.includes(f) ? [argv.indexOf(f) + 1] : [])));
  const srcs = argv.filter((a, i) => !a.startsWith("--") && !skip.has(i));
  if (!srcs.length && !(before && after)) { console.error("usage: node scripts/stability.ts <src> [...] [--before <src> --after <src>] [--board <id>] [--json]"); process.exit(2); }
  const run = elkRun(), json: unknown[] = [];
  for (const src of srcs) {
    const r = await report(src, board, run);
    json.push(r);
    if (argv.includes("--json")) continue;
    console.log(`${r.name}\n  window mean ${pct(r.mean)} (min ${pct(r.min)}) · story/root ${r.story ? pct(r.story.score) : "n/a"} · ${r.boxes} boxes in the  cut`);
    console.log(`  window shapes (${board}, Everything; pairs of boxes keeping their relation)`);
    for (const w of r.win) console.log(`    ${w.label.padEnd(26)} ${cell(w.s)}`);
    console.log(`  Overview vs root (raw box ids, shared boxes only)\n    ${r.story ? cell(r.story) : "n/a (no Overview board)"}`);
  }
  if (before && after) {
    const c = commitRows(await loadSource(before), await loadSource(after));
    json.push({ commits: c });
    if (!argv.includes("--json")) {
      console.log(`commits ${before} -> ${after}\n  ${c.boards} boards in both · mean ${pct(c.mean)} · min ${pct(c.min)}`);
      for (const w of c.worst) console.log(`    worst ${w.board.padEnd(24)} ${cell(w.s)}`);
    }
  } else if (!argv.includes("--json")) console.log("commits: skipped (needs --before and --after)");
  if (argv.includes("--json")) console.log(JSON.stringify(json, null, 1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
