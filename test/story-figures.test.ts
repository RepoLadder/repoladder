// Story level geometry (#71): one column of same-size actor cards, arrows that start at the card,
// and "what they do" pills on their own arrow, clear of every other line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import { Grouping, type Story } from "../src/model/schema.ts";
import { d2Source, layoutBoards, type BoardLayout } from "../src/build/layout.ts";
import { CARD_GAP, actorBox, fitActors, laneWidth, pillHeights, ports, storyCard, storyCardH, tidy } from "../src/build/storylayout.ts";
import { ACTOR_H, actorSize, sayBox } from "../src/viewer/figures.ts";
import { placePills, segmentHits, spots } from "../src/viewer/storylabels.ts";
import { STORY } from "../src/viewer/state.ts";

const person = (name: string) => ({ name, kind: "person" as const });
const system = (name: string) => ({ name, kind: "system" as const });

test("actor cards share one width, from the longest name", () => {
  const [w, h] = actorSize([person("Patient"), person("Clinic iOS app")]);
  assert.deepEqual(actorSize([person("Clinic iOS app")]), [w, h]);
  assert.ok(w > actorSize([person("Patient")])[0]);
  assert.deepEqual(actorBox([w, h], 100), [w + 100, h + 2 * CARD_GAP]);
  assert.ok(laneWidth([{ a: "x", says: ["a long thing they do"] }, { a: "x", says: ["short"] }]) > sayBox(["a long thing they do"])[0]);
  assert.equal(laneWidth([]), 0);
});

test("a system actor widens every card to fit its \"outside system\" sub-label (#283)", () => {
  // person-only boards keep their width
  assert.equal(actorSize([person("Patient")])[0], 138);
  const [w] = actorSize([person("Visitor"), system("Stripe")]);
  assert.ok(w >= 52 + 14 * 6.7 + 14, String(w));
  assert.deepEqual(storyCard([person("Visitor"), system("Stripe")], [])[0], w);
  // a long name still wins over the role
  assert.equal(actorSize([system("A much longer system name")])[0], actorSize([person("A much longer system name")])[0]);
});

test("ports spread an actor's arrows around the card's middle, inside it", () => {
  assert.deepEqual(ports(100, 56, 1), [128]);
  assert.deepEqual(ports(100, 56, 2), [114, 142]);
  for (const y of ports(100, 56, 5)) assert.ok(y >= 108 && y <= 148, String(y));
});

test("ports space an actor's arrows by their pills' heights, so the pills stack 4px apart (#263)", () => {
  // one-line pills (24px) keep the old 28px spacing
  assert.deepEqual(ports(100, 56, 2, [24, 24]), ports(100, 56, 2));
  const [a, b] = ports(100, 56, 2, [40, 24]);
  assert.equal(b - a, 36);
  assert.ok(a >= 108 && b <= 148, `${a} ${b}`);
  assert.deepEqual(ports(100, 56, 0), []);
});

test("storyCardH: taller cards only when an actor's pills would not stack beside one (#263)", () => {
  const one = (a: string, b: string, says: string[]) => ({ a, b, says });
  assert.equal(storyCardH([one("w", "x", ["signs in"]), one("w", "y", ["writes and edits posts", "upgrades to Pro"])]), ACTOR_H);
  assert.equal(storyCardH([one("w", "x", ["a"]), one("w", "y", ["b"]), one("w", "z", ["c"])]), 72);
  const h = storyCardH([one("w", "x", ["a", "b"]), one("w", "y", ["c", "d"])]);
  assert.ok(h > ACTOR_H);
  const [p, q] = ports(0, h, 2, [40, 40]);
  assert.ok(q - p >= 44 && p >= 8 && q <= h - 8, `${h}: ${p} ${q}`);
  assert.deepEqual(storyCard([person("Writer")], []), [actorSize([person("Writer")])[0], ACTOR_H]);
});

test("fitActors stacks a two-arrow actor's pills by their heights (#263)", () => {
  const card: [number, number] = [100, 56];
  const layout: BoardLayout = {
    n: [["w", 0, 0, 300, 76, 0], ["web", 400, 0, 100, 200, 0]],
    e: [["w", "web", 0, 300, 20, 400, 20], ["w", "x", 0, 300, 50, 400, 50]],
  };
  const hs = pillHeights([{ a: "w", b: "web", says: ["signs in"] }, { a: "w", b: "x", says: ["writes and edits posts", "upgrades to Pro"] }]);
  assert.deepEqual(hs, { "w>web": 24, "w>x": 40 });
  const out = fitActors(layout, new Set(["w"]), card, hs);
  const y0 = out.e[0][4] as number, y1 = out.e[1][4] as number;
  assert.ok(y1 - y0 >= (24 + 40) / 2 + 4, `${y0} ${y1}`);
});

test("tidy drops repeated and straight-through points", () => {
  assert.deepEqual(tidy([0, 0, 10, 0, 10, 0, 20, 0, 20, 5]), [0, 0, 20, 0, 20, 5]);
  assert.deepEqual(tidy([0, 0, 0, 5, 0, 9]), [0, 0, 0, 9]);
});

