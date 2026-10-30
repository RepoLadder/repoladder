import type { Facts, GroupNode, Grouping } from "./schema.ts";
import { compileGlob } from "./glob.ts";
import { clusterBasis, commonDir } from "./clustername.ts";
import { humanize } from "./boxnames.ts";
// a cycle (grouping.ts imports this module), safe because prefixOf is only called, never read at load
import { prefixOf } from "./grouping.ts";

export interface Link {
  from: string;
  to: string;
  w?: number;
}

/**
 * Splits files into communities: files linked to each other more than chance would predict end
 * up together (Louvain modularity, all levels). Deterministic: nodes are visited in the given
 * order and ties go to the lowest community. Files with no links inside the set come back as
 * singletons.
 */
export function communities(files: string[], links: Link[], resolution = 1): string[][] {
  const idx = new Map(files.map((f, i) => [f, i]));
  // W[i]: neighbour -> weight; key -1 holds the weight inside an aggregated node
  let W: Map<number, number>[] = files.map(() => new Map());
  for (const e of links) {
    const a = idx.get(e.from), b = idx.get(e.to);
    if (a === undefined || b === undefined || a === b) continue;
    W[a].set(b, (W[a].get(b) ?? 0) + (e.w ?? 1));
    W[b].set(a, (W[b].get(a) ?? 0) + (e.w ?? 1));
  }
  let members: number[][] = files.map((_, i) => [i]);
  for (let level = 0; level < 20; level++) {
    const n = W.length;
    const k = W.map((m) => [...m.values()].reduce((s, x) => s + x, 0));
    const m2 = k.reduce((s, x) => s + x, 0);
    if (!m2) break;
    const comm = W.map((_, i) => i);
    const tot = [...k];
    let any = false;
    for (let pass = 0, moved = true; moved && pass < 100; pass++) {
      moved = false;
      for (let i = 0; i < n; i++) {
        const ci = comm[i];
        const toC = new Map<number, number>();
        for (const [j, w] of W[i]) if (j >= 0) toC.set(comm[j], (toC.get(comm[j]) ?? 0) + w);
        tot[ci] -= k[i];
        let best = ci, bestGain = (toC.get(ci) ?? 0) - (resolution * tot[ci] * k[i]) / m2;
        for (const [c, w] of [...toC].sort((a, b) => a[0] - b[0])) {
          const gain = w - (resolution * tot[c] * k[i]) / m2;
          if (gain > bestGain + 1e-9) { best = c; bestGain = gain; }
        }
        tot[best] += k[i];
        if (best !== ci) { comm[i] = best; moved = true; any = true; }
      }
    }
    if (!any) break;
    const ids = [...new Set(comm)].sort((a, b) => a - b);
    const re = new Map(ids.map((c, i) => [c, i]));
    const next: Map<number, number>[] = ids.map(() => new Map());
    const nextMembers: number[][] = ids.map(() => []);
    for (let i = 0; i < n; i++) {
      const ci = re.get(comm[i])!;
      nextMembers[ci].push(...members[i]);
      for (const [j, w] of W[i]) {
        const cj = j < 0 ? ci : re.get(comm[j])!;
        const key = cj === ci ? -1 : cj;
        next[ci].set(key, (next[ci].get(key) ?? 0) + w);
      }
    }
    W = next;
    members = nextMembers;
  }
  return members
    .map((m) => m.sort((a, b) => a - b).map((i) => files[i]))
    .sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
}

/**
 * Links between `files` for clustering. Direct imports count most; files that use the same
 * outside file are linked too (pages that render the same billing components belong together,
 * even though pages never import each other). Outside files used by many of them (firebase.ts,
 * the UI kit) say nothing, so they're skipped.
 */
