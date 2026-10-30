// Verifies that the committed plugin/dist bundle is what the source builds to.
//
//   node scripts/verifydist.ts [--allow-stale] [--bundle plugin/dist/repoladder.mjs]
//
// Rebuilds into a temp file with the stamp read from the committed bundle's own
// `// repoladder-build:` line (the stamp is the commit the bot built from, so it can't be guessed),
// then compares bytes. Run on ubuntu-latest, node 22, like the rebuild bot: a macOS build packs differently.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { bundlePlugin } from "./bundle.ts";

// What the bundle is built from. Keep in sync with the paths in .github/workflows/rebuild-dist.yml (a test asserts it).
export const BUILD_INPUTS = ["src", "package.json", "package-lock.json", "LICENSE-Geist.txt", "tsconfig.json", "scripts/build.ts", "scripts/bundle.ts"];

export type Git = (args: string[]) => string;
export type Verdict =
  | { ok: true }
  | { ok: false; kind: "nostamp" | "stale" | "mismatch" | "unknown-stamp"; detail: string };

export function bundleStamp(text: string): string | null {
  const m = /^\/\/ repoladder-build: ([0-9A-Za-z.+-]{1,24})$/m.exec(text.slice(0, 300));
  return m ? m[1] : null;
}

export function firstDiff(a: string, b: string): { offset: number; line: number } | null {
  if (a === b) return null;
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return { offset: i, line: a.slice(0, i).split("\n").length };
}

/** Build-input paths changed between the stamped commit and HEAD; null when git can't resolve the stamp. */
export function sourceMoved(stamp: string, git: Git): string[] | null {
  try {
    return git(["diff", "--name-only", stamp, "HEAD", "--", ...BUILD_INPUTS]).split("\n").filter(Boolean);
  } catch {
    return null;
  }
}

export function verify(o: { committed: string; rebuilt: string; git: Git }): Verdict {
  if (o.committed === o.rebuilt) return { ok: true };
  const stamp = bundleStamp(o.committed);
  if (!stamp) return { ok: false, kind: "nostamp", detail: "the committed bundle has no `// repoladder-build:` line (built before this check existed); the rebuild bot has not refreshed it yet" };
  const moved = sourceMoved(stamp, o.git);
  if (moved === null) return { ok: false, kind: "unknown-stamp", detail: `commit ${stamp} named by the bundle can't be resolved (unknown or not fetched)` };
  if (moved.length > 0) return { ok: false, kind: "stale", detail: `source changed since ${stamp} (${moved.slice(0, 5).join(", ")}) and the bot has not rebuilt the bundle yet` };
  const d = firstDiff(o.committed, o.rebuilt);
  return { ok: false, kind: "mismatch", detail: `source is unchanged since ${stamp} but the bundle differs from a rebuild (first difference at offset ${d?.offset}, line ${d?.line}; node ${process.version}): a non-reproducible build or a hand-edited bundle` };
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

async function main(argv: string[]): Promise<number> {
  const allowStale = argv.includes("--allow-stale");
  const bi = argv.indexOf("--bundle");
  const path = bi >= 0 && argv[bi + 1] ? argv[bi + 1] : "plugin/dist/repoladder.mjs";
  const committed = readFileSync(path, "utf8");
  const dir = mkdtempSync(join(tmpdir(), "verifydist-"));
  try {
    const outfile = join(dir, "repoladder.mjs");
    await bundlePlugin({ outfile, version: bundleStamp(committed) ?? "unstamped" });
    const rebuilt = readFileSync(outfile, "utf8");
    const git: Git = (args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const v = verify({ committed, rebuilt, git });
    console.log(`committed: ${sha(committed)} (${committed.length} chars)\nrebuilt:   ${sha(rebuilt)} (${rebuilt.length} chars)`);
    if (v.ok) {
      console.log("plugin/dist matches a rebuild from source.");
      return 0;
    }
    if (v.kind === "stale" && allowStale) {
      console.log(`::warning title=plugin/dist is stale::${v.detail}`);
      return 0;
    }
    console.log(`::error title=plugin/dist is not built from source::${v.kind}: ${v.detail}`);
    return 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = await main(process.argv.slice(2));
}
