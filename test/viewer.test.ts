import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import vm from "node:vm";
import { buildViewer, viewerAssets } from "../src/build/viewer.ts";

test("viewer bundles to a deterministic IIFE exposing repoladder.start", () => {
  const a = buildViewer(), b = buildViewer();
  assert.equal(a.js, b.js);
  assert.equal(a.css, b.css);
  assert.deepEqual(viewerAssets(), a);
  const ctx: { repoladder?: { start?: unknown } } = {};
  vm.runInNewContext(`${a.js};this.repoladder=repoladder`, ctx);
  assert.equal(typeof ctx.repoladder?.start, "function");
  // Inlined into a <script>/<style>, so neither may close its own tag early.
  assert.ok(!/<\/script/i.test(a.js));
  assert.ok(!/<\/style/i.test(a.css));
  assert.ok(a.css.includes("--ground") && a.css.includes("prefers-color-scheme:dark"));
});

test("viewer modules stay small", () => {
  const dir = new URL("../src/viewer/", import.meta.url);
  for (const sub of ["", "ask/"]) {
    for (const f of readdirSync(new URL(sub, dir)).filter((f) => f.endsWith(".ts"))) {
      const lines = readFileSync(new URL(sub + f, dir), "utf8").split("\n").length;
      assert.ok(lines <= 220, `${sub}${f} has ${lines} lines`);
    }
  }
});

// rl#455 / rl#460: the key follows the Tours card at the panel's one 24px gap, not a special-case margin.
test("the key sits a panel gap below the Tours card", () => {
  const css = buildViewer().css.replace(/\s+/g, "");
  assert.match(css, /#details\{[^}]*gap:24px/);
  assert.ok(!css.includes("#details>.walk+.legend"));
});

// A merge that drops a "}" silently swallows every rule after it, so check the braces balance.
test("viewer stylesheets have balanced braces", () => {
  for (const f of readdirSync(new URL("../src/viewer/", import.meta.url)).filter((n) => n.endsWith(".css"))) {
    const css = readFileSync(new URL(`../src/viewer/${f}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    let depth = 0;
    for (const c of css) {
      if (c === "{") depth++;
      if (c === "}") depth--;
      assert.ok(depth >= 0 && depth <= 2, `${f}: unbalanced braces`);
    }
    assert.equal(depth, 0, `${f}: unclosed rule`);
  }
});
