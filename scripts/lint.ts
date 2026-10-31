// Layout lint over built diagrams (src/build/lint.ts): hard defects and neatness per board.
// Usage: npm run lint:layout -- <out dir> [<out dir> ...] [--top N] [--all] [--no-lane]
//   --no-lane lints a build made without lanes (build --no-lane, src/build/lane.ts).
//   <out dir> holds model.json and layout-cache.json from `repoladder build --out <dir>` (e.g. .gallery/out/repoladder).
// Writes <out dir>/lint.json and prints the worst boards. Exits 1 when any board has a hard defect.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Model } from "../src/model/rollup.ts";
import { layoutBoards } from "../src/build/layout.ts";
import { worstBoards, type BoardLint, type LintSummary } from "../src/build/lint.ts";
import { lintReport, type LintReport } from "../src/build/budget.ts";
import { coverageFails, coverageLines } from "../src/model/coverage.ts";
import type { Profile } from "../src/model/profile.ts";
import type { Facts } from "../src/model/schema.ts";

/** Lints a build output dir. Layouts come from its layout cache, so this is quick after a build. */
export async function lintOut(dir: string, lane = true): Promise<LintReport> {
  const model: Model = JSON.parse(readFileSync(join(dir, "model.json"), "utf8"));
  // facts.json (next to model.json after build) lets the coverage count service and store uses too
  let facts: Facts | undefined;
  try { facts = JSON.parse(readFileSync(join(dir, "facts.json"), "utf8")); } catch { /* file connections only */ }
  const out = lintReport(model, await layoutBoards(model, { cacheDir: dir, readOnlyCache: true, lane }), facts);
  writeFileSync(join(dir, "lint.json"), JSON.stringify(out, null, 1) + "\n");
  return out;
}

export function describeSummary(s: LintSummary): string {
  const kinds = Object.entries(s.defects).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(", ");
  return `${s.defectBoards}/${s.boards} boards with defects${kinds ? ` (${kinds})` : ""} · aligned ${Math.round(s.aligned * 100)}% · ${s.crossings} crossings · ${s.overlapWires} overlapping wires · ${s.bendsPerEdge} bends/edge · names ${s.namePx}px (median) · ${Math.round(s.wasted * 100)}% empty · ${s.orphans} orphans${s.cylGap === null ? "" : ` · cylinders ${s.cylGap}px apart`}`;
}

export function describeBoard(l: BoardLint, details = 3): string {
  const m = l.metrics, cvs = Object.entries(m.widthCV).map(([k, v]) => `${k} ${v}`).join(" ");
  const head = `${l.board.padEnd(28)} ${String(l.defects.length).padStart(3)} defects  names ${String(m.namePx).padStart(4)}px  aligned ${m.aligned}/${m.layered}  ${m.crossings} crossings  ${m.overlapWires} overlapping  ${m.bendsPerEdge} bends/edge  ${Math.round(m.wasted * 100)}% empty${m.hiddenLabels ? `  ${m.hiddenLabels} hidden labels` : ""}${m.orphans.length ? `  orphans ${m.orphans.join(", ")}` : ""}${cvs ? `  width cv ${cvs}` : ""}`;
  const more = l.defects.length > details ? [`    … ${l.defects.length - details} more`] : [];
  return [head, ...l.defects.slice(0, details).map((d) => `    ${d.kind}: ${d.detail}`), ...more].join("\n");
}

// Also counts connections with no arrow on any board (src/model/coverage.ts) and exits 1 when any is undrawn.
async function main() {
  const argv = process.argv.slice(2);
  const ti = argv.indexOf("--top"), top = ti >= 0 ? Number(argv[ti + 1]) : 10;
  const dirs = argv.filter((a, i) => !a.startsWith("--") && (ti < 0 || i !== ti + 1));
  if (!dirs.length) { console.error("usage: node scripts/lint.ts <out dir> [...] [--top N] [--all]"); process.exit(2); }
  let bad = 0;
  for (const d of dirs.map((x) => resolve(x))) {
    if (!existsSync(join(d, "model.json"))) { console.error(`${d}: no model.json (build first)`); process.exit(2); }
    const { boards, summary, budget, coverage } = await lintOut(d, !argv.includes("--no-lane"));
    const profile: Profile | undefined = (JSON.parse(readFileSync(join(d, "model.json"), "utf8")) as Model).profile;
    bad += summary.defectBoards + (coverageFails(coverage, profile) ? 1 : 0);
    const shown = argv.includes("--all") ? boards : worstBoards(boards).slice(0, top);
    const over = budget.over.length ? `  ${budget.over.length}/${budget.boards} boards over the digestibility budget:\n${budget.over.map((s) => `    ${s}`).join("\n")}\n` : "";
    // every connection should be an arrow on some rung (#452): undrawn ones and off-board tour steps fail
    const cov = coverageLines(coverage).map((l) => `  ${l}`).join("\n") + (coverage.usesChecked ? "" : "\n  (file connections only: no facts.json next to model.json)") + (profile === "hosted" ? "\n  (hosted profile: undrawn connections are listed, not drawn)" : "");
    console.log(`${d}\n  ${describeSummary(summary)}\n${cov}\n${over}${shown.map((l) => describeBoard(l)).join("\n")}\n`);
  }
  process.exit(bad ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
