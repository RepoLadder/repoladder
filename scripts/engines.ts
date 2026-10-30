// Compares layout engines (src/build/engines/) on the built gallery with the layout lint.
// Usage: node scripts/engines.ts [--repo name,name] [--html]
//   Reads .gallery/out/<repo>/model.json (run `npm run gallery` first). Prints one row per engine over
//   the boards the engines lay out themselves (group and file boards). --html also writes
//   .gallery/engines/<engine>/<repo>.html to look at.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Model } from "../src/model/rollup.ts";
import { layoutBoards, type BoardLayout } from "../src/build/layout.ts";
import { lintBoard, summarizeLint, type BoardLint } from "../src/build/lint.ts";
import { engineBoard, snapEnds } from "../src/build/engines/graph.ts";
import { engineLayout, type EngineOpts } from "../src/build/engines/index.ts";
import { renderHtml } from "../src/build/html.ts";
import { resolveFeatures } from "../src/features.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2), ri = argv.indexOf("--repo");
const only = ri >= 0 ? argv[ri + 1].split(",") : null;
const outRoot = join(ROOT, ".gallery/out");
const repos = readdirSync(outRoot).filter((r) => existsSync(join(outRoot, r, "model.json")) && (!only || only.includes(r))).sort();

const VARIANTS: [string, "d2" | "elkjs" | "columns", EngineOpts & { snap?: boolean }][] = [
  ["d2 (D2's ELK, production)", "d2", {}],
  ["d2, arrowheads snapped to the drawn shape", "d2", { snap: true }],
  ["elkjs BK balanced, fixed ports, model order", "elkjs", { elk: { placement: "BK", ports: true, modelOrder: true } }],
  ["elkjs BK balanced, free ports, model order", "elkjs", { elk: { placement: "BK", ports: false, modelOrder: true } }],
  ["elkjs BK balanced, fixed ports, no model order", "elkjs", { elk: { placement: "BK", ports: true, modelOrder: false } }],
  ["elkjs network simplex, fixed ports, model order", "elkjs", { elk: { placement: "NS", ports: true, modelOrder: true } }],
  ["elkjs network simplex, free ports, model order", "elkjs", { elk: { placement: "NS", ports: false, modelOrder: true } }],
  ["columns (own)", "columns", {}],
];

const rows: string[] = [];
const perBoard: Record<string, Record<string, BoardLint["metrics"] & { defects: number }>> = {};
const all = new Map<string, BoardLint[]>(), time = new Map<string, number>();
for (const repo of repos) {
  const dir = join(outRoot, repo), model: Model = JSON.parse(readFileSync(join(dir, "model.json"), "utf8"));
  const base = await layoutBoards(model, { cacheDir: dir });
  const ids = Object.keys(base).filter((id) => engineBoard(model, id)).sort();
  for (const [name, engine, o] of VARIANTS) {
    const t0 = performance.now(), layouts: Record<string, BoardLayout> = { ...base };
    if (engine !== "d2") for (const id of ids) layouts[id] = await engineLayout(model, id, engine, o);
    else if (o.snap) for (const id of ids) layouts[id] = snapEnds(model, id, base[id]);
    const ms = engine === "d2" ? NaN : performance.now() - t0;
    time.set(name, (time.get(name) ?? 0) + (ms || 0));
    const lints = ids.map((id) => lintBoard(model, id, layouts[id]));
    all.set(name, [...(all.get(name) ?? []), ...lints]);
    for (const l of lints) ((perBoard[`${repo}/${l.board}`] ??= {})[name] = { ...l.metrics, defects: l.defects.length });
    const s = summarizeLint(lints);
    console.error(`${repo.padEnd(20)} ${name.padEnd(36)} ${s.defectBoards}/${s.boards} defect boards ${JSON.stringify(s.defects)} aligned ${s.aligned} crossings ${s.crossings} bends ${s.bendsPerEdge} names ${s.namePx} wasted ${s.wasted}${ms ? ` ${Math.round(ms)}ms` : ""}`);
    if (argv.includes("--html")) {
      const f = join(ROOT, ".gallery/engines", o.snap ? "d2-snap" : engine === "elkjs" ? `elkjs-${o.elk!.placement}-${o.elk!.ports ? "ports" : "free"}${o.elk!.modelOrder ? "" : "-noorder"}` : engine, `${repo}.html`);
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, renderHtml(model, layouts, resolveFeatures(process.env)));
    }
  }
}

rows.push("| engine | boards | boards with defects | overlap | endpoint | label | through | aligned | crossings | bends/edge | names px (median) | names ≥ 11.5px | wasted | layout time |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const [name, lints] of all) {
  const s = summarizeLint(lints), big = lints.filter((l) => l.metrics.namePx >= 11.5).length;
  rows.push(`| ${name} | ${s.boards} | ${s.defectBoards} | ${s.defects.overlap} | ${s.defects.endpoint} | ${s.defects.label} | ${s.defects.through} | ${Math.round(s.aligned * 100)}% | ${s.crossings} | ${s.bendsPerEdge} | ${s.namePx} | ${big} | ${Math.round(s.wasted * 100)}% | ${time.get(name) ? `${(time.get(name)! / 1000).toFixed(1)}s` : "cached D2"} |`);
}
console.log(rows.join("\n"));
mkdirSync(join(ROOT, ".gallery/engines"), { recursive: true });
writeFileSync(join(ROOT, ".gallery/engines/metrics.json"), JSON.stringify(perBoard, null, 1));
