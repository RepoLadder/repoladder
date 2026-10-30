// The runtime deps (typescript, @terrastruct/d2) normally arrive with the plugin: Claude Code
// installs them into the cached copy from plugin/package-lock.json. `repoladder install` is the
// fallback for when it couldn't (a plugin loaded in place from a local marketplace, an install
// that timed out), and does the same pinned, script-free install.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const RUNTIME_DEPS = ["typescript", "@terrastruct/d2"];

/** The npm call that installs the plugin's pinned runtime deps into `pluginRoot`. */
export function npmInstall(pluginRoot: string, platform: NodeJS.Platform = process.platform) {
  const locked = existsSync(join(pluginRoot, "package-lock.json"));
  const args = [locked ? "ci" : "install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"];
  // npm is npm.cmd on Windows, and Node (since 20.12) only runs a .cmd through a shell.
  return { cmd: "npm", args, opts: { cwd: pluginRoot, stdio: "inherit" as const, shell: platform === "win32" } };
}

export function runNpmInstall(pluginRoot: string): void {
  const { cmd, args, opts } = npmInstall(pluginRoot);
  execFileSync(cmd, args, opts);
}
