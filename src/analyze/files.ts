import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

export const SOURCE_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

// Directories that never hold app source: dependencies, build output, tests.
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", "coverage", ".next", ".nuxt", ".svelte-kit",
  ".turbo", ".vercel", ".output", ".cache", ".repoladder",
  "__tests__", "__mocks__", "__snapshots__", "__fixtures__", "test", "tests", "test-d", "e2e", "cypress", "playwright",
]);

const TEST_FILE = /\.(test|spec|e2e|stories|test-d)\.[cm]?[jt]sx?$/;
// Tool configs (vite.config.ts, eslint.config.js, playwright.config.ts, .eslintrc.cjs …) aren't app code.
const CONFIG_FILE = /(^|\/)([^/]+\.config|\.[^/]+)\.[cm]?[jt]s$/;

// A `build` folder inside `src/` is the code's build step (src/build/layout.ts), not its output.
function skipDir(name: string, parent: string | undefined): boolean {
  if (name === "build" && parent === "src") return false;
  return SKIP_DIRS.has(name) || name.startsWith(".");
}

/** Whether a path sits in a folder that never holds app source (tests, fixtures, build output). */
export function inSkippedDir(rel: string): boolean {
  const parts = rel.split("/");
  return parts.slice(0, -1).some((d, i) => skipDir(d, parts[i - 1]));
}

export function isSourcePath(rel: string): boolean {
  if (!SOURCE_EXT.test(rel) || /\.d\.[cm]?ts$/.test(rel) || TEST_FILE.test(rel) || CONFIG_FILE.test(rel)) return false;
  return !inSkippedDir(rel);
}

/**
 * Whether git describes `root`: root is its work tree's top level, or git tracks at least one file
 * under it. False for a plain directory, when git is missing, and for an extracted tarball that
 * merely sits inside some other repo.
 */
export function gitOwns(root: string): boolean {
  try {
    if (git(root, ["rev-parse", "--show-prefix"]) === "") return true;
    const out = execFileSync("git", ["ls-files", "-z", "--cached", "--", "."], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.length > 0;
  } catch {
    return false;
  }
}

/** All repo-relative paths (posix), honoring .gitignore when `useGit` and the root is inside a git repo. */
export function listAllPaths(root: string, useGit = true): string[] {
  if (!useGit) return walk(root, "").sort();
  try {
    const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split("\0").filter(Boolean).sort();
  } catch {
    return walk(root, "").sort();
  }
}

// The no-git lister. It doesn't read .gitignore: a tarball or upload has no ignored files worth
// honouring, and SKIP_DIRS plus dot-dir pruning already drop dependencies and build output. It never
// follows or lists symlinks (a Dirent for one is neither isFile() nor isDirectory()), so an uploaded
// tree can't point the analyzer outside its root.
function walk(root: string, rel: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (!skipDir(e.name, rel.split("/").pop())) out.push(...walk(root, p));
    } else if (e.isFile()) out.push(p);
  }
  return out;
}

export function gitSha(root: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

const git = (root: string, args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

/** "owner/name" from a GitHub remote URL (https, ssh or scp-style), or null for any other host. */
export function parseGithubRemote(url: string): string | null {
  const m = url.trim().match(/^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/git@|git@)github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * Where the analyzed files live on GitHub: the repo, the full HEAD commit (a permanent link target)
 * and the analyzed root's directory inside the repo. Null without a GitHub remote.
 */
export function githubSource(root: string): { repo: string; sha: string; dir: string } | null {
  try {
    const remotes = git(root, ["remote"]).split("\n").filter(Boolean);
    // origin first, otherwise the first remote that points at GitHub
    for (const r of [...remotes.filter((x) => x === "origin"), ...remotes.filter((x) => x !== "origin")]) {
      const repo = parseGithubRemote(git(root, ["remote", "get-url", r]));
      if (repo) return { repo, sha: git(root, ["rev-parse", "HEAD"]), dir: git(root, ["rev-parse", "--show-prefix"]) };
    }
  } catch {}
  return null;
}
