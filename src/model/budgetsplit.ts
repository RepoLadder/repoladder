// No-AI mode (#155): the default grouping keeps every board within the digestibility budget
// (build/budget.ts: 12 boxes, 20 arrows, counting the dashed parts from elsewhere and the services)
// by splitting the boards over it mechanically. Boards are measured on the model itself, which
// draws exactly the boxes and arrows the layout does, so no layout is needed here.
import type { Facts, GroupNode, Grouping } from "./schema.ts";
import { buildModel } from "./rollup.ts";
import { FILE, MAX_FILE_BOXES, MORE } from "./fileboards.ts";
import { communities, linksAmong } from "./communities.ts";
import { compileGlob } from "./glob.ts";
import { MIN_LEVEL_BOXES } from "./depth.ts";
import { GENERIC, clusterBasis, commonDir } from "./clustername.ts";
// a cycle (grouping.ts imports this module), safe because these are only called, never read at load
import { assign, prefixOf, pushTo } from "./grouping.ts";
import { humanize } from "./boxnames.ts";

/** The same numbers as BUDGET in build/budget.ts (model code doesn't import the build). */
export const BOX_BUDGET = 12;
export const EDGE_BUDGET = 20;
const ROUNDS = 12;
const MAX_CHILDREN = 10;

const stem = (p: string) => p.slice(p.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const slug = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x";
// GENERIC and commonDir live with the cluster-naming rule (#283); commonDir is re-exported for callers here
export { commonDir };

interface Part { key: string; name: string; summary: string; items: string[] }
/** Gathering a group's parts: how many files each holds, and the most one gathered part may hold. */
interface Gather { weight: (items: string[]) => number; maxWeight: number }

/** How a gathered group's summary starts, so a later pass (the build's names re-split) knows it. */
const GATHERED = "Parts that ";

/** A group's board keeps at least this many parts when some are gathered into sub-groups. */
export const MIN_GATHERED = 4;
/** No gathered sub-group holds more than this share of its parent's files. */
export const MAX_GATHER_SHARE = 0.6;

/** The most-imported of `files`, counting imports from the others first: what an import cluster is named after. */
export function hubOf(files: string[], imports: { from: string; to: string }[]): string {
  const set = new Set(files);
  const inside = new Map<string, number>(), all = new Map<string, number>();
  for (const e of imports) {
    if (e.from === e.to || !set.has(e.to)) continue;
    all.set(e.to, (all.get(e.to) ?? 0) + 1);
    if (set.has(e.from)) inside.set(e.to, (inside.get(e.to) ?? 0) + 1);
  }
  const score = (f: string) => [inside.get(f) ?? 0, all.get(f) ?? 0, GENERIC.test(stem(f)) ? 0 : 1];
  return [...files].sort((a, b) => {
    const x = score(a), y = score(b);
    return y[0] - x[0] || y[1] - x[1] || y[2] - x[2] || a.localeCompare(b);
  })[0];
}

const PLAIN = new Set(["page", "pages", "index", "use", "get", "set", "the", "and", "for", "with", "impl", "util", "utils", "helper", "helpers", "type", "types", "component", "components", "mobile", "web"]);
// two-letter words count ("Vs" in VsEnvoyPage, VsILobbyPage), the little ones in names don't
const SHORT = new Set(["in", "on", "to", "of", "by", "is", "at", "an", "or", "as", "up", "id", "my", "no", "do", "be", "it"]);
/** The words of a file name worth grouping by: "WaitingRoomCheckInPage" -> waiting, room, check. */
export const nameWords = (s: string) => s.split(/[-_.]|(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/).map((w) => w.toLowerCase()).filter((w) => (w.length >= 3 || /^[a-z]{2}$/.test(w) && !SHORT.has(w)) && !PLAIN.has(w) && !/^\d+$/.test(w));

/** "src/auth/useAuth.ts" -> "useAuth hub"; an index.ts is named after its folder. */
const hubName = (hub: string) => `${GENERIC.test(stem(hub)) && dirOf(hub) ? dirOf(hub).split("/").pop()! : stem(hub)} hub`.slice(0, 40);

/**
 * Splits `items` into at most `room` parts, trying each rule in turn on what the rules before it
 * left: (1) subfolder, (2) shared filename prefix, (3) import clusters. Parts hold at least two
 * items; items no rule placed come back in `rest`. Rules stop as soon as the count fits and
 * the rest (one leaf of its own, for files) would fit on its own board.
 */
export function partition(
  items: string[],
  room: number,
  opts: { folderOf: (item: string) => string | null; prefix: (item: string) => string | null; links: (items: string[]) => { from: string; to: string; w?: number }[]; hub: (items: string[]) => string; restCounts: boolean; restFits?: (rest: string[]) => boolean; words?: (item: string) => string[]; fewest?: number; gather?: Gather },
): { parts: Part[]; rest: string[] } {
  const parts: Part[] = [];
  let rest = [...items].sort();
  const count = () => parts.length + (opts.restCounts && parts.length ? (rest.length ? 1 : 0) : rest.length);
  const take = (by: Map<string, string[]>, make: (k: string, xs: string[]) => Part) => {
    const g = opts.gather;
    if (g) {
      // gathering parts: the smallest groups first, one at a time, and only as many as it takes to
      // fit, so the board keeps as many parts as the budget allows; none may swallow the board
      const cands = [...by].filter(([k, xs]) => k && xs.length >= 2 && xs.length < rest.length + parts.length && g.weight(xs) <= g.maxWeight)
        .sort((a, b) => g.weight(a[1]) - g.weight(b[1]) || a[0].localeCompare(b[0]));
      for (const [k, xs] of cands) {
        if (count() <= room) break;
        if (count() - (xs.length - 1) < (opts.fewest ?? 2) || parts.length >= MAX_CHILDREN - 1) continue;
        parts.push(make(k, xs.sort()));
        const placed = new Set(xs);
        rest = rest.filter((x) => !placed.has(x));
      }
      return;
    }
    const big = [...by].filter(([k, xs]) => k && xs.length >= 2).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    // one part holding (nearly) everything is no split at all: the rest would fold back into it
    if (!parts.length && big.length === 1 && rest.length - big[0][1].length < 3) return;
    // never more boxes than a level holds (the folder grouping's cap): the smallest wait in the rest
    const fit = big.slice(0, Math.max(0, MAX_CHILDREN - parts.length - 1));
    for (const [k, xs] of fit) parts.push(make(k, xs.sort()));
    const placed = new Set(fit.flatMap(([, xs]) => xs));
    rest = rest.filter((x) => !placed.has(x));
  };
  const bucket = (key: (x: string) => string | null) => {
    const by = new Map<string, string[]>();
    for (const x of rest) {
      const k = key(x);
      if (k) by.set(k, [...(by.get(k) ?? []), x]);
    }
    return by;
  };
  const more = () => count() > room || count() < (opts.fewest ?? 2) || !(opts.restFits?.(rest) ?? true);
  if (more()) take(bucket(opts.folderOf), (k, xs) => ({ key: k, name: humanize(k), summary: "", items: xs }));
  if (more()) take(bucket(opts.prefix), (k, xs) => ({ key: k, name: humanize(k), summary: "", items: xs }));
  // a word the names share anywhere: DigitalCheckInPage, QrCheckInPage … (the most shared first)
  for (let i = 0; i < 9 && opts.words && more() && rest.length >= 4; i++) {
    const count = new Map<string, string[]>();
    for (const x of rest) for (const w of new Set(opts.words(x))) count.set(w, [...(count.get(w) ?? []), x]);
    const best = [...count].filter(([, xs]) => xs.length >= 2 && rest.length - xs.length >= (parts.length ? 0 : 3))
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0];
    if (!best) break;
    take(new Map([best]), (k, xs) => ({ key: k, name: humanize(k), summary: "", items: xs }));
  }
  // a finer resolution when the files all hang together as one cluster
  for (const resolution of [1, 1.25, 1.5, 2, 3, 4]) {
    if (!more() || rest.length < 4) break;
    const n = parts.length, before = rest;
    const by = new Map<string, string[]>();
    for (const c of communities(rest, opts.links(rest), resolution)) if (c.length >= 2) by.set(opts.hub(c), c);
    take(by, (k, xs) => ({ key: k, name: "", summary: "", items: xs }));
    // too few boxes for a level of their own: a finer resolution may give more
    if (parts.length > n && count() < (opts.fewest ?? 2)) { parts.length = n; rest = before; continue; }
    if (parts.length > n) break;
  }
  return { parts, rest };
}

/**
 * Splits the boards of `g` that are over budget until none is, or nothing more can be split.
 * `crowded` boards are split once more even though their boxes fit: the build found their names too
 * small at the desktop fit, which only the layout can tell. `opts` makes a finer cut for the dial's
 * Less stop (autosplits.ts): a smaller box budget, and a single round, so it adds one level.
 * `opts.force` leaves are split in the first round even when their board fits, falling back to alphabetical
 * ranges across subfolders (the oversize pass in grouping.ts).
 */
export function splitOverBudget(g: Grouping, facts: Facts, crowded: string[] = [], opts: { boxes?: number; rounds?: number; force?: string[] } = {}): Grouping {
  const cap = opts.boxes ?? BOX_BUDGET;
  // the root's name only feeds "More parts" below; its summary is a sentence
  const root: GroupNode = { id: "root", name: "Parts", summary: "", children: structuredClone(g.children) };
  /** Groups whose parts were gathered once already: gathering again only stacks clicks. */
  const gathered = new Set<string>();
  const byId = new Map<string, GroupNode>();
  const index = (n: GroupNode) => { byId.set(n.id, n); n.children?.forEach(index); };
  index(root);
  // a collision takes a short hash of a stable salt (a file path or child id), not the creation order (#464)
  const uid = (base: string, salt?: string) => {
    const b = slug(base).slice(0, 44).replace(/-$/, "");
    let id = b;
    if (byId.has(id) && salt !== undefined) id = `${b}-${fnv(salt).toString(16).padStart(8, "0").slice(0, 4)}`;
    for (let i = 2; byId.has(id); i++) id = `${b}-${i}`;
    return id;
  };
  const imports = [...facts.imports, ...facts.calls].filter((e) => e.from !== e.to);
  const allFiles = facts.files.map((f) => f.path);
  /** Leaf id -> the files it must hold, for parts written as globs. */
  const want = new Map<string, string[]>();
  const current = (): Grouping => ({ ...g, children: root.children! });

  for (let round = 0; round < (opts.rounds ?? ROUNDS); round++) {
    let a = assign(current(), facts);
    // a glob that lands a file elsewhere (a more specific pattern somewhere) becomes a file list
    for (const [id, files] of want) {
      const n = byId.get(id)!;
      if (n.files && files.some((f) => a.leafOf.get(f) !== id)) n.files = files;
    }
    want.clear();
    a = assign(current(), facts);
    if (a.errors.length) break;
    const filesOf = new Map<string, string[]>();
    for (const [f, id] of [...a.leafOf].sort((x, y) => x[0].localeCompare(y[0]))) pushTo(filesOf, id, f);
    const model = buildModel(facts, current(), a.leafOf);
    let changed = false;
    for (const id of Object.keys(model.boards).sort()) {
      const n = byId.get(id), b = model.boards[id];
      if (!n) continue;
      const boxes = b.nodes.length, edges = b.edges.filter((e) => e.major).length;
      // a crowded board aims for a few boxes fewer than it has
      const budget = round === 0 && crowded.includes(id) ? Math.min(cap, boxes - 3) : cap;
      const force = round === 0 && (opts.force ?? []).includes(id) && !!n.files;
      if (!force && boxes <= budget && edges <= EDGE_BUDGET) continue;
      const own = n.files ? b.nodes.filter((x) => x.startsWith(FILE) || x === MORE).length : n.children!.length;
      const others = boxes - own;
      // names crowded by the parts from elsewhere and the services: another level wouldn't help
      if (!force && boxes <= cap && edges <= EDGE_BUDGET && own * 2 <= others) continue;
      const room = Math.min(MAX_CHILDREN, Math.max(Math.min(budget - others, edges > EDGE_BUDGET ? own - 1 : own), 2, 3 - others));
      // the new level must still earn its click (depth.ts): 3 boxes, counting the ones from elsewhere
      const fewest = Math.max(2, MIN_LEVEL_BOXES - others);
      if (n.files) changed = splitLeaf(n, filesOf.get(id) ?? [], room, budget - others, fewest, others, force, edges > EDGE_BUDGET && own * 2 > others) || changed;
      else changed = bundle(n, room, filesOf, fewest) || changed;
    }
    if (!changed) break;
  }
  return current();

  function addLeaf(base: string, name: string, summary: string, files: string[], salt = files[files.length - 1]): GroupNode {
    const id = uid(base, salt);
    // a glob when one says it as well as the list ("web/src/utils/logger/**", "functions/src/billing*")
    const dir = commonDir(files);
    const pre = commonPrefix(files.map((f) => f.slice(dir.length + 1)));
    const says = (glob: string) => {
      const m = compileGlob(glob);
      return allFiles.filter((f) => m.re.test(f)).length === files.length && files.every((f) => m.re.test(f));
    };
    const glob = !dir ? undefined : [`${dir}/**`, ...(pre ? [`${dir}/${pre}*`] : [])].find(says);
    const n: GroupNode = { id, name, summary, files: glob ? [glob] : files };
    if (glob) want.set(id, files);
    byId.set(id, n);
    return n;
  }

  /** A leaf over budget becomes a group of smaller leaves. */
  function splitLeaf(n: GroupNode, files: string[], room: number, restRoom: number, fewest: number, others: number, force = false, crowdedByArrows = false): boolean {
    if (files.length < 4) return false;
    const dir = commonDir(files);
    const rel = (f: string) => (dir ? f.slice(dir.length + 1) : f);
    // no seam that works: an honest alphabetical split beats a board over budget or files hidden in
    // "+N more" (#224). Subfolders are real structure, though: ranges across them would mislead,
    // so a leaf of subfolders is left as it is unless files would be hidden.
    // a file board draws every connection of its files (#449): too many arrows is split like too many boxes, unless the arrows mostly go to parts elsewhere, which a split cannot shrink
    const even = (folders: boolean) => (force || (crowdedByArrows && !folders) || ((!folders || files.length > MAX_FILE_BOXES) && files.length + others > cap)) && evenSplit(n, files, rel, room, fewest, dir);
    const folders = (ps: Part[]) => ps.length > 0 && ps.every((p) => p.items.every((f) => rel(f).startsWith(`${p.key}/`)));
    const { parts, rest } = partition(files, room, {
      folderOf: (f) => (rel(f).includes("/") ? rel(f).split("/")[0] : null),
      prefix: (f) => { const k = prefixOf(f.slice(f.lastIndexOf("/") + 1)); return k === "index" ? null : k; },
      links: (fs) => linksAmong(fs, imports),
      hub: (fs) => hubOf(fs, imports),
      restCounts: true,
      // the rest is a box of its own: it must fit, and not hold most of the files
      restFits: (rest) => rest.length <= restRoom && rest.length <= MAX_GATHER_SHARE * files.length,
      words: (f) => nameWords(stem(f)),
      fewest,
    });
    if (!parts.length) return even(false);
    let leftover = rest;
    // one or two files left over join the part they import or are imported by most (else the biggest)
    if (leftover.length && leftover.length <= 2) {
      for (const f of leftover) {
        const ties = parts.map((p) => imports.filter((e) => (e.from === f && p.items.includes(e.to)) || (e.to === f && p.items.includes(e.from))).length);
        // the first part with the most ties, parts being in key order
        const order = parts.map((p, i) => i).sort((x, y) => ties[y] - ties[x] || parts[x].key.localeCompare(parts[y].key));
        parts[order[0]].items.push(f);
      }
      leftover = [];
    }
    if (parts.length + (leftover.length ? 1 : 0) < fewest) return even(folders(parts));
    // one part holding most of the files only adds a click in front of them: leave the board over budget
    if ([...parts.map((p) => p.items.length), leftover.length].some((k) => k > MAX_GATHER_SHARE * files.length)) return even(folders(parts));
    const given = new Set<string>();
    const kids = parts.map((p) => {
      const folder = p.items.every((f) => rel(f).startsWith(`${p.key}/`));
      const hub = !p.name;
      // an import cluster is named after a file only when most of it imports that file, else its folder (#283)
      const basis = hub ? clusterBasis(p.items, imports) : undefined;
      let name = !basis ? p.name : basis.hub ? hubName(basis.hub) : basis.folder || hubName(p.key);
      if (name.toLowerCase() === n.name.toLowerCase()) name = `${name} core`;
      for (let i = 2, b = name; given.has(name.toLowerCase()); i++) name = `${b.slice(0, 40 - String(i).length - 1)} ${i}`;
      given.add(name.toLowerCase());
      const around = basis?.hub ?? (basis?.folder ? "" : p.key);
      const summary = folder ? `Files in ${dir}/${p.key}/.` : !hub ? `Files named ${p.key}….`
        : around ? `Files that import each other, around ${around.slice(around.lastIndexOf("/") + 1)}.` : `Files that import each other, in ${commonDir(p.items)}/.`;
      // "functions-config" + "config" would stutter
      const key = slug(hub ? stem(p.key) : p.key);
      return addLeaf(`${n.id}-${n.id.endsWith(`-${key}`) || n.id === key ? "core" : key}`, name, summary, p.items.sort(), [...p.items].sort()[0]);
    });
    if (leftover.length) {
      const loose = leftover.every((f) => dirOf(f) === dir) && dir;
      const name = loose ? `Files in ${dir.split("/").pop()}/`.slice(0, 40) : moreName(n.name);
      kids.push(addLeaf(`${n.id}-${loose ? "files" : "more"}`, name, loose ? `Files directly in ${dir}/.` : `The rest of ${n.name}.`, leftover, [...leftover].sort()[0]));
    }
    delete n.files;
    n.children = kids;
    return true;
  }

  /**
   * The fallback when no seam splits a leaf (zod's locales, express's one-file examples): alphabetical
   * ranges, each named by its first and last file ("ar – fr"), so every file gets a box (#224).
   * Steady under edits (#464): cuts fall at name-prefix anchors (anchoredSizes) and a range's id is
   * keyed by its last file's name, so cuts and ids are a function of names only, never of how many
   * files come before. One added or removed file changes the range it lands in, and at most a neighbour.
   * The even positional split is the fallback when the anchored one can't meet the limits (a range
   * over today's size, or more ranges than the board has room for: folders so big that `k` is `room`).
   */
  function evenSplit(n: GroupNode, files: string[], rel: (f: string) => string, room: number, fewest: number, dir: string): boolean {
    const label = (f: string) => rangeLabel(rel(f));
    const sorted = [...files].sort((a, b) => label(a).localeCompare(label(b)) || a.localeCompare(b));
    // at least 3 ranges: the parts from elsewhere on the leaf's board needn't reach the new level
    // a range aims for cap - 4 files: its board keeps room for the parts from elsewhere
    const k = Math.min(room, Math.max(fewest, MIN_LEVEL_BOXES, Math.ceil(sorted.length / (cap - 4))));
    if (k < 2 || k < fewest || sorted.length < 2 * k) return false;
    const { hi, lo } = rangeBounds(sorted.length, k);
    let sizes = anchoredSizes(sorted.map(label), hi, lo);
    if (sizes.length > room || sizes.length < fewest || sizes.some((s) => s > hi || s < 2)) {
      sizes = Array.from({ length: k }, (_, i) => Math.floor(sorted.length / k) + (i < sorted.length % k ? 1 : 0));
    }
    const kids: GroupNode[] = [];
    for (let i = 0, at = 0; i < sizes.length; i++) {
      const part = sorted.slice(at, at + sizes[i]);
      at += sizes[i];
      const [a, b] = [label(part[0]), label(part[part.length - 1])];
      const name = `${a} – ${b}`.length <= 40 ? `${a} – ${b}` : `${cutWords(a)} – ${cutWords(b)}`;
      const id = i === sizes.length - 1 ? `${n.id}-end` : `${n.id}-to-${slug(b).slice(0, 20)}`;
      kids.push(addLeaf(id, name, `Files ${a} to ${b}${dir ? ` in ${dir}/` : ""}, split alphabetically.`, part));
    }
    delete n.files;
    n.children = kids;
    return true;
  }

  /** A group over budget gathers some of its children into sub-groups. */
  function bundle(n: GroupNode, roomIn: number, filesOf: Map<string, string[]>, fewestIn: number): boolean {
    const kids = n.children!;
    // the board keeps at least MIN_GATHERED parts, even when the budget would want fewer
    const fewest = Math.max(fewestIn, MIN_GATHERED), room = Math.max(roomIn, MIN_GATHERED);
    // gathered once (in this call, or an earlier one that left a gathered part here): another
    // gathering would only stack clicks
    if (kids.length <= room || gathered.has(n.id) || kids.some((k) => k.summary.startsWith(GATHERED))) return false;
    const under = (x: GroupNode): string[] => (x.files ? filesOf.get(x.id) ?? [] : x.children!.flatMap(under));
    const files = new Map(kids.map((k) => [k.id, under(k)]));
    const owner = new Map<string, string>();
    for (const [id, fs] of files) for (const f of fs) owner.set(f, id);
    const dir = commonDir([...files.values()].flat());
    const childLinks = (ids: string[]) => {
      const set = new Set(ids), w = new Map<string, number>();
      for (const e of imports) {
        const x = owner.get(e.from), y = owner.get(e.to);
        if (!x || !y || x === y || !set.has(x) || !set.has(y)) continue;
        const k = x < y ? `${x}\n${y}` : `${y}\n${x}`;
        w.set(k, (w.get(k) ?? 0) + 1);
      }
      return [...w].sort((p, q) => p[0].localeCompare(q[0])).map(([k, v]) => ({ from: k.split("\n")[0], to: k.split("\n")[1], w: v }));
    };
    const byKid = new Map(kids.map((k) => [k.id, k]));
    const total = [...files.values()].reduce((s, fs) => s + fs.length, 0);
    const { parts, rest } = partition(kids.map((k) => k.id), room, {
      folderOf: (id) => {
        const d = commonDir(files.get(id)!);
        const r = dir ? d.slice(dir.length + 1) : d;
        return d.startsWith(dir) && r.includes("/") ? r.split("/")[0] : null;
      },
      prefix: (id) => (byKid.get(id)!.name === "Other" ? null : prefixOf(`${byKid.get(id)!.name.replace(/\s+/g, "-")}.x`)),
      links: childLinks,
      hub: (ids) => {
        // the child the others import most
        const set = new Set(ids), into = new Map<string, number>();
        for (const e of imports) {
          const x = owner.get(e.from), y = owner.get(e.to);
          if (x && y && x !== y && set.has(x) && set.has(y)) into.set(y, (into.get(y) ?? 0) + 1);
        }
        return [...ids].sort((x, y) => (into.get(y) ?? 0) - (into.get(x) ?? 0) || x.localeCompare(y))[0];
      },
      restCounts: false,
      fewest,
      // one bundle holding most of the files only moves the crowd a level down and hides it
      gather: { weight: (ids) => ids.reduce((s, id) => s + files.get(id)!.length, 0), maxWeight: MAX_GATHER_SHARE * total },
    });
    // still too many: the biggest keep their boxes, the rest share one "More …" group
    const count = () => parts.length + rest.length;
    if (count() > room) {
      const size = (id: string) => files.get(id)!.length;
      // catch-alls ("Other", an earlier "More components") always go with the rest
      const catchAll = (id: string) => /^(Other$|More |Rest of )/.test(byKid.get(id)!.name);
      const ranked = [...rest].filter((id) => !catchAll(id)).sort((x, y) => size(y) - size(x) || x.localeCompare(y));
      const keep = Math.max(0, room - 1 - parts.length);
      const spill = [...ranked.slice(keep), ...rest.filter(catchAll)];
      if (spill.length >= 2 && spill.reduce((s, id) => s + size(id), 0) <= MAX_GATHER_SHARE * total && parts.length + rest.length - spill.length + 1 >= fewest) {
        parts.push({ key: "more", name: moreName(n.name), summary: "", items: spill });
        const s = new Set(spill);
        rest.splice(0, rest.length, ...rest.filter((id) => !s.has(id)));
      }
    }
    // no gathering that fits both rules: leave the board over budget rather than nest it
    if (!parts.length || parts.length + rest.length < fewest || parts.length + rest.length > room) return false;
    const groupOf = new Map<string, GroupNode>();
    for (const p of parts) {
      const cluster = !p.name;
      let name = cluster ? listName(p.items.map((k) => byKid.get(k)!), (k) => files.get(k.id)!.length) : p.name;
      // inside "Billing, war room and more", a cluster of the same parts needs another name
      if (name.toLowerCase() === n.name.toLowerCase()) name = `${name.split(/,| and /)[0]} group`.slice(0, 40);
      const id = uid(`${n.id}-${cluster ? name.replace(/ and more$/, "") : p.key}`, [...p.items].sort()[0]);
      const summary = cluster ? `${GATHERED}import each other, around ${byKid.get(p.key)!.name}.` : p.key === "more" ? `${GATHERED}are the smaller ones of ${n.name}.` : `${GATHERED}share the name ${p.name}.`;
      const members = kids.filter((k) => p.items.includes(k.id));
      // an earlier "More components" takes the new stragglers in, rather than nesting in a namesake
      const twin = p.key === "more" ? members.find((k) => k.children && k.name === name) : undefined;
      // "Rmw shell" gathering Rmw shell, Rmw shell template … is not the Rmw shell part itself
      if (!twin && members.some((k) => k.name.toLowerCase() === name.toLowerCase())) name = `${name} and related`.slice(0, 40);
      const g: GroupNode = twin ? { ...twin, children: [...twin.children!, ...members.filter((k) => k !== twin)] } : { id, name, summary, children: members };
      byId.set(g.id, g);
      for (const k of p.items) groupOf.set(k, g);
    }
    const out: GroupNode[] = [];
    for (const k of kids) {
      const g = groupOf.get(k.id);
      if (!g) out.push(k);
      else if (!out.includes(g)) out.push(g);
    }
    n.children = out;
    gathered.add(n.id);
    return true;
  }
}

/** A file in an alphabetical range's name: "ar.ts" -> "ar", "examples/auth/index.js" -> "auth". */
const rangeLabel = (rel: string) => {
  const parts = rel.replace(/\.[^./]+$/, "").split("/");
  const [file, folder] = [parts[parts.length - 1], parts[parts.length - 2]];
  // src/index.ts stays "index": "src" would name a range after where all the code lives
  return (folder && GENERIC.test(file) && !/^(src|lib|source)$/.test(folder) ? folder : file) || rel;
};

/** 32-bit FNV-1a: a stable hash of a name (no dependency, the same on every machine). */
export function fnv(s: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/** The hash seed for anchors, picked (with the bounds below) for steadiness over random names and the zod-locales fixture (test/steadylayout.test.ts). */
const ANCHOR_SEED = 470;
const prefixKey = (label: string) => label.toLowerCase().slice(0, 3);
/** The most (`hi`, today's even size) and fewest (`lo`) files a range holds when `n` files split into `k` ranges. */
export const rangeBounds = (n: number, k: number) => { const hi = Math.ceil(n / k); return { hi, lo: Math.max(2, Math.ceil(hi / 2)) }; };
/**
 * About one prefix in `m` is an anchor: sparse enough that a run mostly ends at its first anchor
 * (the same cut after a one-file shift), dense enough that few runs end at `hi` instead.
 */
export const anchorModulus = (hi: number, lo: number) => Math.max(2, hi - lo + 3);
/** Whether a range may end after the file named `label`: a function of its first 3 letters only. */
export const isAnchor = (label: string, m: number) => fnv(prefixKey(label), ANCHOR_SEED) % m === 0;

/**
 * Run lengths of alphabetical ranges over `labels` (sorted), each between `lo` and `hi` files. A cut
 * falls after a file whose name-prefix (its first 3 letters) hashes to an anchor, when the next file
 * starts a different prefix, once the run holds `lo` files; a run that reaches `hi` is cut anyway.
 * Whether a cut falls somewhere depends on the names in that run alone, so an edit disturbs the run
 * it lands in and at most the next one. Only the short tail run is balanced by count.
 */
export function anchoredSizes(labels: string[], hi: number, lo: number): number[] {
  const m = anchorModulus(hi, lo);
  const sizes: number[] = [];
  let r = 0;
  for (let i = 0; i < labels.length; i++) {
    r++;
    if (i === labels.length - 1) break;
    if (r >= hi || (r >= lo && prefixKey(labels[i + 1]) !== prefixKey(labels[i]) && isAnchor(labels[i], m))) { sizes.push(r); r = 0; }
  }
  if (r && r < lo && sizes.length) {
    const total = sizes.pop()! + r;
    if (total <= hi) sizes.push(total);
    else { const a = Math.ceil(total / 2); sizes.push(a, total - a); }
  } else if (r) sizes.push(r);
  return sizes;
}

/** "mobileProvisionTherapist" -> "mobileProvision…": whole words, so a range's name fits in 40. */
export const cutWords = (x: string, max = 18) => {
  if (x.length <= max) return x;
  const words = x.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[-_.])/);
  let out = "";
  for (const w of words) if ((out + w).length < max) out += w; else break;
  return `${out || x.slice(0, max - 1)}…`;
};

