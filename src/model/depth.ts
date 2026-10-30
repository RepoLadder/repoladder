// Dynamic depth (#103): a grouping may go as deep as the code is complex, but every level has to
// earn its click. Opening a group whose board shows one box, or two, tells the reader nothing new.
import type { Facts, GroupNode, Grouping } from "./schema.ts";

/** A level's board draws at least this many boxes; fewer is a useless click. */
export const MIN_LEVEL_BOXES = 3;
/** A level shows at most this many boxes of its own (the default grouping's cap). */
const MAX_LEVEL_BOXES = 10;
/** Group and file boards draw at most this many parts from elsewhere. */
const MAX_ELSEWHERE = 4;

/** How many boxes besides its own children a group's board draws (elsewhere parts, services). */
export type OtherBoxes = (groupId: string) => number;

/**
 * Estimates the boxes a group's board draws besides its children: the parts outside the group
 * that its files import or call (each at the level where the two paths split, as the board shows
 * them), up to MAX_ELSEWHERE, plus the services its files use.
 */
export function otherBoxes(g: Grouping, facts: Facts, leafOf: Map<string, string>): OtherBoxes {
  const chain = new Map<string, string[]>();
  const walk = (n: GroupNode, up: string[]) => {
    const c = [...up, n.id];
    chain.set(n.id, c);
    n.children?.forEach((k) => walk(k, c));
  };
  g.children.forEach((n) => walk(n, []));
  const add = (m: Map<string, Set<string>>, k: string, v: string) => m.set(k, (m.get(k) ?? new Set()).add(v));
  const elsewhere = new Map<string, Set<string>>();
  const link = (from: string, to: string) => {
    const a = chain.get(leafOf.get(from) ?? ""), b = chain.get(leafOf.get(to) ?? "");
    if (!a || !b) return;
    // every group holding one end but not the other shows the other end's part, cut where the paths split
    for (const [mine, theirs] of [[a, b], [b, a]]) {
      const i = mine.findIndex((id, k) => id !== theirs[k]);
      if (i < 0 || !theirs[i]) continue;
      for (let j = i; j < mine.length; j++) add(elsewhere, mine[j], theirs[i]);
    }
  };
  for (const i of facts.imports) if (i.from !== i.to) link(i.from, i.to);
  for (const c of facts.calls) link(c.from, c.to);
  const services = new Map<string, Set<string>>();
  for (const u of facts.serviceUses) for (const id of chain.get(leafOf.get(u.from) ?? "") ?? []) add(services, id, u.service);
  return (id) => Math.min(MAX_ELSEWHERE, elsewhere.get(id)?.size ?? 0) + (services.get(id)?.size ?? 0);
}

const leavesUnder = (n: GroupNode): GroupNode[] => (n.files ? [n] : n.children!.flatMap(leavesUnder));

/** All of a subtree's files in one leaf with the subtree's id and name. Patterns keep their specificity, so assignment is unchanged. */
const asLeaf = (n: GroupNode): GroupNode => ({ id: n.id, name: n.name, summary: n.summary, files: [...new Set(leavesUnder(n).flatMap((l) => l.files!))] });

/**
 * Removes levels that would show too little, bottom up:
 * - a group with one child becomes that child (under the group's own id and name);
 * - a group whose board would draw fewer than MIN_LEVEL_BOXES boxes, counting what it shows from
 *   elsewhere (`others`), takes in the children of one of its sub-groups when that fits, and
 *   otherwise becomes one leaf.
 * The root is left alone: its board also shows the services and the story above it.
 */
export function guardLevels(g: Grouping, others: OtherBoxes = () => 0): Grouping {
  const visit = (n: GroupNode): GroupNode => {
    if (n.files) return n;
    let kids = n.children!.map(visit);
    while (kids.length === 1 || kids.length + others(n.id) < MIN_LEVEL_BOXES) {
      if (kids.length === 1) {
        const only = kids[0];
        return only.files ? { id: n.id, name: n.name, summary: n.summary, files: only.files } : { id: n.id, name: n.name, summary: n.summary, children: only.children };
      }
      // the inner group with the most boxes that still fits beside its siblings
      const lift = kids
        .map((k, i) => ({ k, i }))
        .filter(({ k }) => k.children && kids.length - 1 + k.children.length <= MAX_LEVEL_BOXES)
        .sort((a, b) => b.k.children!.length - a.k.children!.length || a.i - b.i)[0];
      if (!lift) return asLeaf({ ...n, children: kids });
      kids = [...kids.slice(0, lift.i), ...lift.k.children!, ...kids.slice(lift.i + 1)];
    }
    return { id: n.id, name: n.name, summary: n.summary, children: kids };
  };
  return { ...g, children: g.children.map(visit) };
}

/** Warnings for a hand-written grouping: a group with one child, or a board of fewer than MIN_LEVEL_BOXES boxes. */
export function levelWarnings(g: Grouping, others: OtherBoxes = () => 0, fileCount?: (id: string) => number): string[] {
  const out: string[] = [];
  // with a file counter, a warning also names the group's parent and size, so a big run says which group it is (#434)
  const where = (n: GroupNode, parent: string) => (fileCount ? ` (inside "${parent}", ${fileCount(n.id)} files)` : "");
  const walk = (n: GroupNode, parent: string) => {
    if (n.files) return;
    const k = n.children!.length;
    if (k === 1) out.push(`group "${n.id}" has a single child "${n.children![0].id}": merge them, a rung with one box is a useless click${where(n, parent)}`);
    else if (k + others(n.id) < MIN_LEVEL_BOXES) out.push(`group "${n.id}" opens to only ${k} boxes: give it at least ${MIN_LEVEL_BOXES} sub-groups, or make it one leaf${where(n, parent)}`);
    n.children!.forEach((c) => walk(c, n.id));
  };
  g.children.forEach((c) => walk(c, "the top level"));
  return out;
}
