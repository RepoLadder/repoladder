import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { routeRegex } from "../src/analyze/calls.ts";
import { directiveOf, serverActions } from "../src/analyze/nextjs.ts";
import { parseFile } from "../src/analyze/resolve.ts";
import { Facts } from "../src/model/schema.ts";
import { summarize } from "../src/model/summary.ts";
import { DEFAULT_FEATURES } from "../src/features.ts";
import { endpointLabel } from "../src/model/endpoints.ts";

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const f = Facts.parse(analyze(fixture("next-app")));

test("nextjs: app route handlers and pages/api become http endpoints", () => {
  // a route.ts carries every method it exports (#244); pages/api handlers don't say
  assert.deepEqual(f.endpoints.filter((e) => e.kind === "http").map((e) => `${e.file}:${e.line} ${endpointLabel(e)}`), [
    "app/api/hello/route.ts:1 GET /api/hello",
    "app/api/users/[id]/route.ts:3 GET, DELETE /api/users/[id]", // line of the first exported method
    "app/api/users/me/route.ts:2 GET, POST /api/users/me", // export { handler as GET, handler as POST }
    "app/docs/[[...path]]/route.ts:1 GET /docs/[[...path]]",
    "pages/api/hello.ts:1 /api/hello",
    "pages/api/legacy/[id].ts:1 /api/legacy/[id]",
  ]);
});

test("nextjs: fetch calls match route handlers, static segments beating dynamic ones", () => {
  assert.deepEqual(f.calls.filter((c) => c.kind === "http").map((c) => `${c.from}:${c.line} -> ${c.to}`), [
    "components/Form.tsx:8 -> app/api/users/[id]/route.ts", // `/api/users/${id}`
    "components/Form.tsx:9 -> app/api/users/me/route.ts", // not also [id]
    "components/Form.tsx:10 -> app/docs/[[...path]]/route.ts",
    "components/Form.tsx:11 -> app/api/hello/route.ts",
    "components/Form.tsx:11 -> pages/api/hello.ts",
    "components/Form.tsx:12 -> pages/api/legacy/[id].ts",
  ]);
});

test("nextjs: server actions are endpoints, and importing one is an action call", () => {
  assert.deepEqual(f.endpoints.filter((e) => e.kind === "action").map((e) => `${e.file}:${e.line} ${e.name}`), [
    "app/dashboard/page.tsx:4 archive", // inline "use server"
    "lib/actions.ts:4 createUser",
    "lib/actions.ts:5 deleteUser",
    "lib/actions.ts:7 addToCart", // export { addToCart }; LIMIT is a value, not an action
  ]);
  assert.deepEqual(f.calls.filter((c) => c.kind === "action").map((c) => `${c.from}:${c.line} -> ${c.endpoint} (${c.to})`), [
    "app/(shop)/cart/page.tsx:1 -> addToCart (lib/actions.ts)", // through the lib/index.ts barrel
    "components/Form.tsx:4 -> createUser (lib/actions.ts)",
    "components/Form.tsx:4 -> deleteUser (lib/actions.ts)",
  ]);
});

test("nextjs: layout/loading/error files and middleware are tied to their route", () => {
  assert.deepEqual(f.routeFiles.map((r) => `${r.route} ${r.role} ${r.file}`), [
    "/ layout app/layout.tsx",
    "/dashboard error app/dashboard/error.tsx",
    "/dashboard layout app/dashboard/layout.tsx",
    "/dashboard loading app/dashboard/loading.tsx",
    "/dashboard/:path*, /api/:path* middleware middleware.ts",
  ]);
  const digest = summarize(f, undefined, { ...DEFAULT_FEATURES, story: true });
  assert.match(digest, /\/dashboard: app\/dashboard\/error\.tsx \[error\], app\/dashboard\/layout\.tsx \[layout\]/);
  assert.match(digest, /- Server actions: addToCart, archive, createUser, deleteUser/);
});

test("nextjs: the use client / use server boundary is recorded per file", () => {
  assert.deepEqual(f.files.filter((x) => x.directive).map((x) => `${x.path} ${x.directive}`), [
    "app/dashboard/error.tsx client",
    "components/Form.tsx client", // after a block comment
    "lib/actions.ts server",
  ]);
  assert.equal(directiveOf(`import x from "y";\n"use client";`), null); // only the prologue counts
  assert.deepEqual(serverActions("a.ts", `"use server";\nexport default async function save() {}`), [{ name: "default", line: 2 }]);
});

test("nextjs: route regexes for dynamic segments", () => {
  assert.ok(routeRegex("/api/users/[id]")!.test("/api/users/:_"));
  assert.ok(!routeRegex("/api/users/[id]")!.test("/api/users/a/b"));
  assert.ok(routeRegex("/docs/[...p]")!.test("/docs/a/b"));
  assert.ok(!routeRegex("/docs/[...p]")!.test("/docs"));
  assert.ok(routeRegex("/docs/[[...p]]")!.test("/docs"));
  assert.ok(!routeRegex("/api/trpc/[trpc]")!.test("/api/trpc/$")); // a TanStack route definition, not a call
  assert.ok(!routeRegex("/api/auth/[...all]")!.test("/api/auth/$"));
  assert.ok(!routeRegex("/users/:id")!.test("/users/:userId"));
  assert.equal(routeRegex("/[slug]"), null); // no literal segment: would match any URL
  assert.equal(routeRegex("/:id"), null);
});

test("template literals keep their path with substitutions as dynamic segments", () => {
  const strings = parseFile("a.ts", "fetch(`/api/posts/${id}`); fetch(`${base}/createUser`); fetch(`${a}${b}`);").strings;
  assert.deepEqual(strings.map((s) => [s.path, s.token]), [["/api/posts/:_", ""], ["/createUser", "createUser"]]);
});
