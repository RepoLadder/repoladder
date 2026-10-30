import { passesThrough } from "./fgraph.ts";
import { endpointLabel } from "./endpoints.ts";
import { assign, defaultGrouping, groupingScore, prefixOf } from "./grouping.ts";
import type { Facts, GroupNode, Grouping } from "./schema.ts";
import { SPLIT_OVER, unsplitLeaves } from "./splits.ts";
import { chainSection } from "./chaindigest.ts";
import { mergedServices, storeId, svcId } from "./rollup.ts";
import { DEFAULT_FEATURES, type Features } from "../features.ts";

// Build/test/lint tooling says nothing about what the app does.
const TOOLING = /^(@types\/|typescript$|ts-node|tsx$|eslint|@eslint|typescript-eslint|prettier|vitest|jest|@jest|@testing-library|playwright|@playwright|vite$|@vitejs|@tailwindcss\/vite|tailwindcss|postcss|autoprefixer|concurrently|nodemon|rimraf|husky|lint-staged|esbuild|@firebase\/rules-unit-testing|dotenv)/;

const KIND = { web: "web app", backend: "backend", library: "library", scripts: "scripts" } as const;
const PKG_LINES = 30; // packages beyond the biggest 30 are summarized per parent folder

/** The digest has to fit comfortably in Claude's context next to the skill and the grouping it writes. */
export const DIGEST_TOKEN_BUDGET = 12_000;
// Paths and identifiers tokenize densely; ~3.5 chars a token is a fair middle for this text.
const CHARS_PER_TOKEN = 3.5;
export const estimateTokens = (s: string) => Math.ceil(s.length / CHARS_PER_TOKEN);
// Aim under the budget so the estimate's error doesn't push us over.
const TARGET = Math.floor(DIGEST_TOKEN_BUDGET * 0.92);

/**
 * How hard each section is squeezed. Level 0 is everything; each next level trades detail for
 * room, starting with what Claude needs least (sample file names in the default grouping).
 */
interface Squeeze {
  /** Folders with more files than this list name prefixes with counts plus a few samples. */
  names: number;
  /** Folders deeper than this are rolled up into their ancestor at this depth. */
  depth: number;
  /** File globs shown per default-grouping leaf, and how deep that tree is printed. */
  treeFiles: number;
  treeDepth: number;
  connections: number;
  /** Endpoint names per file and files listed; routes per page file and page files listed. */
  endpointNames: number;
  endpointFiles: number;
  pageRoutes: number;
  pageFiles: number;
  /** Dependencies per package; above `packages` packages, sibling packages share one line. */
  deps: number;
  packages: number;
  /** Paths per entry-point list. */
  entries: number;
  /** Large repo, top digest: folders with file counts, no file names (never set in LEVELS). */
  foldersOnly?: boolean;
  /** Part digest: every file name, no per-folder cap and no prefix families (never set in LEVELS). */
  allNames?: boolean;
}
const lv = (names: number, depth: number, treeFiles: number, treeDepth: number, connections: number, endpointNames: number, endpointFiles: number, pageRoutes: number, pageFiles: number, deps: number, packages: number, entries: number): Squeeze =>
  ({ names, depth, treeFiles, treeDepth, connections, endpointNames, endpointFiles, pageRoutes, pageFiles, deps, packages, entries });
const LEVELS: Squeeze[] = [
  lv(80, 99, 4, 9, 50, 999, 999, 99, 999, 20, 999, 40),
  lv(50, 99, 2, 9, 50, 30, 300, 8, 300, 20, 999, 40),
  lv(35, 99, 0, 9, 40, 12, 150, 4, 150, 12, 999, 30),
  lv(25, 99, 0, 4, 40, 8, 100, 3, 100, 10, 60, 25),
  lv(18, 99, 0, 3, 35, 6, 80, 2, 80, 8, 40, 20),
  lv(12, 8, 0, 3, 30, 5, 60, 2, 60, 6, 30, 15),
  lv(8, 7, 0, 2, 30, 4, 50, 1, 50, 5, 25, 12),
  lv(5, 6, 0, 2, 25, 3, 40, 1, 40, 4, 20, 10),
  lv(3, 5, 0, 2, 25, 2, 30, 1, 30, 3, 15, 8),
  lv(2, 4, 0, 1, 20, 2, 25, 1, 25, 2, 12, 6),
  lv(0, 3, 0, 1, 20, 1, 20, 1, 20, 0, 10, 5),
  lv(0, 2, 0, 1, 15, 1, 15, 1, 15, 0, 8, 4),
];

