// No-AI mode's Less stop (#265): `build --default` writes the splits Claude would name, mechanically.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { withAutoSplits } from "../src/model/autosplits.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { Grouping, type GroupNode } from "../src/model/schema.ts";
import { checkSplits, simpleTree } from "../src/model/splits.ts";

const fx = (name: string) => analyze(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));
const nodes = (g: Grouping): GroupNode[] => {
  const out: GroupNode[] = [];
  const walk = (ns: GroupNode[]) => { for (const n of ns) { out.push(n); if (n.children) walk(n.children); } };
  walk(g.children);
  return out;
};

test("autosplits: a --default grouping gets valid splits on its busy leaves, so the page has a Less stop", () => {
  const facts = fx("tourapp"), g = defaultGrouping(facts), a = assign(g, facts);
  const s = withAutoSplits(g, facts);
  assert.ok(Grouping.safeParse(s).success);
  const split = nodes(s).filter((n) => n.split);
  assert.ok(split.length > 0, "some leaf is split");
  assert.ok(split.every((n) => n.files), "only leaves: a group's buckets must cover every child");
  assert.deepEqual(checkSplits(s, a.leafOf).errors, []);
  // each part lists its files by path, and together they hold exactly the leaf's files
  for (const n of split) {
    const mine = [...a.leafOf].filter(([, l]) => l === n.id).map(([f]) => f).sort();
    assert.deepEqual(n.split!.flatMap((p) => p.files!).sort(), mine);
  }
  // part ids are new, and unique
  const ids = [...nodes(g).map((n) => n.id), ...split.flatMap((n) => n.split!.map((p) => p.id))];
  assert.equal(new Set(ids).size, ids.length);
  const t = simpleTree(s, facts, a.leafOf);
  assert.ok(t && t.kept.length > 0, "the splits survive the level guard");
  // Default is untouched: the split only feeds the Less stop
  assert.deepEqual(nodes(s).map((n) => n.id), nodes(g).map((n) => n.id));
  assert.equal(g.children.some(function has(n: GroupNode): boolean { return !!n.split || !!n.children?.some(has); }), false, "the input isn't changed");
});

test("autosplits: deterministic", () => {
  const facts = fx("routes"), g = defaultGrouping(facts);
  assert.equal(JSON.stringify(withAutoSplits(g, facts)), JSON.stringify(withAutoSplits(g, facts)));
});

test("autosplits: a repo with nothing to split comes back as it was", () => {
  const facts = fx("mono"), g = defaultGrouping(facts);
  assert.equal(withAutoSplits(g, facts), g);
});
