import type { Facts, GroupNode, Grouping, Package } from "./schema.ts";
import { compileGlob, literalDir, type Matcher } from "./glob.ts";
import { validateStory } from "./story.ts";
import { splitCatchAlls } from "./communities.ts";
import { guardLevels, levelWarnings, otherBoxes } from "./depth.ts";
import { checkSplits } from "./splits.ts";
import { splitOverBudget } from "./budgetsplit.ts";
import { boxHint, describeBoxes, humanize } from "./boxnames.ts";

// A folder this small isn't worth opening. There is no depth limit (#103): a folder keeps opening
// while it is bigger than this, and guardLevels() removes the levels that would show too little.
const LEAF_MAX = 12;
const MIN_GROUP = 3;
const MAX_CHILDREN = 10;

const KIND_ORDER: Record<Package["kind"], number> = { web: 0, backend: 1, library: 2, scripts: 3 };
const KIND_LABEL: Record<Package["kind"], string> = { web: "Web app", backend: "Backend", library: "Library", scripts: "Scripts" };

export { humanize } from "./boxnames.ts";
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x";

/**
 * Folder-based grouping. Deterministic, so it gives the same boxes on an unchanged repo;
 * it's the fallback diagram and Claude's starting point.
 */
export function defaultGrouping(facts: Facts): Grouping {
  // "root" is the top board's id: a package named "root" (trpc's) must not take it
  const used = new Set<string>(["root"]);
  const uid = (base: string) => {
    let id = slug(base).slice(0, 48).replace(/-$/, "");
    for (let i = 2; used.has(id); i++) id = `${slug(base).slice(0, 44)}-${i}`;
    used.add(id);
    return id;
  };

  const pkgs = [...facts.packages].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.id.localeCompare(b.id));
  const filesOf = (p: Package) => facts.files.filter((f) => f.pkg === p.id).map((f) => f.path);

  let children: GroupNode[];
  if (pkgs.length === 1) {
    const g = folderGroup(filesOf(pkgs[0]), pkgs[0].dir, pkgs[0].id, uid);
    children = g.children ?? [g];
  } else {
    const names = packageNames(pkgs);
    const kindSentence = (p: Package) => `${KIND_LABEL[p.kind]} in ${p.dir || "the repo root"}.`;
    const pkgNode = (p: Package): GroupNode => {
      const g = folderGroup(filesOf(p), p.dir, p.id, uid);
      const loose = SHARED_DIR.test(p.dir); // a plain folder, not a package
      return { ...g, id: g.id, name: loose ? `Loose files in ${p.dir}/` : names.get(p)!, summary: loose ? kindSentence(p) : boxHint(filesOf(p), facts, names.get(p)!) ?? kindSentence(p) };
    };
    // Many example apps (trpc's examples/) are not the product: they go one level down together,
    // so the overview shows the library and its docs first (#222)
    const examples = pkgs.filter((p) => exampleFolder(p.dir));
    const pulled = new Set(examples.map((p) => exampleFolder(p.dir))).size >= MIN_EXAMPLES && examples.length < pkgs.length;
    const main = pulled ? pkgs.filter((p) => !exampleFolder(p.dir)) : pkgs;
    // Monorepos: apps stay at the top level, the libraries they share go one level down.
    // With an apps/ folder the layout says what's an app; otherwise only plain libraries are shared,
    // or every nested package when the only apps are examples (they are the library the examples use).
    // Top-level folders (tools/, docs/) stay at the top either way.
    const hasAppsDir = main.some((p) => APP_DIR.test(p.dir));
    const isShared = (p: Package) => hasAppsDir ? !APP_DIR.test(p.dir) && (p.dir.includes("/") || SHARED_DIR.test(p.dir)) : p.dir.includes("/") && (p.kind === "library" || pulled);
    const shared = main.filter(isShared);
    if (shared.length >= 2) {
      children = main.filter((p) => !isShared(p)).map(pkgNode);
      children.push(sharedGroup(shared, filesOf, pkgNode, uid, hasAppsDir || !pulled ? undefined : "Library"));
    } else children = main.map(pkgNode);
    if (pulled) children.push(examplesGroup(examples, filesOf, uid));
  }
  const kinds = pkgs.map((p) => KIND_LABEL[p.kind].toLowerCase());
  const kindList = pkgs.length <= 7 ? kinds.join(", ") : [...new Set(kinds)].map((k) => {
    const n = kinds.filter((x) => x === k).length;
    return `${n} ${n === 1 || k === "scripts" ? k : k === "library" ? "libraries" : `${k}s`}`;
  }).join(", ");
  return refine({ version: 1, summary: `${facts.repo}: ${pkgs.length} package${pkgs.length === 1 ? "" : "s"} (${kindList}).`, children }, facts);
}