/**
 * A compact digest of the facts for Claude to group and name from: file names (that's where the
 * domain vocabulary lives), the strongest connections, services and endpoints, and the default
 * grouping as a starting point. Kept under DIGEST_TOKEN_BUDGET: on big repos folders are
 * compressed to name prefixes with counts, and the digest says what it left out.
 */
export function summarize(facts: Facts, written?: Grouping, features: Features = DEFAULT_FEATURES): string {
  const storyOff = !features.story;
  const grouping = defaultGrouping(facts);
  const { leafOf } = assign(grouping, facts);
  const toSplit = written ? splitSection(facts, written) : "";
  let out = "", hidden = 0;
  for (let level = 0; level < LEVELS.length; level++) {
    const r = render(facts, grouping, leafOf, LEVELS[level], level, { storyOff });
    out = r.text + toSplit;
    hidden = r.hidden;
    if (estimateTokens(out) <= TARGET) break;
  }
  if (!hidden) return out;
  // Large repo: hiding file names would leave Claude unable to cover every file, so go folder-first
  // and let it ask for each part's names (`summary --part`, two-pass grouping, #257).
  return ladder(FOLDER_LEVELS, (sq, level) => render(facts, grouping, leafOf, sq, level, { large: true, storyOff }).text + toSplit);
}

/** The heading of the digest block that says the story is off; the skill keys on it. */
export const STORY_OFF_MARKER = "## Story: off";
/** The first line of the large-repo note; the skill keys on it. */
export const LARGE_REPO_MARKER = "Large repo: two passes.";
/** `summary --part` runs allowed per /map run (SKILL.md section 2 says the same). */
export const MAX_PART_DIGESTS = 12;
/** Placeholders over this many files get a `--part` digest (SKILL.md section 2 says the same). */
export const PART_OVER = 16;

const FOLDER_LEVELS: Squeeze[] = LEVELS.map((l) => ({ ...l, foldersOnly: true, treeFiles: 0 }));
const NAME_LEVELS: Squeeze[] = LEVELS.map((l) => ({ ...l, names: 999, depth: 99, allNames: true }));

/** The first level whose text fits under TARGET, else the last. */
function ladder(levels: Squeeze[], draw: (sq: Squeeze, level: number) => string): string {
  let out = "";
  for (let level = 0; level < levels.length; level++) {
    out = draw(levels[level], level);
    if (estimateTokens(out) <= TARGET) break;
  }
  return out;
}

/** `summary --part` asked for a node that isn't a leaf of grouping.json, or a leaf matching no files. */
export class PartError extends Error {
  code: "UNKNOWN_PART" | "EMPTY_PART";
  constructor(code: "UNKNOWN_PART" | "EMPTY_PART", message: string) {
    super(message);
    this.code = code;
  }
}

const allNodes = (ns: GroupNode[]): GroupNode[] => ns.flatMap((n) => [n, ...allNodes(n.children ?? [])]);

/** A part's facts: its files and only the facts about them. */
function partFacts(facts: Facts, files: Set<string>): Facts {
  const inPart = (p: string) => files.has(p);
  const owners = new Set(facts.files.filter((f) => inPart(f.path)).map((f) => f.pkg));
  const serviceUses = facts.serviceUses.filter((u) => inPart(u.from));
  const usedServices = new Set(serviceUses.map((u) => u.service));
  const storeUses = (facts.storeUses ?? []).filter((u) => inPart(u.file));
  const storeFields = (facts.storeFields ?? []).filter((u) => inPart(u.file));
  const usedStores = new Set([...storeUses.map((u) => u.store), ...storeFields.map((u) => u.store)]);
  return {
    version: facts.version, repo: facts.repo, sha: facts.sha, github: facts.github,
    packages: facts.packages.filter((p) => owners.has(p.id)),
    files: facts.files.filter((f) => inPart(f.path)),
    imports: facts.imports.filter((i) => inPart(i.from) && inPart(i.to)),
    calls: facts.calls.filter((c) => inPart(c.from) && inPart(c.to)),
    externals: facts.externals.filter((e) => inPart(e.from)),
    unresolved: facts.unresolved.filter((u) => inPart(u.from)),
    serviceUses,
    services: facts.services.filter((s) => usedServices.has(s.id)),
    storeUses,
    storeFields,
    ...(facts.readmes ? { readmes: facts.readmes } : {}),
    stores: (facts.stores ?? []).filter((s) => usedStores.has(s.id)),
    endpoints: facts.endpoints.filter((e) => inPart(e.file)),
    pages: (facts.pages ?? []).filter((p) => inPart(p.file)),
    routeFiles: (facts.routeFiles ?? []).filter((r) => inPart(r.file)),
  };
}

