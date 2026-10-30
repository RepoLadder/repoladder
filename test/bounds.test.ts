// The fitted frame includes edge labels (#137): a pill on a wire along the board's outer edge sticks
// out past the wire by half its width, and was cut off at the edge of the fitted view.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import { Grouping } from "../src/model/schema.ts";
import { CANVAS, type BoardLayout } from "../src/build/layout.ts";
import { lintBoard, outsideBy } from "../src/build/lint.ts";
import { isFileBoard } from "../src/build/filelayout.ts";
import { boardViewBox } from "../src/viewer/bounds.ts";
import { labelRect, labelShown, placeBoardLabels } from "../src/viewer/placement.ts";
import { wireLabel, type PageEdge } from "../src/viewer/state.ts";

const facts = analyze(fileURLToPath(new URL("./fixtures/stores/", import.meta.url)));
const g = Grouping.parse(defaultGrouping(facts));
const model = buildModel(facts, g, assign(g, facts).leafOf);

// root of the stores fixture: "stores" reads & writes three databases; Firestore's wire runs down
// the board's left edge, so its "reads & writes" pill hangs off to the left of every box and wire
const layout: BoardLayout = {
  n: [["stores", 100, 0, 200, 60, 0], ["store-firestore", 100, 300, 120, 80, 1], ["store-prisma", 260, 300, 120, 80, 1], ["store-supabase", 700, 300, 120, 80, 1]],
  e: [
    ["stores", "store-firestore", 0, 100, 30, 0, 30, 0, 340, 100, 340],
    ["stores", "store-prisma", 0, 250, 60, 250, 180, 320, 180, 320, 300],
    ["stores", "store-supabase", 0, 300, 30, 760, 30, 760, 300],
  ],
};
const shownLabels = () => {
  const info = new Map(model.boards.root.edges.map((e): [string, PageEdge] => [`${e.a}>${e.b}`, e as unknown as PageEdge]));
  return [...placeBoardLabels(layout, info, wireLabel)].filter(([e, l]) => labelShown(e, l)).map(([, l]) => labelRect(l));
};

test("boardViewBox: shown labels widen the frame past the outermost wire", () => {
  const labels = shownLabels();
  const left = labels.reduce((m, r) => Math.min(m, r.x), Infinity);
  assert.ok(left < -24, `the pill on the x=0 wire reaches past the boxes-and-wires frame: ${left}`);
  const bare = boardViewBox(layout, false), framed = boardViewBox(layout, false, labels);
  assert.ok(labels.some((r) => outsideBy(bare, r) > 0), "boxes and wires alone cut the pill off");
  for (const r of labels) assert.ok(outsideBy(framed, r) <= -24 + 1e-9, `label padded inside the frame: ${JSON.stringify(r)}`);
  assert.deepEqual(boardViewBox(layout, false, []), bare);
});

test("lint: no edge label outside the fitted frame, and the name size is measured on it", () => {
  const l = lintBoard(model, "root", layout);
  assert.deepEqual(l.defects.filter((d) => d.kind === "clipped"), []);
  const file = isFileBoard(model, "root"), [, , W, H] = boardViewBox(layout, file, shownLabels());
  assert.ok(W > boardViewBox(layout, file)[2], "wider than the frame without labels");
  assert.equal(l.metrics.namePx, Math.round((file ? 13 : 14.5) * Math.min(CANVAS[0] / W, CANVAS[1] / H) * 10) / 10);
});

test("outsideBy: how far a rect reaches past a frame", () => {
  const vb = [0, 0, 100, 50];
  assert.equal(outsideBy(vb, { x: 10, y: 10, w: 20, h: 10 }), -10);
  assert.equal(outsideBy(vb, { x: -30, y: 10, w: 20, h: 10 }), 30);
  assert.equal(outsideBy(vb, { x: 90, y: 45, w: 20, h: 10 }), 10);
});
