import { test } from "node:test";
import assert from "node:assert/strict";
import { BOX_BUDGET, EDGE_BUDGET, commonDir, cutWords, hubOf, nameWords, splitOverBudget } from "../src/model/budgetsplit.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import type { Facts, GroupNode, Grouping } from "../src/model/schema.ts";

const facts = (files: string[], imports: [string, string][] = []): Facts => ({
  version: 1, repo: "t", sha: null, github: null, stores: [], storeUses: [], storeFields: [],
  packages: [{ id: "app", name: "app", dir: "", kind: "web", deps: [] }],
  files: files.map((path) => ({ path, pkg: "app", loc: 10 })),
  imports: imports.map(([from, to]) => ({ from, to, line: 1, kind: "static" as const })),
  externals: [], unresolved: [], services: [], serviceUses: [], endpoints: [], calls: [], pages: [], routeFiles: [],
});
const leaf = (id: string, ...files: string[]): GroupNode => ({ id, name: id.charAt(0).toUpperCase() + id.slice(1), summary: "", files });
const grouping = (...children: GroupNode[]): Grouping => ({ version: 1, summary: "t", children });
const find = (ns: GroupNode[], id: string): GroupNode | undefined => {
  for (const n of ns) {
    if (n.id === id) return n;
    const x = n.children && find(n.children, id);
    if (x) return x;
  }
};
const all = (ns: GroupNode[]): GroupNode[] => ns.flatMap((n) => [n, ...all(n.children ?? [])]);

/** Every board within budget, every group with 2+ children, every file in exactly one leaf. */
function assertWithinBudget(g: Grouping, f: Facts) {
  const a = assign(g, f);
  assert.deepEqual(a.errors, []);
  const m = buildModel(f, g, a.leafOf);
  for (const [id, b] of Object.entries(m.boards)) {
    if (!m.nodes[id]) continue;
    assert.ok(b.nodes.length <= BOX_BUDGET, `${id}: ${b.nodes.length} boxes`);
    assert.ok(b.edges.filter((e) => e.major).length <= EDGE_BUDGET, `${id}: too many arrows`);
  }
  for (const n of all(g.children)) if (n.children) assert.ok(n.children.length >= 2, `${n.id} has a single child`);
}

// three small neighbours so the split leaf is not alone at the top
const others = ["src/x/x1.ts", "src/y/y1.ts", "src/z/z1.ts"];
const base = (feat: string[]) => grouping(leaf("feat", "src/feat/**"), leaf("x", "src/x/**"), leaf("y", "src/y/**"), leaf("z", "src/z/**"));

test("budget split rule 1: a crowded leaf opens by subfolder, each part a folder glob", () => {
  const files = ["a", "b", "c"].flatMap((d) => Array.from({ length: 5 }, (_, i) => `src/feat/${d}/f${d}${i}.ts`));
  const f = facts([...files, ...others]);
  const g = splitOverBudget(base(files), f);
  const feat = find(g.children, "feat")!;
  assert.deepEqual(feat.children!.map((c) => [c.id, c.name, c.files]), [
    ["feat-a", "A", ["src/feat/a/**"]], ["feat-b", "B", ["src/feat/b/**"]], ["feat-c", "C", ["src/feat/c/**"]],
  ]);
  assertWithinBudget(g, f);
});

test("budget split rule 2: a flat leaf splits by filename prefix", () => {
  const files = ["billing", "kiosk", "chat"].flatMap((k) => ["Api", "Cache", "Panel", "Store", "View"].map((s) => `src/feat/${k}${s}.ts`));
  const f = facts([...files, ...others]);
  const g = splitOverBudget(base(files), f);
  const feat = find(g.children, "feat")!;
  assert.deepEqual(feat.children!.map((c) => [c.id, c.name, c.files]), [
    ["feat-billing", "Billing", ["src/feat/billing*"]], ["feat-chat", "Chat", ["src/feat/chat*"]], ["feat-kiosk", "Kiosk", ["src/feat/kiosk*"]],
  ]);
  assertWithinBudget(g, f);
});