/**
 * Prefix ids with `<partId>-` (unless they already have it) so they can't collide with the rest of
 * grouping.json. An id that would then collide with one already prefixed (`api` beside `trpc-api`
 * in part `trpc`) gets a numeric suffix.
 */
export function prefixIds(nodes: GroupNode[], partId: string): GroupNode[] {
  const has = (id: string) => id.startsWith(`${partId}-`);
  const ids: string[] = [];
  const walk = (n: GroupNode) => { ids.push(n.id, ...(n.split ?? []).map((p) => p.id)); n.children?.forEach(walk); };
  nodes.forEach(walk);
  const used = new Set(ids.filter(has));
  const to = new Map<string, string>();
  for (const id of ids) {
    if (to.has(id)) continue;
    if (has(id)) { to.set(id, id); continue; }
    let next = `${partId}-${id}`;
    for (let k = 2; used.has(next); k++) next = `${partId}-${id}-${k}`;
    used.add(next);
    to.set(id, next);
  }
  const px = (id: string) => to.get(id) ?? id;
  const map = (n: GroupNode): GroupNode => ({
    ...n,
    id: px(n.id),
    ...(n.children ? { children: n.children.map(map) } : {}),
    ...(n.split ? { split: n.split.map((p) => ({ ...p, id: px(p.id), ...(p.members ? { members: p.members.map(px) } : {}) })) } : {}),
  });
  return nodes.map(map);
}

/** Where a leaf of grouping.json is, and its files; throws PartError when it isn't one. */
function findPart(facts: Facts, written: Grouping, partId: string) {
  const { leafOf } = assign(written, facts);
  const count = new Map<string, number>();
  for (const id of leafOf.values()) count.set(id, (count.get(id) ?? 0) + 1);
  const nodes = allNodes(written.children);
  const node = nodes.find((n) => n.id === partId);
  if (!node || node.children) {
    const leaves = nodes.filter((n) => n.files).map((n) => ({ id: n.id, files: count.get(n.id) ?? 0 }));
    leaves.sort((a, b) => b.files - a.files || a.id.localeCompare(b.id));
    const list = leaves.slice(0, 30).map((l) => `${l.id} (${l.files} file${l.files === 1 ? "" : "s"})`).join(", ");
    const what = node ? "a group, not a leaf, of grouping.json" : "not a leaf of grouping.json";
    throw new PartError("UNKNOWN_PART", `UNKNOWN_PART ${partId}: ${what}. Leaves: ${list}${leaves.length > 30 ? ` … +${leaves.length - 30}` : ""}`);
  }
  const files = new Set([...leafOf].filter(([, l]) => l === partId).map(([f]) => f));
  if (!files.size) throw new PartError("EMPTY_PART", `EMPTY_PART ${partId}: its patterns match no files`);
  return { node, files, leafOf, nodes };
}

/** The default grouping of one part of grouping.json, with its ids prefixed by the part's id. */
export function partDefaultGrouping(facts: Facts, written: Grouping, partId: string): Grouping {
  const { files } = findPart(facts, written, partId);
  const g = defaultGrouping(partFacts(facts, files));
  return { ...g, children: prefixIds(g.children, partId) };
}

/**
 * Two-pass grouping, second pass: the digest of one placeholder leaf of grouping.json, naming every
 * file in it (when that fits), with the part's own default grouping and where its code reaches.
 */
