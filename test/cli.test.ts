// The CLI's top-level commands as a source run: help and version exit 0, an unknown or missing command exits 1 (#313).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: { ...process.env, REPOLADDER_NO_USAGE: "1" } });

test("--help, -h and help print the usage to stdout and exit 0", () => {
  for (const a of ["--help", "-h", "help"]) {
    const r = run(a);
    assert.equal(r.status, 0, a);
    assert.match(r.stdout, /usage: repoladder/, a);
  }
});

test("--version and -v print one version line and exit 0", () => {
  for (const a of ["--version", "-v"]) {
    const r = run(a);
    assert.equal(r.status, 0, a);
    assert.match(r.stdout, /^[0-9A-Za-z.+-]{1,24}\n$/, a);
  }
});

test("no command, or an unknown one, prints the usage to stderr and exits 1", () => {
  for (const a of [[], ["nope"]]) {
    const r = run(...a);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /usage: repoladder/);
  }
});

// #428: progress lines on stderr for `build`
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const basic = fileURLToPath(new URL("./fixtures/basic-app", import.meta.url));
function build(extra: string[], env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "rl-progress-"));
  const r = spawnSync(process.execPath, [cli, "build", basic, "--out", dir, "--default", ...extra], { encoding: "utf8", env: { ...process.env, REPOLADDER_NO_USAGE: "1", ...env } });
  const html = readFileSync(join(dir, "diagram.html"), "utf8"), model = readFileSync(join(dir, "model.json"), "utf8");
  rmSync(dir, { recursive: true, force: true });
  return { r, html, model };
}
const progressLines = (s: string) => s.split("\n").filter((l) => l.startsWith("[build] "));

test("build prints [build] stage lines on stderr and leaves stdout alone", () => {
  const { r } = build([]);
  assert.equal(r.status, 0, r.stderr);
  const lines = progressLines(r.stderr);
  assert.ok(lines.some((l) => /layout.*(:|…| done in )/.test(l)));
  assert.ok(lines.some((l) => / done in /.test(l)));
  for (const w of ["reading files", "parsing files", "resolving imports", "grouping", "building the model", "layout", "checking the layout", "rendering the page", "writing files"]) {
    assert.ok(lines.some((l) => l.includes(w)), w);
  }
  const out = r.stdout.trim().split("\n");
  assert.match(out.at(-1)!, /^BUILD_OK /);
  assert.ok(!out.some((l) => l.startsWith("[build]")));
});

test("--quiet prints no [build] line and changes no output", () => {
  const loud = build([]), quiet = build(["--quiet"]);
  assert.equal(quiet.r.status, 0);
  assert.equal(progressLines(quiet.r.stderr).length, 0);
  const strip = (s: string) => s.replace(/\/rl-progress-\w+/g, "").replace(/ in \d+ms/, "");
  assert.equal(strip(quiet.r.stdout), strip(loud.r.stdout));
  assert.equal(quiet.model, loud.model);
  assert.equal(quiet.html, loud.html);
});

test("REPOLADDER_TIMINGS=1 keeps the TIMING lines beside the progress lines", () => {
  const { r } = build([], { REPOLADDER_TIMINGS: "1" });
  assert.match(r.stderr, /^TIMING /m);
  assert.match(r.stderr, /^\[build\] /m);
});

test("--help lists --quiet", () => {
  assert.match(run("--help").stdout, /--quiet/);
});

test("build prints a CONNECTIONS line before BUILD_OK and still succeeds (#452)", () => {
  const out = join(mkdtempSync(join(tmpdir(), "rl-cov-")), "out");
  const r = run("build", fileURLToPath(new URL("./fixtures/tourapp", import.meta.url)), "--default", "--out", out);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^CONNECTIONS [\d,]+ connections, \d+ undrawn$/m);
  assert.ok(r.stdout.indexOf("CONNECTIONS") < r.stdout.indexOf("BUILD_OK"));
  assert.ok(JSON.parse(readFileSync(join(out, "lint.json"), "utf8")).coverage.total > 0);
});

// #521: --profile
test("build --profile hosted records the profile and prints no file-arrow warnings; --profile full equals the default", () => {
  const def = build([]), full = build(["--profile", "full"]), hosted = build(["--profile", "hosted"]);
  assert.equal(hosted.r.status, 0);
  assert.equal(full.model, def.model);
  assert.equal(full.html, def.html);
  assert.equal(JSON.parse(hosted.model).profile, "hosted");
  assert.ok(!/WARN/.test(hosted.r.stdout));
  assert.ok(!("profile" in JSON.parse(def.model)));
});

test("build --profile nope exits 2 with INVALID_OPTIONS on stderr", () => {
  for (const extra of [["--profile", "nope"], ["--profile"]]) {
    const dir = mkdtempSync(join(tmpdir(), "rl-profile-"));
    const r = spawnSync(process.execPath, [cli, "build", basic, "--out", dir, "--default", ...extra], { encoding: "utf8", env: { ...process.env, REPOLADDER_NO_USAGE: "1" } });
    rmSync(dir, { recursive: true, force: true });
    assert.equal(r.status, 2, extra.join(" "));
    assert.match(r.stderr, /INVALID_OPTIONS/);
  }
});
