import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { analyze } from "../src/analyze/index.ts";
import { inScope, packageRelation } from "../src/analyze/calls.ts";
import type { Package } from "../src/model/schema.ts";

const pkg = (id: string, deps: string[] = []): Package => ({ id, name: `@m/${id}`, dir: `apps/${id}`, kind: "backend", deps });

test("packageRelation: own package, package.json deps (transitively) and import links", () => {
  const related = packageRelation([pkg("a", ["@m/b", "react"]), pkg("b", ["@m/c"]), pkg("c"), pkg("d"), pkg("e")], [["d", "e"]]);
  assert.ok(related("a", "a"));
  assert.ok(related("a", "b"));
  assert.ok(related("a", "c")); // through b
  assert.ok(!related("b", "a")); // not the other way round
  assert.ok(related("d", "e")); // d imports e's files
  assert.ok(!related("a", "d"));
});

test("inScope: near endpoints win, one unrelated package is kept, several are dropped", () => {
  const owner = (f: string) => f.split("/")[0];
  const related = packageRelation([pkg("a", ["@m/b"]), pkg("b"), pkg("c"), pkg("d")]);
  const eps = (...files: string[]) => files.map((file) => ({ file }));
  assert.deepEqual(inScope("a", eps("a/x.ts", "c/x.ts", "d/x.ts"), owner, related), eps("a/x.ts"));
  assert.deepEqual(inScope("a", eps("b/x.ts", "c/x.ts"), owner, related), eps("b/x.ts"));
  assert.deepEqual(inScope("a", eps("c/x.ts", "c/y.ts"), owner, related), eps("c/x.ts", "c/y.ts"));
  assert.deepEqual(inScope("a", eps("c/x.ts", "d/x.ts"), owner, related), []);
});

function write(root: string, files: Record<string, string>) {
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), text);
  }
}

const server = (route: string) => `import express from "express";\nconst app = express();\napp.get("${route}", (_req, res) => res.end());\napp.listen(3000);\nexport type Api = typeof app;\n`;
const pj = (name: string, deps: Record<string, string> = {}) => JSON.stringify({ name, dependencies: { express: "4.0.0", ...deps } });

test("call edges stay inside related packages (#260)", () => {
  const root = mkdtempSync(join(tmpdir(), "repoladder-callscope-"));
  write(root, {
    "package.json": JSON.stringify({ name: "mono", private: true, workspaces: ["apps/*"] }),
    // two example apps that both serve and call /api/items
    "apps/shop/package.json": pj("shop"),
    "apps/shop/src/server.ts": server("/api/items"),
    "apps/shop/src/client.ts": `export const items = () => fetch("/api/items");\n`,
    "apps/blog/package.json": pj("blog"),
    "apps/blog/src/server.ts": server("/api/items"),
    "apps/blog/src/client.ts": `export const items = () => fetch("/api/items");\n`,
    // depends on shop by package.json; imports blog's types by relative path
    "apps/admin/package.json": pj("admin", { shop: "workspace:*" }),
    "apps/admin/src/client.ts": `export const items = () => fetch("/api/items");\n`,
    "apps/portal/package.json": pj("portal"),
    "apps/portal/src/client.ts": `import type { Api } from "../../blog/src/server";\nexport type A = Api;\nexport const items = () => fetch("/api/items");\n`,
    // related to neither: the literal is a guess between shop and blog
    "apps/stray/package.json": pj("stray"),
    "apps/stray/src/client.ts": `export const items = () => fetch("/api/items");\n`,
    // a web app calling the one package that serves /api/orders, without depending on it
    "apps/orders/package.json": pj("orders"),
    "apps/orders/src/server.ts": server("/api/orders"),
    "apps/web/package.json": JSON.stringify({ name: "web", dependencies: { react: "18.0.0" } }),
    "apps/web/src/orders.ts": `export const orders = () => fetch("/api/orders");\n`,
  });
  const f = analyze(root);
  assert.deepEqual(f.calls.map((c) => `${c.from} -> ${c.to} ${c.endpoint}`), [
    "apps/admin/src/client.ts -> apps/shop/src/server.ts /api/items",
    "apps/blog/src/client.ts -> apps/blog/src/server.ts /api/items",
    "apps/portal/src/client.ts -> apps/blog/src/server.ts /api/items",
    "apps/shop/src/client.ts -> apps/shop/src/server.ts /api/items",
    "apps/web/src/orders.ts -> apps/orders/src/server.ts /api/orders",
  ]);
});
