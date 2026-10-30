// The Simple stop of the detail dial: the Default tree plus the finer levels
// Claude names in the grouping's `split`s. A split on a leaf turns it into a group of named parts
// that share its files; a split on a wide group puts a level of named buckets between it and its
// children. Splits are never made up here: with none written, there is no Simple stop.
import { compileGlob } from "./glob.ts";
import { guardLevels, otherBoxes, MIN_LEVEL_BOXES } from "./depth.ts";
import type { Facts, GroupNode, Grouping } from "./schema.ts";

/** A leaf with more files than this wants a split (SKILL.md section 3). */
export const SPLIT_OVER = 6;

export interface SplitCheck {
  errors: string[];
  /** File path -> the split part that holds it, for leaves with a split. */
  partOf: Map<string, string>;
}

const nodesOf = (g: Grouping): GroupNode[] => {
  const out: GroupNode[] = [];
  const walk = (n: GroupNode) => { out.push(n); n.children?.forEach(walk); };
  g.children.forEach(walk);
  return out;
};

/** Leaves over SPLIT_OVER files that have no split yet, biggest first. */
export function unsplitLeaves(g: Grouping, leafOf: Map<string, string>): { id: string; name: string; files: number }[] {
  const count = new Map<string, number>();
  for (const l of leafOf.values()) count.set(l, (count.get(l) ?? 0) + 1);
  return nodesOf(g).filter((n) => n.files && !n.split && (count.get(n.id) ?? 0) > SPLIT_OVER)
    .map((n) => ({ id: n.id, name: n.name, files: count.get(n.id)! }))
    .sort((a, b) => b.files - a.files || a.id.localeCompare(b.id));
}

/**
 * Validates the splits like children: a leaf's parts must share out exactly its files (each file to
 * one part, the most specific pattern winning, as in assign()); a group's buckets must hold each of
 * its children exactly once. Patterns only ever pick among the leaf's own files.
 */
export function checkSplits(g: Grouping, leafOf: Map<string, string>): SplitCheck {
  const errors: string[] = [], partOf = new Map<string, string>();
  const filesOf = new Map<string, string[]>();
  for (const [f, l] of leafOf) filesOf.set(l, [...(filesOf.get(l) ?? []), f]);
  for (const n of nodesOf(g)) {
    if (!n.split) continue;
    if (n.files) {
      const parts = n.split.flatMap((p) => p.files!.map((f) => ({ id: p.id, m: compileGlob(f) })));
      const hits = new Map<string, number>();
      const none: string[] = [], tied: string[] = [];
      for (const f of (filesOf.get(n.id) ?? []).sort()) {
        let best: typeof parts = [];
        for (const p of parts) {
          if (!p.m.re.test(f)) continue;
          if (!best.length || p.m.specificity > best[0].m.specificity) best = [p];
          else if (p.m.specificity === best[0].m.specificity) best.push(p);
        }
        const owners = [...new Set(best.map((b) => b.id))];
        if (!owners.length) none.push(f);
        else if (owners.length > 1) tied.push(`${f} (${owners.join(", ")})`);
        else { partOf.set(f, owners[0]); hits.set(owners[0], (hits.get(owners[0]) ?? 0) + 1); }
      }
      if (none.length) errors.push(`split of "${n.id}": ${none.length} of its file(s) in no part: ${none.slice(0, 10).join(", ")}${none.length > 10 ? " …" : ""}`);
      if (tied.length) errors.push(`split of "${n.id}": file(s) matched equally by two parts (make one pattern more specific): ${tied.slice(0, 10).join(", ")}`);
      for (const p of n.split) if (!hits.get(p.id)) errors.push(`split of "${n.id}": part "${p.id}" holds none of its files`);
    } else {
      const kids = new Set(n.children!.map((c) => c.id)), seen = new Map<string, string>();
      for (const b of n.split) for (const m of b.members!) {
        if (!kids.has(m)) errors.push(`split of "${n.id}": bucket "${b.id}" lists "${m}", which is not one of its children`);
        else if (seen.has(m)) errors.push(`split of "${n.id}": "${m}" is in two buckets ("${seen.get(m)}", "${b.id}")`);
        else seen.set(m, b.id);
      }
      const left = [...kids].filter((k) => !seen.has(k));
      if (left.length) errors.push(`split of "${n.id}": child(ren) in no bucket: ${left.join(", ")}`);
    }
  }
  return { errors, partOf };
}

