// Points git at the tracked hooks (.githooks/). Run by `npm run hooks` and `prepare`.
// Never fails: it must not break `npm ci` or `npm pack`. A no-op under CI and outside a git work tree.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const HOOKS_DIR = ".githooks";

/** Returns what it did: "installed", or the reason it skipped. */
export function install(
  env: Record<string, string | undefined>,
  git: (args: string[]) => string,
  exists: (path: string) => boolean = existsSync,
): string {
  if (env.CI) return "skipped: CI";
  try {
    if (git(["rev-parse", "--is-inside-work-tree"]).trim() !== "true") return "skipped: not a work tree";
    const top = git(["rev-parse", "--show-toplevel"]).trim();
    if (!exists(join(top, HOOKS_DIR, "pre-push"))) return "skipped: no pre-push hook";
    git(["config", "core.hooksPath", HOOKS_DIR]);
    return "installed";
  } catch {
    return "skipped: git unavailable";
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const run = (args: string[]) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const result = install(process.env, run);
    if (result === "installed") console.log(`git hooks: core.hooksPath=${HOOKS_DIR} (leak guard on pre-push)`);
  } catch {
    // never fail
  }
  process.exit(0);
}
