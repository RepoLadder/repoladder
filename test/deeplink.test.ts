import { test } from "node:test";
import assert from "node:assert/strict";
import { hashFor, homeOf, parseHash, parseTourToken, tourToken } from "../src/viewer/deeplink.ts";
import { buildViewer } from "../src/build/viewer.ts";
import type { ViewerData } from "../src/viewer/state.ts";

const node = (parent: string | null, children: string[] = []) => ({ name: "x", parent, children, files: [], count: 1, loc: 1 }) as unknown as ViewerData["nodes"][string];
const edge = (a: string, b: string) => ({ a, b, imports: 1, calls: 0, uses: 0, major: true, ev: [] }) as unknown as ViewerData["boards"][string]["edges"][number];
const brd = (edges: ReturnType<typeof edge>[], context: string[] = []) => ({ nodes: [], edges, throughout: [], hubs: [], context }) as unknown as ViewerData["boards"][string];
const lay = (...ids: string[]) => ({ n: ids.map((id) => [id, 0, 0, 1, 1, 0]), e: [] }) as unknown as ViewerData["layout"][string];

// root: web, functions, store-firestore. web (a board): web-billing, web-auth, and functions as an elsewhere box.
const data: ViewerData = {
  repo: "r", sha: null, paths: [],
  nodes: { root: node(null, ["web", "functions"]), web: node("root", ["web-billing", "web-auth"]), functions: node("root"), "web-billing": node("web"), "web-auth": node("web") },
  services: { "store-firestore": "Firestore" },
  boards: {
    root: brd([edge("web", "functions"), edge("web", "store-firestore")]),
    web: brd([edge("web-billing", "web-auth"), edge("web-billing", "functions"), edge("web-auth", "store-firestore")], ["functions"]),
  },
  layout: { root: lay("web", "functions", "store-firestore"), web: lay("web-billing", "web-auth", "functions", "store-firestore") },
};

test("story off: old story links are unknown and open the overview", () => {
  for (const h of ["#_story", "#_story~web", "#customer"]) assert.equal(parseHash(data, h), null, h);
});

test("a bare node id opens its parent board with the box selected", () => {
  assert.deepEqual(parseHash(data, "#web-billing"), { board: "web", hit: "n:web-billing" });
  assert.deepEqual(parseHash(data, "#web"), { board: "root", hit: "n:web" });
  assert.equal(hashFor(data, "web", "n:web-billing"), "web-billing");
});

test("a.b names the connection a→b on the board it lives on", () => {
  assert.deepEqual(parseHash(data, "#web-billing.web-auth"), { board: "web", hit: "e:web-billing>web-auth" });
  assert.deepEqual(parseHash(data, "#web.functions"), { board: "root", hit: "e:web>functions" });
  assert.equal(hashFor(data, "web", "e:web-billing>web-auth"), "web-billing.web-auth");
  assert.equal(homeOf(data, "e:web-billing>functions"), "web");
});

test("boards and off-home selections are qualified with board~", () => {
  assert.equal(hashFor(data, "root", null), "");
  assert.equal(hashFor(data, "web", null), "web~");
  assert.deepEqual(parseHash(data, "#web~"), { board: "web", hit: null });
  // functions is an elsewhere box on web; its home is root.
  assert.equal(hashFor(data, "web", "n:functions"), "web~functions");
  assert.deepEqual(parseHash(data, "#web~functions"), { board: "web", hit: "n:functions" });
  // A service lives on several boards; its home is the first board that draws it.
  assert.equal(hashFor(data, "root", "n:store-firestore"), "store-firestore");
  assert.equal(hashFor(data, "web", "n:store-firestore"), "web~store-firestore");
});

test("every hash the viewer writes reads back as the same view", () => {
  for (const [board, hits] of Object.entries({ root: [null, "n:web", "n:functions", "n:store-firestore", "e:web>functions", "e:web>store-firestore"], web: [null, "n:web-billing", "n:functions", "n:store-firestore", "e:web-billing>web-auth", "e:web-billing>functions", "e:web-auth>store-firestore"] })) {
    for (const hit of hits) {
      const h = hashFor(data, board, hit);
      assert.match(h, /^[A-Za-z0-9._~-]*$/);
      assert.deepEqual(parseHash(data, `#${h}`) ?? { board: "root", hit: null }, { board, hit }, `#${h}`);
    }
  }
});

test("unknown or malformed hashes are ignored", () => {
  assert.equal(parseHash(data, ""), null);
  assert.equal(parseHash(data, "#nope"), null);
  assert.equal(parseHash(data, "#nope~web"), null);
  assert.equal(parseHash(data, "#%E0%A4%A"), null);
  // A board that exists but a selection that doesn't: open the board.
  assert.deepEqual(parseHash(data, "#web~nope"), { board: "web", hit: null });
  assert.deepEqual(parseHash(data, "#web~web.functions"), { board: "web", hit: null });
  // Two known ids with no edge between them name nothing.
  assert.equal(parseHash(data, "#web-auth.web-billing"), null);
});

test("the viewer bundle wires up the hash and the copy-link button", () => {
  const { js } = buildViewer();
  assert.ok(js.includes("hashchange") && js.includes("replaceState") && js.includes("data-link"));
  assert.ok(js.includes("tour-link"), "the tour strip's copy-link button");
});

test("tour links: #tour.<id>.<n> counts steps from 1 and stays a bare token", () => {
  assert.equal(tourToken("patient-check-in", 2), "tour.patient-check-in.3");
  assert.deepEqual(parseTourToken("#tour.patient-check-in.3"), { id: "patient-check-in", step: 2 });
  assert.deepEqual(parseTourToken("tour.x.0"), { id: "x", step: 0 }, "step 0 reads as the first");
  for (const bad of ["#tour.x", "#tour.x.y", "#web~", "#tour..2", ""]) assert.equal(parseTourToken(bad), null, bad);
  // ids outside the host's bare-token set round-trip through ~xx
  for (const id of ["flow:web:0", "a.b", "x~y", "plain_id"]) {
    const t = tourToken(id, 4);
    assert.match(t, /^[A-Za-z0-9._~-]+$/);
    assert.deepEqual(parseTourToken(`#${t}`), { id, step: 4 });
  }
  // a tour token never reads as a board or selection
  assert.equal(parseHash(data, "#tour.download.2"), null);
});
