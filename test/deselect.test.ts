import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dragged, escapeStep, hasSelection, onEmpty } from "../src/viewer/deselect.ts";
import { zoomStep } from "../src/viewer/focuszoom.ts";
import { st } from "../src/viewer/state.ts";

test("a press that stays within a few pixels is a click; past that it is a drag", () => {
  assert.equal(dragged(0, 0, "mouse"), false);
  assert.equal(dragged(2, 2, "mouse"), false);
  assert.equal(dragged(3, 2, "mouse"), true);
  assert.equal(dragged(-5, 0, "mouse"), true);
  // a finger wobbles more than a mouse
  assert.equal(dragged(4, 3, "touch"), false);
  assert.equal(dragged(5, 4, "touch"), true);
});

test("Escape clears a selection first, then goes up a level, and does nothing on the top board", () => {
  assert.equal(escapeStep(true, false), "clear");
  assert.equal(escapeStep(true, true), "clear", "the overview's selection clears too");
  assert.equal(escapeStep(false, false), "up");
  assert.equal(escapeStep(false, true), null);
});

// A stand-in for DOM elements: closest() walks the given ancestry by selector.
const el = (...path: string[]) => ({ closest: (sel: string) => (sel.split(",").some((s) => path.includes(s.trim())) ? {} : null) }) as unknown as Element;

test("only a click on the board's empty canvas counts as empty", () => {
  assert.equal(onEmpty(el("svg.board")), true);
  assert.equal(onEmpty(el("svg.board", "g[data-hit]")), false, "a box, an arrow or its label");
  assert.equal(onEmpty(el()), false, "an overlay outside the svg: legend, zoom buttons, read button");
  assert.equal(onEmpty(null), false);
});

test("a pinned story sentence counts as a selection to clear", () => {
  const was = { selected: st.selected, svgEl: st.svgEl };
  try {
    st.selected = null;
    st.svgEl = { classList: { contains: (c: string) => c === "telling" } } as unknown as SVGSVGElement;
    assert.equal(hasSelection(), true);
    st.svgEl = { classList: { contains: () => false } } as unknown as SVGSVGElement;
    assert.equal(hasSelection(), false);
    st.selected = "n:web";
    assert.equal(hasSelection(), true);
  } finally {
    Object.assign(st, was);
  }
});

test("the viewer wires click-empty and Escape through deselect.ts, and a pan never clears", () => {
  const src = (f: string) => readFileSync(new URL(`../src/viewer/${f}`, import.meta.url), "utf8");
  assert.match(src("main.ts"), /installDeselect\(select\)/);
  assert.match(src("navigate.ts"), /onEscape\(select,/);
  assert.match(src("panzoom.ts"), /dragged\(dx, dy, e\.pointerType\)/);
  assert.match(src("deselect.ts"), /!st\.dragged && hasSelection\(\) && onEmpty/);
  // clearing a selection that zoomed glides back to the board's fit (#148)
  assert.match(src("focuszoom.ts"), /step === "fit" \? \[\.\.\.st\.base\]/);
});

test("clearing a selection zooms back out to the board's fit, only if the selection zoomed in", () => {
  assert.equal(zoomStep("n:a", false, false), "focus");
  assert.equal(zoomStep("n:a", true, false), "focus", "another box: zoom to it, not out");
  assert.equal(zoomStep(null, true, false), "fit", "Escape, a click on empty canvas, or the selected box again");
  assert.equal(zoomStep(null, false, false), null, "nothing had zoomed (zoom off, a fresh board): leave the view");
  assert.equal(zoomStep("n:a", false, true), null, "the story level frames its own sentences");
  assert.equal(zoomStep(null, false, true), null);
});
