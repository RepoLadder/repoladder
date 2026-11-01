// CLI side of the Ask endpoint: query is read-only under REPOLADDER_READONLY, and serve --no-ask leaves the routes out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { request } from "node:http";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = join(root, "src/cli.ts");
const fixture = join(root, "test/fixtures/basic-app");

test("query --fresh is refused when REPOLADDER_READONLY=1", () => {
  const out = join(mkdtempSync(join(tmpdir(), "rl-ro-")), "facts");
  const r = spawnSync(process.execPath, [cli, "query", fixture, "files", "x", "--fresh", "--out", out], { encoding: "utf8", env: { ...process.env, REPOLADDER_NO_USAGE: "1", REPOLADDER_READONLY: "1" } });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^READ_ONLY: query is read-only in this mode/);
  assert.ok(!existsSync(out), "nothing is analyzed or written");
});

test("serve --no-ask starts and has no ask routes; serve without it has them", async () => {
  for (const flag of [true, false]) {
    const out = mkdtempSync(join(tmpdir(), "rl-noask-"));
    const child = spawn(process.execPath, [cli, "serve", fixture, "--no-open", "--out", out, ...(flag ? ["--no-ask"] : [])], { env: { ...process.env, REPOLADDER_NO_USAGE: "1" } });
    try {
      const m = await new Promise<RegExpMatchArray>((resolve, reject) => {
        let so = "";
        child.stdout!.on("data", (d) => { so += d; const x = so.match(/SERVE_OK http:\/\/127\.0\.0\.1:(\d+)\/\?t=([0-9a-f]+)/); if (x) resolve(x); });
        child.on("exit", (c) => reject(new Error(`serve exited ${c}`)));
      });
      const status = await new Promise<number>((resolve, reject) => {
        const r = request({ host: "127.0.0.1", port: Number(m[1]), path: "/api/ask/status", headers: { host: `127.0.0.1:${m[1]}`, "x-repoladder-token": m[2] } }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode!)); });
        r.on("error", reject);
        r.end();
      });
      assert.equal(status, flag ? 404 : 200);
    } finally {
      child.removeAllListeners("exit");
      child.kill("SIGINT");
    }
  }
});
