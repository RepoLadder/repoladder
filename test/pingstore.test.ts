// The usage ping end to end: the CLI sends, the real worker counts into the real schema (node:sqlite).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION_RE } from "../server/ping/worker.ts";
import { startPingStore } from "./pingstore.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const fixture = fileURLToPath(new URL("fixtures/basic-app", import.meta.url));
const freshEnv = () => ({ REPOLADDER_CONFIG_DIR: mkdtempSync(join(tmpdir(), "rl-ping-")) });
const tmp = () => mkdtempSync(join(tmpdir(), "rl-ping-out-"));

const node = (args: string[], env: Record<string, string>) =>
  new Promise<{ code: number; stdout: string }>((res) =>
    execFile(process.execPath, [cli, ...args], { env: { ...process.env, DO_NOT_TRACK: "", REPOLADDER_NO_USAGE: "", ...env } }, (err, stdout) =>
      res({ code: err ? (err.code as number) : 0, stdout })));

type Row = Record<string, unknown>;
const all = (db: { prepare(s: string): { all(): unknown[] } }, sql: string) => db.prepare(sql).all() as Row[];

test("consent yes: a build lands one runs row and one installs row; a second build bumps both", async () => {
  const store = await startPingStore();
  try {
    const env = { ...freshEnv(), REPOLADDER_PING_URL: store.url };
    const out = tmp();
    await node(["usage", "yes"], env);
    assert.equal((await node(["build", fixture, "--fresh", "--default", "--out", out], env)).code, 0);
    const runs = all(store.db, "SELECT * FROM runs");
    assert.equal(runs.length, 1);
    assert.deepEqual({ ok: runs[0].ok, error: runs[0].error, size: runs[0].size, mode: runs[0].mode, n: runs[0].n }, { ok: 1, error: "", size: "1-49", mode: "default", n: 1 });
    assert.match(String(runs[0].version), VERSION_RE);
    assert.match(String(runs[0].day), /^\d{4}-\d{2}-\d{2}$/);
    const installs = all(store.db, "SELECT * FROM installs");
    assert.equal(installs.length, 1);
    assert.equal(installs[0].id, JSON.parse(readFileSync(join(env.REPOLADDER_CONFIG_DIR, "usage.json"), "utf8")).id);
    assert.equal(installs[0].runs, 1);
    assert.equal(installs[0].first_day, installs[0].last_day);

    assert.equal((await node(["build", fixture, "--default", "--out", out], env)).code, 0);
    assert.equal(all(store.db, "SELECT * FROM runs").length, 1);
    assert.equal(all(store.db, "SELECT n FROM runs")[0].n, 2);
    assert.equal(all(store.db, "SELECT * FROM installs").length, 1);
    assert.equal(all(store.db, "SELECT runs FROM installs")[0].runs, 2);

    // A failed build counts its error code.
    writeFileSync(join(out, "grouping.json"), JSON.stringify({ version: 1, summary: "s", children: [{ id: "a", name: "A", summary: "s", files: ["nothing/**"] }] }));
    assert.equal((await node(["build", fixture, "--out", out], env)).code, 2);
    const bad = all(store.db, "SELECT * FROM runs WHERE ok = 0");
    assert.equal(bad.length, 1);
    assert.deepEqual({ error: bad[0].error, mode: bad[0].mode }, { error: "INVALID_GROUPING", mode: "ai" });
  } finally { await store.close(); }
});

test("consent off: never answered, usage no, and yes with DO_NOT_TRACK store nothing", async () => {
  for (const setup of ["ask", "no", "dnt"] as const) {
    const store = await startPingStore();
    try {
      const env: Record<string, string> = { ...freshEnv(), REPOLADDER_PING_URL: store.url };
      if (setup === "no") await node(["usage", "no"], env);
      if (setup === "dnt") { await node(["usage", "yes"], env); env.DO_NOT_TRACK = "1"; }
      assert.equal((await node(["build", fixture, "--fresh", "--default", "--out", tmp()], env)).code, 0, setup);
      for (const t of ["runs", "installs"]) assert.equal(all(store.db, `SELECT COUNT(*) AS c FROM ${t}`)[0].c, 0, `${setup}: ${t}`);
    } finally { await store.close(); }
  }
});

test("README read-out queries are valid SQL on the store", async () => {
  const store = await startPingStore();
  try {
    const env = { ...freshEnv(), REPOLADDER_PING_URL: store.url };
    await node(["usage", "yes"], env);
    await node(["build", fixture, "--fresh", "--default", "--out", tmp()], env);
    const md = readFileSync(new URL("../server/ping/README.md", import.meta.url), "utf8");
    const after = md.slice(md.indexOf("## Read the numbers"));
    const block = /```sql\n([\s\S]*?)```/.exec(after)![1];
    const stmts = block.split("\n").filter((l) => l.trim() && !l.startsWith("--") && l.trimEnd().endsWith(";"));
    assert.ok(stmts.length >= 8, `${stmts.length} statements`);
    for (const q of stmts) assert.doesNotThrow(() => store.db.prepare(q).all(), q);
  } finally { await store.close(); }
});
