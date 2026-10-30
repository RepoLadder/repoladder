// The path of the up / across / down move between boards (viewer/travel.ts route).
import { test } from "node:test";
import assert from "node:assert/strict";
import { route } from "../src/viewer/travel.ts";

// a large app's shape: the story level on top, then web and functions, check-in two levels down
const tree: Record<string, string | null> = { _story: null, web: "_story", functions: "_story", "web-checkin": "web", "fn-checkin": "functions", "fn-checkin-kiosk": "fn-checkin" };
const parent = (id: string) => tree[id];

test("across branches: climbs to the common board in one move, then dives through every level", () => {
  assert.deepEqual(route("web", "fn-checkin", parent), { top: "_story", up: "web", down: ["functions", "fn-checkin"] });
  assert.deepEqual(route("fn-checkin-kiosk", "web-checkin", parent), { top: "_story", up: "functions", down: ["web", "web-checkin"] });
});

test("straight down or straight up has no climb or no dive", () => {
  assert.deepEqual(route("functions", "fn-checkin-kiosk", parent), { top: "functions", up: null, down: ["fn-checkin", "fn-checkin-kiosk"] });
  assert.deepEqual(route("fn-checkin-kiosk", "_story", parent), { top: "_story", up: "functions", down: [] });
});

test("siblings meet on their parent; unrelated boards have no route", () => {
  assert.deepEqual(route("web", "functions", parent), { top: "_story", up: "web", down: ["functions"] });
  assert.equal(route("web", "elsewhere", parent), null);
});
