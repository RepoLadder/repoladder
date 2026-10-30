// Keeping the board's order across window shapes (viewer/everyfit.ts, #463): boards of containers
// (seeded sizes, packed by ELK then repack) laid out at several canvas shapes. Preferring packings
// that keep the reading order fixes the top-left box and, on average, keeps more of the arrangement
// (build/stability.ts), at a coverage cost within ORDER_SLACK. elkjs runs in Node.
import { test } from "node:test";
import assert from "node:assert/strict";
import bundled from "elkjs/lib/elk.bundled.js";
import type { ELK as ElkApi, ElkNode } from "elkjs/lib/elk-api.js";
import type { BoardLayout } from "../src/build/layout.ts";
import { pairStability } from "../src/build/stability.ts";
import { EVERY_GAP } from "../src/viewer/everylayout.ts";
import { laneSide, ORDER_SLACK, repack } from "../src/viewer/everyfit.ts";

const elk = new (bundled as unknown as new () => ElkApi)();
const ASPECTS = [0.46, 1, 1.6, 2.2];
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
/** Mean stability over every pair of the aspects' layouts. */
const stable = (ls: BoardLayout["n"][]) => mean(ls.flatMap((a, i) => ls.slice(i + 1).map((b) => pairStability(a, b).score ?? 1)));

/** A board of containers of leaf containers (ids `m<i>.<j>`), sizes from a seeded sequence, laid out by ELK. */
function synth(seed: number, mids: number, per: number): ElkNode {
  let x = seed;
  const rnd = () => (x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const leaf = (id: string): ElkNode => ({ id, layoutOptions: { "elk.algorithm": "layered", "elk.padding": "[top=40,left=14,bottom=14,right=14]" }, children: Array.from({ length: 1 + Math.floor(rnd() * 10) }, (_, i) => ({ id: `${id}.${i}`, width: 100 + Math.floor(rnd() * 120), height: 45 })), edges: [] });
  const mid = (i: number): ElkNode => ({ id: `m${i}`, layoutOptions: { "elk.algorithm": "rectpacking", "elk.aspectRatio": "1.5", "elk.spacing.nodeNode": "36", "elk.padding": "[top=60,left=36,bottom=36,right=36]" }, children: Array.from({ length: per }, (_, j) => leaf(`m${i}.${j}`)), edges: [] });
  return { id: "root", layoutOptions: { "elk.algorithm": "rectpacking", "elk.aspectRatio": "1.5", "elk.spacing.nodeNode": "36", "elk.padding": "[top=36,left=36,bottom=36,right=36]" }, children: Array.from({ length: mids }, (_, i) => mid(i)), edges: [] };
}

/** The leaf containers of a laid-out board as stability rows (absolute positions). */
function rows(r: ElkNode): BoardLayout["n"] {
  const out: BoardLayout["n"] = [];
  const walk = (n: ElkNode, ox: number, oy: number, top: boolean) => {
    const x = ox + (n.x ?? 0), y = oy + (n.y ?? 0);
    if (!top && !n.children?.some((c) => c.children?.length)) out.push([n.id, x, y, n.width!, n.height!] as unknown as BoardLayout["n"][number]);
    else for (const c of n.children ?? []) walk(c, x, y, false);
  };
  walk(r, 0, 0, true);
  return out;
}

const board = async (seed: number, mids: number, per: number) => {
  const g = synth(seed, mids, per), opts = new Map<string, ElkNode["layoutOptions"]>();
  const index = (n: ElkNode) => { opts.set(n.id, n.layoutOptions); n.children?.forEach(index); };
  index(g);
  const r = await elk.layout(structuredClone(g)), lane: [string, number, number][] = [["svc", 120, 74]];
  return (slack: number) => ASPECTS.map((a) => repack(r, opts, a, lane, EVERY_GAP, laneSide(a), slack));
};
/** The leaf container nearest the top-left corner (the first box), by id. */
const first = (n: ElkNode) => rows(n).sort((a, b) => (a[2] as number) - (b[2] as number) || (a[1] as number) - (b[1] as number))[0][0];
const SEEDS = Array.from({ length: 24 }, (_, i) => [i * 13 + 1, 3 + (i % 3), 3 + (i % 4)]);

test("order kept: the first box is the same at every window shape where the old chooser moved it", async () => {
  for (const [seed, mids, per] of [[66, 5, 4], [183, 5, 5], [248, 4, 6]]) {
    const at = await board(seed, mids, per);
    assert.ok(new Set(at(-1).map(([n]) => first(n))).size > 1, `${seed}: the old chooser moves the first box`);
    const now = at(ORDER_SLACK).map(([n]) => first(n));
    assert.equal(new Set(now).size, 1, `${seed}: ${now}`);
  }
});

test("order kept: over many boards stability is no lower on average and coverage stays within ORDER_SLACK", async () => {
  const before: number[] = [], after: number[] = [];
  for (const [seed, mids, per] of SEEDS) {
    const at = await board(seed, mids, per), old = at(-1), now = at(ORDER_SLACK);
    now.forEach(([, s], i) => assert.ok(s >= old[i][1] * (1 - ORDER_SLACK) - 1e-9, `${seed} at ${ASPECTS[i]}: coverage ${s} vs ${old[i][1]}`));
    before.push(stable(old.map(([n]) => rows(n))));
    after.push(stable(now.map(([n]) => rows(n))));
  }
  assert.ok(after.filter((a, i) => a > before[i] + 1e-9).length >= 5, "arrangement kept better on several boards");
  assert.ok(mean(after) >= mean(before), `${mean(after)} vs ${mean(before)}`);
});

test("tuning table for ORDER_SLACK (ORDER_TUNE=1)", async () => {
  if (!process.env.ORDER_TUNE) return;
  const slacks = [-1, 0, 0.05, 0.1, 0.15, 0.2], acc = new Map(slacks.map((k) => [k, { st: [] as number[], loss: [] as number[], first: 0 }]));
  for (const [seed, mids, per] of SEEDS) {
    const at = await board(seed, mids, per), base = at(-1);
    for (const k of slacks) {
      const x = at(k), m = acc.get(k)!;
      m.st.push(stable(x.map(([n]) => rows(n))));
      x.forEach(([, sc], i) => m.loss.push(1 - sc / base[i][1]));
      m.first += new Set(x.map(([n]) => first(n))).size === 1 ? 1 : 0;
    }
  }
  for (const [k, m] of acc) console.log(`slack ${k}: stability ${mean(m.st).toFixed(3)} loss mean ${(mean(m.loss) * 100).toFixed(1)}% worst ${(Math.max(...m.loss) * 100).toFixed(1)}% same first box ${m.first}/${SEEDS.length}`);
});