/**
 * Box names per package: its package.json name, unless two packages share it (copied starters,
 * like friendlyeats' two "my-app"s), when the folder says which is which, with as many path segments as it takes.
 */
export function packageNames(pkgs: Package[]): Map<Package, string> {
  const out = new Map<Package, string>();
  const tail = (p: Package, k: number) => humanize(p.dir.split("/").filter(Boolean).slice(-k).join(" ") || p.name);
  const depth = new Map(pkgs.map((p) => [p, 0]));
  for (let round = 0; round < 6; round++) {
    const name = (p: Package) => (depth.get(p)! ? tail(p, depth.get(p)!) : humanize(p.name));
    const count = new Map<string, number>();
    for (const p of pkgs) count.set(name(p), (count.get(name(p)) ?? 0) + 1);
    const clash = pkgs.filter((p) => count.get(name(p))! > 1);
    for (const p of pkgs) out.set(p, name(p));
    if (!clash.length) break;
    for (const p of clash) depth.set(p, depth.get(p)! + 1);
  }
  return out;
}

const SHARED_MAX = 7; // more shared packages than this get grouped by their parent folder

const APP_DIR = /^(apps?|services|sites|[^/]*examples?[^/]*)\//;
/** A folder of example apps (examples/, samples/, demos/, trpc-examples/): kept whole as one group (#225). */
const EXAMPLES_DIR = /(^|[-_.])(examples?|samples?|demos?)([-_.]|$)/i;
// files straight under packages/ that belong to no package (packages/sms/*.ts) are shared code too
const SHARED_DIR = /^(packages|libs?|modules|shared)$/;

/** At least this many example apps go one level down together; one or two stay beside the rest. */
const MIN_EXAMPLES = 3;

/** "examples/next-sse-chat/client" -> "examples/next-sse-chat": the example a package belongs to, or null. */
export function exampleFolder(dir: string): string | null {
  const parts = dir.split("/");
  const i = parts.findIndex((s) => /(^|[-_.])examples?([-_.]|$)/i.test(s));
  return i >= 0 && i < parts.length - 1 ? parts.slice(0, i + 2).join("/") : null;
}

/**
 * One "Examples" group: a box per example, named after its folder ("Next sse chat", not the
 * package's "@examples/next-sse-chat"); an example made of several packages (a client and a server)
 * is a group of them. A long list is split later by the budget pass, by the names' first word.
 */
function examplesGroup(examples: Package[], filesOf: (p: Package) => string[], uid: (s: string) => string): GroupNode {
  const byFolder = new Map<string, Package[]>();
  for (const p of examples) {
    const k = exampleFolder(p.dir)!;
    byFolder.set(k, [...(byFolder.get(k) ?? []), p]);
  }
  const id = uid("examples");
  const node = (p: Package, name: string, summary: string): GroupNode => ({ ...folderGroup(filesOf(p), p.dir, p.id, uid), name, summary });
  const children = [...byFolder].sort((a, b) => a[0].localeCompare(b[0])).map(([folder, ps]): GroupNode => {
    const name = humanize(folder.split("/").pop()!);
    if (ps.length === 1) return node(ps[0], name, `Example: ${KIND_LABEL[ps[0].kind].toLowerCase()} in ${ps[0].dir}/.`);
    const sorted = [...ps].sort((a, b) => a.dir.localeCompare(b.dir));
    const kids = sorted.map((p) => node(p, humanize(p.dir.slice(folder.length + 1)), `${KIND_LABEL[p.kind]} in ${p.dir}/.`));
    return { id: uid(`example-${folder.split("/").pop()}`), name, summary: `Example in ${folder}/, in ${ps.length} packages.`, children: kids };
  });
  const roots = [...new Set([...byFolder.keys()].map((k) => `${k.slice(0, k.lastIndexOf("/"))}/`))].sort();
  return { id, name: "Examples", summary: `${byFolder.size} example apps in ${roots.join(", ")}.`, children };
}

