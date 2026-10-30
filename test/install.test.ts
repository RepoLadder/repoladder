import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { npmInstall, RUNTIME_DEPS } from "../src/install.ts";

const plugin = new URL("../plugin/", import.meta.url).pathname;

test("the fallback install is the pinned, script-free one from the lockfile", () => {
  const { cmd, args, opts } = npmInstall(plugin, "linux");
  assert.equal(cmd, "npm");
  assert.equal(args[0], "ci");
  assert.ok(args.includes("--ignore-scripts") && args.includes("--omit=dev"));
  assert.equal(opts.shell, false);
});

test("on Windows npm runs through a shell (npm.cmd)", () => {
  assert.equal(npmInstall(plugin, "win32").opts.shell, true);
});

test("without a lockfile it falls back to npm install", () => {
  assert.equal(npmInstall(mkdtempSync(join(tmpdir(), "cw-")), "linux").args[0], "install");
});

// Claude Code installs a copied plugin's deps only from a lockfile of registry packages pinned
// to exact versions that matches package.json, with no install scripts and no overrides.
test("plugin/package-lock.json meets Claude Code's automatic dependency install rules", () => {
  const pkg = JSON.parse(readFileSync(join(plugin, "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(join(plugin, "package-lock.json"), "utf8"));
  assert.ok([2, 3].includes(lock.lockfileVersion));
  assert.equal(pkg.overrides, undefined);
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), [...RUNTIME_DEPS].sort());
  assert.deepEqual(lock.packages[""].dependencies, pkg.dependencies);
  for (const [name, range] of Object.entries(pkg.dependencies as Record<string, string>)) {
    assert.match(range, /^\d+\.\d+\.\d+$/, `${name} is pinned to an exact version`);
  }
  for (const [path, p] of Object.entries(lock.packages as Record<string, { resolved?: string; hasInstallScript?: boolean; dev?: boolean }>)) {
    if (!path) continue;
    assert.match(p.resolved ?? "", /^https:\/\/registry\.npmjs\.org\//, `${path} comes from the registry over https`);
    assert.ok(!p.hasInstallScript, `${path} needs no install script`);
  }
});

// installcheck: bounded wait for the deps Claude Code installs after `claude plugin install` returns
import { mkdirSync, writeFileSync } from "node:fs";
import { diagnoseInstall, waitForDeps } from "../scripts/installwait.ts";

function fakeWait(outs: string[]) {
  let t = 0, i = 0;
  const sleeps: number[] = [];
  const check = () => outs[Math.min(i++, outs.length - 1)];
  return { check, sleeps, opts: { sleep: (ms: number) => { sleeps.push(ms); t += ms; }, now: () => t }, calls: () => i };
}

test("waitForDeps: an immediate PREFLIGHT_OK never sleeps", () => {
  const f = fakeWait(["PREFLIGHT_OK"]);
  const r = waitForDeps(f.check, f.opts);
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 1);
  assert.equal(f.sleeps.length, 0);
});

test("waitForDeps: passes once the deps arrive", () => {
  const f = fakeWait(["PREFLIGHT_NEEDS_INSTALL missing=typescript", "PREFLIGHT_NEEDS_INSTALL missing=typescript", "PREFLIGHT_OK"]);
  const r = waitForDeps(f.check, f.opts);
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 3);
  assert.deepEqual(f.sleeps, [10_000, 10_000]);
  assert.equal(r.waitedMs, 20_000);
});

test("waitForDeps: gives up after the last retry", () => {
  const f = fakeWait(["PREFLIGHT_NEEDS_INSTALL missing=typescript"]);
  const r = waitForDeps(f.check, f.opts);
  assert.equal(r.ok, false);
  assert.equal(f.calls(), 6);
  assert.deepEqual(f.sleeps, [10_000, 10_000, 10_000, 10_000, 10_000]);
});

test("waitForDeps: any other output fails at once", () => {
  const f = fakeWait(["PREFLIGHT_NODE_TOO_OLD node=v18"]);
  const r = waitForDeps(f.check, f.opts);
  assert.equal(r.ok, false);
  assert.equal(f.calls(), 1);
  assert.equal(f.sleeps.length, 0);
});

test("diagnoseInstall reports what is present and missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "cw-diag-"));
  writeFileSync(join(dir, "package.json"), "{}");
  mkdirSync(join(dir, "node_modules/typescript"), { recursive: true });
  writeFileSync(join(dir, "node_modules/typescript/package.json"), "{}");
  const out = diagnoseInstall(dir, join(dir, "no-config")).join("\n");
  assert.match(out, /node_modules\/typescript: present/);
  assert.match(out, /node_modules\/@terrastruct\/d2: MISSING/);
  assert.match(out, /package-lock\.json: MISSING/);
  assert.match(out, /no Claude log files found/);
});

test("diagnoseInstall never throws on a nonexistent install path", () => {
  const out = diagnoseInstall(join(tmpdir(), "cw-does-not-exist-372"), join(tmpdir(), "cw-nope-372")).join("\n");
  assert.match(out, /exists=false/);
});

test("diagnoseInstall prints Claude log files", () => {
  const cfg = mkdtempSync(join(tmpdir(), "cw-cfg-"));
  mkdirSync(join(cfg, "logs"));
  writeFileSync(join(cfg, "logs/x.log"), "npm ci failed hard\n");
  const out = diagnoseInstall(join(cfg, "none"), cfg).join("\n");
  assert.match(out, /--- logs[\\/]x\.log ---/);
  assert.match(out, /npm ci failed hard/);
});