test("budget split rule 2b: a word the names share anywhere groups them (DigitalCheckInPage, QrCheckInPage)", () => {
  assert.deepEqual(nameWords("WaitingRoomCheckInPage"), ["waiting", "room", "check"]);
  assert.deepEqual(nameWords("VsEnvoyPage"), ["vs", "envoy"]);
  const files = [
    ...["Digital", "Qr", "Therapy", "Waiting", "Kiosk"].map((w) => `src/feat/${w}CheckInPage.tsx`),
    ...["Envoy", "Lobby", "Swiped", "Reception", "Front"].map((w) => `src/feat/Vs${w}Page.tsx`),
    ...["Branding", "Customers", "Privacy", "Terms", "Missing"].map((w) => `src/feat/${w}Page.tsx`),
  ];
  const f = facts([...files, ...others]);
  const g = splitOverBudget(base(files), f);
  const feat = find(g.children, "feat")!;
  assert.deepEqual(feat.children!.map((c) => c.name), ["Check", "Vs", "Files in feat/"]);
  assertWithinBudget(g, f);
});

test("budget split rule 3: files that import each other stay together, named after the most-imported file", () => {
  const words = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo", "lima", "mike", "november", "oscar"];
  const files = words.map((w) => `src/feat/${w}.ts`);
  const hubs = ["src/feat/alpha.ts", "src/feat/foxtrot.ts", "src/feat/kilo.ts"];
  const imports: [string, string][] = [];
  for (let c = 0; c < 3; c++) {
    const group = files.slice(c * 5, c * 5 + 5);
    for (const x of group.slice(1)) imports.push([x, group[0]]);
    imports.push([group[1], group[2]], [group[3], group[4]]);
  }
  const f = facts([...files, ...others], imports);
  assert.equal(hubOf(files.slice(0, 5), f.imports), hubs[0]);
  const g = splitOverBudget(base(files), f);
  const feat = find(g.children, "feat")!;
  assert.deepEqual(feat.children!.map((c) => c.name).sort(), ["alpha hub", "foxtrot hub", "kilo hub"]);
  assert.deepEqual(find(g.children, "feat-alpha")!.files, files.slice(0, 5));
  assertWithinBudget(g, f);
});

test("budget split rule 3: clusters no file dominates are named after their folder, not their first file (#283)", () => {
  const words = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo", "lima", "mike", "november", "oscar"];
  const files = words.map((w) => `src/feat/${w}.ts`);
  const imports: [string, string][] = [];
  // chains a -> b -> c -> d -> e: each file imported by one other, so none has a majority
  for (let c = 0; c < 3; c++) for (let i = 0; i < 4; i++) imports.push([files[c * 5 + i], files[c * 5 + i + 1]]);
  const f = facts([...files, ...others], imports);
  const g = splitOverBudget(base(files), f);
  const feat = find(g.children, "feat")!;
  // the folder is the parent's name too: " core", then numbered among siblings
  assert.deepEqual(feat.children!.map((c) => c.name), ["Feat core", "Feat core 2", "Feat core 3"]);
  for (const c of feat.children!) assert.match(c.summary, /in src\/feat\/\.$/);
  // ids still come from hubOf, so they stay stable
  assert.equal(new Set(feat.children!.map((c) => c.id)).size, 3);
  assertWithinBudget(g, f);
});

test("budget split rule 3: zod-like locales whose hubs say nothing (index.ts) are named Locales, never after one locale (#283)", () => {
  const locales = ["ar", "az", "be", "ca", "cs", "de", "en", "es", "fa", "fi", "fr", "he"];
  const hubs = ["index", "types", "util"];
  const files = [...locales, ...hubs].map((l) => `src/v4/locales/${l}.ts`);
  const imports: [string, string][] = [];
  // three clusters, each 4 locales importing one generic file, which every locale imports from core too
  for (let c = 0; c < 3; c++) for (const l of locales.slice(c * 4, c * 4 + 4)) imports.push([`src/v4/locales/${l}.ts`, `src/v4/locales/${hubs[c]}.ts`], [`src/v4/locales/${l}.ts`, "src/v4/core/util.ts"]);
  const f = facts([...files, "src/v4/core/util.ts", ...others], imports);
  const g = splitOverBudget(grouping(leaf("locales", "src/v4/locales/**"), leaf("core", "src/v4/core/**"), leaf("x", "src/x/**"), leaf("y", "src/y/**"), leaf("z", "src/z/**")), f);
  const parts = find(g.children, "locales")!.children!;
  assert.deepEqual(parts.map((c) => c.name), ["Locales core", "Locales core 2", "Locales core 3"]);
  for (const c of parts) assert.match(c.summary, /in src\/v4\/locales\/\.$/);
});

