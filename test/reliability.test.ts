// Regressions from the launch reliability sweep (docs/reliability.md), one per failure found.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { analyze } from "../src/analyze/index.ts";
import { parseFile } from "../src/analyze/resolve.ts";
import { assign, defaultGrouping, packageNames } from "../src/model/grouping.ts";
import type { Facts, GroupNode, Package } from "../src/model/schema.ts";

const facts = (pkgs: [string, string][], files: [string, string][]): Facts => ({
  version: 1, repo: "t", sha: null, github: null, stores: [], storeUses: [], storeFields: [],
  packages: pkgs.map(([id, dir]) => ({ id, name: id, dir, kind: "library" as const, deps: [] })),
  files: files.map(([path, pkg]) => ({ path, pkg, loc: 10 })),
  imports: [], externals: [], unresolved: [], services: [], serviceUses: [], endpoints: [], calls: [], pages: [], routeFiles: [],
});

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "repoladder-rel-"));
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), text);
  }
  return root;
}

test("a package named root does not take the top board's id (trpc)", () => {
  const f = facts([["root", ""], ["a", "packages/a"], ["b", "packages/b"]], [["scripts/x.ts", "root"], ["packages/a/i.ts", "a"], ["packages/b/i.ts", "b"]]);
  const g = defaultGrouping(f);
  assert.deepEqual(assign(g, f).errors, []);
});

test("packages that share a name are told apart by their folders (friendlyeats, bulletproof-react)", () => {
  const p = (name: string, dir: string): Package => ({ id: dir, name, dir, kind: "web", deps: [] });
  const pkgs = [p("my-app", "nextjs-end"), p("my-app", "nextjs-start"), p("hosting", "end/hosting"), p("hosting", "start/hosting"), p("api", "api")];
  assert.deepEqual([...packageNames(pkgs).values()], ["Nextjs end", "Nextjs start", "End hosting", "Start hosting", "API"]);
});

test("a test fixture's package.json is not a package (np)", () => {
  const root = repo({
    "package.json": JSON.stringify({ name: "np", bin: "./source/cli.js" }),
    "source/cli.js": "import './index.js';\n",
    "source/index.js": "export const x = 1;\n",
    "test/fixtures/a/package.json": JSON.stringify({ name: "fixture" }),
  });
  const f = analyze(root);
  assert.deepEqual(f.packages.map((p) => [p.id, p.dir, p.kind]), [["np", "", "scripts"]]);
});

test("an HTTP client named api is not read as a server route (bulletproof-react)", () => {
  const client = parseFile("a.ts", "import { api } from './api-client';\nexport const create = (data) => {\n  return api.post(`/discussions`, data);\n};\nexport const list = () => api.get('/users');\nexport async function one() { await api.get('/teams'); }\n");
  assert.deepEqual(client.routes.routes, []);
  const server = parseFile("b.ts", "import { app } from './app';\napp.get('/users', list);\nexport default (api) => api.post('/teams', create);\napp.post('/x', async (req, res) => res.send(1));\n");
  assert.deepEqual(server.routes.routes.map((r) => r.path), ["/users", "/teams", "/x"]);
});

test("a root app keeps its folders when a tool package sits beside it (indie-stack's remix.init)", () => {
  const root = repo({
    "package.json": JSON.stringify({ name: "indie", dependencies: { "@remix-run/react": "1" } }),
    "app/root.tsx": "import { db } from './db.server';\n",
    "app/db.server.ts": "export const db = 1;\n",
    "prisma/seed.ts": "export {};\n",
    "remix.init/package.json": JSON.stringify({ name: "remix.init" }),
    "remix.init/index.js": "module.exports = 1;\n",
  });
  const f = analyze(root);
  assert.deepEqual(f.packages.map((p) => [p.dir, p.kind]), [["", "web"], ["remix.init", "library"]]);
});

test("tsd type tests and dotfile configs are not source (ky's test-d/, indie-stack's .eslintrc.cjs)", () => {
  const root = repo({ "package.json": "{}", "source/index.ts": "export const a = 1;\n", "test-d/index.test-d.ts": "export {};\n", "source/x.test-d.ts": "export {};\n", ".eslintrc.cjs": "module.exports = {};\n" });
  assert.deepEqual(analyze(root).files.map((f) => f.path), ["source/index.ts"]);
});