export function summarizePart(facts: Facts, written: Grouping, partId: string): string {
  const { node, files, leafOf: writtenLeafOf, nodes } = findPart(facts, written, partId);
  const sub = partFacts(facts, files);
  const raw = defaultGrouping(sub);
  const grouping = { ...raw, children: prefixIds(raw.children, partId) };
  const { leafOf } = assign(grouping, sub);

  // the other end of an edge belongs to its leaf when that leaf shares the part's level-1 group, else to that level-1 group
  const top = new Map<string, string>();
  for (const l1 of written.children) for (const n of allNodes([l1])) top.set(n.id, l1.id);
  const nameOf = new Map(nodes.map((n) => [n.id, n.name]));
  const ownerOf = (file: string) => {
    const leaf = writtenLeafOf.get(file);
    if (!leaf) return "(not in any leaf)";
    return top.get(leaf) === top.get(partId) ? leaf : top.get(leaf)!;
  };
  const reachOf = new Map<string, { out: [number, number]; in: [number, number] }>();
  const bump = (from: string, to: string, k: 0 | 1) => {
    const a = files.has(from), b = files.has(to);
    if (a === b) return;
    const owner = ownerOf(a ? to : from);
    const r = reachOf.get(owner) ?? { out: [0, 0], in: [0, 0] };
    r[a ? "out" : "in"][k]++;
    reachOf.set(owner, r);
  };
  for (const i of facts.imports) if (!passesThrough(i)) bump(i.from, i.to, 0);
  for (const c of facts.calls) bump(c.from, c.to, 1);
  const weight = (r: { out: [number, number]; in: [number, number] }) => r.out[0] + r.in[0] + 3 * (r.out[1] + r.in[1]);
  const ranked = [...reachOf].sort((x, y) => weight(y[1]) - weight(x[1]) || x[0].localeCompare(y[0]));
  const terms = ([imports, calls]: [number, number]) => [imports && `${imports} imports`, calls && `${calls} calls`].filter(Boolean).join(", ");
  const reach = (sq: Squeeze) => {
    const out = ["## Where this part's code reaches (imports, runtime calls), by other part"];
    for (const [owner, r] of ranked.slice(0, sq.connections)) {
      const dirs = [terms(r.out) && `out ${terms(r.out)}`, terms(r.in) && `in ${terms(r.in)}`].filter(Boolean).join("; ");
      out.push(`${owner}${nameOf.has(owner) ? ` "${nameOf.get(owner)}"` : ""}: ${dirs}`);
    }
    if (ranked.length > sq.connections) out.push(`… ${ranked.length - sq.connections} smaller parts omitted`);
    if (!ranked.length) out.push("(none: this part's code keeps to itself)");
    out.push("");
    return out;
  };

  const title = `# ${facts.repo}${facts.sha ? ` @ ${facts.sha}` : ""} — part ${partId} "${node.name}"`;
  const count = `${sub.files.length} of ${facts.files.length} source files are in this part.`;
  const named = ladder(NAME_LEVELS, (sq, level) =>
    render(sub, grouping, leafOf, sq, level, {
      header: [title, count, `Write this part's leaves as children of ${partId} (keep its id, name and summary; reuse the default ids below, already prefixed with ${partId}-).`],
      reach,
    }).text);
  if (estimateTokens(named) <= TARGET) return named;
  return ladder(FOLDER_LEVELS, (sq, level) =>
    render(sub, grouping, leafOf, sq, level, {
      header: [title, `Part still too big to list every file: split leaf ${partId} into placeholder sub-leaves by folder (below), then run summary --part on each.`, count,
        `Keep ${partId}'s id, name and summary on the group that replaces it.`],
      reach,
    }).text);
}

/**
 * On a re-run: the leaves of the grouping Claude wrote earlier that are big enough to want a
 * `split` for the Simple stop and don't have one yet, with their files, so the parts can be named.
 */
function splitSection(facts: Facts, written: Grouping): string {
  const a = assign(written, facts);
  if (a.errors.length) return "";
  const leaves = unsplitLeaves(written, a.leafOf);
  if (!leaves.length) return "";
  const filesOf = new Map<string, string[]>();
  for (const [f, l] of a.leafOf) filesOf.set(l, [...(filesOf.get(l) ?? []), f.slice(f.lastIndexOf("/") + 1)]);
  return [
    "",
    "## Leaves to split (the Simple stop)",
    `Leaves of the existing grouping.json with more than ${SPLIT_OVER} files and no \`split\`. Give each 2-4 named parts (SKILL.md section 3):`,
    ...leaves.map((l) => `- ${l.id} "${l.name}" (${l.files}): ${filesOf.get(l.id)!.sort().slice(0, 16).join(", ")}${l.files > 16 ? " …" : ""}`),
    "",
  ].join("\n");
}

/** How a digest is framed: the repo's own (default), a large repo's top digest, or one part's. */
interface Frame {
  /** Replaces the repo header lines (part digests). */
  header?: string[];
  /** The large-repo note instead of "Compressed to fit…". */
  large?: boolean;
  /** The story switch is off: no entry-points section, a short "Story: off" block instead. */
  storyOff?: boolean;
  /** A section right after the file list (part digests: where the part's code reaches). */
  reach?: (sq: Squeeze) => string[];
}