function sharedGroup(shared: Package[], filesOf: (p: Package) => string[], pkgNode: (p: Package) => GroupNode, uid: (s: string) => string, name?: string): GroupNode {
  const size = new Map(shared.map((p) => [p, filesOf(p).length]));
  const id = uid("shared-packages");
  // the biggest packages get boxes, the long tail is one leaf; keeps every level under MAX_CHILDREN
  const otherLeaf = (ps: Package[], base: string): GroupNode => {
    const sorted = [...ps].sort((a, b) => a.dir.localeCompare(b.dir));
    return { id: uid(`${base}-other`), name: `${ps.length} more packages`, summary: sorted.map((p) => p.name).join(", ").slice(0, 300), files: sorted.map((p) => `${p.dir}/**`) };
  };
  const capped = (ps: Package[], base: string, room = MAX_CHILDREN): GroupNode[] => {
    const ranked = [...ps].sort((a, b) => size.get(b)! - size.get(a)! || a.dir.localeCompare(b.dir));
    if (ranked.length <= room) return ranked.map(pkgNode);
    return [...ranked.slice(0, room - 1).map(pkgNode), otherLeaf(ranked.slice(room - 1), base)];
  };
  let children: GroupNode[];
  const byFolder = new Map<string, Package[]>();
  for (const p of shared) {
    const parent = p.dir.includes("/") ? p.dir.slice(0, p.dir.lastIndexOf("/")) : "";
    byFolder.set(parent, [...(byFolder.get(parent) ?? []), p]);
  }
  if (shared.length <= SHARED_MAX || byFolder.size < 2) children = capped(shared, id);
  else {
    const folders: GroupNode[] = [];
    const loose: Package[] = [];
    for (const [folder, ps] of [...byFolder].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (ps.length < 2) { loose.push(...ps); continue; }
      const fid = uid(`folder-${folder}`);
      folders.push({ id: fid, name: humanize(folder.split("/").pop() || "packages"), summary: `${ps.length} packages in ${folder || "the repo root"}/.`, children: capped(ps, fid) });
    }
    children = [...folders, ...(loose.length ? capped(loose, `${id}-loose`, Math.max(1, MAX_CHILDREN - folders.length)) : [])];
  }
  return { id, name: name ?? "Shared packages", summary: name ? `${shared.length} packages the examples build on.` : `${shared.length} libraries shared across the apps.`, children };
}

/** Folder grouping leaves catch-alls behind ("Other", a flat 60-file folder); split those by imports. */
function refine(g: Grouping, facts: Facts): Grouping {
  const { leafOf, errors } = assign(g, facts);
  // one folder level at a time: its subfolders become leaves, which are opened again if still big
  if (errors.length) return g;
  const split = splitCatchAlls(g, facts, leafOf, (paths, dir, id, uid) => folderGroup(paths, dir, id, uid));
  const guarded = guardLevels(split, otherBoxes(split, facts, assign(split, facts).leafOf));
  // no AI to split the crowded boards later: split them here, mechanically (#155)
  const done = splitOversized(splitOverBudget(guarded, facts), facts);
  const last = assign(done, facts);
  return last.errors.length ? done : describeBoxes(done, facts, last.leafOf);
}

/** A leaf holding more than this share of the repo's files (and more than LEAF_MAX of them) reads as "everything is here". */
export const OVERSIZE_SHARE = 0.4;

