// Builds a fixed set of repos into .gallery/ and writes one comparison page.
// Usage: npm run gallery [-- --only name,name] [-- --title Name (with --only one map: passed to build --title)] [-- --jobs N] [-- --no-lane] [-- --demos | --large]
//   --no-lane builds without the lanes (src/build/lane.ts).
//   --demos builds the launch demos (gallery/demos.json, groupings in gallery/demos/) into .gallery/demos/.
//   --large builds the very large repos (gallery/large.json, 2,000 files and up: timing references) into
//   .gallery/large/. A plain run never builds them.
//   --check runs analyze and the default-grouping score only (no layout, no page) and exits 1 when a pinned repo breaks gallery/thresholds.json (#361).
//   --check --update-thresholds rewrites the checked repos' rows from their current scores; --thresholds <file> reads another file.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assign, defaultGrouping, groupingScore, type GroupingScore } from "../src/model/grouping.ts";
import { DIGEST_TOKEN_BUDGET, estimateTokens, summarize } from "../src/model/summary.ts";
import { BOARD_KB, FONT_KB, VIEWER_KB, budgetKb, describeSize, overBudget, pageSize, type PageSize } from "../src/build/pagesize.ts";
import { worstBoards, type LintSummary } from "../src/build/lint.ts";
import { describeSummary, lintOut } from "./lint.ts";
import { shellTokens } from "./shellstyle.ts";
import { BUDGET } from "../src/build/budget.ts";
import type { Profile } from "../src/model/profile.ts";
import { connectionCoverage, describeCoverage, type Coverage } from "../src/model/coverage.ts";
import { modelOf } from "../src/build/pipeline.ts";
import type { Facts } from "../src/model/schema.ts";

export interface RepoEntry {
  name: string;
  /** Public repos: cloned from url at sha. */
  url?: string;
  sha?: string;
  /** Local repos: built in place (read-only; output goes to .gallery). */
  path?: string;
  shape?: string;
  license?: string;
  /** Grouping file; defaults to gallery/groupings/<name>.json when that exists. */
  grouping?: string;
}

export interface Result {
  /** Set only for a hosted build, where undrawn connections are expected (src/model/profile.ts). */
  profile?: Profile;
  name: string;
  shape: string;
  source: string;
  sha: string | null;
  local: boolean;
  status: "ok" | "failed" | "skipped";
  error?: string;
  grouping: "default" | string;
  files?: number;
  packages?: number;
  edges?: number;
  majorEdges?: number;
  boards?: number;
  kb?: number;
  /** Where the page bytes go (viewer JS/CSS, packed data by section). */
  size?: PageSize;
  analyzeMs?: number;
  buildMs?: number;
  warnings: string[];
  diagramHash?: string;
  /** Compared with the previous gallery run of the same repo commit. */
  sameAsLastRun?: boolean | null;
  /** Estimated tokens in the digest Claude reads (`repoladder summary`). */
  digestTokens?: number;
  /** Quality of the default grouping, whatever grouping the diagram uses. */
  defaultScore?: GroupingScore;
  /** Layout lint (src/build/lint.ts) over every board, and the boards with hard defects, worst first. */
  lint?: LintSummary & { worst: string[] };
  /** Digestibility budget (src/build/budget.ts): the boards over it, worst first, with why. */
  budget?: { boards: number; over: string[] };
  /** Connections with no arrow at the Default dial (src/model/coverage.ts): the totals and up to 10 undrawn ones, `from -> to`. */
  coverage?: { total: number; undrawn: number; tourSteps: number; sample: string[] };
  /** Guided tours on the page: how many the grouping wrote, and the titles of the derived ones (src/model/derivedtours.ts). */
  tours?: { grouping: number; derived: string[] };
}

/** Digest size and default-grouping score straight from facts, the way `summary` and `--default` compute them. */
export function measure(facts: Parameters<typeof summarize>[0]): { digestTokens: number; defaultScore: GroupingScore } {
  const digestTokens = estimateTokens(summarize(facts));
  const defaultScore = groupingScore(assign(defaultGrouping(facts), facts).leafOf);
  return { digestTokens, defaultScore };
}

const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/i;

/** Limits on a default grouping's score; a missing limit is not checked. */
export interface Limits { maxLargestShare?: number; maxSingleFileGroups?: number; minGroups?: number }
export interface Thresholds { fallback: Limits; repos: Record<string, Limits> }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function parseLimits(raw: unknown, where: string): Limits {
  if (!isObj(raw)) throw new Error(`${where}: expected an object`);
  for (const k of Object.keys(raw)) if (!["maxLargestShare", "maxSingleFileGroups", "minGroups"].includes(k)) throw new Error(`${where}: unknown limit "${k}"`);
  const { maxLargestShare: share, maxSingleFileGroups: single, minGroups: min } = raw;
  if (share !== undefined && !(typeof share === "number" && share >= 0 && share <= 1)) throw new Error(`${where}: "maxLargestShare" must be a number from 0 to 1`);
  for (const [k, v] of [["maxSingleFileGroups", single], ["minGroups", min]] as const)
    if (v !== undefined && !(typeof v === "number" && Number.isInteger(v) && v >= 0)) throw new Error(`${where}: "${k}" must be a non-negative integer`);
  return raw as Limits;
}