function render(facts: Facts, grouping: ReturnType<typeof defaultGrouping>, leafOf: Map<string, string>, sq: Squeeze, level: number, frame: Frame = {}): { text: string; hidden: number } {
  const out: string[] = [];
  const elided: string[] = [];
  if (frame.header) out.push(...frame.header);
  else {
    out.push(`# ${facts.repo}${facts.sha ? ` @ ${facts.sha}` : ""}`);
    out.push(`${facts.files.length} source files (tests, e2e, tool configs and build output excluded).`);
  }
  const noteAt = out.length;
  out.push("");

  out.push("## Packages");
  const fileCount = new Map<string, number>();
  for (const f of facts.files) fileCount.set(f.pkg, (fileCount.get(f.pkg) ?? 0) + 1);
  // Sibling workspace packages show up as arrows; listing them as deps too only costs tokens.
  const internal = new Set(facts.packages.map((p) => p.name));
  const maxDeps = Math.min(sq.deps, facts.packages.length > 15 ? 8 : 20);
  // With dozens of packages, the biggest get a line each and the small ones one line per parent folder.
  const parentOf = (dir: string) => (dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : "");
  const big = new Set(
    [...facts.packages].sort((a, b) => (fileCount.get(b.id) ?? 0) - (fileCount.get(a.id) ?? 0) || a.id.localeCompare(b.id)).slice(0, Math.min(PKG_LINES, sq.packages)).map((p) => p.id),
  );
  const collapsed = new Set(facts.packages.filter((p) => !big.has(p.id) && p.dir).map((p) => p.id));
  const done = new Set<string>();
  for (const p of facts.packages) {
    if (collapsed.has(p.id)) {
      const parent = parentOf(p.dir);
      if (done.has(parent)) continue;
      done.add(parent);
      const group = facts.packages.filter((q) => collapsed.has(q.id) && parentOf(q.dir) === parent);
      const files = group.reduce((s, q) => s + (fileCount.get(q.id) ?? 0), 0);
      out.push(`- ${parent || "."}/* — ${group.length} smaller package${group.length === 1 ? "" : "s"}, ${files} files: ${cap(group.map((q) => q.id), sq.packages)}`);
      continue;
    }
    const deps = p.deps.filter((d) => !TOOLING.test(d) && !internal.has(d));
    out.push(`- ${p.id} (${KIND[p.kind]}) at ${p.dir || "."}/ — ${fileCount.get(p.id) ?? 0} files${deps.length && maxDeps ? `; deps: ${deps.slice(0, maxDeps).join(", ")}${deps.length > maxDeps ? " …" : ""}` : ""}`);
  }
  out.push("");

  const files = filesByFolder(facts, sq, collapsed);
  const ext = files.dropped ? `\`${files.dropped}\` dropped, other extensions shown` : "extensions shown";
  out.push(
    sq.foldersOnly ? "## Files by folder (file counts only: run `summary --part <leaf id>` for a part's file names)"
    : level && !sq.allNames ? `## Files by folder (${ext}; big folders as name prefixes with counts, \`name*\` = files starting with name)`
    : `## Files by folder (${ext})`,
  );
  out.push(...files.lines, "");
  if (files.hidden) elided.push(`${files.hidden} of ${facts.files.length} file names (counted under their prefix or folder)`);
  if (frame.reach) out.push(...frame.reach(sq));

  const edges = new Map<string, { imports: number; calls: number }>();
  const bump = (a: string | undefined, b: string | undefined, k: "imports" | "calls") => {
    if (!a || !b || a === b) return;
    const key = `${a} -> ${b}`;
    const e = edges.get(key) ?? { imports: 0, calls: 0 };
    e[k]++;
    edges.set(key, e);
  };
  for (const i of facts.imports) if (!passesThrough(i)) bump(leafOf.get(i.from), leafOf.get(i.to), "imports");
  for (const c of facts.calls) bump(leafOf.get(c.from), leafOf.get(c.to), "calls");
  const ranked = [...edges].sort((x, y) => y[1].imports + 3 * y[1].calls - (x[1].imports + 3 * x[1].calls) || x[0].localeCompare(y[0]));
  out.push("## Strongest connections between default groups (imports, runtime calls by name/URL)");
  for (const [k, e] of ranked.slice(0, sq.connections)) out.push(`${k}: ${[e.imports && `${e.imports} imports`, e.calls && `${e.calls} calls`].filter(Boolean).join(", ")}`);
  if (ranked.length > sq.connections) out.push(`… ${ranked.length - sq.connections} weaker connections omitted`);
  out.push("");

  // the ids are what narratives, tours and flows name; Claude guessed them wrong when only names were shown
  out.push("## External services (SDK imports) [their ids], by folder");
  const merged = mergedServices(facts);
  for (const s of facts.services) {
    const dirs = new Map<string, number>();
    for (const u of facts.serviceUses.filter((u) => u.service === s.id)) {
      const d = dirOf(u.from);
      dirs.set(d, (dirs.get(d) ?? 0) + 1);
    }
    const top = [...dirs].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const id = merged.has(s.id) ? `${svcId(s.id)}, drawn as ${storeId(merged.get(s.id)!)}` : svcId(s.id);
    out.push(`- ${s.name}${s.does ? ` (${s.does})` : ""} [${id}]: ${top.slice(0, 12).map(([d, n]) => `${d} (${n})`).join(", ")}${top.length > 12 ? ` … +${top.length - 12} folders` : ""}`);
  }
  if (!facts.services.length) out.push("(none detected)");
  out.push("");

  // facts built by hand (tests, older callers) may lack the store fields
  const storeUses = facts.storeUses ?? [];
  if (storeUses.length) {
    out.push("## Data stores [their ids]: collections and the folders that read (r) / write (w) them");
    for (const st of facts.stores ?? []) {
      out.push(`### ${st.name} [${storeId(st.id)}]`);
      const byCol = new Map<string, Map<string, Set<string>>>();
      for (const u of storeUses.filter((u) => u.store === st.id)) {
        const d = dirOf(u.file);
        const dirs = byCol.get(u.collection) ?? new Map<string, Set<string>>();
        byCol.set(u.collection, dirs);
        dirs.set(d, (dirs.get(d) ?? new Set()).add(u.op === "read" ? "r" : "w"));
      }
      for (const [col, dirs] of [...byCol].sort((a, b) => a[0].localeCompare(b[0]))) {
        const list = [...dirs].sort((a, b) => a[0].localeCompare(b[0])).map(([d, ops]) => `${d} (${[...ops].sort().join("")})`);
        out.push(`- ${col}: ${list.slice(0, 8).join(", ")}${list.length > 8 ? ` … +${list.length - 8}` : ""}`);
      }
    }
    out.push("");
  }

  if (facts.endpoints.length) {
    out.push("## Server endpoints (Cloud Functions / routes), by file");
    const byFile = new Map<string, string[]>();
    for (const e of facts.endpoints) byFile.set(e.file, [...(byFile.get(e.file) ?? []), `${endpointLabel(e)}${e.kind === "event" || e.kind === "action" ? ` [${e.kind}]` : ""}`]);
    const list = [...byFile];
    for (const [f, names] of list.slice(0, sq.endpointFiles)) out.push(`${f}: ${cap(names, sq.endpointNames)}`);
    if (list.length > sq.endpointFiles) {
      out.push(`… +${list.length - sq.endpointFiles} more files with endpoints`);
      elided.push(`endpoints in ${list.length - sq.endpointFiles} files`);
    }
    out.push("");
  }

  if (facts.pages.length) {
    out.push("## Pages users see (route → page component file)");
    const byFile = new Map<string, string[]>();
    for (const pg of facts.pages) byFile.set(pg.file, [...(byFile.get(pg.file) ?? []), pg.route]);
    const list = [...byFile].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [f, routes] of list.slice(0, sq.pageFiles)) out.push(`${f}: ${cap([...new Set(routes)], sq.pageRoutes)}`);
    if (list.length > sq.pageFiles) {
      out.push(`… +${list.length - sq.pageFiles} more page files`);
      elided.push(`${list.length - sq.pageFiles} page files`);
    }
    out.push("");
  }
  const routeFiles = facts.routeFiles ?? []; // facts written before routeFiles existed
  if (routeFiles.length) {
    // Layouts, loading states and error boundaries render with their route: group them with its pages.
    out.push("## Route files (Next.js and React Router layouts, loading/error states, middleware), by route");
    const byRoute = new Map<string, string[]>();
    for (const r of routeFiles) byRoute.set(r.route, [...(byRoute.get(r.route) ?? []), `${r.file} [${r.role}]`]);
    const list = [...byRoute];
    for (const [route, files] of list.slice(0, sq.pageFiles)) out.push(`${route}: ${cap(files, Math.max(2, sq.pageRoutes * 2))}`);
    if (list.length > sq.pageFiles) {
      out.push(`… +${list.length - sq.pageFiles} more routes`);
      elided.push(`route files of ${list.length - sq.pageFiles} routes`);
    }
    out.push("");
  }
  const dirs = facts.files.filter((f) => f.directive);
  if (dirs.length) {
    const client = dirs.filter((f) => f.directive === "client").length;
    out.push(`React boundary: ${client} "use client" files, ${dirs.length - client} "use server" files.`, "");
  }
  if (frame.storyOff) out.push(`${STORY_OFF_MARKER}`, "The story level is off for this build: do not write a \"story\" in grouping.json and skip the \"Story (rung 0)\" part of the grouping rules. The build ignores one if present.", "");
  else out.push(...entryPoints(facts, sq.entries));
  out.push(...chainSection(facts, sq.entries, Math.max(4, Math.round(sq.entries / 3)), Math.round(sq.entries * 0.6)));

  const score = groupingScore(leafOf);
  out.push("## Default grouping (folder and import-cluster based starting point; ids are stable)");
  out.push(`Score: ${score.groups} groups, largest ${score.largest} holds ${Math.round(score.largestShare * 100)}% of files, ${score.singleFileGroups} single-file groups.`);
  const count = new Map<string, number>();
  for (const id of leafOf.values()) count.set(id, (count.get(id) ?? 0) + 1);
  const size = (n: GroupNode): number => (n.files ? count.get(n.id) ?? 0 : n.children!.reduce((s, c) => s + size(c), 0));
  let hiddenGroups = 0;
  const tree = (n: GroupNode, d: number) => {
    const shown = sq.treeFiles && n.files ? `: ${n.files.length > sq.treeFiles ? `${n.files.slice(0, sq.treeFiles).join(" ")} … +${n.files.length - sq.treeFiles}` : n.files.join(" ")}` : "";
    const inner = n.children && d + 1 >= sq.treeDepth ? ` (${n.children.length} subgroups not shown)` : "";
    out.push(`${"  ".repeat(d)}- ${n.id} "${n.name}" (${size(n)} files)${shown}${inner}`);
    if (inner) hiddenGroups += n.children!.length;
    else n.children?.forEach((c) => tree(c, d + 1));
  };
  grouping.children.forEach((c) => tree(c, 0));
  if (hiddenGroups) elided.push("deeper default groups");
  if ((level || sq.foldersOnly) && !sq.treeFiles) elided.push("file globs of default groups");

  if (frame.large) {
    out.splice(noteAt, 0,
      `${LARGE_REPO_MARKER} The full file list doesn't fit in one digest, so this one shows folders with file counts.`,
      `Write the top rungs of grouping.json with placeholder leaves (folder patterns such as \`dir/**\` that cover every file), then run \`summary REPO --part <leaf id>\` for each placeholder over ${PART_OVER} files, biggest first, at most ${MAX_PART_DIGESTS} per run (SKILL.md section 2, "Large repo").`,
      ...(elided.length ? [`Also left out: ${elided.join("; ")}. Read facts.json for the full lists.`] : []),
    );
  } else if (elided.length) out.splice(noteAt, 0, `Compressed to fit about ${DIGEST_TOKEN_BUDGET / 1000}K tokens; left out: ${elided.join("; ")}. Read facts.json for the full lists.`);
  return { text: out.join("\n") + "\n", hidden: files.hidden };
}