/** Splits the biggest leaf while it holds over OVERSIZE_SHARE of the files, as long as each split helps (#358). */
export function splitOversized(g: Grouping, facts: Facts): Grouping {
  for (let i = 0; i < 3; i++) {
    const a = assign(g, facts);
    if (a.errors.length) return g;
    const s = groupingScore(a.leafOf);
    const n = [...a.leafOf.values()].filter((id) => id === s.largest).length;
    if (!s.largest || s.largestShare <= OVERSIZE_SHARE || n <= LEAF_MAX) return g;
    const next = splitOverBudget(g, facts, [], { force: [s.largest] });
    const b = assign(next, facts);
    if (b.errors.length || groupingScore(b.leafOf).largestShare >= s.largestShare) return g;
    g = next;
  }
  return g;
}

export interface GroupingScore {
  /** Leaf groups that hold at least one file. */
  groups: number;
  /** Share of all files in the biggest leaf (0-1), and that leaf's id. */
  largestShare: number;
  largest: string | null;
  singleFileGroups: number;
}

/** How readable a grouping is at a glance: one huge box or many one-file boxes both read badly. */
export function groupingScore(leafOf: Map<string, string>): GroupingScore {
  const count = new Map<string, number>();
  for (const id of leafOf.values()) count.set(id, (count.get(id) ?? 0) + 1);
  const [largest, max] = [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? [null, 0];
  return {
    groups: count.size,
    largestShare: leafOf.size ? Math.round((max / leafOf.size) * 1000) / 1000 : 0,
    largest,
    singleFileGroups: [...count.values()].filter((n) => n === 1).length,
  };
}

/** map[key].push(v), creating the list: unlike `[...old, v]` it does not copy the list every time. */
export function pushTo<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const a = m.get(k);
  if (a) a.push(v); else m.set(k, [v]);
}

function folderGroup(paths: string[], dir: string, idBase: string, uid: (s: string) => string): GroupNode {
  // descend through folders that hold everything (web/ -> web/src/)
  let base = dir;
  for (;;) {
    const rel = paths.map((p) => (base ? p.slice(base.length + 1) : p));
    const first = rel[0]?.split("/");
    if (!first || first.length < 2) break;
    if (!rel.every((r) => r.startsWith(first[0] + "/"))) break;
    base = base ? `${base}/${first[0]}` : first[0];
  }
  const id = uid(idBase);
  const name = chainName(dir, base) ?? humanize(base.split("/").pop() || idBase);
  const leaf = (): GroupNode => ({ id, name, summary: "", files: [base ? `${base}/**` : "**"] });
  if (paths.length <= LEAF_MAX) return leaf();

  const sub = new Map<string, string[]>();
  const loose: string[] = [];
  for (const p of paths) {
    const r = base ? p.slice(base.length + 1) : p;
    const i = r.indexOf("/");
    if (i < 0) loose.push(p);
    else pushTo(sub, r.slice(0, i), p);
  }

  const children: GroupNode[] = [];
  const other: string[] = [...loose];
  for (const [folder, files] of [...sub].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
    if (files.length < MIN_GROUP) { other.push(...files); continue; }
    // one folder holding nearly everything (web/src next to web/scripts) is not a level of its own:
    // lift its groups up beside the small siblings
    const dominant = files.length >= 0.85 * paths.length;
    // examples/ holding 43 of express's 50 files is still not the product: keep it one "Examples" box (#225)
    const apps = new Set(files.map((p) => p.slice((base ? base.length + 1 : 0) + folder.length + 1)).filter((r) => r.includes("/")).map((r) => r.slice(0, r.indexOf("/"))));
    const examples = EXAMPLES_DIR.test(folder) && apps.size >= MIN_EXAMPLES;
    const child = folderGroup(files, base ? `${base}/${folder}` : folder, `${idBase}-${folder}`, uid);
    if (dominant && child.children && !examples) {
      for (const c of child.children) {
        if (c.name === "Other" && c.files) other.push(...c.files.flatMap((f) => paths.filter((p) => globRe(f).test(p))));
        else children.push(c);
      }
    }
    else children.push(child);
  }
  // a big flat folder (92 files side by side) is grouped by filename prefix: billing*.ts, kiosk*.ts …
  if (loose.length > LEAF_MAX) {
    other.length = 0;
    const looseSet = new Set(loose);
    other.push(...paths.filter((p) => !looseSet.has(p) && !children.some((c) => covers(c, p))));
    const byPrefix = new Map<string, string[]>();
    for (const p of loose) {
      const k = prefixOf(p.split("/").pop()!);
      pushTo(byPrefix, k, p);
    }
    for (const [k, files] of [...byPrefix].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
      if (files.length < MIN_GROUP || k === "index") { other.push(...files); continue; }
      // consent.ts beside consent/ belongs with the folder
      const twin = children.find((c) => c.files && slug(c.name) === slug(humanize(k)));
      if (twin) twin.files!.push(...files.sort());
      else children.push({ id: uid(`${idBase}-${k}`), name: humanize(k), summary: "", files: files.sort() });
    }
  }
  // keep each level readable: the biggest groups get boxes, the long tail goes to Other
  const size = (n: GroupNode): number => paths.filter((p) => covers(n, p)).length;
  if (children.length > MAX_CHILDREN) {
    const ranked = children.map((c) => [c, size(c)] as const).sort((a, b) => b[1] - a[1]);
    children.length = 0;
    for (const [c, n] of ranked) {
      if (children.length < MAX_CHILDREN - 1) children.push(c);
      else other.push(...paths.filter((p) => covers(c, p)));
      void n;
    }
  }
  if (other.length) children.push({ id: uid(`${idBase}-other`), name: children.length ? "Other" : name, summary: "", files: other.sort() });
  if (children.length < 2) return leaf();
  return { id, name, summary: "", children };
}