test("SQLite and Drizzle's SQLite and MySQL drivers are databases (hono-open-api-starter)", async () => {
  const { serviceFor } = await import("../src/analyze/services.ts");
  assert.deepEqual(["drizzle-orm/libsql", "@libsql/client", "better-sqlite3", "drizzle-orm/d1", "drizzle-orm/mysql2", "drizzle-orm/node-postgres"].map((s) => serviceFor(s)?.id),
    ["sqlite", "sqlite", "sqlite", "sqlite", "mysql", "postgres"]);
});

test("URL strings used as data are not calls (#237: create-t3-turbo's redirectURI; #277: epic-stack's sitemap and healthcheck)", () => {
  const client = [
    `import axios from "axios";`,
    `declare const base: string, origin: string, u: string, id: string, request: (o: unknown) => void;`,
    // data: no call
    `export const auth = { socialProviders: { discord: { redirectURI: \`\${base}/api/auth/callback/discord\` } } };`,
    `export const robots = { type: "sitemap", value: \`\${origin}/sitemap.xml\` };`,
    `export const skip = (v: string) => v.includes("/resources/healthcheck");`,
    `export const hc = (x?: string) => x?.startsWith("/resources/healthcheck");`,
    `export const isHc = (p: string) => p === "/resources/healthcheck";`,
    `export const strip = (p: string) => p.replace("/api/users/1", "");`,
    `export const hdr = () => fetch(u, { headers: { Referer: "/api/users/7" } });`,
    // requests: calls
    `export const a = () => fetch("/api/users/42");`,
    `export const b = () => fetch(\`\${base}/api/users/\${id}\`);`,
    `export const c = () => { const url = "/api/users/3"; return fetch(url); };`,
    `export const d = () => axios({ url: "/api/users/5" });`,
    `export const e = () => request({ method: "POST", body: "/api/users/6" });`,
    `export const cfg = { endpoint: "/api/users/8" };`,
    `export const out = () => location.replace("/logout");`,
    `export const img = (i: string) => \`/api/users/\${i}?v=1\`;`,
    `export const chat = () => new DefaultChatTransport({ api: "/api/users/9" });`, // AI SDK: ai-chatbot's useChat transport
  ].join("\n") + "\n";
  const root = repo({
    "package.json": JSON.stringify({ name: "mono", private: true, workspaces: ["apps/*"] }),
    "apps/server/package.json": JSON.stringify({ name: "server", dependencies: { express: "4.0.0" } }),
    "apps/server/src/server.ts": [
      `import express from "express";`,
      `const app = express();`,
      `app.get("/api/auth/callback/discord", (_q, r) => r.end());`,
      `app.get("/resources/healthcheck", (_q, r) => r.end());`,
      `app.get("/sitemap.xml", (_q, r) => r.end());`,
      `app.get("/api/users/:id", (_q, r) => r.end());`,
      `app.post("/logout", (_q, r) => r.end());`,
      `app.listen(3000);`,
    ].join("\n") + "\n",
    "apps/web/package.json": JSON.stringify({ name: "web", dependencies: { server: "workspace:*", react: "18.0.0" } }),
    "apps/web/src/client.ts": client,
    "apps/web/src/form.tsx": `export const F = () => <form action="/logout" method="post" />;\n`,
  });
  const f = analyze(root);
  assert.deepEqual(f.calls.map((c) => `${c.from}:${c.line} -> ${c.endpoint}`).sort(), [
    "apps/web/src/client.ts:10 -> /api/users/:id",
    "apps/web/src/client.ts:11 -> /api/users/:id",
    "apps/web/src/client.ts:12 -> /api/users/:id",
    "apps/web/src/client.ts:13 -> /api/users/:id",
    "apps/web/src/client.ts:14 -> /api/users/:id",
    "apps/web/src/client.ts:15 -> /api/users/:id",
    "apps/web/src/client.ts:16 -> /logout",
    "apps/web/src/client.ts:17 -> /api/users/:id",
    "apps/web/src/client.ts:18 -> /api/users/:id",
    "apps/web/src/form.tsx:1 -> /logout",
  ]);
});

