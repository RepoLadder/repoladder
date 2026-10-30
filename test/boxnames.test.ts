import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { readmeHint } from "../src/analyze/readmes.ts";
import { cleanHint, describe, describeBoxes, humanize } from "../src/model/boxnames.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { Grouping, type Facts, type GroupNode } from "../src/model/schema.ts";

const NAMES: [string, string][] = [
  ["utils", "Utilities"], ["api-utils", "API utilities"], ["date-utils", "Date utilities"], ["[...slug]", "Slug"],
  ["__generated__", "Generated"], ["(marketing)", "Marketing"], ["[id]", "ID"], ["_app", "App"], ["TTDDialog", "TTD dialog"],
  ["next-sse-chat", "Next SSE chat"], ["@mono/ui", "UI"], ["minimal-01", "Minimal 01"], ["core2", "Core2"], ["www", "Www"],
  ["[[...slug]]", "Slug"], ["GraphQLSchema", "GraphQL schema"], ["getURLs", "Get URLs"], ["OAuthButton", "OAuth button"], ["OAuth2", "OAuth2"], ["c++", "C"], ["trpc", "tRPC"], ["i18n", "i18n"], ["db", "Database"],
];

test("humanize: readable names", () => {
  for (const [from, to] of NAMES) assert.equal(humanize(from), to, from);
});

test("humanize is idempotent", () => {
  for (const [from] of NAMES) assert.equal(humanize(humanize(from)), humanize(from), from);
});

test("humanize cuts at a word boundary, at most 40 chars", () => {
  const long = "this-is-a-really-long-folder-name-that-keeps-going-on";
  const h = humanize(long);
  assert.ok(h.length <= 40, h);
  assert.equal(h, "This is a really long folder name that");
  assert.equal(humanize("x".repeat(60)).length, 40);
});

test("cleanHint: boilerplate, names, long text and the trailing period", () => {
  assert.equal(cleanHint("This is a Next.js project bootstrapped with create-next-app."), undefined);
  assert.equal(cleanHint("A starter. This template is great"), undefined);
  assert.equal(cleanHint("short"), undefined);
  assert.equal(cleanHint("Billing", ["billing"]), undefined);
  assert.equal(cleanHint("Billing service", ["billing-service"]), undefined);
  assert.equal(cleanHint("Handles billing for the app"), "Handles billing for the app.");
  const sentence = "Handles billing for the app. " + "More words about the details of it. ".repeat(6);
  assert.equal(cleanHint(sentence), "Handles billing for the app.");
  assert.notEqual(cleanHint("A tool for e.g. stuff and " + "things ".repeat(20)), "A tool for e.g.");
  const run = cleanHint("word ".repeat(60))!;
  assert.ok(run.length <= 120 && run.endsWith("…"), run);
});

test("readmeHint: title, first prose paragraph, no badges, fences or front matter", () => {
  const md = "---\ntitle: x\n---\n# My *Lib*\n\n[![ci](a.svg)](b)\n\n```\nnot this\n```\n\nFast **parsing** of [things](http://x), <b>safely</b>.\nSecond line.\n\n- bullet\n";
  assert.deepEqual(readmeHint(md), { title: "My Lib", text: "Fast parsing of things, safely. Second line." });
  assert.deepEqual(readmeHint("Setext\n======\n\nBody text here.\n"), { title: "Setext", text: "Body text here." });
  assert.deepEqual(readmeHint("# Only title\n"), { title: "Only title" });
});

const file = (path: string, pkg = "app", exports?: string[], loc = 10) => ({ path, pkg, loc, ...(exports ? { exports } : {}) });
const facts = (over: Partial<Facts> & { files: Facts["files"] }): Facts => ({
  version: 1, repo: "t", sha: null, github: null, stores: [], storeUses: [], storeFields: [],
  packages: [{ id: "app", name: "app", dir: "", kind: "web", deps: [] }],
  imports: [], externals: [], unresolved: [], services: [], serviceUses: [], endpoints: [], calls: [], pages: [], routeFiles: [], ...over,
});

