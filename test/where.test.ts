import { test } from "node:test";
import assert from "node:assert/strict";
import { whereLine, whereText, type Tree } from "../src/viewer/where.ts";

// root: Web app (check-in, shell), Cloud backend (api). Check-in holds a page.
const nodes: Tree = {
  root: { name: "repo", parent: null },
  web: { name: "Web app", parent: "root" },
  "web-checkin": { name: "Patient check-in", parent: "web" },
  "web-checkin-page": { name: "Page", parent: "web-checkin" },
  "web-shell": { name: "App shell & sign-in", parent: "web" },
  backend: { name: "Cloud backend", parent: "root" },
  "backend-api": { name: "API", parent: "backend" },
  long: { name: "A very long top-level part name indeed", parent: "root" },
};

test("a top-level part is outside the top-level part the board belongs to", () => {
  assert.equal(whereLine(nodes, "web", "backend"), "outside Web app");
  assert.equal(whereLine(nodes, "web-checkin", "backend"), "outside Web app");
  assert.equal(whereLine(nodes, "web-checkin-page", "backend"), "outside Web app");
});

test("a sibling of the board or of an ancestor is also in that group", () => {
  assert.equal(whereLine(nodes, "web-checkin", "web-shell"), "also in Web app");
  assert.equal(whereLine(nodes, "web-checkin-page", "web-shell"), "also in Web app");
});

test("a part in another branch names its own group", () => {
  assert.equal(whereLine(nodes, "web-checkin", "backend-api"), "in Cloud backend");
});

test("long group names are shortened; unknown places fall back to elsewhere", () => {
  assert.equal(whereLine(nodes, "long", "backend"), "outside A very long top-level…");
  assert.equal(whereLine(nodes, "root", "backend"), "elsewhere");
  assert.equal(whereLine(nodes, "_story", "backend"), "elsewhere");
  assert.equal(whereLine(nodes, "web", "nope"), "elsewhere");
});

test("the panel sentence says where the part lives and why it is dashed", () => {
  assert.equal(whereText(nodes, "web", "backend", "repo"), "Cloud backend is outside Web app: it's one of the main parts of repo. It's drawn dashed because Web app connects with it.");
  assert.equal(whereText(nodes, "web-checkin", "web-shell", "repo"), "App shell & sign-in is another part of Web app, outside Patient check-in. It's drawn dashed because Patient check-in connects with it.");
  assert.equal(whereText(nodes, "web-checkin", "backend-api", "repo"), "API is part of Cloud backend, outside Patient check-in. It's drawn dashed because Patient check-in connects with it.");
});