/**
 * One line per folder. A folder over `sq.names` files lists its name prefixes with counts and a
 * few other names; folders deeper than `sq.depth` are rolled up into their ancestor.
 */
function filesByFolder(facts: Facts, sq: Squeeze, collapsed: Set<string>): { lines: string[]; hidden: number; dropped: string | null } {
  const dropped = commonExt(facts);
  const shortName = (base: string) => (dropped && base.endsWith(dropped) ? base.slice(0, -dropped.length) : base);
  const byDir = new Map<string, string[]>();
  const rolled = new Map<string, Map<string, number>>();
  const pkgDir = new Map(facts.packages.map((p) => [p.id, p.dir]));
  for (const f of facts.files) {
    const i = f.path.lastIndexOf("/");
    // a small package's files go on one line rather than one per folder
    let dir = collapsed.has(f.pkg) ? `${pkgDir.get(f.pkg)}/**` : i < 0 ? "." : f.path.slice(0, i);
    const parts = dir.split("/");
    if (!collapsed.has(f.pkg) && dir !== "." && parts.length > sq.depth) {
      dir = parts.slice(0, sq.depth).join("/");
      const sub = parts[sq.depth];
      const m = rolled.get(dir) ?? new Map<string, number>();
      m.set(sub, (m.get(sub) ?? 0) + 1);
      rolled.set(dir, m);
    }
    byDir.set(dir, [...(byDir.get(dir) ?? []), f.path.slice(i + 1)]);
  }
  const lines: string[] = [];
  let hidden = 0;
  for (const [dir, names] of [...byDir].sort((a, b) => a[0].localeCompare(b[0]))) {
    const sub = rolled.get(dir);
    const head = sub
      ? `${dir}/** (${names.length}, in ${sub.size} subfolder${sub.size === 1 ? "" : "s"}: ${cap([...sub].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([s, n]) => `${s}/ ${n}`), 10)})`
      : `${dir.endsWith("**") ? dir : `${dir}/`} (${names.length})`;
    // leaving names out on purpose (the large-repo top digest) isn't hiding them
    if (sq.foldersOnly) {
      lines.push(head);
      continue;
    }
    if (sq.allNames) {
      lines.push(`${head}: ${names.map(shortName).join(", ")}`);
      continue;
    }
    if (names.length <= Math.max(sq.names, 3) || (!sub && sq.names >= 80)) {
      const shown = names.slice(0, 80);
      hidden += names.length - shown.length;
      lines.push(`${head}: ${shown.map(shortName).join(", ")}${names.length > 80 ? ` … +${names.length - 80}` : ""}`);
      continue;
    }
    const byPrefix = new Map<string, string[]>();
    for (const n of names) {
      const p = prefixOf(n);
      byPrefix.set(p, [...(byPrefix.get(p) ?? []), n]);
    }
    const families = [...byPrefix].filter(([, ns]) => ns.length >= 3).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    const shownFamilies = families.slice(0, Math.max(6, sq.names));
    const loose = names.filter((n) => !shownFamilies.some(([, ns]) => ns.includes(n)));
    const samples = loose.slice(0, sq.names);
    hidden += names.length - samples.length;
    const parts = [...shownFamilies.map(([p, ns]) => `${p}* ${ns.length}`), ...samples.map(shortName)];
    const more = loose.length - samples.length;
    lines.push(parts.length ? `${head}: ${parts.join(", ")}${more ? ` … +${more} other` : ""}` : head);
  }
  return { lines, hidden, dropped };
}

