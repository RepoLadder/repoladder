import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS, hiddenCounts, isDefault, kindOn, loadFlags, saveFlags, visible, type Flags } from "../src/viewer/filter.ts";
import { besideBoard, extraPath, type Rect } from "../src/viewer/xwire.ts";
import type { PageBoard, PageEdge } from "../src/viewer/state.ts";

const E = (a: string, b: string, o: Partial<PageEdge> = {}): PageEdge => ({ a, b, imports: 0, calls: 0, uses: 0, major: true, ev: [], ...o });
// a, b, c are parts (c is a hub), x is elsewhere, svc-s a service, store-db a store
const board: PageBoard = {
  nodes: ["a", "b", "c", "x", "svc-s", "store-db"], context: ["x"], hubs: ["c"], throughout: [],
  edges: [
    E("a", "b", { imports: 3 }),
    E("a", "c", { imports: 2, major: false, hub: true }),
    E("b", "c", { imports: 1, major: false, hub: true }),
    E("b", "a", { imports: 1, major: false }),
    E("a", "x", { calls: 2 }),
    E("b", "svc-s", { uses: 1 }),
    E("a", "store-db", { uses: 1, reads: 2 }),
    E("a", "svc-gone", { uses: 1, major: false }),
  ],
};
const services = { "svc-s": "Stripe", "store-db": "Firestore" };
const drawn = new Set(board.nodes);
const routed = new Set(["a>b", "a>x", "b>svc-s", "a>store-db"]);
const run = (on: Partial<Flags> = {}, focus: string | null = null) => visible(board, drawn, services, { ...DEFAULTS, ...on }, focus, routed);
const sorted = (s: Set<string>) => [...s].sort();

test("filters: defaults show exactly the major edges and every drawn box", () => {
  const v = run();
  assert.deepEqual(sorted(v.edges), ["a>b", "a>store-db", "a>x", "b>svc-s"]);
  assert.deepEqual(sorted(v.nodes), sorted(drawn));
  assert.deepEqual(v.extra, []);
});

test("filters: category toggles hide boxes and the wires that touch them", () => {
  assert.deepEqual(sorted(run({ stores: false }).edges), ["a>b", "a>x", "b>svc-s"]);
  assert.ok(!run({ stores: false }).nodes.has("store-db"));
  assert.ok(!run({ svc: false }).nodes.has("svc-s") && run({ svc: false }).nodes.has("store-db"));
  assert.deepEqual(sorted(run({ ctx: false }).edges), ["a>b", "a>store-db", "b>svc-s"]);
  assert.deepEqual(sorted(run({ imports: false }).edges), ["a>store-db", "a>x", "b>svc-s"]);
  assert.deepEqual(sorted(run({ calls: false }).edges), ["a>b", "a>store-db", "b>svc-s"]);
});

test("filters: reveal toggles add hub and minor edges, drawn by the viewer, never to undrawn boxes", () => {
  const h = run({ hubs: true });
  assert.deepEqual(h.extra.map((e) => `${e.a}>${e.b}`), ["a>c", "b>c"]);
  const m = run({ minor: true });
  assert.deepEqual(m.extra.map((e) => `${e.a}>${e.b}`), ["b>a"]);
  assert.ok(!m.edges.has("a>svc-gone"));
  assert.deepEqual(hiddenCounts(board, drawn), { hubs: 2, minor: 1 });
});

test("filters: focus keeps the box, its neighbors and only its edges, minor ones included", () => {
  const v = run({}, "b");
  assert.deepEqual(sorted(v.nodes), ["a", "b", "c", "svc-s"]);
  assert.deepEqual(sorted(v.edges), ["a>b", "b>a", "b>c", "b>svc-s"]);
  // still subject to the toggles
  assert.deepEqual(sorted(run({ svc: false }, "b").nodes), ["a", "b", "c"]);
  // a focused box that a toggle hides is ignored rather than emptying the board
  assert.deepEqual(sorted(run({ svc: false }, "svc-s").edges), sorted(run({ svc: false }).edges));
});

test("filters: flags persist through localStorage and survive it being unavailable", () => {
  const g = globalThis as { localStorage?: unknown };
  const before = g.localStorage;
  const mem = new Map<string, string>();
  g.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  try {
    assert.deepEqual(loadFlags(), DEFAULTS);
    saveFlags({ ...DEFAULTS, calls: false, minor: true });
    assert.deepEqual(loadFlags(), { ...DEFAULTS, calls: false, minor: true });
    assert.ok(!isDefault(loadFlags()));
    mem.set("repoladder.filters", "{not json");
    assert.deepEqual(loadFlags(), DEFAULTS);
    g.localStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
    assert.deepEqual(loadFlags(), DEFAULTS);
    assert.doesNotThrow(() => saveFlags(DEFAULTS));
  } finally { g.localStorage = before; }
});