export function parseThresholds(raw: unknown, origin: string): Thresholds {
  if (!isObj(raw)) throw new Error(`${origin}: expected a JSON object`);
  if (!isObj(raw.fallback)) throw new Error(`${origin}: needs a "fallback" object`);
  if (!isObj(raw.repos)) throw new Error(`${origin}: needs a "repos" object`);
  const repos: Record<string, Limits> = {};
  for (const [name, l] of Object.entries(raw.repos)) {
    if (!NAME_RE.test(name)) throw new Error(`${origin}: repo name "${name}" must be a simple identifier`);
    repos[name] = parseLimits(l, `${origin} repos.${name}`);
  }
  return { fallback: parseLimits(raw.fallback, `${origin} fallback`), repos };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** One reason per broken limit of the repo's row (the fallback when it has none); empty when the score passes. */
export function gate(name: string, score: GroupingScore, t: Thresholds): string[] {
  const l = t.repos[name] ?? t.fallback;
  const out: string[] = [];
  if (l.maxLargestShare !== undefined && score.largestShare > l.maxLargestShare)
    out.push(`largest group ${pct(score.largestShare)} (${score.largest}) > max ${Math.round(l.maxLargestShare * 100)}%`);
  if (l.maxSingleFileGroups !== undefined && score.singleFileGroups > l.maxSingleFileGroups)
    out.push(`${score.singleFileGroups} one-file groups > max ${l.maxSingleFileGroups}`);
  if (l.minGroups !== undefined && score.groups < l.minGroups) out.push(`${score.groups} groups < min ${l.minGroups}`);
  return out;
}

/** The margin checked-in rows are set with: absorbs small unrelated changes, still catches a regression. */
export function suggestLimits(s: GroupingScore): Required<Limits> {
  return {
    maxLargestShare: Math.min(1, Math.ceil(Math.round((s.largestShare + 0.05) * 1000) / 10) / 100),
    maxSingleFileGroups: s.singleFileGroups + Math.max(2, Math.ceil(s.singleFileGroups * 0.25)),
    minGroups: Math.max(1, Math.floor(s.groups * 0.8)),
  };
}

export interface CheckRow { name: string; local: boolean; coverage?: { total: number; undrawn: number }; score?: GroupingScore; limits?: Limits; reasons: string[]; error?: string }

/** Markdown for the GitHub step summary: each value with its limit and headroom. */
export function checkSummary(rows: CheckRow[]): string {
  const cell = (v: string, rest: string | null) => (rest ? `${v} (${rest})` : v);
  const lines = ["### Default-grouping gate", "", "| Repo | Groups (min) | Largest (max) | 1-file (max) | Undrawn | Result |", "| --- | --- | --- | --- | --- | --- |"];
  for (const r of rows) {
    const s = r.score, l = r.limits ?? {};
    const groups = s ? cell(String(s.groups), l.minGroups === undefined ? null : `min ${l.minGroups}, ${s.groups - l.minGroups >= 0 ? "+" : ""}${s.groups - l.minGroups}`) : "–";
    const largest = s ? cell(pct(s.largestShare), l.maxLargestShare === undefined ? null : `max ${Math.round(l.maxLargestShare * 100)}%, ${((l.maxLargestShare - s.largestShare) * 100).toFixed(1)} pts`) : "–";
    const single = s ? cell(String(s.singleFileGroups), l.maxSingleFileGroups === undefined ? null : `max ${l.maxSingleFileGroups}, ${l.maxSingleFileGroups - s.singleFileGroups} left`) : "–";
    const result = r.error ? `error: ${r.error}` : r.local ? "not gated (local)" : r.reasons.length ? `FAIL: ${r.reasons.join("; ")}` : "ok";
    lines.push(`| ${r.name} | ${groups} | ${largest} | ${single} | ${r.coverage ? `${r.coverage.undrawn} / ${r.coverage.total}` : "–"} | ${result.replace(/\|/g, "\\|").replace(/\n/g, " ")} |`);
  }
  return lines.join("\n") + "\n";
}

export function parseEntries(raw: unknown, origin: string): RepoEntry[] {
  if (!Array.isArray(raw)) throw new Error(`${origin}: expected a JSON array`);
  return raw.map((e, i) => {
    const where = `${origin}[${i}]`;
    if (!e || typeof e !== "object") throw new Error(`${where}: expected an object`);
    const r = e as RepoEntry;
    if (typeof r.name !== "string" || !NAME_RE.test(r.name)) throw new Error(`${where}: "name" must be a simple identifier`);
    if (r.path === undefined) {
      if (typeof r.url !== "string" || !/^https:\/\//.test(r.url)) throw new Error(`${where}: needs an https "url" or a local "path"`);
      if (typeof r.sha !== "string" || !/^[0-9a-f]{40}$/.test(r.sha)) throw new Error(`${where}: "sha" must be a full 40-character commit SHA`);
    } else if (typeof r.path !== "string") throw new Error(`${where}: "path" must be a string`);
    return r;
  });
}

export const run = (cmd: string, args: string[], cwd?: string, timeout = 600_000) =>
  new Promise<{ code: number; out: string }>((done) => {
    execFile(cmd, args, { cwd, timeout, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, REPOLADDER_NO_USAGE: "1" } }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === "number" ? err.code : 1) : 0;
      done({ code, out: `${stdout}${stderr}` });
    });
  });