const extOf = (p: string) => (/\.[^./]+$/.exec(p)?.[0] ?? "");
const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ".");

/**
 * The repo's most common extension, which the file list leaves off to save tokens. Every other one
 * stays, so a `.tsx` beside `.ts` files is never written back as `.ts` in an explicit path.
 */
function commonExt(facts: Facts): string | null {
  const n = new Map<string, number>();
  for (const f of facts.files) n.set(extOf(f.path), (n.get(extOf(f.path)) ?? 0) + 1);
  const top = [...n].filter(([e]) => e).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return top ? top[0] : null;
}

const PAGE_DIR = /(^|\/)(pages|routes|screens|views|app)\/[^/]+\.[jt]sx?$/;
const APP_ENTRY = /(^|\/)src\/(main|index|App)\.[jt]sx?$/;
const AUTH = /auth|log-?in|sign-?in|sign-?up|register|onboard/i;
const cap = (xs: string[], n = 40) => xs.slice(0, n).join(", ") + (xs.length > n ? ` … +${xs.length - n}` : "");

/** Candidates for the story's `entry` field: exact paths and endpoint names the build accepts. */
export function entryPoints(facts: Facts, n = 40): string[] {
  const out = ["## Likely entry points (valid `entry` values for the story: a file path, a page route or an endpoint name)"];
  const label = { callable: "Callable functions", http: "HTTP routes", action: "Server actions" };
  for (const kind of ["callable", "http", "action"] as const) {
    const names = [...new Set(facts.endpoints.filter((e) => e.kind === kind).map((e) => e.name))].sort();
    if (names.length) out.push(`- ${label[kind]}: ${cap(names, Math.round(n * 1.5))}`);
  }
  const web = new Set(facts.packages.filter((p) => p.kind === "web").map((p) => p.id));
  const routes = [...new Set(facts.pages.map((p) => p.route))].sort();
  if (routes.length) out.push(`- Page routes: ${cap(routes, Math.round(n * 1.5))}`);
  const apps = facts.files.filter((f) => web.has(f.pkg) && APP_ENTRY.test(f.path)).map((f) => f.path);
  if (apps.length) out.push(`- App entry files: ${cap(apps, n)}`);
  const pages = facts.files.map((f) => f.path).filter((p) => PAGE_DIR.test(p));
  if (pages.length) out.push(`- Top-level pages: ${cap(pages, n)}`);
  const auth = facts.files.map((f) => f.path).filter((p) => AUTH.test(p.split("/").pop()!));
  if (auth.length) out.push(`- Auth / sign-up files: ${cap(auth, n)}`);
  if (out.length === 1) out.push("(none detected; any source file path works)");
  out.push("");
  return out;
}
