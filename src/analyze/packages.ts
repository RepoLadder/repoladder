import { basename, posix } from "node:path";
import { compileGlob } from "../model/glob.ts";
import { inSkippedDir } from "./files.ts";
import { asSource, type FileSource } from "./source.ts";
import type { Package, PackageKind } from "../model/schema.ts";

const WEB_DEPS = ["next", "vite", "react-dom", "react-scripts", "vue", "svelte", "@sveltejs/kit", "nuxt", "astro", "@remix-run/react", "solid-js", "@angular/core", "expo", "react-native"];
// Full-stack app frameworks: an app built on one is a web app even when it also serves an API (Next + tRPC).
// React Router v7 framework mode (and Remix v2's server runtime) counts too, so `express` beside it doesn't make
// it a backend. Bare `react-router` doesn't: an SPA router alone shouldn't decide, and `react-dom` already does.
const APP_FRAMEWORKS = [
  "next", "nuxt", "@sveltejs/kit", "@remix-run/react", "astro", "expo", "react-native", "@tanstack/react-start",
  "@react-router/node", "@react-router/express", "@react-router/serve", "@remix-run/node",
];
const BACKEND_DEPS = ["firebase-functions", "express", "hono", "fastify", "koa", "@nestjs/core", "@hapi/hapi", "@trpc/server", "apollo-server", "@apollo/server"];
const SCRIPT_DIRS = new Set(["tools", "scripts", "bin", "script", "ops"]);