async function pool<T, R>(items: T[], jobs: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, items.length) }, worker));
  return out;
}

/** Shallow-fetches exactly the pinned commit; a no-op when it is already checked out. */
async function checkout(dir: string, url: string, sha: string): Promise<string | null> {
  if (!existsSync(join(dir, ".git"))) {
    mkdirSync(dir, { recursive: true });
    await run("git", ["init", "-q"], dir);
    await run("git", ["remote", "add", "origin", url], dir);
  }
  const head = await run("git", ["rev-parse", "HEAD"], dir);
  if (head.code === 0 && head.out.trim() === sha) return null;
  const f = await run("git", ["fetch", "-q", "--depth", "1", "origin", sha], dir);
  if (f.code) return `git fetch failed: ${f.out.trim()}`;
  const c = await run("git", ["checkout", "-q", "--force", "FETCH_HEAD"], dir);
  if (c.code) return `git checkout failed: ${c.out.trim()}`;
  await run("git", ["clean", "-qfdx"], dir);
  return null;
}

const lastLine = (s: string) => s.trim().split("\n").filter(Boolean).slice(-3).join("\n");

export function edgeCounts(model: { boards: Record<string, { edges: { major: boolean }[] }> }) {
  let edges = 0, majorEdges = 0;
  for (const b of Object.values(model.boards)) {
    edges += b.edges.length;
    majorEdges += b.edges.filter((e) => e.major).length;
  }
  return { edges, majorEdges };
}

/** `--title Name`: the one map's name for `build --title`; only valid with exactly one `--only` name. */
export function galleryTitle(argv: string[], only: string[] | undefined): string | undefined {
  const i = argv.indexOf("--title");
  if (i < 0) return undefined;
  const v = argv[i + 1];
  if (v === undefined || !v.trim() || v.startsWith("--")) throw new Error("--title needs a name");
  if (only?.length !== 1) throw new Error("--title names one map: use it with --only <one name>");
  return v.trim();
}

export function buildArgs(o: { cli: string; repoDir: string; outDir: string; groupingFile: string | null; lane?: boolean; title?: string; profile?: Profile }): string[] {
  return [o.cli, "build", o.repoDir, "--out", o.outDir, ...(o.groupingFile ? ["--grouping", o.groupingFile] : ["--default"]), ...(o.lane === false ? ["--no-lane"] : []), ...(o.title ? ["--title", o.title] : []), ...(o.profile === "hosted" ? ["--profile", "hosted"] : [])];
}

export const coverageResult = (c: Coverage): NonNullable<Result["coverage"]> => ({
  total: c.total, undrawn: c.undrawn.length, tourSteps: c.tourSteps.length,
  sample: [...c.undrawn.map((u) => `${u.from} -> ${u.to}`), ...c.tourSteps.map((s) => `tour ${s.tour}/${s.step} -> ${s.board}`)].slice(0, 10),
});
/** Whether a built map fails the coverage gate: an undrawn connection or a tour step off its board. */
export const coverageBad = (r: Pick<Result, "coverage" | "profile">) => r.profile !== "hosted" && !!r.coverage && (r.coverage.undrawn > 0 || r.coverage.tourSteps > 0);