test("fitActors shrinks the box to the card and starts each arrow at its edge", () => {
  const card: [number, number] = [100, 56];
  const layout: BoardLayout = {
    n: [["a", 0, 0, 300, 76, 0], ["b", 0, 100, 300, 76, 0], ["web", 400, 0, 100, 200, 0]],
    e: [
      // leaves below the card, then bends: the bend moves up to the card's middle
      ["a", "web", 0, 300, 70, 350, 70, 350, 20, 400, 20],
      // two arrows: evenly spaced ports; the straight one gets a step at the lane's end
      ["b", "web", 0, 300, 110, 400, 110],
      ["b", "web", 0, 300, 160, 350, 160, 350, 150, 400, 150],
    ],
  };
  const out = fitActors(layout, new Set(["a", "b"]), card);
  assert.deepEqual(out.n[0], ["a", 0, 10, 100, 56, 0]);
  assert.deepEqual(out.n[1], ["b", 0, 110, 100, 56, 0]);
  // the lone arrow straightens: the height it bends to (20) is inside the card (10..66)
  assert.deepEqual(out.e[0], ["a", "web", 0, 100, 20, 400, 20]);
  assert.deepEqual(out.e[1], ["b", "web", 0, 100, 124, 300, 124, 300, 110, 400, 110]);
  assert.deepEqual(out.e[2], ["b", "web", 0, 100, 152, 350, 152, 350, 150, 400, 150]);
  // an arrow that doesn't leave the right side straight leaves the actor's box alone
  const odd = fitActors({ n: layout.n, e: [["a", "web", 0, 150, 76, 150, 120, 400, 120]] }, new Set(["a"]), card);
  assert.deepEqual(odd.n[0], layout.n[0]);
});

test("segmentHits clips a segment against a rect", () => {
  const r = { x: 0, y: 0, w: 10, h: 10 };
  assert.ok(segmentHits(r, [-5, 5], [15, 5]));
  assert.ok(segmentHits(r, [5, -5], [5, 3]));
  assert.ok(!segmentHits(r, [-5, 12], [15, 12]));
  assert.ok(!segmentHits(r, [11, -5], [11, 15]));
});

test("pills sit on a straight run of their own arrow, with line on both sides, clear of other wires", () => {
  const own = { curve: 0 as const, p: [0, 0, 300, 0] };
  const first = spots(own, 100, 24)[0];
  assert.ok(first.x - 50 >= 18 && first.y === 0);
  // a corner too short for the pill offers no spot on that run
  assert.deepEqual(spots({ curve: 0, p: [0, 0, 60, 0, 60, 200] }, 100, 24).filter((s) => !s.vertical), []);
  // another wire crosses the run near its start: the pill moves past it
  const cross = { curve: 0 as const, p: [100, -50, 100, 50] };
  const [at] = placePills([], [own, cross], [{ wire: 0, w: 100, h: 24 }]);
  assert.ok(at.x - 50 > 103 && !at.lo, JSON.stringify(at));
  // two pills on stacked arrows stay apart
  const two = placePills([], [own, { curve: 0, p: [0, 10, 300, 10] }], [{ wire: 0, w: 100, h: 24 }, { wire: 1, w: 100, h: 24 }]);
  assert.ok(Math.abs(two[0].x - two[1].x) >= 100 || Math.abs(two[0].y - two[1].y) >= 24);
});

const multi = analyze(fileURLToPath(new URL("./fixtures/multi", import.meta.url)));
const story: Story = {
  actors: [
    { id: "zed", name: "Zed", summary: "Listed first.", kind: "person" },
    { id: "cron", name: "Health check robot", summary: "Pings the server.", kind: "system" },
    { id: "amy", name: "Amy", summary: "Listed last.", kind: "person" },
  ],
  uses: [
    { actor: "zed", part: "functions", says: "calls the backend", entry: "pingHttp" },
    { actor: "cron", part: "functions", says: "checks it is up", entry: "pingHttp" },
    { actor: "amy", part: "web", says: "opens the app", entry: "web/src/main.ts" },
    { actor: "amy", part: "functions", says: "pings it too", entry: "pingHttp" },
  ],
  narrative: ["A [[zed]] and an [[amy]]."],
};
const g = Grouping.parse({ ...defaultGrouping(multi), story });
const model = buildModel(multi, g, assign(g, multi).leafOf);

test("story D2 source keeps actors in one container, in the grouping's order", () => {
  const src = d2Source(model, STORY);
  const order = [...src.matchAll(/^"story-actors"\."([^"]+)": /gm)].map((m) => m[1]);
  assert.deepEqual(order, ["zed", "cron", "amy"]);
  assert.match(src, /^"story-actors"\."amy" -> "web"$/m);
  assert.match(src, /^"story-actors".label: ""$/m);
});

test("story layout: one column, same size, in order; every actor arrow starts on its card's right edge", async () => {
  const lay = (await layoutBoards(model))[STORY];
  const actors = lay.n.filter(([id]) => story.actors.some((a) => a.id === id));
  assert.equal(actors.length, 3);
  assert.equal(new Set(actors.map((n) => n[1])).size, 1, "one x");
  assert.equal(new Set(actors.map((n) => `${n[3]}x${n[4]}`)).size, 1, "one size");
  assert.deepEqual([...actors].sort((a, b) => a[2] - b[2]).map((n) => n[0]), ["zed", "cron", "amy"]);
  assert.ok(!lay.n.some(([id]) => id === "story-actors"));
  const box = new Map(lay.n.map((n) => [n[0], n]));
  for (const [a, z, , ...p] of lay.e) {
    const n = box.get(a)!;
    if (!actors.includes(n)) continue;
    assert.equal(p[0], n[1] + n[3], `${a}>${z} starts at the card's right edge`);
    assert.ok(p[1] > n[2] && p[1] < n[2] + n[4], `${a}>${z} starts inside the card's height`);
    const t = box.get(z)!, [ex, ey] = p.slice(-2);
    assert.ok(Math.abs(ex - t[1]) <= 1 && ey >= t[2] && ey <= t[2] + t[4], `${a}>${z} ends on ${z}'s left edge`);
  }
});