export interface SimpleTree {
  /** The Default grouping with the kept splits applied (no `split` fields left). */
  grouping: Grouping;
  leafOf: Map<string, string>;
  /** Ids of the nodes whose split is drawn, and of those dropped with why. */
  kept: string[];
  dropped: { id: string; why: string }[];
}

/** The grouping with the splits of `on` applied, and where each file lands in it. */
function apply(g: Grouping, leafOf: Map<string, string>, partOf: Map<string, string>, on: Set<string>): { grouping: Grouping; leafOf: Map<string, string> } {
  const out = new Map<string, string>();
  for (const [f, l] of leafOf) out.set(f, on.has(l) ? partOf.get(f)! : l);
  const filesOf = new Map<string, string[]>();
  for (const [f, l] of [...out].sort((x, y) => x[0].localeCompare(y[0]))) filesOf.set(l, [...(filesOf.get(l) ?? []), f]);
  // leaves list their files by path, so the parts' patterns can't pull in files from elsewhere
  const visit = (n: GroupNode): GroupNode => {
    const base = { id: n.id, name: n.name, summary: n.summary };
    const split = on.has(n.id) ? n.split : undefined;
    if (n.files) return split ? { ...base, children: split.map((p) => ({ id: p.id, name: p.name, summary: p.summary, files: filesOf.get(p.id)! })) } : { ...base, files: n.files };
    const kids = n.children!.map(visit);
    if (!split) return { ...base, children: kids };
    const byId = new Map(kids.map((k) => [k.id, k]));
    return { ...base, children: split.map((b) => ({ id: b.id, name: b.name, summary: b.summary, children: b.members!.map((m) => byId.get(m)!) })) };
  };
  return { grouping: { ...g, children: g.children.map(visit) }, leafOf: out };
}

/**
 * Simple = Default + the splits, with guardLevels applied: a split whose new level wouldn't earn
 * its click (fewer than MIN_LEVEL_BOXES boxes, counting what the board shows from elsewhere, or a
 * bucket of one) is dropped, and the rest of the tree is left exactly as written, so every Default
 * id is still there. Null when no split is written or none survives, so there is no Simple stop.
 */
export function simpleTree(g: Grouping, facts: Facts, leafOf: Map<string, string>): SimpleTree | null {
  const written = nodesOf(g).filter((n) => n.split);
  if (!written.length) return null;
  const { errors, partOf } = checkSplits(g, leafOf);
  if (errors.length) return null;
  const on = new Set(written.map((n) => n.id));
  const dropped: SimpleTree["dropped"] = [];
  // a dropped split can change what its neighbours' boards show from elsewhere, so settle it
  for (let round = 0; round < 4; round++) {
    const t = apply(g, leafOf, partOf, on);
    const others = otherBoxes(t.grouping, facts, t.leafOf);
    const guarded = new Map(nodesOf(guardLevels(t.grouping, others)).map((n) => [n.id, n]));
    let changed = false;
    for (const n of written) {
      if (!on.has(n.id)) continue;
      const kept = guarded.get(n.id);
      const ids = (x?: GroupNode) => (x?.children ?? []).map((c) => c.id).join(",");
      const ok = kept && ids(kept) === n.split!.map((p) => p.id).join(",") &&
        (n.files || n.split!.every((b) => ids(guarded.get(b.id)) === b.members!.join(",")));
      if (ok) continue;
      on.delete(n.id);
      changed = true;
      const single = n.split!.find((b) => b.members?.length === 1);
      dropped.push({ id: n.id, why: single ? `bucket "${single.id}" holds one part` : `its rung would show fewer than ${MIN_LEVEL_BOXES} boxes (${n.split!.length} parts + ${others(n.id)} from elsewhere)` });
    }
    if (!changed) break;
  }
  if (!on.size) return null;
  const t = apply(g, leafOf, partOf, on);
  return { ...t, kept: written.filter((n) => on.has(n.id)).map((n) => n.id), dropped: dropped.sort((a, b) => a.id.localeCompare(b.id)) };
}