test("budget split: a group with too many boxes gathers children by shared name, then by imports", () => {
  const names = ["billing-api", "billing-ui", "billing-jobs", "alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo"];
  const files = names.flatMap((n) => [1, 2].map((i) => `src/${n}/f${i}.ts`));
  const f = facts(files);
  const g = grouping({ id: "app", name: "App", summary: "", children: names.map((n) => ({ id: n, name: n.replace("-", " "), summary: "", files: [`src/${n}/**`] })) }, leaf("x", "nothing/**"));
  const out = splitOverBudget(g, f);
  const app = find(out.children, "app")!;
  const billing = app.children!.find((c) => c.name === "Billing")!;
  assert.deepEqual(billing.children!.map((c) => c.id), ["billing-api", "billing-ui", "billing-jobs"]);
  // the original groups keep their ids
  for (const n of names) assert.ok(find(out.children, n), n);
  assertWithinBudget(out, f);
});

test("budget split: a board the build found crowded (names too small) is split once more", () => {
  const files = ["a", "b", "c"].flatMap((d) => Array.from({ length: 3 }, (_, i) => `src/feat/${d}/f${d}${i}.ts`));
  const f = facts([...files, ...others]);
  const g = base(files);
  assert.deepEqual(splitOverBudget(g, f), g); // 9 boxes: within budget
  assert.deepEqual(find(splitOverBudget(g, f, ["feat"]).children, "feat")!.children!.map((c) => c.id), ["feat-a", "feat-b", "feat-c"]);
});

test("budget split: a leaf that would open to fewer than 3 boxes is left alone", () => {
  const files = ["a", "b"].flatMap((d) => Array.from({ length: 8 }, (_, i) => `src/feat/${d}/f${d}${i}.ts`));
  const f = facts(files);
  const g = grouping(leaf("feat", "src/feat/**"));
  assert.deepEqual(splitOverBudget(g, f), g);
});

test("default grouping keeps every board within budget, deterministically, and splitting again changes nothing", () => {
  const files: string[] = [];
  const imports: [string, string][] = [];
  for (const d of ["pages", "components", "utils"]) {
    for (let i = 0; i < 30; i++) files.push(`src/${d}/${d}${String.fromCharCode(65 + (i % 6))}${i}.ts`);
  }
  for (let i = 1; i < files.length; i++) if (i % 7) imports.push([files[i], files[i - 1]]);
  const f = facts(files, imports);
  const g = defaultGrouping(f);
  assertWithinBudget(g, f);
  assert.deepEqual(defaultGrouping(f), g);
  assert.deepEqual(splitOverBudget(g, f), g);
});

test("budget split: gathering keeps at least 4 parts and never lets one gathered group hold most of the files", () => {
  // every part imports the big core: one import cluster would swallow the whole board
  const names = ["core", "alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo", "lima", "mike"];
  const files = names.flatMap((n) => Array.from({ length: n === "core" ? 30 : 2 }, (_, i) => `src/${n}/f${i}.ts`));
  const imports: [string, string][] = names.slice(1).map((n) => [`src/${n}/f0.ts`, "src/core/f0.ts"]);
  const f = facts(files, imports);
  const g = grouping({ id: "app", name: "App", summary: "", children: names.map((n) => ({ id: n, name: n, summary: "", files: [`src/${n}/**`] })) }, leaf("x", "nothing/**"));
  const out = splitOverBudget(g, f);
  const app = find(out.children, "app")!;
  const a = assign(out, f);
  const size = (n: GroupNode) => {
    const ids = new Set(all([n]).map((x) => x.id));
    return [...a.leafOf.values()].filter((id) => ids.has(id)).length;
  };
  const total = size(app);
  assert.ok(app.children!.length >= 4, `${app.children!.length} parts`);
  for (const c of app.children!) if (!names.includes(c.id)) assert.ok(size(c) <= 0.6 * total, `${c.name} holds ${size(c)}/${total}`);
  assert.ok(app.children!.some((c) => c.id === "core"), "the big part keeps its own box");
  // (core's own 30 unrelated files can't split, so only the gathered board is checked)
  assert.ok(buildModel(f, out, a.leafOf).boards.app.nodes.length <= BOX_BUDGET);
});