test("string literals record their data site (#237)", () => {
  const pf = parseFile("a.ts", [
    `export const o = { redirectURI: "/a/b" };`,
    `export const p = (s: string) => s.includes("/a/b");`,
    `export const r = (s: string) => ("/a/b" as const).startsWith(s);`,
    `export const c = (s: string) => s !== "/a/b";`,
    `export const e = (s: string) => "/a/b" == s || s != "/a/b";`,
    `export const f = () => fetch("/a/b");`,
    `export const x = () => axios({ url: "/a/b" });`,
    `export const h = () => fetch(u, { headers: { Referer: "/a/b" } });`,
  ].join("\n") + "\n");
  assert.deepEqual(pf.strings.map((s) => s.site?.kind ?? null), ["property", "predicate", "predicate", "compare", "compare", "compare", null, "property", "property"]);
  assert.deepEqual(pf.strings.map((s) => (s.site?.kind === "property" ? s.site.objectCallee : undefined)), [null, undefined, undefined, undefined, undefined, undefined, undefined, "axios", null]);
  assert.deepEqual(pf.strings[1].site, { kind: "predicate", method: "includes" });
});

test('examples stay one "Examples" box beside the library; the root entry sits with lib (express)', () => {
  // express @ a419aa7: 7 library files, 43 example files (86%: the dominant-folder lift applies)
  const up = "var express = require('../../');\n";
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ name: "express", main: "index.js" }),
    "index.js": "module.exports = require('./lib/express');\n",
    "lib/express.js": ["application", "request", "response", "utils", "view"].map((m) => `require('./${m}');\n`).join(""),
  };
  for (const m of ["application", "request", "response", "utils", "view"]) files[`lib/${m}.js`] = "module.exports = {};\n";
  for (const ex of ["auth", "cookies", "cookie-sessions", "downloads", "ejs", "error", "error-pages", "hello-world", "markdown", "online", "params", "resource", "route-map", "route-middleware", "vhost", "web-service"]) {
    files[`examples/${ex}/index.js`] = up;
  }
  for (const [ex, sib] of [["search", "db"], ["session", "redis"], ["static-files", "public"], ["view-constructor", "github-view"], ["view-locals", "user"]]) {
    files[`examples/${ex}/index.js`] = sib === "redis" ? up : `${up}require('./${sib}');\n`;
    files[`examples/${ex}/${sib}.js`] = sib === "redis" ? up : "module.exports = {};\n";
  }
  files["examples/mvc/index.js"] = `${up}require('./lib/boot');\n`;
  files["examples/mvc/lib/boot.js"] = "module.exports = {};\n";
  files["examples/mvc/db.js"] = "module.exports = {};\n";
  for (const c of ["main", "user", "pet", "user-pet"]) files[`examples/mvc/controllers/${c}/index.js`] = "require('../../db');\n";
  files["examples/route-separation/index.js"] = `${up}require('./site');\nrequire('./post');\nrequire('./user');\n`;
  for (const m of ["site", "post", "user"]) files[`examples/route-separation/${m}.js`] = "module.exports = {};\n";
  files["examples/multi-router/index.js"] = `${up}require('./controllers/api_v1');\nrequire('./controllers/api_v2');\n`;
  for (const m of ["api_v1", "api_v2"]) files[`examples/multi-router/controllers/${m}.js`] = "module.exports = {};\n";
  files["examples/content-negotiation/index.js"] = `${up}require('./db');\nrequire('./users');\n`;
  files["examples/content-negotiation/users.js"] = "require('./db');\n";
  files["examples/content-negotiation/db.js"] = "module.exports = {};\n";

  const f = analyze(repo(files));
  assert.equal(f.files.length, 50);
  const g = defaultGrouping(f);
  const a = assign(g, f);
  assert.deepEqual(a.errors, []);
  const all = (ns: GroupNode[]): GroupNode[] => ns.flatMap((n) => [n, ...(n.children ? all(n.children) : [])]);
  assert.deepEqual(all(g.children).filter((n) => n.name === "Redis").map((n) => n.id), []);
  const ex = g.children.filter((n) => n.name === "Examples");
  assert.equal(ex.length, 1);
  const inside = new Set(all([ex[0]]).map((n) => n.id));
  for (const file of f.files) assert.equal(inside.has(a.leafOf.get(file.path)!), file.path.startsWith("examples/"), file.path);
  assert.equal(a.leafOf.get("index.js"), a.leafOf.get("lib/express.js"));
  assert.deepEqual(defaultGrouping(f), g);
});
