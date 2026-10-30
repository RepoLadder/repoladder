import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { d2Pool } from "../src/build/d2pool.ts";
import { installInterrupt } from "../src/build/interrupt.ts";

function fake(flushed: number | null) {
  const handlers = new Map<string, () => void>();
  const lines: string[] = [];
  const exits: number[] = [];
  const dispose = installInterrupt({
    flush: () => flushed, write: (l) => lines.push(l),
    exit: ((c: number) => { exits.push(c); }) as (c: number) => never,
    on: (s, f) => { handlers.set(s, f); }, off: (s) => { handlers.delete(s); },
  });
  return { handlers, lines, exits, dispose };
}

test("interrupt: SIGINT saves and exits 130, SIGTERM exits 143", () => {
  const a = fake(1234);
  a.handlers.get("SIGINT")!();
  assert.deepEqual(a.lines, ["interrupted; saved layout cache (1,234 layouts)"]);
  assert.deepEqual(a.exits, [130]);
  const b = fake(1);
  b.handlers.get("SIGTERM")!();
  assert.deepEqual(b.exits, [143]);
});

test("interrupt: nothing saved says plain interrupted; a second signal does nothing; the disposer removes both", () => {
  const a = fake(null);
  a.handlers.get("SIGINT")!();
  a.handlers.get("SIGTERM")!();
  assert.deepEqual(a.lines, ["interrupted"]);
  assert.deepEqual(a.exits, [130]);
  a.dispose();
  assert.equal(a.handlers.size, 0);
});

test("interrupt: a real SIGTERM saves the cache and exits 143", async () => {
  const dir = mkdtempSync(join(tmpdir(), "repoladder-int-"));
  try {
    const child = spawn(process.execPath, [fileURLToPath(new URL("./helpers/interruptchild.ts", import.meta.url)), dir], { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => { err += d; });
    await new Promise<void>((ok, bad) => {
      child.on("error", bad);
      child.on("exit", () => bad(new Error(`child exited early: ${err}`)));
      child.stdout.on("data", (d) => { if (String(d).includes("ready")) { child.removeAllListeners("exit"); ok(); } });
    });
    const code = new Promise<number | null>((ok) => child.on("exit", (c) => ok(c)));
    child.kill("SIGTERM");
    assert.equal(await code, 143);
    assert.match(err, /interrupted; saved layout cache \(1 layouts\)/);
    const saved = JSON.parse(readFileSync(join(dir, "layout-cache.json"), "utf8"));
    assert.equal(Object.keys(saved.entries).length, 1);
    const pool = d2Pool({ cacheDir: dir, size: 1 });
    await pool.compile("a: a\na -> b", "elk");
    assert.equal(pool.stats.hits, 1);
    assert.equal(pool.stats.misses, 0);
    await pool.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