test("budget split: a leaf whose split would leave one part with most of the files stays as it is", () => {
  // 13 unrelated loose files and a 2-file subfolder: the only split is 2 + 13
  const loose = ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "a", "s", "d"].map((c, i) => `src/feat/${c}${"xyz"[i % 3]}${c}.ts`);
  const files = [...loose, "src/feat/sub/a.ts", "src/feat/sub/b.ts"];
  const f = facts([...files, ...others]);
  const g = base(files);
  assert.deepEqual(splitOverBudget(g, f), g);
});

test("budget split fallback (#224): a flat folder with no seam splits into alphabetical ranges, hiding no file", () => {
  // zod's locales: 60 files that share no folder, prefix, word or import
  const codes = Array.from({ length: 60 }, (_, i) => `${"abcdefghijklmnopqrstuvwxyz"[Math.floor(i / 6)]}${"bdfhjz"[i % 6]}`);
  const files = codes.map((c) => `src/feat/${c}.ts`);
  const f = facts([...files, ...others]);
  const g = splitOverBudget(base(files), f);
  assertWithinBudget(g, f);
  const feat = find(g.children, "feat")!;
  // anchored ranges (#464): uneven sizes, none over today's even size (8), count within the room (9)
  assert.ok(feat.children!.length >= 3 && feat.children!.length <= 9, `${feat.children!.length} ranges`);
  const leafOf = [...assign(g, f).leafOf.values()];
  const sizes = feat.children!.map((c) => leafOf.filter((id) => id === c.id).length);
  assert.equal(sizes.reduce((x, y) => x + y, 0), 60);
  assert.ok(Math.max(...sizes) <= 8, `too big: ${sizes}`);
  // names are first – last, in alphabetical order, and each range starts after the one before
  const names = feat.children!.map((c) => c.name.split(" – "));
  assert.equal(names[0][0], "ab");
  assert.equal(names[names.length - 1][1], "jz");
  for (let i = 1; i < names.length; i++) assert.ok(names[i - 1][1] < names[i][0], `${names[i - 1]} before ${names[i]}`);
  for (const c of feat.children!) assert.match(c.summary, /^Files \w+ to \w+ in src\/feat\/, split alphabetically\.$/);
  assert.deepEqual(splitOverBudget(g, f), g);
});

test("budget split fallback: one-file folders are named by their folder ('auth – error')", () => {
  const names = ["auth", "cookies", "cors", "downloads", "ejs", "error", "markdown", "mvc", "params", "redis", "route-map", "search", "session", "static", "vhost", "web-service"];
  const files = names.map((n) => `src/feat/${n}/index.js`);
  const f = facts([...files, ...others]);
  const g = splitOverBudget(base(files), f);
  assertWithinBudget(g, f);
  assert.deepEqual(find(g.children, "feat")!.children!.map((c) => c.name), ["auth – error", "markdown – route-map", "search – web-service"]);
});

test("cutWords keeps whole words", () => {
  assert.equal(cutWords("mobileProvisionTherapist"), "mobileProvision…");
  assert.equal(cutWords("locales-coverage-description"), "locales-coverage-…");
  assert.equal(cutWords("short"), "short");
});

test("commonDir", () => {
  assert.equal(commonDir(["a/b/c.ts", "a/b/d/e.ts"]), "a/b");
  assert.equal(commonDir(["a.ts", "b/c.ts"]), "");
});
