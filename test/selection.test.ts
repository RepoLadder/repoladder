import { test } from "node:test";
import assert from "node:assert/strict";
import { litBy, moved } from "../src/viewer/focus.ts";

// #117: selecting KioskPage on a large app's web-checkin lit only SelectionScreen. Shaped like that board:
// the page has drawn arrows out to screens, to a context box (Cloud backend) and none in; its minor
// arrows (to the types hub, to "+N more", to and from App shell) are not drawn, so they are not hits.
test("selecting a box lights every box it has a drawn arrow to or from, and those arrows", () => {
  const hits = [
    "n:kiosk", "n:selection", "n:thanks", "n:screen", "n:viewport", "n:types", "n:redirect", "n:+more", "n:functions", "n:web-shell",
    "e:kiosk>selection", "e:kiosk>thanks", "e:kiosk>screen", "e:kiosk>functions", "e:redirect>kiosk",
    "e:screen>viewport", "e:redirect>web-shell",
  ];
  assert.deepEqual([...litBy("n:kiosk", hits)].sort(), [
    "e:kiosk>functions", "e:kiosk>screen", "e:kiosk>selection", "e:kiosk>thanks", "e:redirect>kiosk",
    "n:functions", "n:kiosk", "n:redirect", "n:screen", "n:selection", "n:thanks",
  ]);
  // a neighbor's own arrows stay dim: one step out, not two
  assert.ok(!litBy("n:kiosk", hits).has("e:screen>viewport"));
});

test("only a moving pointer hovers: the view gliding under a still cursor does not", () => {
  assert.equal(moved(null, 10, 10), true);
  assert.equal(moved([10, 10], 10, 10), false);
  assert.equal(moved([10, 10], 10.3, 9.8), false);
  assert.equal(moved([10, 10], 12, 10), true);
});