export function linksAmong(files: string[], imports: { from: string; to: string }[]): Link[] {
  const set = new Set(files);
  const links: Link[] = [];
  const users = new Map<string, Set<string>>();
  for (const e of imports) {
    if (e.from === e.to) continue;
    const a = set.has(e.from), b = set.has(e.to);
    if (a && b) links.push({ from: e.from, to: e.to, w: 2 });
    else if (a || b) {
      const [inside, outside] = a ? [e.from, e.to] : [e.to, e.from];
      users.set(outside, (users.get(outside) ?? new Set()).add(inside));
    }
  }
  const cap = Math.max(3, Math.min(12, Math.floor(files.length / 4)));
  for (const [, us] of [...users].sort((x, y) => x[0].localeCompare(y[0]))) {
    if (us.size < 2 || us.size > cap) continue;
    const list = [...us].sort();
    const w = 1 / (list.length - 1);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) links.push({ from: list[i], to: list[j], w });
  }
  return links;
}

const LEAF_MAX = 12;
const MIN_GROUP = 3;
const MAX_CHILDREN = 10;
const GENERIC = new Set(["index", "utils", "util", "helpers", "helper", "types", "type", "constants", "common", "shared", "base", "main", "use", "get", "set", "with", "create", "make", "the", "and", "for", "page", "component", "components", "provider", "context", "hook", "hooks"]);

const stem = (p: string) => p.split("/").pop()!.replace(/\.[^.]+$/, "");
const words = (s: string) => s.split(/[-_.]|(?=[A-Z][a-z])/).map((w) => w.replace(/\d+$/, "").toLowerCase()).filter((w) => w.length >= 3);
const title = (s: string) => humanize(s);

/**
 * A name for a cluster that its siblings don't already use: the word most of its file names
 * share ("Dialog" for ConfirmDialog, ErrorDialog …), else the file most of it imports
 * (clustername.ts), else its common folder ("Locales", not the alphabetically first locale, #283).
 * Only files that share no folder fall back to their most connected file. `hub` is the file it is
 * named after, if any.
 */
export function nameCluster(files: string[], links: Link[], taken: Set<string>, parent: string, imports: { from: string; to: string }[]): { name: string; hub?: string } {
  const set = new Set(files);
  const deg = new Map<string, number>();
  for (const e of links) if (set.has(e.from) && set.has(e.to)) {
    deg.set(e.from, (deg.get(e.from) ?? 0) + (e.w ?? 1));
    deg.set(e.to, (deg.get(e.to) ?? 0) + (e.w ?? 1));
  }
  // index.ts or types.ts is often the hub but says nothing about the cluster
  const ranked = [...files].sort((a, b) => (deg.get(b) ?? 0) - (deg.get(a) ?? 0) || a.localeCompare(b));
  const hubs = [...ranked.filter((f) => !GENERIC.has(stem(f).toLowerCase())), ...ranked.filter((f) => GENERIC.has(stem(f).toLowerCase()))];
  const count = new Map<string, number>();
  for (const f of files) for (const w of new Set(words(stem(f)))) if (!GENERIC.has(w)) count.set(w, (count.get(w) ?? 0) + 1);
  const common = [...count].filter(([, n]) => n >= Math.max(2, files.length * 0.3)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([w]) => title(w));
  const basis = clusterBasis(files, imports);
  const named = (h: string) => title(stem(h).replace(/^(use|get|with)(?=[A-Z])/, ""));
  const folder = basis.folder.toLowerCase() === parent.toLowerCase() ? `${basis.folder} core` : basis.folder;
  const candidates = [...common, ...(basis.hub ? [named(basis.hub)] : folder ? [folder] : hubs.map(named))];
  // inside "Action", actionGroup.ts names its cluster "Group"
  const p = parent.toLowerCase() + " ";
  for (let i = 0; i < candidates.length; i++) if (candidates[i] !== `${basis.folder} core` && candidates[i].toLowerCase().startsWith(p)) candidates[i] = title(candidates[i].slice(p.length));
  const free = candidates.find((c) => !taken.has(c.toLowerCase()));
  const name = free ?? `${candidates[0]} ${[...Array(taken.size + 2).keys()].slice(2).find((i) => !taken.has(`${candidates[0]} ${i}`.toLowerCase()))}`;
  taken.add(name.toLowerCase());
  return { name, hub: basis.hub ?? (folder ? undefined : hubs[0]) };
}

/**
 * Breaks up the big vague boxes a folder grouping leaves behind: an "Other" catch-all over
 * LEAF_MAX files, or any leaf over 2 × LEAF_MAX (a flat folder), is split into communities of
 * files that import each other or use the same files. A 1-2 file "Other" left over joins the
 * sibling it is most tied to.
 */
