// Readable names and one-line descriptions for default boxes (#359). No Claude, no network: names come
// from folder names, descriptions from hints already in the repo (package.json description, folder README,
// exported names), else a file count. A leaf module: it imports only types, so grouping.ts, clustername.ts,
// budgetsplit.ts and communities.ts can all use it without an import cycle.
import type { Facts, GroupNode, Grouping } from "./schema.ts";

const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const baseOf = (d: string) => d.split("/").pop() ?? "";

/** The deepest folder holding all of `paths`. */
export function commonDir(paths: string[]): string {
  let parts = dirOf(paths[0] ?? "").split("/").filter(Boolean);
  for (const p of paths) {
    const d = dirOf(p).split("/");
    let i = 0;
    while (i < parts.length && parts[i] === d[i]) i++;
    parts = parts.slice(0, i);
  }
  return parts.join("/");
}

// ---- names ----

const ABBREV: Record<string, string> = {
  util: "utilities", utils: "utilities", lib: "library", libs: "libraries", db: "database", dbs: "databases",
  pkg: "package", pkgs: "packages", cfg: "config", ctx: "context", svc: "service", svcs: "services",
};
const SPECIAL: Record<string, string> = Object.fromEntries([
  "API", "APIs", "UI", "UX", "SQL", "HTTP", "HTTPS", "URL", "URLs", "URI", "ID", "IDs", "CSS", "HTML", "JSON", "JWT", "SDK", "CLI",
  "SSR", "SSG", "SSE", "RPC", "tRPC", "GraphQL", "OAuth", "AI", "LLM", "PDF", "CSV", "XML", "SVG", "DOM", "AWS", "GCP", "CDN", "iOS",
  "E2E", "MDX", "ORM", "CMS", "SEO", "OTP", "SMS", "i18n",
].map((w) => [w.toLowerCase(), w]));
const CAMEL = /(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/;
const NAME_MAX = 40;

/** A folder or package name as a box name: "api-utils" -> "API utilities", "(marketing)" -> "Marketing". */
export function humanize(s: string): string {
  const cleaned = s
    .replace(/^@[^/]+\//, "")
    .replace(/\[{1,2}(?:\.{3})?([^\]]*)\]{1,2}/g, " $1 ")
    .replace(/\(([^)]*)\)/g, " $1 ")
    .replace(/(^|[\s/])[@_$]+/g, "$1")
    .replace(/\++(?=$|[\s/])/g, "");
  const word = (w: string): string => {
    const lower = w.toLowerCase();
    if (SPECIAL[lower]) return SPECIAL[lower];
    if (ABBREV[lower]) return ABBREV[lower];
    if (w.length >= 2 && /^[A-Z0-9]+$/.test(w) && /[A-Z]/.test(w)) return w;
    return lower;
  };
  const words: string[] = [];
  for (const tok of cleaned.split(/[\/\s\-_.]+/).filter(Boolean)) {
    // a special word can span camel pieces ("GraphQLSchema" -> Graph|QL|Schema), so try up to 3 pieces together
    const pieces = tok.split(CAMEL).filter(Boolean);
    for (let i = 0; i < pieces.length;) {
      let took = 0;
      for (let j = Math.min(pieces.length, i + 3); j > i && !took; j--) {
        const m = /^(.*?)(\d*)$/.exec(pieces.slice(i, j).join(""))!;
        if (m[1] && SPECIAL[m[1].toLowerCase()]) { words.push(SPECIAL[m[1].toLowerCase()] + m[2]); took = j - i; }
      }
      if (!took) { words.push(word(pieces[i])); took = 1; }
      i += took;
    }
  }
  let out = words.join(" ");
  if (out && !(SPECIAL[words[0].toLowerCase()] && /^[a-z]/.test(words[0]))) out = out.charAt(0).toUpperCase() + out.slice(1);
  if (out.length > NAME_MAX) {
    const cut = out.slice(0, NAME_MAX + 1).lastIndexOf(" ");
    out = out.slice(0, cut > 0 ? cut : NAME_MAX).replace(/[\s.,;:\-–]+$/, "");
  }
  return out || s.slice(0, NAME_MAX);
}