export async function buildOne(opts: { title?: string; cli: string; galleryDir: string; repoDir: string; outDir: string; entry: RepoEntry; groupingFile: string | null; local: boolean; lane?: boolean; profile?: Profile }): Promise<Result> {
  const { entry, outDir, repoDir, groupingFile } = opts;
  const r: Result = {
    name: entry.name, shape: entry.shape ?? "", source: entry.url ?? "local", sha: entry.sha ?? null, local: opts.local,
    ...(opts.profile === "hosted" ? { profile: opts.profile } : {}),
    status: "failed", grouping: groupingFile ? relative(opts.galleryDir, groupingFile) : "default", warnings: [],
  };
  mkdirSync(outDir, { recursive: true });
  let t = performance.now();
  const a = await run(process.execPath, [opts.cli, "analyze", repoDir, "--out", outDir]);
  r.analyzeMs = Math.round(performance.now() - t);
  writeFileSync(join(outDir, "analyze.log"), a.out);
  if (a.code) return { ...r, error: `analyze exited ${a.code}: ${lastLine(a.out)}` };
  t = performance.now();
  const b = await run(process.execPath, buildArgs({ cli: opts.cli, repoDir, outDir, groupingFile, lane: opts.lane, title: opts.title, profile: opts.profile }));
  r.buildMs = Math.round(performance.now() - t);
  writeFileSync(join(outDir, "build.log"), b.out);
  r.warnings = b.out.split("\n").filter((l) => l.startsWith("warning: ")).map((l) => l.slice(9));
  if (b.code || !b.out.includes("BUILD_OK")) return { ...r, error: `build exited ${b.code}: ${lastLine(b.out)}` };
  const facts = JSON.parse(readFileSync(join(outDir, "facts.json"), "utf8"));
  const model = JSON.parse(readFileSync(join(outDir, "model.json"), "utf8"));
  const html = readFileSync(join(outDir, "diagram.html"));
  if (opts.local) r.sha = facts.sha ?? null;
  const lint = await lintOut(outDir, opts.lane !== false);
  return {
    lint: { ...lint.summary, worst: worstBoards(lint.boards).filter((l) => l.defects.length).map((l) => `${l.board} (${l.defects.length})`) },
    budget: { boards: lint.budget.boards, over: lint.budget.over },
    coverage: coverageResult(lint.coverage),
    tours: { grouping: (model.tours ?? []).length, derived: (model.derivedTours ?? []).map((t: { title: string }) => t.title) },
    ...r, status: "ok", files: facts.files.length, packages: facts.packages.length, ...edgeCounts(model),
    // the Simple stop's new parts and buckets are boards the page can show too, so they count toward the page budget
    boards: Object.keys(model.boards).length + Object.keys(model.simple?.nodes ?? {}).filter((id) => !model.nodes[id]).length, kb: Math.round((html.length / 1024) * 10) / 10, size: pageSize(html.toString()),
    diagramHash: createHash("sha256").update(html).digest("hex"), ...measure(facts),
  };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const num = (n: number | undefined) => (n === undefined ? "–" : n.toLocaleString("en-US"));
const secs = (ms: number | undefined) => (ms === undefined ? "–" : `${(ms / 1000).toFixed(1)}s`);

const lintCells = (l: Result["lint"]) => l
  ? `<td class="n${l.defectBoards ? " bad" : ""}" title="${esc(l.worst.length ? `boards with hard defects: ${l.worst.join(", ")}` : "no hard defects")}">${l.defectBoards}<span class="muted"> / ${l.boards}</span></td><td class="n">${Math.round(l.aligned * 100)}%</td><td class="n${l.namePx < 11.5 ? " warn" : ""}">${l.namePx}</td><td class="n">${Math.round(l.wasted * 100)}%</td><td class="n${l.overlapWires ? " warn" : ""}">${l.overlapWires}</td>`
  : `<td class="n">–</td><td class="n">–</td><td class="n">–</td><td class="n">–</td><td class="n">–</td>`;

const coverageCell = (c: Result["coverage"]) => c
  ? `<td class="n${coverageBad({ coverage: c }) ? " bad" : ""}" title="${esc(c.sample.length ? `no arrow at the Default dial:\n${c.sample.join("\n")}${c.undrawn + c.tourSteps > c.sample.length ? "\n…" : ""}` : "every connection is an arrow on some board")}">${c.undrawn + c.tourSteps}<span class="muted"> / ${num(c.total)}</span></td>`
  : `<td class="n">–</td>`;

const budgetCell = (b: Result["budget"]) => b
  ? `<td class="n${b.over.length ? " warn" : ""}" title="${esc(b.over.length ? b.over.join("\n") : "every board within budget")}">${b.over.length}<span class="muted"> / ${b.boards}</span></td>`
  : `<td class="n">–</td>`;

const toursCell = (t: Result["tours"]) => {
  if (!t) return `<td class="n">–</td>`;
  const total = t.grouping + t.derived.length;
  const tip = total ? [...(t.grouping ? [`${t.grouping} from the grouping`] : []), ...t.derived].join("\n") : "no tours";
  return `<td class="n${total < 2 ? " warn" : ""}" title="${esc(tip)}">${total}</td>`;
};

const scoreCells = (sc: GroupingScore | undefined) => sc
  ? `<td class="n">${sc.groups}</td><td class="n${sc.largestShare > 0.25 ? " warn" : ""}" title="${esc(sc.largest ?? "")}">${Math.round(sc.largestShare * 100)}%</td><td class="n">${sc.singleFileGroups}</td>`
  : `<td class="n">–</td><td class="n">–</td><td class="n">–</td>`;

export function renderIndex(results: Result[], meta: { repoladderSha: string; totalMs: number }): string {
  const ok = results.filter((r) => r.status === "ok");
  const rows = results.map((r) => {
    const det = r.sameAsLastRun === true ? `<span class="good">same</span>` : r.sameAsLastRun === false ? `<span class="warn">changed</span>` : `<span class="muted">first run</span>`;
    const status = r.status === "ok" ? det : `<span class="${r.status === "failed" ? "bad" : "muted"}">${r.status}</span>`;
    return `<tr>
<td><a href="#${esc(r.name)}">${esc(r.name)}</a>${r.local ? ` <span class="tag">local</span>` : ""}<div class="shape">${esc(r.shape)}</div></td>
<td class="n">${num(r.files)}</td><td class="n">${num(r.majorEdges)}<span class="muted"> / ${num(r.edges)}</span></td><td class="n">${num(r.boards)}</td>${toursCell(r.tours)}
<td class="n${overBudget(r.kb ?? 0, r.boards ?? 0) ? " warn" : ""}"${r.size ? ` title="${esc(describeSize(r.size))}"` : ""}>${r.kb ?? "–"}</td><td class="n">${secs(r.analyzeMs)}</td><td class="n">${secs(r.buildMs)}</td>
<td class="n${(r.digestTokens ?? 0) > DIGEST_TOKEN_BUDGET ? " warn" : ""}">${r.digestTokens === undefined ? "–" : `${(r.digestTokens / 1000).toFixed(1)}K`}</td>${scoreCells(r.defaultScore)}
${lintCells(r.lint)}${budgetCell(r.budget)}${coverageCell(r.coverage)}<td class="n${r.warnings.length ? " warn" : ""}">${r.warnings.length}</td><td>${r.grouping === "default" ? `<span class="muted">default</span>` : "custom"}</td><td>${status}</td></tr>`;
  }).join("\n");
  const cards = results.map((r) => {
    const src = r.local ? "local repo" : `<a href="${esc(r.source)}/tree/${esc(r.sha ?? "")}">${esc(r.source.replace("https://github.com/", ""))}@${esc((r.sha ?? "").slice(0, 7))}</a>`;
    const body = r.status === "ok"
      ? `<iframe src="out/${esc(r.name)}/diagram.html" title="${esc(r.name)} diagram"></iframe>`
      : `<pre class="err">${esc(r.error ?? r.status)}</pre>`;
    const warns = r.warnings.length
      ? `<details><summary>${r.warnings.length} grouping warning${r.warnings.length === 1 ? "" : "s"}</summary><ul>${r.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></details>`
      : "";
    return `<section class="card" id="${esc(r.name)}">
<div class="head"><h2>${esc(r.name)}</h2><span class="muted">${src}</span>${r.status === "ok" ? `<a class="pop" href="out/${esc(r.name)}/diagram.html" target="_blank" rel="noopener">open full page ↗</a>` : ""}</div>
${r.lint ? `<p class="stats${r.lint.defectBoards ? " bad" : ""}">layout ${esc(describeSummary(r.lint))}${r.lint.worst.length ? ` · worst: ${esc(r.lint.worst.slice(0, 5).join(", "))}` : ""}</p>` : ""}${r.coverage ? `<p class="stats${coverageBad(r) ? " bad" : ""}">connections ${esc(describeCoverage(r.coverage))}${r.coverage.tourSteps ? ` · ${r.coverage.tourSteps} tour steps off their board` : ""}</p>` : ""}${r.budget?.over.length ? `<p class="stats">over budget ${r.budget.over.length}/${r.budget.boards}: ${esc(r.budget.over.slice(0, 5).join("; "))}${r.budget.over.length > 5 ? "; …" : ""}</p>` : ""}<p class="stats">${num(r.files)} files · ${num(r.packages)} packages · ${num(r.majorEdges)} drawn / ${num(r.edges)} edges · ${num(r.boards)} boards · ${r.kb ?? "–"}KB · grouping: ${esc(r.grouping)}</p>${r.tours?.derived.length ? `<p class="stats">derived tours: ${esc(r.tours.derived.join(" · "))}</p>` : ""}${r.size ? `<p class="stats">page ${esc(describeSize(r.size))}</p>` : ""}
${warns}${body}</section>`;
  }).join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RepoLadder Gallery</title>
<style>
${shellTokens()}
body{margin:0;background:var(--ground);color:var(--ink);font:14px/1.45 var(--font-ui);padding:16px;box-sizing:border-box}
a{color:var(--accent)}h1{font-size:18px;margin:0 0 4px}.muted{color:var(--muted)}.good{color:var(--good)}.warn{color:var(--warn)}.bad{color:var(--bad)}
.sub{color:var(--muted);margin:0 0 14px;font-size:13px}
.tablewrap{overflow-x:auto;background:var(--surface);border:1px solid var(--line);border-radius:6px;margin-bottom:16px}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:7px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;white-space:nowrap}
th{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:600}tr:last-child td{border-bottom:0}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums;font-family:var(--font-mono)}
.shape{color:var(--muted);font-size:12px;white-space:normal;max-width:340px}
.tag{font-size:11px;border:1px solid var(--line);border-radius:3px;padding:0 4px;color:var(--muted)}
.controls{display:flex;gap:8px;align-items:center;margin:0 0 12px;color:var(--muted);font-size:13px}
.controls button{border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:4px;padding:3px 10px;cursor:pointer;font:inherit}
.controls button[aria-pressed="true"]{border-color:var(--accent);color:var(--accent);font-weight:600}
.grid{display:grid;grid-template-columns:repeat(var(--cols,1),minmax(0,1fr));gap:16px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:12px;min-width:0}
.head{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:baseline}.head h2{font-size:15px;margin:0}.pop{margin-left:auto;font-size:13px}
.stats{margin:4px 0 8px;color:var(--muted);font-size:12px;font-family:var(--font-mono)}
details{font-size:12px;margin:0 0 8px;color:var(--warn)}details ul{color:var(--ink);margin:4px 0;padding-left:18px}
iframe{width:100%;height:var(--h,820px);border:1px solid var(--line);border-radius:4px;background:var(--ground);display:block}
.err{color:var(--bad);white-space:pre-wrap;font-size:12px;margin:0}
@media (max-width:900px){.grid{--cols:1!important}iframe{height:640px}}
</style></head><body>
<h1>RepoLadder gallery</h1>
<p class="sub">${ok.length}/${results.length} built · repoladder ${esc(meta.repoladderSha.slice(0, 7))} · ${secs(meta.totalMs)} total · edges are drawn / total across all boards · tours are the page's guided tours (the grouping's plus derived), flagged under 2 · digest is the estimated token size of <code>summary</code> (budget ${(DIGEST_TOKEN_BUDGET / 1000).toFixed(0)}K) · groups, largest and 1-file score the default grouping · "vs last run" compares diagram.html bytes with the previous run at the same commit · defects, aligned, names and empty come from the layout lint (<code>npm run lint:layout -- .gallery/out/&lt;repo&gt;</code>; each repo's <code>out/&lt;repo&gt;/lint.json</code> has every board) · connections is undrawn / total: a connection (import, call or service or store use) with no arrow on any board at the Default dial, plus tour steps on a board that does not draw them (<code>src/model/coverage.ts</code>; the run fails on any) · over counts boards past the digestibility budget (${BUDGET.boxes} boxes, ${BUDGET.edges} arrows, names ${BUDGET.namePx}px, no "+N more"; <code>src/build/budget.ts</code>) · KB is flagged above the page budget of ${VIEWER_KB}KB viewer + ${FONT_KB}KB fonts + ${BOARD_KB}KB per board (hover it, or see each card, for where the bytes go)</p>
<div class="tablewrap"><table>
<thead><tr><th>Repo</th><th class="n">Files</th><th class="n">Edges</th><th class="n">Boards</th><th class="n" title="guided tours on the page: the grouping's own plus derived ones (src/model/derivedtours.ts); flagged under 2; hover for titles">Tours</th><th class="n">KB</th><th class="n">Analyze</th><th class="n">Build</th><th class="n" title="estimated tokens in the summary digest">Digest</th><th class="n" title="default grouping: leaf groups">Groups</th><th class="n" title="default grouping: share of files in the biggest group">Largest</th><th class="n" title="default grouping: groups holding one file">1-file</th><th class="n" title="layout lint: boards with hard defects (overlaps, arrows off their box, labels on boxes, wires through boxes); hover for which">Defects</th><th class="n" title="layout lint: boxes in a shared layer that line up with another">Aligned</th><th class="n" title="layout lint: median box-name size at the desktop fit (px)">Names</th><th class="n" title="layout lint: mean share of the fitted canvas left empty">Empty</th><th class="n" title="layout lint: pairs of arrows drawn on top of each other along a shared stretch">Overlap</th><th class="n" title="digestibility budget: boards with too many boxes or arrows, small names, or files hidden in &quot;+N more&quot; (likely want another level); hover for which">Over</th><th class="n" title="connections with no arrow on any board at the Default dial (and tour steps off their board) / all connections; the run fails when any is undrawn; hover for which">Undrawn</th><th class="n">Warn</th><th>Grouping</th><th>vs last run</th></tr></thead>
<tbody>
${rows}
</tbody></table></div>
<div class="controls">Columns <button data-cols="1" aria-pressed="true">1</button><button data-cols="2" aria-pressed="false">2</button><button data-cols="3" aria-pressed="false">3</button></div>
<div class="grid" id="grid">
${cards}
</div>
<script>
const grid=document.getElementById("grid"),btns=[...document.querySelectorAll("[data-cols]")];
const set=(n)=>{grid.style.setProperty("--cols",n);grid.style.setProperty("--h",n>1?"640px":"820px");btns.forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.cols===n)));try{localStorage.setItem("gallery-cols",n)}catch{}};
btns.forEach(b=>b.addEventListener("click",()=>set(b.dataset.cols)));
try{const n=localStorage.getItem("gallery-cols");if(n)set(n)}catch{}
</script>
</body></html>
`;
}

/** Clones the pinned repos (network-bound, so more parallelism than builds) and resolves local paths. */
async function prepare(entries: RepoEntry[], galleryDir: string, work: string) {
  mkdirSync(join(work, "repos"), { recursive: true });
  return pool(entries, 6, async (e) => {
    const local = e.path !== undefined;
    const repoDir = local ? resolve(galleryDir, e.path!) : join(work, "repos", e.name);
    if (local && !existsSync(repoDir)) return { e, local, repoDir, error: `skipped: ${repoDir} not found` };
    if (!local) {
      process.stdout.write(`fetch  ${e.name}\n`);
      const err = await checkout(repoDir, e.url!, e.sha!);
      if (err) return { e, local, repoDir, error: err };
    }
    return { e, local, repoDir, error: null as string | null };
  });
}

/** Analyze and score only (no layout, no page); returns the process exit code. */
async function runCheck(o: { galleryDir: string; work: string; cli: string; entries: RepoEntry[]; jobs: number; thresholdsFile: string; update: boolean; names: string[] }): Promise<number> {
  const t0 = performance.now();
  if (!o.entries.length) { process.stdout.write("GALLERY_CHECK_FAILED no repos to check\n"); return 1; }
  const thresholds = parseThresholds(JSON.parse(readFileSync(o.thresholdsFile, "utf8")), o.thresholdsFile);
  const prepared = await prepare(o.entries, o.galleryDir, o.work);
  const rows = await pool(prepared, o.jobs, async ({ e, local, repoDir, error }): Promise<CheckRow | null> => {
    const base: CheckRow = { name: e.name, local, reasons: [] };
    if (error?.startsWith("skipped")) { process.stdout.write(`skip   ${e.name}: ${error}\n`); return null; }
    if (error) return { ...base, error };
    const out = join(o.work, "check", e.name);
    mkdirSync(out, { recursive: true });
    const a = await run(process.execPath, [o.cli, "analyze", repoDir, "--out", out]);
    if (a.code) return { ...base, error: `analyze exited ${a.code}: ${lastLine(a.out).replace(/\n/g, " | ")}` };
    let score: GroupingScore;
    try { score = measure(JSON.parse(readFileSync(join(out, "facts.json"), "utf8"))).defaultScore; }
    catch (err) { return { ...base, error: `scoring failed: ${(err as Error).message}` }; }
    // every connection an arrow on some rung (#452): model-only, so before the layout-driven splits
    let coverage: CheckRow["coverage"], reasons = local ? [] : gate(e.name, score, thresholds);
    try {
      const facts = JSON.parse(readFileSync(join(out, "facts.json"), "utf8")) as Facts;
      const c = connectionCoverage(modelOf(facts, defaultGrouping(facts), { read: () => null, usingDefault: true, warn: false, log: () => {} }), facts);
      coverage = { total: c.total, undrawn: c.undrawn.length };
      if (c.undrawn.length && !local) reasons = [...reasons, `${c.undrawn.length} undrawn connections of ${c.total}`];
    } catch (err) { return { ...base, error: `coverage failed: ${(err as Error).message}` }; }
    return { ...base, score, coverage, limits: thresholds.repos[e.name] ?? thresholds.fallback, reasons };
  });
  const checked = rows.filter((r): r is CheckRow => r !== null);
  const fmt = (r: CheckRow) => {
    const s = r.score!, l = r.limits ?? {};
    const conn = r.coverage ? `  connections ${r.coverage.total} undrawn ${r.coverage.undrawn}` : "";
    const lim = (v: number | string | undefined, show: string) => (v === undefined ? "" : ` (${show})`);
    return `groups ${s.groups}${lim(l.minGroups, `min ${l.minGroups}`)}  largest ${pct(s.largestShare)}${lim(l.maxLargestShare, `max ${Math.round((l.maxLargestShare ?? 0) * 100)}%`)}  1-file ${s.singleFileGroups}${lim(l.maxSingleFileGroups, `max ${l.maxSingleFileGroups}`)}${conn}`;
  };
  for (const r of checked) {
    const tag = r.name.padEnd(22);
    if (r.error) process.stdout.write(`error  ${tag} ${r.error}\n`);
    else if (r.local) process.stdout.write(`local  ${tag} ${fmt(r).replace(/ \(.*?\)/g, "")} (not gated)\n`);
    else if (r.reasons.length) process.stdout.write(`FAIL   ${tag} ${r.reasons.join("; ")}\n`);
    else process.stdout.write(`ok     ${tag} ${fmt(r)}\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, checkSummary(checked) + "\n");
  const errors = checked.filter((r) => r.error && !r.local); // local entries are reported, never fail the run
  if (o.update) {
    const next: Thresholds = { fallback: thresholds.fallback, repos: { ...thresholds.repos } };
    const updated: string[] = [];
    for (const r of checked) if (r.score && !r.local && !r.error) { next.repos[r.name] = suggestLimits(r.score); updated.push(r.name); }
    const rank = (n: string) => { const i = o.names.indexOf(n); return i < 0 ? Infinity : i; };
    const keys = Object.keys(next.repos).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    next.repos = Object.fromEntries(keys.map((k) => [k, next.repos[k]]));
    writeFileSync(o.thresholdsFile, JSON.stringify(next, null, 1) + "\n");
    process.stdout.write(`updated ${o.thresholdsFile}: ${updated.join(", ")}\n`);
    return errors.length ? 1 : 0;
  }
  const bad = checked.filter((r) => (r.error && !r.local) || r.reasons.length);
  if (bad.length) { process.stdout.write(`GALLERY_CHECK_FAILED ${bad.length}/${checked.length}: ${bad.map((r) => r.name).join(", ")}\n`); return 1; }
  process.stdout.write(`GALLERY_CHECK_OK ${checked.length} repos in ${secs(performance.now() - t0)}\n`);
  return 0;
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const galleryDir = join(root, "gallery");
  const argv = process.argv.slice(2);
  const demos = argv.includes("--demos"), large = argv.includes("--large");
  if (demos && large) throw new Error("--demos and --large build different lists: pick one");
  const check = argv.includes("--check");
  if (check && (demos || large)) throw new Error("--check gates gallery/repos.json (and local.json) only: drop --demos/--large");
  if (!check && (argv.includes("--update-thresholds") || argv.includes("--thresholds"))) throw new Error("--update-thresholds and --thresholds only work with --check");
  const work = join(root, ".gallery", ...(demos ? ["demos"] : large ? ["large"] : []));
  const cli = join(root, "src", "cli.ts");
  const flag = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  const only = flag("only")?.split(",");
  const jobs = Number(flag("jobs") ?? Math.max(2, Math.min(4, Math.floor(availableParallelism() / 2))));

  const list = demos ? "demos.json" : large ? "large.json" : "repos.json";
  let entries = parseEntries(JSON.parse(readFileSync(join(galleryDir, list), "utf8")), `gallery/${list}`);
  const localFile = join(galleryDir, "local.json");
  const localEntries = !demos && !large && existsSync(localFile) ? parseEntries(JSON.parse(readFileSync(localFile, "utf8")), "gallery/local.json") : [];
  entries = [...entries, ...localEntries];
  const names = new Set<string>();
  for (const e of entries) {
    if (names.has(e.name)) throw new Error(`duplicate gallery repo name "${e.name}"`);
    names.add(e.name);
  }
  if (only) entries = entries.filter((e) => only.includes(e.name));
  const title = galleryTitle(argv, only);

  if (check) {
    const thresholdsFile = resolve(flag("thresholds") ?? join(galleryDir, "thresholds.json"));
    process.exit(await runCheck({ galleryDir, work, cli, entries, jobs, thresholdsFile, update: argv.includes("--update-thresholds"), names: [...names] }));
  }

  const prevFile = join(work, "results.json");
  const prev: Result[] = existsSync(prevFile) ? JSON.parse(readFileSync(prevFile, "utf8")) : [];
  const t0 = performance.now();
  const prepared = await prepare(entries, galleryDir, work);

  const results = await pool(prepared, jobs, async ({ e, local, repoDir, error }): Promise<Result> => {
    const base: Result = { name: e.name, shape: e.shape ?? "", source: e.url ?? "local", sha: e.sha ?? null, local, status: "failed", grouping: "default", warnings: [] };
    if (error) return { ...base, status: error.startsWith("skipped") ? "skipped" : "failed", error };
    const g = e.grouping ? resolve(galleryDir, e.grouping) : join(galleryDir, demos ? "demos" : "groupings", `${e.name}.json`);
    const groupingFile = existsSync(g) ? g : null;
    if (e.grouping && !groupingFile) return { ...base, error: `grouping ${g} not found` };
    const r = await buildOne({ cli, galleryDir, repoDir, outDir: join(work, "out", e.name), entry: e, groupingFile, local, title, lane: !argv.includes("--no-lane") });
    const p = prev.find((x) => x.name === r.name && x.status === "ok");
    r.sameAsLastRun = p && r.diagramHash && p.sha === r.sha && p.grouping === r.grouping ? p.diagramHash === r.diagramHash : null;
    if (r.status === "ok") process.stdout.write(`ok     ${r.name.padEnd(22)} ${String(r.files).padStart(5)} files ${String(r.boards).padStart(4)} boards ${String(r.kb).padStart(6)}KB  ${secs(r.analyzeMs)} + ${secs(r.buildMs)}${r.warnings.length ? `  ${r.warnings.length} warnings` : ""}\n`);
    if (r.lint) process.stdout.write(`       layout: ${describeSummary(r.lint)}${r.lint.worst.length ? `\n       worst: ${r.lint.worst.slice(0, 5).join(", ")}` : ""}\n`);
    if (r.coverage) process.stdout.write(`       connections: ${describeCoverage(r.coverage)}${r.coverage.tourSteps ? `, ${r.coverage.tourSteps} tour steps off their board` : ""}${r.coverage.sample.length ? `\n       undrawn: ${r.coverage.sample.slice(0, 3).join("; ")}${r.coverage.undrawn + r.coverage.tourSteps > 3 ? "; …" : ""}` : ""}\n`);
    if (r.budget?.over.length) process.stdout.write(`       over budget: ${r.budget.over.length}/${r.budget.boards} boards (${r.budget.over.slice(0, 3).join("; ")}${r.budget.over.length > 3 ? "; …" : ""})\n`);
    if (r.tours) { const n = r.tours.grouping + r.tours.derived.length; process.stdout.write(n ? `       tours: ${n}${r.tours.derived.length ? ` (${r.tours.derived.join("; ")})` : ""}\n` : `       tours: none\n`); }
    if (r.size && overBudget(r.kb ?? 0, r.boards ?? 0)) process.stdout.write(`       over the ${budgetKb(r.boards ?? 0)}KB page budget (${VIEWER_KB}KB viewer + ${FONT_KB}KB fonts + ${BOARD_KB}KB per board): ${describeSize(r.size)}\n`);
    return r;
  });

  for (const r of results) if (r.status !== "ok") process.stdout.write(`${r.status === "skipped" ? "skip  " : "FAILED"} ${r.name}: ${r.error}\n`);
  const sha = await run("git", ["rev-parse", "HEAD"], root);
  // Keep results from repos not built this run (--only), so the page still covers everything.
  const merged = [...results, ...prev.filter((p) => !results.some((r) => r.name === p.name) && names.has(p.name))];
  const order = [...names];
  merged.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  writeFileSync(prevFile, JSON.stringify(merged, null, 1) + "\n");
  const index = join(work, "index.html");
  writeFileSync(index, renderIndex(merged, { repoladderSha: sha.out.trim(), totalMs: performance.now() - t0 }));
  const failed = results.filter((r) => r.status === "failed").length;
  process.stdout.write(`\n${index}\n${results.length - failed}/${results.length} built in ${secs(performance.now() - t0)}${failed ? `, ${failed} failed` : ""}\n`);
  const undrawn = results.filter(coverageBad).length;
  if (undrawn) process.stdout.write(`${undrawn} map${undrawn === 1 ? "" : "s"} with undrawn connections: ${results.filter(coverageBad).map((r) => r.name).join(", ")}\n`);
  process.exit(failed || undrawn ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
