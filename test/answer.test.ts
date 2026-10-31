// The answer renderer: a plan of pieces, then DOM built without parsing markup.
import { test } from "node:test";
import assert from "node:assert/strict";
import { answerPlan, renderPlan } from "../src/viewer/ask/answer.ts";
import type { Segment } from "../src/model/cite.ts";

const segs: Segment[] = [
  { text: "See " },
  { ref: "src/a.ts:3", kind: "file", verified: true, target: { file: "src/a.ts", line: 3 } },
  { text: " and " },
  { ref: "src/ghost.ts", kind: "file", verified: false, reason: "not found in the code facts" },
  { text: " <img src=x onerror=alert(1)>" },
];

test("streaming marks candidates as checking", () => {
  const p = answerPlan({ mode: "streaming", text: "see src/a.ts now" });
  assert.deepEqual(p.map((i) => [i.text, i.cls]), [["see ", ""], ["src/a.ts", "cite cite-wait"], [" now", ""]]);
  assert.equal(p[1].title, "checking against the code");
});

test("settled: buttons only for verified refs, visible reason for the rest, markup only as text", () => {
  const p = answerPlan({ mode: "settled", segments: segs });
  assert.deepEqual(p.filter((i) => i.tag === "button").map((i) => i.ref), [{ file: "src/a.ts", line: 3 }]);
  const no = p.find((i) => i.cls === "cite cite-no")!;
  assert.equal(no.tag, "span");
  assert.equal(no.text, "src/ghost.ts (not found in the code facts)");
  assert.equal(p.at(-1)!.text, " <img src=x onerror=alert(1)>");
});

test("no segments: plain text and a note", () => {
  const p = answerPlan({ mode: "settled", segments: null, text: "hello" });
  assert.equal(p[0].text, "hello");
  assert.match(p[1].text!, /could not be checked/);
});

type El = { tag: string; className: string; title: string; textContent: string; type: string; handlers: Record<string, () => void>; addEventListener(n: string, f: () => void): void };
function fakeDoc() {
  const mk = (tag: string): El => {
    const e: any = { tag, className: "", title: "", type: "", handlers: {}, addEventListener(n: string, f: () => void) { e.handlers[n] = f; } };
    for (const k of ["innerHTML", "outerHTML"]) Object.defineProperty(e, k, { set() { throw new Error(k); } });
    e.insertAdjacentHTML = () => { throw new Error("insertAdjacentHTML"); };
    return e;
  };
  const frag: any = { kids: [] as El[], appendChild(k: El) { frag.kids.push(k); } };
  return { doc: { createElement: mk, createDocumentFragment: () => frag } as unknown as Document, frag };
}

test("renderPlan never touches innerHTML; only a verified button opens", () => {
  const { doc, frag } = fakeDoc();
  const opened: unknown[] = [];
  renderPlan(doc, answerPlan({ mode: "settled", segments: segs }), (r) => opened.push(r));
  const kids = frag.kids as El[];
  const btn = kids.find((k) => k.tag === "button")!;
  btn.handlers.click();
  assert.deepEqual(opened, [{ file: "src/a.ts", line: 3 }]);
  const no = kids.find((k) => k.className === "cite cite-no")!;
  assert.deepEqual(Object.keys(no.handlers), []);
  assert.ok(kids.some((k) => k.textContent === " <img src=x onerror=alert(1)>"));
});