test("extra wires bend around boxes in the way", () => {
  const a: Rect = [0, 0, 40, 40], b: Rect = [400, 0, 40, 40], block: Rect = [180, -30, 80, 60];
  const free = extraPath(a, b, []), dodge = extraPath(a, b, [block]);
  assert.match(free.d, /^M\d+ \d+Q-?\d+ -?\d+ \d+ \d+$/);
  assert.notEqual(free.d, dodge.d);
  // the label sits on the curve, outside the blocking box
  assert.ok(dodge.ly < -30 || dodge.ly > 30, dodge.d);
});

test("extra wires into an openable box end on its stacked cards, so the arrowhead shows (#248)", () => {
  const a: Rect = [0, 300, 100, 60], b: Rect = [0, 0, 100, 60];
  const end = (d: string) => d.split(" ").slice(-2).map(Number);
  assert.equal(end(extraPath(a, b, []).d)[1], 60);
  assert.equal(end(extraPath(a, b, [], 8).d)[1], 68, "below the cards behind the box, not under them");
});

// polyline corners of a gutter route ("M x y L … Q cx cy …"): the Q control points are the corners
const corners = (d: string) => [...d.matchAll(/[MQL](-?[\d.]+) (-?[\d.]+)/g)].filter((m) => m[0][0] !== "L").map((m) => [+m[1], +m[2]]).concat([d.match(/L(-?[\d.]+) (-?[\d.]+)$/)!.slice(1).map(Number)]);
const through = ([x0, y0]: number[], [x1, y1]: number[], [x, y, w, h]: Rect) => Math.max(x0, x1) > x && Math.min(x0, x1) < x + w && Math.max(y0, y1) > y && Math.min(y0, y1) < y + h;

test("extra wires fall back to the gutters when every curve crosses a box (#281)", () => {
  const a: Rect = [0, 0, 100, 60], wall: Rect = [160, -200, 100, 460], b: Rect = [320, 0, 100, 60];
  const r = extraPath(a, b, [wall]);
  assert.match(r.d, /L/, r.d);
  const p = corners(r.d);
  for (let i = 1; i < p.length; i++) assert.ok(!through(p[i - 1], p[i], wall), `${p[i - 1]} → ${p[i]} runs through the wall: ${r.d}`);
  const [ex, ey] = p[p.length - 1];
  assert.ok((ex === 320 || ex === 420 || ey === 0 || ey === 60) && ex >= 320 && ex <= 420 && ey >= 0 && ey <= 60, `ends on b's border: ${r.d}`);
  assert.deepEqual(extraPath(a, b, [wall]), r, "deterministic");
});

test("a frame holding the endpoints is no obstacle (#281)", () => {
  const a: Rect = [0, 0, 40, 40], b: Rect = [400, 0, 40, 40], frame: Rect = [-50, -50, 600, 200];
  assert.equal(extraPath(a, b, [frame]).d, extraPath(a, b, []).d);
  assert.equal(extraPath(a, b, [[350, -10, 120, 60]]).d, extraPath(a, b, []).d, "nor is one holding just the target");
});

test("with no clean gutter route the best curve is kept (#281)", () => {
  const a: Rect = [0, 0, 60, 60], b: Rect = [400, 0, 60, 60];
  const cage: Rect[] = [[380, -22, 100, 20], [380, 62, 100, 20], [378, -22, 20, 104], [462, -22, 20, 104]];
  const r = extraPath(a, b, cage);
  assert.match(r.d, /^M-?\d+ -?\d+Q-?\d+ -?\d+ -?\d+ -?\d+$/, r.d);
  assert.deepEqual(extraPath(a, b, cage), r, "deterministic");
});

test("story arrows (actor uses) always pass the toggles", () => {
  const e = { a: "patient", b: "web", imports: 0, calls: 0, uses: 0, major: true, says: ["checks in"] } as unknown as PageEdge;
  assert.equal(kindOn(e, DEFAULTS), true);
  assert.equal(kindOn(e, { ...DEFAULTS, imports: false, calls: false }), true);
});

test("a tour's box for a service used throughout goes beside the board, on the side the canvas has room for", () => {
  const bounds: Rect = [0, 0, 1000, 400], near: Rect = [800, 300, 150, 60], over = (a: Rect, b: Rect) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
  // a tall canvas has room below; a wide one to the side
  const tall = besideBoard(bounds, near, 120, 90, 0.5), wide = besideBoard(bounds, near, 120, 90, 4);
  assert.ok(tall[1] >= 400 && !over(tall, bounds), `below: ${tall}`);
  assert.ok(wide[0] >= 1000 && !over(wide, bounds), `right: ${wide}`);
  // lined up with the box it connects to, and kept within the board's span
  assert.equal(tall[0], 815);
  assert.equal(wide[1], 285);
  // a box near the left edge gets its neighbor on the left when the board is not grown either way
  const left = besideBoard([0, 0, 1000, 400], [20, 100, 100, 60], 120, 90, 2.5);
  assert.ok(left[0] + left[2] <= 0, `left: ${left}`);
});