export interface PkgJson {
  name?: string;
  main?: string;
  module?: string;
  source?: string;
  exports?: unknown;
  workspaces?: string[] | { packages?: string[] };
  bin?: unknown;
  description?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readPkg(src: FileSource, dir: string): PkgJson {
  try {
    return JSON.parse(src.read(posix.join(dir, "package.json")));
  } catch {
    return {};
  }
}

function kindOf(dir: string, pkg: PkgJson): PackageKind {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (APP_FRAMEWORKS.some((d) => d in (pkg.dependencies ?? {}))) return "web";
  if (BACKEND_DEPS.some((d) => d in (pkg.dependencies ?? {}))) return "backend";
  if (WEB_DEPS.some((d) => d in deps)) return "web";
  if (SCRIPT_DIRS.has(basename(dir)) || pkg.bin) return "scripts";
  return "library";
}

export interface PackageMap {
  packages: Package[];
  /** Package id owning a repo-relative source path. */
  owner(path: string): string;
}

/**
 * A package is a directory with its own package.json. A folder a workspace glob names is a package even
 * without a package.json. When the root package has
 * sub-packages, the root's remaining files are split by top-level folder (e.g. tools/),
 * because the root is then just a shell around the real apps.
 */
export function detectPackages(srcArg: FileSource | string, allPaths: string[], sourcePaths: string[]): PackageMap {
  const src = asSource(srcArg);
  const pkgDirs = allPaths
    // a test fixture's package.json (np's test/fixtures/**) is not a package of the repo
    .filter((p) => basename(p) === "package.json" && !inSkippedDir(p))
    .map((p) => posix.dirname(p))
    .map((d) => (d === "." ? "" : d));
  if (!pkgDirs.includes("")) pkgDirs.push("");
  // a workspace member is a package even without a package.json of its own (#358); only one-level
  // globs (packages/*) and plain folders count here: packages/** would make every folder a package
  const member = workspaceMatcher(workspaceGlobs(src).filter((g) => g.startsWith("!") || !g.includes("**")));
  const members = new Set<string>();
  for (const p of sourcePaths) {
    for (let i = p.indexOf("/"); i > 0; i = p.indexOf("/", i + 1)) if (member(p.slice(0, i))) members.add(p.slice(0, i));
  }
  for (const d of [...members].sort()) if (!pkgDirs.includes(d)) pkgDirs.push(d);
  // deepest first, so ownership picks the closest package
  pkgDirs.sort((a, b) => b.length - a.length || a.localeCompare(b));

  const under = (p: string, dir: string) => dir === "" || p === dir || p.startsWith(dir + "/");
  const pkgOf = (p: string) => pkgDirs.find((d) => under(p, d))!;

  // A root that is itself an app (its dependencies name a framework) stays one package: a small tool
  // package beside it, like indie-stack's remix.init/, must not split the app by top-level folder.
  const rootDeps = readPkg(src, "").dependencies ?? {};
  const rootIsApp = [...APP_FRAMEWORKS, ...BACKEND_DEPS].some((d) => d in rootDeps);
  const hasSubPackages = pkgDirs.length > 1 && !rootIsApp;
  const dirOwner = (p: string): string => {
    const d = pkgOf(p);
    if (d !== "" || !hasSubPackages) return d;
    const top = p.split("/")[0];
    return p.includes("/") ? top : "";
  };

  const counts = new Map<string, number>();
  for (const p of sourcePaths) counts.set(dirOwner(p), (counts.get(dirOwner(p)) ?? 0) + 1);

  const usedIds = new Set<string>();
  const idFor = (dir: string, name: string) => {
    let base = slug(dir === "" ? name || "app" : basename(dir));
    let id = base;
    for (let i = 2; usedIds.has(id); i++) id = `${base}-${i}`;
    usedIds.add(id);
    return id;
  };

  const rootPkg = readPkg(src, "");
  const packages: Package[] = [];
  const idByDir = new Map<string, string>();
  for (const dir of [...counts.keys()].sort()) {
    const json = pkgDirs.includes(dir) ? readPkg(src, dir) : {};
    const name = json.name ?? (dir === "" ? rootPkg.name ?? src.name : basename(dir));
    const id = idFor(dir, name);
    idByDir.set(dir, id);
    const deps = Object.keys({ ...json.dependencies, ...(dir === "" ? {} : json.devDependencies) }).sort();
    const d = typeof json.description === "string" ? json.description.replace(/\s+/g, " ").trim() : "";
    packages.push({ id, name, dir, kind: kindOf(dir, json), deps, ...(d ? { description: d.slice(0, 300) } : {}) });
  }
  return { packages, owner: (p) => idByDir.get(dirOwner(p))! };
}

/** Workspace globs from package.json `workspaces` (array or { packages }) and pnpm-workspace.yaml. */
export function workspaceGlobs(srcArg: FileSource | string): string[] {
  const src = asSource(srcArg);
  const ws = readPkg(src, "").workspaces;
  const globs = [...(Array.isArray(ws) ? ws : ws?.packages ?? [])];
  if (src.exists("pnpm-workspace.yaml")) {
    // Only the top-level `packages:` list matters; a YAML parser isn't worth a dependency for it.
    let inList = false;
    for (const line of src.read("pnpm-workspace.yaml").split(/\r?\n/)) {
      if (/^packages\s*:/.test(line)) { inList = true; continue; }
      if (!inList || /^\s*(#.*)?$/.test(line)) continue;
      const m = /^\s+-\s*["']?([^"'#]+?)["']?\s*(#.*)?$/.exec(line);
      if (!m) break;
      globs.push(m[1]);
    }
  }
  return [...new Set(globs.map((g) => g.trim().replace(/^\.\//, "").replace(/\/+$/, "")).filter(Boolean))].sort();
}

export interface WorkspacePackage {
  name: string;
  dir: string;
  json: PkgJson;
}

/** Whether a repo-relative folder is matched by the workspace globs (`!` globs exclude). */
export function workspaceMatcher(globs: string[]): (dir: string) => boolean {
  // a workspace entry without wildcards names exactly one folder, not everything below it
  const matcher = (g: string) => (/[*?]/.test(g) ? compileGlob(g).re : new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, "\\$&")}$`));
  const include = globs.filter((g) => !g.startsWith("!")).map(matcher);
  const exclude = globs.filter((g) => g.startsWith("!")).map((g) => matcher(g.slice(1)));
  return (dir) => include.some((re) => re.test(dir)) && !exclude.some((re) => re.test(dir));
}

/** Named packages matched by the workspace globs, keyed by package name, so `@acme/ui` can resolve to its source. */
export function workspacePackages(srcArg: FileSource | string, allPaths: string[]): Map<string, WorkspacePackage> {
  const src = asSource(srcArg);
  const globs = workspaceGlobs(src);
  const isMember = workspaceMatcher(globs);
  const out = new Map<string, WorkspacePackage>();
  if (!globs.some((g) => !g.startsWith("!"))) return out;
  const dirs = allPaths
    .filter((p) => basename(p) === "package.json" && p.includes("/") && !p.includes("node_modules/"))
    .map((p) => posix.dirname(p))
    .sort();
  for (const dir of dirs) {
    if (!isMember(dir)) continue;
    const json = readPkg(src, dir);
    if (json.name && !out.has(json.name)) out.set(json.name, { name: json.name, dir, json });
  }
  return out;
}

export function slug(s: string): string {
  return s.replace(/^@[^/]+\//, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x";
}