export function splitCatchAlls(
  grouping: Grouping,
  facts: Facts,
  leafOf: Map<string, string>,
  /** The folder grouping, for big folder leaves that have subfolders. */
  regroup?: (paths: string[], dir: string, idBase: string, uid: (s: string) => string) => GroupNode,
): Grouping {
  const filesOf = new Map<string, string[]>();
  for (const [f, id] of [...leafOf].sort((a, b) => a[0].localeCompare(b[0]))) filesOf.set(id, [...(filesOf.get(id) ?? []), f]);
  const used = new Set<string>();
  const collect = (n: GroupNode) => { used.add(n.id); n.children?.forEach(collect); };
  grouping.children.forEach(collect);
  const uid = (base: string) => {
    const b = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 44).replace(/-$/, "");
    let id = b;
    for (let i = 2; used.has(id); i++) id = `${b}-${i}`;
    used.add(id);
    return id;
  };
  const imports = facts.imports.filter((i) => i.from !== i.to);
  const isOther = (n: GroupNode) => !!n.files && n.name === "Other";
  // leaves made here list their files explicitly; leaves from the folder grouping may use globs
  const filesIn = (leaf: GroupNode) => filesOf.get(leaf.id) ?? leaf.files!;

  /** Community leaves for these files plus whatever is left over (singletons, tiny clusters). */
  const cluster = (idBase: string, files: string[], taken: Set<string>, parent: string) => {
    const links = linksAmong(files, imports);
    const groups: GroupNode[] = [];
    const rest: string[] = [];
    for (const c of communities(files, links)) {
      if (c.length < MIN_GROUP) { rest.push(...c); continue; }
      const { name, hub } = nameCluster(c, links, taken, parent, imports);
      const where = hub ? `around ${hub.split("/").pop()}` : `in ${commonDir(c)}/`;
      groups.push({ id: uid(`${idBase}-${name}`), name, summary: `Files that import each other or use the same code, ${where}.`, files: c });
    }
    return { groups, rest: rest.sort() };
  };

  /** Leaves of 3+ files sharing a filename prefix, when there are at least two of them. */
  const byPrefix = (idBase: string, files: string[], taken: Set<string>) => {
    const by = new Map<string, string[]>();
    for (const f of files) {
      const k = prefixOf(f.split("/").pop()!);
      by.set(k, [...(by.get(k) ?? []), f]);
    }
    const big = [...by].filter(([k, fs]) => fs.length >= MIN_GROUP && k !== "index" && !taken.has(title(k).toLowerCase()))
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    if (big.length < 2) return { groups: [] as GroupNode[], rest: files };
    const groups = big.map(([k, fs]): GroupNode => {
      taken.add(title(k).toLowerCase());
      return { id: uid(`${idBase}-${k}`), name: title(k), summary: `Files named ${k}…`, files: fs.sort() };
    });
    const mine = new Set(big.flatMap(([, fs]) => fs));
    return { groups, rest: files.filter((f) => !mine.has(f)).sort() };
  };

  /** Communities (plus an "Other" for the rest) to put in place of `files`, or null when they don't split. */
  const split = (idBase: string, files: string[], taken: Set<string>, parent: string, otherId: string): GroupNode[] | null => {
    let { groups, rest } = cluster(idBase, files, taken, parent);
    // files that don't import each other may still share a name (#103): billingApi, billingCache …
    if (!groups.length || (groups.length === 1 && rest.length < MIN_GROUP)) ({ groups, rest } = byPrefix(idBase, files, taken));
    if (groups.length < 2 && !(groups.length === 1 && rest.length >= MIN_GROUP)) return null;
    return rest.length ? [...groups, { id: otherId, name: "Other", summary: "", files: rest }] : groups;
  };

  /** A 1-2 file "Other" is noise: its files join the sibling leaf they import most, else the one they are most tied to either way. */
  const foldTiny = (kids: GroupNode[]): GroupNode[] => {
    const tiny = kids.find((c) => isOther(c) && filesIn(c).length <= 2);
    if (!tiny) return kids;
    const leaves = kids.filter((c) => c.files && c !== tiny);
    // "src/** + debug.ts": two boxes where one will do
    if (kids.length === 2 && leaves.length === 1) return [{ ...leaves[0], files: [...leaves[0].files!, ...filesIn(tiny)] }];
    const mine = new Set(filesIn(tiny));
    const owner = new Map<string, GroupNode>();
    for (const l of leaves) for (const f of filesIn(l)) owner.set(f, l);
    // what the leftover imports says where it belongs (#225: express's index.js requires lib/, examples require it)
    const out = new Map<GroupNode, number>();
    const ties = new Map<GroupNode, number>();
    for (const e of imports) {
      const other = mine.has(e.from) ? e.to : mine.has(e.to) ? e.from : null;
      const l = other ? owner.get(other) : undefined;
      if (!l) continue;
      ties.set(l, (ties.get(l) ?? 0) + 1);
      if (other === e.to) out.set(l, (out.get(l) ?? 0) + 1);
    }
    const rank = (m: Map<GroupNode, number>) => [...m].sort((a, b) => b[1] - a[1] || a[0].id.localeCompare(b[0].id));
    const [o1, o2] = rank(out);
    if (o1 && !(o2 && o2[1] === o1[1])) return kids.filter((c) => c !== tiny).map((c) => (c === o1[0] ? { ...c, files: [...c.files!, ...filesIn(tiny)] } : c));
    // no imports either way: fall back to a shared word in the file names (TTDDialogTrigger -> TTDDialog)
    if (!ties.size) {
      const mw = new Set([...mine].flatMap((f) => words(stem(f))).filter((w) => !GENERIC.has(w)));
      for (const l of leaves) {
        const n = filesIn(l).filter((f) => words(stem(f)).some((w) => mw.has(w))).length;
        if (n) ties.set(l, n);
      }
    }
    // a barrel tied equally to several siblings belongs to none of them
    const [first, second] = rank(ties);
    if (!first || (second && second[1] === first[1])) return kids;
    const best = first[0];
    return kids.filter((c) => c !== tiny).map((c) => (c === best ? { ...c, files: [...c.files!, ...filesIn(tiny)] } : c));
  };
  /** A group left with one child is just that child. */
  const flatten = (n: GroupNode, kids: GroupNode[]): GroupNode =>
    kids.length === 1 && kids[0].files ? { id: n.id, name: n.name, summary: n.summary, files: kids[0].files } : { id: n.id, name: n.name, summary: n.summary, children: kids };

  /** A folder leaf the depth limit stopped (components/** with 200 files) opens by its subfolders first. */
  const byFolder = (n: GroupNode): GroupNode | null => {
    if (!regroup || n.files!.length !== 1 || !/^[^*?]+\/\*\*$/.test(n.files![0])) return null;
    const dir = n.files![0].slice(0, -3);
    const paths = filesIn(n);
    if (paths.every((p) => !p.slice(dir.length + 1).includes("/"))) return null;
    const g = regroup(paths, dir, n.id, uid);
    if (!g.children) return null;
    // the new leaves use globs; resolve them the way assign() does, most specific pattern first
    const leaves: { id: string; m: ReturnType<typeof compileGlob> }[] = [];
    const walk = (x: GroupNode) => (x.files ? x.files.forEach((f) => leaves.push({ id: x.id, m: compileGlob(f) })) : x.children!.forEach(walk));
    walk(g);
    for (const p of paths) {
      const hit = leaves.filter((l) => l.m.re.test(p)).sort((a, b) => b.m.specificity - a.m.specificity)[0];
      if (!hit) return null;
      filesOf.set(hit.id, [...(filesOf.get(hit.id) ?? []), p]);
    }
    return { id: n.id, name: n.name, summary: n.summary, children: g.children };
  };

  const visit = (n: GroupNode): GroupNode => {
    if (n.files) {
      // several globs ("12 more packages") is a deliberate roll-up of whole folders: leave it
      if (filesIn(n).length <= 2 * LEAF_MAX || n.files.filter((f) => f.includes("*")).length > 1) return n;
      const opened = byFolder(n);
      if (opened) return visit(opened);
      const kids = split(n.id, filesIn(n), new Set([n.name.toLowerCase()]), n.name, uid(`${n.id}-other`));
      // no depth limit (#103): a cluster still over the size is split again
      return kids ? visit(flatten(n, foldTiny(kids))) : n;
    }
    let out: GroupNode[] = [];
    let split_ = false;
    const taken = new Set(n.children!.map((k) => k.name.toLowerCase()));
    for (const c of n.children!) {
      if (!isOther(c) || filesIn(c).length <= LEAF_MAX) { out.push(visit(c)); continue; }
      const kids = split(n.id, filesIn(c), taken, n.name, c.id);
      out.push(...(kids ?? [c]));
      split_ ||= !!kids;
    }
    const leavesUnder = (x: GroupNode): GroupNode[] => (x.files ? [x] : x.children!.flatMap(leavesUnder));
    const size = (x: GroupNode) => leavesUnder(x).reduce((s, l) => s + filesIn(l).length, 0);
    const other = out.find(isOther);
    // biggest first, "Other" last, the way the folder grouping orders boxes
    const ranked = out.filter((x) => x !== other).map((x, i) => ({ x, n: size(x), i })).sort((a, b) => b.n - a.n || a.x.id.localeCompare(b.x.id) || a.i - b.i);
    if (split_ && out.length <= MAX_CHILDREN) out = [...ranked.map((r) => r.x), ...(other ? [other] : [])];
    // Too many boxes now: the biggest folders and clusters keep theirs, the rest share one "Other".
    // (Nesting the clusters inside "Other" instead gives a board that is mostly context boxes.)
    // When the rest is too big for one file board, it becomes a level of its own (#103).
    const tail = ranked.slice(MAX_CHILDREN - 1).map((r) => r.x);
    const tailSize = tail.reduce((s, x) => s + size(x), other ? filesIn(other).length : 0);
    if (split_ && out.length > MAX_CHILDREN && tailSize > 2 * LEAF_MAX && tail.length >= MIN_GROUP) {
      const inner = tail.slice(0, MAX_CHILDREN - 1);
      const spill = [...tail.slice(MAX_CHILDREN - 1), ...(other ? [other] : [])];
      const leftover = spill.length ? (() => {
        const id = other?.id ?? uid(`${n.id}-other`);
        filesOf.set(id, spill.flatMap(leavesUnder).flatMap(filesIn).sort());
        return [{ id, name: "Other", summary: "", files: [...new Set(spill.flatMap(leavesUnder).flatMap((l) => l.files!))].sort() }];
      })() : [];
      const more: GroupNode = { id: uid(`${n.id}-more`), name: `More ${n.name.toLowerCase()}`.slice(0, 40), summary: "", children: [...inner, ...leftover] };
      out = [...ranked.slice(0, MAX_CHILDREN - 1).map((r) => r.x), more];
    } else if (split_ && out.length > MAX_CHILDREN) {
      const keep = new Set(ranked.slice(0, MAX_CHILDREN - 1).map((r) => r.x));
      const spill = [other, ...ranked.slice(MAX_CHILDREN - 1).map((r) => r.x)].filter((x): x is GroupNode => !!x);
      const id = other?.id ?? uid(`${n.id}-other`);
      // explicit paths (and the folder globs of demoted folders) so the leaf matches exactly what it holds
      const files = spill.flatMap(leavesUnder).flatMap((l) => l.files!);
      filesOf.set(id, spill.flatMap(leavesUnder).flatMap(filesIn).sort());
      out = [...ranked.filter((r) => keep.has(r.x)).map((r) => r.x), { id, name: "Other", summary: "", files: [...new Set(files)].sort() }];
    }
    return flatten(n, foldTiny(out));
  };
  // the top level gets the same treatment as any group
  const top = visit({ id: "root", name: grouping.summary, summary: "", children: grouping.children });
  const first = grouping.children.find((c) => !isOther(c)) ?? grouping.children[0];
  return { ...grouping, children: top.children ?? [{ id: first.id, name: first.name, summary: first.summary, files: top.files! }] };
}
