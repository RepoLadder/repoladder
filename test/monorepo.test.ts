import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { workspaceGlobs } from "../src/analyze/packages.ts";
import { exportTargets, sourceVariants } from "../src/analyze/resolve.ts";
import { assign, defaultGrouping, exampleFolder } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import type { Facts, GroupNode, Package } from "../src/model/schema.ts";
import { summarize } from "../src/model/summary.ts";

const mono = analyze(fileURLToPath(new URL("./fixtures/mono", import.meta.url)));

test("mono: workspace globs from pnpm-workspace.yaml and package.json", () => {
  assert.deepEqual(workspaceGlobs(fileURLToPath(new URL("./fixtures/mono", import.meta.url))), ["apps/*", "packages/*"]);
  const dir = mkdtempSync(join(tmpdir(), "repoladder-ws-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ workspaces: { packages: ["./libs/*/", "apps/web"] } }));
  assert.deepEqual(workspaceGlobs(dir), ["apps/web", "libs/*"]);
});

test("mono: packages and kinds (a Next app serving tRPC is still a web app)", () => {
  assert.deepEqual(mono.packages.map((p) => [p.id, p.kind, p.dir]), [
    ["server", "backend", "apps/server"],
    ["web", "web", "apps/web"],
    ["api", "library", "packages/api"],
    ["config", "library", "packages/config"],
    ["ui", "library", "packages/ui"],
  ]);
});

test("kind: a React Router app served through Express is a web app; plain Express stays a backend", () => {
  const root = (pkg: object) => {
    const dir = mkdtempSync(join(tmpdir(), "repoladder-kind-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify(pkg));
    mkdirSync(join(dir, "app"));
    writeFileSync(join(dir, "app/root.tsx"), "export default function App() { return null }\n");
    return analyze(dir).packages.map((p) => p.kind);
  };
  // the epic-stack shape
  const rrExpress = {
    name: "rr-express",
    dependencies: { express: "4.21.0", "react-router": "7.6.0", "@react-router/node": "7.6.0", "@react-router/express": "7.6.0", "react-dom": "19.0.0" },
    devDependencies: { "@react-router/dev": "7.6.0", vite: "6.0.0" },
  };
  assert.deepEqual(root(rrExpress), ["web"]);
  assert.deepEqual(root({ name: "api", dependencies: { express: "4.21.0" } }), ["backend"]);
});

test("mono: workspace imports resolve to source files, not externals", () => {
  assert.deepEqual(mono.imports.map((i) => `${i.from} -> ${i.to} [${i.kind}${i.via ? ` via ${i.via}` : ""}]`), [
    "apps/server/src/index.ts -> packages/api/src/index.ts [static]", // main: ./dist/index.js
    "apps/web/src/page.tsx -> packages/ui/src/button.tsx [static via packages/ui/src/index.ts]", // exports "."
    "apps/web/src/page.tsx -> packages/ui/src/card.tsx [static]", // exports "./card" -> dist/card.js -> src/card.tsx
    "apps/web/src/page.tsx -> packages/api/src/index.ts [static]",
    "apps/web/src/page.tsx -> packages/config/src/index.ts [static]", // no entry fields: src/index
    "packages/api/src/index.ts -> packages/config/src/index.ts [static]",
    "packages/ui/src/index.ts -> packages/ui/src/button.tsx [reexport]",
  ]);
  assert.deepEqual(mono.externals.map((e) => e.spec), ["express", "react"]);
  // a workspace subpath that doesn't exist is a broken import, never a third-party package
  assert.deepEqual(mono.unresolved.map((u) => u.spec), ["@mono/ui/missing"]);
});

test("exports maps and source variants", () => {
  const exp = { ".": { types: "./dist/index.d.ts", default: "./src/index.ts" }, "./icons/*": { import: "./dist/icons/*.js" } };
  assert.deepEqual(exportTargets(exp, "."), ["./src/index.ts", "./dist/index.d.ts"]);
  assert.deepEqual(exportTargets(exp, "./icons/star"), ["./dist/icons/star.js"]);
  assert.deepEqual(exportTargets("./index.js", "."), ["./index.js"]);
  assert.deepEqual(exportTargets(exp, "./nope"), []);
  const v = sourceVariants("./dist/card.js");
  assert.ok(v.includes("src/card.tsx") && v.includes("dist/card.ts") && v.indexOf("dist/card.js") < v.indexOf("src/card.tsx"));
});

test("mono: apps at the top, libraries under Shared packages", () => {
  const g = defaultGrouping(mono);
  assert.deepEqual(g.children.map((c) => c.id), ["web", "server", "shared-packages"]);
  assert.deepEqual(g.children[2].children!.map((c) => c.name), ["UI", "API", "Config"]);
  const a = assign(g, mono);
  assert.deepEqual(a.errors, []);
  assert.equal(a.leafOf.size, mono.files.length);
});

/** A synthetic monorepo: one app plus `n` plugins and a few core packages, each with `size(i)` files. */
function bigMono(plugins: number): Facts {
  const packages: Package[] = [{ id: "web", name: "@big/web", dir: "apps/web", kind: "web", deps: ["next", "@big/core"] }];
  for (let i = 0; i < 4; i++) packages.push({ id: `core${i}`, name: `@big/core${i}`, dir: `packages/core${i}`, kind: "library", deps: ["@big/core0", "zod"] });
  for (let i = 0; i < plugins; i++) packages.push({ id: `plugin${String(i).padStart(2, "0")}`, name: `@big/plugin${i}`, dir: `packages/plugins/p${String(i).padStart(2, "0")}`, kind: "library", deps: [] });
  const files = packages.flatMap((p, i) => Array.from({ length: 1 + (i % 4) }, (_, j) => ({ path: `${p.dir}/src/f${j}.ts`, pkg: p.id, loc: 10 })));
  return { version: 1, repo: "big", sha: null, packages, files, imports: [], externals: [], unresolved: [], services: [], serviceUses: [], endpoints: [], calls: [], pages: [] } as unknown as Facts;
}

test("many shared packages are grouped by folder and every level stays small", () => {
  const facts = bigMono(40);
  const g = defaultGrouping(facts);
  assert.deepEqual(g.children.map((c) => c.id), ["web", "shared-packages"]);
  const shared = g.children[1];
  // packages/ alone would open to two boxes (#103): its four core packages sit beside Plugins instead
  assert.deepEqual(shared.children!.map((c) => c.name), ["Core2", "Core1", "Core0", "Core3", "Plugins"]);
  const walk = (n: GroupNode): void => {
    assert.ok(!n.children || n.children.length <= 10, `${n.id} has ${n.children?.length} children`);
    n.children?.forEach(walk);
  };
  g.children.forEach(walk);
  assert.match(shared.children!.at(-1)!.children!.at(-1)!.name, /^31 more packages$/);
  const a = assign(g, facts);
  assert.deepEqual(a.errors, []);
  assert.equal(a.leafOf.size, facts.files.length);
  assert.match(g.summary, /45 packages \(1 web app, 44 libraries\)/);
});

test("digest: package lines stay under budget with dozens of packages", () => {
  const digest = summarize(bigMono(40));
  const section = digest.slice(digest.indexOf("## Packages"), digest.indexOf("## Files by folder")).trim().split("\n").slice(1);
  assert.ok(section.filter((l) => !l.includes("smaller package")).length <= 30);
  assert.ok(section.length < 35, `${section.length} package lines`);
  assert.ok(section.some((l) => /^- packages\/plugins\/\* — \d+ smaller packages/.test(l)));
  // sibling workspace packages are arrows, not deps
  assert.ok(!section.some((l) => l.includes("@big/core0")));
  assert.ok(section.some((l) => l.includes("deps: zod")));
});

/** trpc's shape (#222): a library in packages/, a docs site, and `n` example apps (one a client and a server). */
function exampleMono(n: number): Facts {
  const packages: Package[] = [
    { id: "server", name: "@trpc/server", dir: "packages/server", kind: "library", deps: [] },
    { id: "client", name: "@trpc/client", dir: "packages/client", kind: "web", deps: ["@trpc/server"] },
    { id: "www", name: "www", dir: "www", kind: "web", deps: [] },
  ];
  const words = ["next", "minimal", "lambda", "express"];
  for (let i = 0; i < n; i++) {
    const name = `${words[i % words.length]}-${String(i).padStart(2, "0")}`;
    if (i === 1) for (const side of ["client", "server"]) packages.push({ id: `${name}-${side}`, name: `@examples/${name}-${side}`, dir: `examples/${name}/${side}`, kind: "web", deps: [] });
    else packages.push({ id: name, name: `@examples/${name}`, dir: `examples/${name}`, kind: "web", deps: [] });
  }
  const files = packages.flatMap((p) => [0, 1].map((j) => ({ path: `${p.dir}/src/f${j}.ts`, pkg: p.id, loc: 10 })));
  return { version: 1, repo: "ex", sha: null, packages, files, imports: [], externals: [], unresolved: [], services: [], serviceUses: [], endpoints: [], calls: [], pages: [] } as unknown as Facts;
}

test("exampleFolder: the example a package belongs to", () => {
  assert.equal(exampleFolder("examples/next-sse-chat"), "examples/next-sse-chat");
  assert.equal(exampleFolder("examples/minimal-react/client"), "examples/minimal-react");
  assert.equal(exampleFolder("packages/ui/examples/basic"), "packages/ui/examples/basic");
  assert.equal(exampleFolder("trpc-examples/bun"), "trpc-examples/bun");
  assert.equal(exampleFolder("examples"), null);
  assert.equal(exampleFolder("packages/counterexample"), null);
});

test("many example apps go one level down together, after the library and its docs (trpc, #222)", () => {
  const facts = exampleMono(27);
  const g = defaultGrouping(facts);
  assert.deepEqual(g.children.map((c) => c.name), ["Www", "Library", "Examples"]);
  const examples = g.children[2];
  const names = (n: GroupNode): string[] => [n.name, ...(n.children ?? []).flatMap(names)];
  // named after the folder, not "@examples/…"
  assert.ok(names(examples).includes("Minimal 01"), names(examples).join(", "));
  assert.ok(!names(examples).some((x) => /^Examples? /.test(x)));
  const a = assign(g, facts);
  assert.deepEqual(a.errors, []);
  assert.equal(a.leafOf.size, facts.files.length);
  // every board stays within the budget: the examples are split, by their names' first word
  const m = buildModel(facts, g, a.leafOf);
  for (const [id, b] of Object.entries(m.boards)) assert.ok(b.nodes.length <= 12, `${id}: ${b.nodes.length} boxes`);
  assert.ok(examples.children!.some((c) => c.name === "Next"), examples.children!.map((c) => c.name).join(", "));
});

test("one or two examples stay beside the rest", () => {
  const g = defaultGrouping(exampleMono(2));
  assert.ok(!g.children.some((c) => c.name === "Examples" || c.name === "Library"), g.children.map((c) => c.name).join(", "));
});

/** Many packages under several folders, optionally nested a level deeper (#434). */
function spreadMono(n: number, nested: boolean): Facts {
  const f = bigMono(0);
  const dirs = nested ? ["packages/a/b", "packages/a/c", "packages/d/e", "extensions/x"] : ["packages/plugins", "extensions", "libs", "tools"];
  for (let i = 0; i < n; i++) {
    const id = `pk${String(i).padStart(3, "0")}`, dir = `${dirs[i % dirs.length]}/${id}`;
    f.packages.push({ id, name: `@big/${id}`, dir, kind: "library", deps: [] } as Package);
    f.files.push({ path: `${dir}/src/index.ts`, pkg: id, loc: 10 } as Facts["files"][number]);
  }
  return f;
}

test("synthetic many-package repos get no thin-group warning and at most 10 children per level (#434)", () => {
  for (const [n, nested] of [[40, false], [120, false], [300, false], [120, true], [300, true]] as const) {
    const facts = spreadMono(n, nested);
    const g = defaultGrouping(facts);
    const a = assign(g, facts);
    assert.deepEqual(a.errors, [], `${n}`);
    assert.deepEqual(a.warnings.filter((w) => /opens to only|has a single child/.test(w)), [], `${n} nested=${nested}`);
    const walk = (x: GroupNode): void => {
      assert.ok(!x.children || x.children.length <= 10, `${x.id} has ${x.children?.length} children (${n})`);
      x.children?.forEach(walk);
    };
    g.children.forEach(walk);
  }
});