test("describe: package description beats README, README beats exports, exports beat the count", () => {
  const files = [file("src/a.ts", "app", ["alpha"]), file("src/b.ts", "app", ["beta"])];
  const paths = files.map((f) => f.path);
  const readmes = [{ dir: "src", text: "Readme text about src stuff" }];
  const pkg = { id: "app", name: "app", dir: "", kind: "web" as const, deps: [], description: "Package description text" };
  assert.equal(describe(paths, facts({ files, readmes, packages: [pkg] }), "Box"), "Package description text.");
  assert.equal(describe(paths, facts({ files, readmes }), "Box"), "Readme text about src stuff.");
  assert.equal(describe(paths, facts({ files }), "Box"), "Exports alpha and beta.");
  assert.equal(describe(paths, facts({ files: files.map((f) => ({ ...f, exports: undefined })) }), "Box"), "2 files in src/.");
  assert.equal(describe(["a.ts"], facts({ files: [file("a.ts")] }), "Box"), "1 file.");
});

test("describe: exports ranked by importers, with 'and N more'", () => {
  const files = ["a", "b", "c", "d", "e"].map((n) => file(`src/${n}.ts`, "app", [`${n}1`, `${n}2`]));
  const imp = (from: string, to: string) => ({ from, to, line: 1, kind: "static" as const });
  const imports = [imp("x.ts", "src/c.ts"), imp("y.ts", "src/c.ts"), imp("x.ts", "src/b.ts")];
  const f = facts({ files: [...files, file("x.ts"), file("y.ts")], imports });
  assert.equal(describe(files.map((x) => x.path), f, "Box"), "Exports c1, c2, b1 and 7 more.");
});

test("describe: a README only describes a box that covers its whole folder", () => {
  const files = [file("src/x/a.ts"), file("src/x/b.ts"), file("top.ts"), file("src/y.ts")];
  const readmes = [{ dir: "", text: "Root readme says things" }, { dir: "src/x", text: "The x folder does things" }];
  const f = facts({ files, readmes });
  assert.equal(describe(["src/x/a.ts", "src/x/b.ts"], f, "X box"), "The x folder does things.");
  assert.equal(describe(["src/x/a.ts"], f, "A"), "1 file in src/x/.");
  assert.equal(describe(["top.ts", "src/y.ts"], f, "Other"), "2 files.");
  assert.equal(describe(files.map((x) => x.path), f, "All"), "Root readme says things.");
});

test("describeBoxes keeps existing summaries and is idempotent", () => {
  const files = ["src/x/a.ts", "src/x/b.ts", "src/y/c.ts", "src/y/d.ts", "src/z/e.ts"].map((p) => file(p));
  const f = facts({ files });
  const g: Grouping = {
    version: 1, summary: "Root sentence.", children: [
      { id: "x", name: "X", summary: "Files in src/x/.", files: ["src/x/**"] },
      { id: "y", name: "Y", summary: "Parts that do y.", files: ["src/y/**"], split: [{ id: "y1", name: "A to C", summary: "", range: ["a", "c"] } as never] },
      { id: "z", name: "Z", summary: "", files: ["src/z/**"] },
    ],
  };
  const leafOf = new Map(files.map((x) => [x.path, x.path.split("/")[1]]));
  const once = describeBoxes(g, f, leafOf);
  assert.equal(once.summary, "Root sentence.");
  assert.deepEqual(once.children.map((c) => c.summary), ["Files in src/x/.", "Parts that do y.", "1 file in src/z/."]);
  assert.deepEqual(once.children[1].split, g.children[1].split);
  assert.deepEqual(describeBoxes(once, f, leafOf), once);
});

test("default grouping on the described fixture: readable names and one-line summaries", () => {
  const facts = analyze(fileURLToPath(new URL("./fixtures/described", import.meta.url)));
  const g = defaultGrouping(facts);
  assert.deepEqual(defaultGrouping(facts), g);
  const all: GroupNode[] = [];
  const walk = (n: GroupNode) => { all.push(n); n.children?.forEach(walk); };
  g.children.forEach(walk);
  const by = (name: string) => all.find((n) => n.name === name)!;
  assert.equal(by("Core").summary, "Shared money and date helpers for the apps.");
  assert.equal(by("Web").summary, "Web app in apps/web.");
  for (const n of ["Utilities", "Marketing", "Database", "Auth"]) assert.ok(by(n), n);
  assert.equal(by("Auth").summary, "Sign-in and session handling for the web app.");
  assert.ok(by("Utilities").summary.startsWith("Exports "));
  for (const n of all) assert.ok(n.summary && n.summary.length <= 120 && !n.summary.includes("\n"), `${n.name}: ${n.summary}`);
  assert.deepEqual(assign(g, facts).errors, []);
  assert.doesNotThrow(() => Grouping.parse(g));
});