/**
 * A folder chain the grouping walked down in one step (features/billing/invoices/pdf) is named by its
 * last two folders, "Invoices pdf", not just "Pdf" (#358); src/ and route groups like (shop) say nothing.
 */
function chainName(dir: string, base: string): string | null {
  if (base === dir) return null;
  const segs = [...(dir ? [dir.slice(dir.lastIndexOf("/") + 1)] : []), ...base.slice(dir ? dir.length + 1 : 0).split("/")]
    .filter((s) => !/^(src|\(.*\))$/.test(s));
  return segs.length >= 2 ? humanize(segs.slice(-2).join(" ")) : null;
}

// covers() runs per file per group; compiling the same globs each time dominated big repos
const globCache = new Map<string, RegExp>();
const globRe = (g: string) => {
  let re = globCache.get(g);
  if (!re) globCache.set(g, (re = compileGlob(g).re));
  return re;
};

function covers(n: GroupNode, path: string): boolean {
  if (n.files) return n.files.some((f) => globRe(f).test(path));
  return n.children!.some((c) => covers(c, path));
}

/** "warRoomErrors.ts" -> "warRoom", "billing.ts" -> "billing", "kiosk-shared.ts" -> "kiosk". */
export function prefixOf(file: string): string {
  const stem = file.replace(/\.[^.]+$/, "");
  // App.clipboard.ts, App.pan.ts … are parts of App
  if (stem.includes(".")) return stem.charAt(0).toLowerCase() + stem.slice(1, stem.indexOf("."));
  // acronyms stay whole: TTDDialog -> TTD, Dialog
  const words = stem.split(/[-_.]|(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/).filter(Boolean);
  if (words.length > 1 && /^(use|get|set|with|is|has|create|make)$/.test(words[0])) words.shift();
  let k = (words[0] ?? stem).toLowerCase();
  const acronym = /^[A-Z0-9]{2,}$/.test(words[0] ?? "");
  if (k.length < 4 && !acronym && words[1]) k += words[1].charAt(0).toUpperCase() + words[1].slice(1);
  return k.charAt(0).toLowerCase() + k.slice(1);
}

// ---- validation ----

export interface Assignment {
  /** file path -> leaf id */
  leafOf: Map<string, string>;
  errors: string[];
  warnings: string[];
}

export function assign(grouping: Grouping, facts: Facts): Assignment {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Set<string>(["root"]);
  const leaves: { id: string; m: Matcher }[] = [];
  const walk = (n: GroupNode) => {
    if (ids.has(n.id)) errors.push(`duplicate id "${n.id}"`);
    ids.add(n.id);
    if (n.files) for (const f of n.files) leaves.push({ id: n.id, m: compileGlob(f) });
    for (const p of n.split ?? []) {
      if (ids.has(p.id)) errors.push(`duplicate id "${p.id}"`);
      ids.add(p.id);
    }
    n.children?.forEach(walk);
  };
  grouping.children.forEach(walk);

  const leafOf = new Map<string, string>();
  const hits = new Map<Matcher, number>();
  const unassigned: string[] = [];
  const ambiguous: string[] = [];
  // patterns by the folder their literal prefix sits in: a file tries only those along its own folder path
  const byDir = new Map<string, number[]>();
  leaves.forEach((l, i) => { const d = literalDir(l.m.pattern); pushTo(byDir, d, i); });
  const candidates = (path: string): { id: string; m: Matcher }[] => {
    const idx: number[] = [...(byDir.get("") ?? [])];
    for (let i = path.indexOf("/"); i >= 0; i = path.indexOf("/", i + 1)) idx.push(...(byDir.get(path.slice(0, i)) ?? []));
    return idx.sort((a, b) => a - b).map((i) => leaves[i]);
  };
  for (const { path } of facts.files) {
    let best: { id: string; m: Matcher }[] = [];
    for (const l of candidates(path)) {
      if (!l.m.re.test(path)) continue;
      hits.set(l.m, (hits.get(l.m) ?? 0) + 1);
      if (!best.length || l.m.specificity > best[0].m.specificity) best = [l];
      else if (l.m.specificity === best[0].m.specificity) best.push(l);
    }
    const owners = new Set(best.map((b) => b.id));
    if (!owners.size) unassigned.push(path);
    else if (owners.size > 1) ambiguous.push(`${path} (${[...owners].join(", ")})`);
    else leafOf.set(path, best[0].id);
  }
  const list = (xs: string[]) => xs.slice(0, 25).map((x) => `  ${x}`).join("\n") + (xs.length > 25 ? `\n  … and ${xs.length - 25} more` : "");
  // an explicit path written with the wrong extension (`.ts` for a `.tsx`) matches nothing: say which
  const stem = (p: string) => p.replace(/\.[^./]+$/, "");
  const missed = new Map(leaves.filter((l) => !hits.get(l.m) && !/[*?[{]/.test(l.m.pattern)).map((l) => [stem(l.m.pattern), l]));
  const why = (f: string) => { const l = missed.get(stem(f)); return l ? `${f} (pattern "${l.m.pattern}" in "${l.id}" has the wrong extension)` : f; };
  if (unassigned.length) errors.push(`${unassigned.length} file(s) not covered by any group:\n${list(unassigned.map(why))}`);
  if (ambiguous.length) errors.push(`${ambiguous.length} file(s) matched equally by more than one group (make one pattern more specific):\n${list(ambiguous)}`);
  for (const l of leaves) if (!hits.get(l.m)) warnings.push(`pattern "${l.m.pattern}" in "${l.id}" matches no files`);
  const perLeaf = new Map<string, number>();
  for (const id of leafOf.values()) perLeaf.set(id, (perLeaf.get(id) ?? 0) + 1);
  const size = new Map<string, number>();
  const tally = (n: GroupNode): number => {
    const c = n.files ? (perLeaf.get(n.id) ?? 0) : n.children!.reduce((a, k) => a + tally(k), 0);
    size.set(n.id, c);
    return c;
  };
  grouping.children.forEach(tally);
  warnings.push(...levelWarnings(grouping, otherBoxes(grouping, facts, leafOf), (id) => size.get(id) ?? 0));
  if (!unassigned.length && !ambiguous.length) errors.push(...checkSplits(grouping, leafOf).errors);
  const story = validateStory(grouping, facts, leafOf);
  errors.push(...story.errors);
  warnings.push(...story.warnings);
  return { leafOf, errors, warnings };
}