// ---- descriptions ----

const SUMMARY_MAX = 120;
const BOILERPLATE = /\b(bootstrapped|scaffolded|generated) (with|by)\b|\bthis (template|starter)\b|^(todo|tbd|wip|description)\b/i;
const slug = (s: string) => s.replace(/^@[^/]+\//, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const needsDot = (s: string) => /[\p{L}\p{N})]$/u.test(s);

/**
 * A hint as one summary line, or undefined when it says nothing: too short, boilerplate, or just the box,
 * package or folder name. Long hints are cut to their first sentence, else at a word with an ellipsis.
 */
export function cleanHint(s: string, avoid: string[] = [], max = SUMMARY_MAX): string | undefined {
  let t = s.replace(/\s+/g, " ").trim();
  if (t.length < 8 || BOILERPLATE.test(t)) return undefined;
  const k = slug(t);
  if (avoid.some((a) => slug(a) && slug(a) === k)) return undefined;
  if (t.length > max - (needsDot(t) ? 1 : 0)) {
    // the first sentence, unless its "end" is an abbreviation ("e.g.") or leaves too little
    let end = -1;
    for (const m of t.matchAll(/[.!?](\s|$)/g)) {
      const head = t.slice(0, m.index + 1);
      if (m.index + 1 > max) break;
      if (head.length >= 8 && !/\b(e\.g|i\.e|etc|vs|cf|approx)\.$/i.test(head)) { end = m.index + 1; break; }
    }
    if (end > 0) t = t.slice(0, end);
    else {
      const cut = t.slice(0, max - 1).lastIndexOf(" ");
      t = `${t.slice(0, cut > 0 ? cut : max - 1).replace(/[\s.,;:\-–]+$/, "")}…`;
    }
  }
  return needsDot(t) ? `${t}.` : t;
}

interface Index {
  dirCount: Map<string, number>; // files under each folder ("" = all)
  pkgCount: Map<string, number>;
  importers: Map<string, Set<string>>;
  loc: Map<string, number>;
  exports: Map<string, string[]>;
  readme: Map<string, { title?: string; text?: string }>;
  pkgs: Map<string, { description?: string; name: string }>;
  owner: Map<string, string>;
}
const indexes = new WeakMap<Facts, Index>();
function indexOf(facts: Facts): Index {
  let ix = indexes.get(facts);
  if (ix) return ix;
  ix = { dirCount: new Map(), pkgCount: new Map(), importers: new Map(), loc: new Map(), exports: new Map(), readme: new Map(), pkgs: new Map(), owner: new Map() };
  for (const f of facts.files) {
    ix.dirCount.set("", (ix.dirCount.get("") ?? 0) + 1);
    for (let d = dirOf(f.path); d; d = dirOf(d)) ix.dirCount.set(d, (ix.dirCount.get(d) ?? 0) + 1);
    ix.pkgCount.set(f.pkg, (ix.pkgCount.get(f.pkg) ?? 0) + 1);
    ix.loc.set(f.path, f.loc);
    ix.owner.set(f.path, f.pkg);
    if (f.exports?.length) ix.exports.set(f.path, f.exports);
  }
  for (const e of facts.imports) if (e.from !== e.to) ix.importers.set(e.to, (ix.importers.get(e.to) ?? new Set()).add(e.from));
  for (const r of facts.readmes ?? []) ix.readme.set(r.dir, r);
  for (const p of facts.packages) ix.pkgs.set(p.id, p);
  indexes.set(facts, ix);
  return ix;
}

/**
 * The real hints for a box covering exactly `files`: its package's description (when it is the whole
 * package), else the README of the folder it covers entirely. A README never describes a box that holds
 * only part of its folder, so a parent's text doesn't show up on a child or an "Other" box.
 */
export function boxHint(files: string[], facts: Facts, name: string): string | undefined {
  if (!files.length) return undefined;
  const ix = indexOf(facts);
  const owner = ix.owner;
  const pkg = owner.get(files[0]);
  if (pkg && files.every((f) => owner.get(f) === pkg) && files.length === ix.pkgCount.get(pkg)) {
    const p = ix.pkgs.get(pkg);
    const h = p?.description ? cleanHint(p.description, [name, p.name]) : undefined;
    if (h) return h;
  }
  const under = (d: string) => files.filter((f) => !d || f.startsWith(`${d}/`)).length;
  for (let d: string | undefined = commonDir(files); d !== undefined; d = d ? dirOf(d) : undefined) {
    if (under(d) !== ix.dirCount.get(d)) continue;
    const r = ix.readme.get(d);
    if (!r) continue;
    const avoid = [name, baseOf(d)];
    const h = (r.text ? cleanHint(r.text, avoid) : undefined) ?? (r.title ? cleanHint(r.title, avoid) : undefined);
    if (h) return h;
  }
  return undefined;
}

function exportsLine(names: string[]): string {
  const line = (shown: string[]) => {
    const more = names.length - shown.length;
    const head = shown.length > 1 ? `${shown.slice(0, -1).join(", ")}${more ? "," : " and"} ${shown[shown.length - 1]}` : shown[0];
    return `Exports ${head}${more ? ` and ${more} more` : ""}.`;
  };
  let shown = names.slice(0, 3);
  while (shown.length > 1 && line(shown).length > SUMMARY_MAX) shown = shown.slice(0, -1);
  const l = line(shown);
  return l.length > SUMMARY_MAX ? `${l.slice(0, SUMMARY_MAX - 2).replace(/[\s,]+$/, "")}….` : l;
}

/** A one-line description of a box: the hints above, else its most-imported exports, else a file count. */
export function describe(files: string[], facts: Facts, name: string): string {
  const hint = boxHint(files, facts, name);
  if (hint) return hint;
  const ix = indexOf(facts);
  const n = (f: string) => ix.importers.get(f)?.size ?? 0;
  const ranked = [...files].sort((a, b) => n(b) - n(a) || (ix.loc.get(b) ?? 0) - (ix.loc.get(a) ?? 0) || a.localeCompare(b));
  const seen = new Set<string>();
  for (const f of ranked) for (const e of ix.exports.get(f) ?? []) seen.add(e);
  if (seen.size) return exportsLine([...seen]);
  const d = commonDir(files);
  const count = `${files.length} file${files.length === 1 ? "" : "s"}`;
  if (!d) return `${count}.`;
  const segs = d.split("/");
  let shown = d;
  for (let i = 1; `${count} in ${shown}/.`.length > SUMMARY_MAX && i < segs.length; i++) shown = `…/${segs.slice(i).join("/")}`;
  return `${count} in ${shown}/.`;
}

/**
 * Fills every empty node summary, at any depth, from the files the node covers. Summaries that exist
 * (budgetsplit's markers and ranges, package and group sentences) and the root sentence are never changed,
 * so running it twice gives the same result as once.
 */
export function describeBoxes(g: Grouping, facts: Facts, leafOf: Map<string, string>): Grouping {
  const byLeaf = new Map<string, string[]>();
  for (const [path, id] of leafOf) byLeaf.set(id, [...(byLeaf.get(id) ?? []), path]);
  const filesUnder = (n: GroupNode): string[] => [...(byLeaf.get(n.id) ?? []), ...(n.children ?? []).flatMap(filesUnder)];
  const walk = (n: GroupNode): GroupNode => {
    const kids = n.children?.map(walk);
    const files = n.summary === "" ? filesUnder(n) : [];
    return { ...n, ...(kids ? { children: kids } : {}), ...(n.summary === "" && files.length ? { summary: describe(files.sort(), facts, n.name) } : {}) };
  };
  return { ...g, children: g.children.map(walk) };
}
