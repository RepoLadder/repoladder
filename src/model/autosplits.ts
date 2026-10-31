// No-AI mode's Less stop (#265): the dial's stop below Default draws the grouping's `split`s, which
// Claude names. `build --default` has no Claude, so it writes the splits the way it writes the rest
// of its tree (budgetsplit.ts): one more round of splitting at a smaller box budget, its new level
// on each leaf kept as that leaf's split. simpleTree then guards them like any split. A grouping
// Claude wrote is never touched here: its splits stay Claude's to name.
import type { Facts, GroupNode, Grouping, SplitPart } from "./schema.ts";
import { splitOverBudget } from "./budgetsplit.ts";
import { DEFAULT_PROFILE, type Profile } from "./profile.ts";
import { assign } from "./grouping.ts";

/** Less's box budget per board, the parts from elsewhere included: about 6 of a board's own boxes plus its lane. */
export const LESS_BOXES = 8;

const walk = (ns: GroupNode[], f: (n: GroupNode) => void) => { for (const n of ns) { f(n); if (n.children) walk(n.children, f); } };

/** `g` with a `split` on every leaf that one more round at LESS_BOXES splits; `g` itself when none. */
export function withAutoSplits(g: Grouping, facts: Facts, profile: Profile = DEFAULT_PROFILE): Grouping {
  const fine = splitOverBudget(g, facts, [], { boxes: LESS_BOXES, rounds: 1, profile });
  const { leafOf, errors } = assign(fine, facts);
  if (errors.length) return g;
  const filesOf = new Map<string, string[]>();
  for (const [f, l] of [...leafOf].sort((x, y) => x[0].localeCompare(y[0]))) filesOf.set(l, [...(filesOf.get(l) ?? []), f]);
  const fineById = new Map<string, GroupNode>();
  walk(fine.children, (n) => fineById.set(n.id, n));
  const out: Grouping = structuredClone(g);
  let any = false;
  walk(out.children, (n) => {
    const f = fineById.get(n.id);
    // a leaf that became a group of leaves; parts list their files by path, so no pattern can tie
    if (!n.files || !f?.children || f.children.length < 2 || f.children.length > 6 || f.children.some((c) => !c.files)) return;
    const split: SplitPart[] = f.children.map((c) => ({ id: c.id, name: c.name, summary: c.summary, files: filesOf.get(c.id) ?? [] }));
    if (split.some((p) => !p.files!.length)) return;
    n.split = split;
    any = true;
  });
  return any ? out : g;
}
