// `build --title` names the map instead of the folder; REPOLADDER_BRAND_NAME renames the page shell's product name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const fixture = (n: string) => fileURLToPath(new URL(`fixtures/${n}`, import.meta.url));
const tmp = () => mkdtempSync(join(tmpdir(), "cw-title-"));

const build = (extra: string[], env: Record<string, string> = {}) => {
  const out = tmp();
  return new Promise<{ code: number; stderr: string; out: string }>((res) =>
    execFile(process.execPath, [cli, "build", fixture("basic-app"), "--fresh", "--default", "--out", out, ...extra],
      { env: { ...process.env, REPOLADDER_NO_USAGE: "1", REPOLADDER_CONFIG_DIR: tmp(), ...env } },
      (err, _o, stderr) => res({ code: err ? (err.code as number) : 0, stderr, out })));
};

test("--title names the map in the page, the model and nothing on disk but the model", async () => {
  const r = await build(["--title", "Acme & Co"]);
  assert.equal(r.code, 0);
  const html = readFileSync(join(r.out, "diagram.html"), "utf8");
  assert.match(html, /<title>Acme &amp; Co architecture<\/title>/);
  assert.match(html, /<h1>Acme &amp; Co<\/h1>/);
  const model = JSON.parse(readFileSync(join(r.out, "model.json"), "utf8"));
  assert.equal(model.repo, "Acme & Co");
  assert.equal(model.nodes.root.name, "Acme & Co");
  assert.equal(JSON.parse(readFileSync(join(r.out, "facts.json"), "utf8")).repo, "basic-app");
});

test("without --title the header shows the folder name", async () => {
  const r = await build([]);
  assert.equal(r.code, 0);
  assert.match(readFileSync(join(r.out, "diagram.html"), "utf8"), /<h1>basic-app<\/h1>/);
});

test("--title with no value or a blank one is INVALID_TITLE and writes no diagram", async () => {
  for (const extra of [["--title"], ["--title", "  "]]) {
    const r = await build(extra);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /INVALID_TITLE/);
    assert.equal(existsSync(join(r.out, "diagram.html")), false);
  }
});

test("REPOLADDER_BRAND_NAME renames the footer and the header mark, and unset changes nothing", async () => {
  const named = readFileSync(join((await build([], { REPOLADDER_BRAND_NAME: "Acme" })).out, "diagram.html"), "utf8");
  assert.match(named, /Made with Acme<\/a>/);
  assert.match(named, /aria-label="Acme"/);
  const plain = readFileSync(join((await build([], { REPOLADDER_BRAND_NAME: "" })).out, "diagram.html"), "utf8");
  assert.match(plain, /Made with RepoLadder<\/a>/);
});