/** "More hooks" for the rest of Hooks; inside "More hooks", "Rest of hooks" (not "More more hooks"). */
const moreName = (name: string) => (/^More /.test(name) ? `Rest of ${name.slice(5)}` : `More ${name.toLowerCase()}`).slice(0, 40);

/** A cluster of parts is named after its biggest members: "Billing, war room and ui", or "Billing, war room and more". */
function listName(kids: GroupNode[], size: (k: GroupNode) => number): string {
  const names = kids.filter((k) => k.name !== "Other" && !k.name.startsWith("More ")).sort((a, b) => size(b) - size(a) || a.id.localeCompare(b.id)).map((k, i) => (i ? k.name.toLowerCase() : k.name));
  const all = names.length === kids.length;
  if (all && names.length <= 3) {
    const s = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    if (s.length <= 40) return s;
  }
  const two = `${names.slice(0, names.length > 2 || !all ? 2 : 1).join(", ")} and more`;
  return (two.length <= 40 ? two : `${names[0]} and more`).slice(0, 40);
}

/** The longest start every name shares, when it is long enough to say something ("billing" from billingApi, billingCache). */
function commonPrefix(names: string[]): string {
  let p = names[0] ?? "";
  for (const s of names) while (!s.startsWith(p)) p = p.slice(0, -1);
  return p.length >= 3 ? p : "";
}
