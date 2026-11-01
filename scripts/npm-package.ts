// Generates the publishable package into .npm-package/: the library (`buildFromFiles()`) and the `repoladder` CLI
// (`npx repoladder build . --default`). Nothing is published from here.
//
//   node scripts/npm-package.ts [--out <dir>] [--version X.Y.Z]
//
// The version is the root package.json one, unless --version or a `vX.Y.Z` tag ref (GITHUB_REF_NAME) says otherwise.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { commitId } from "../src/usage.ts";
import { bundleCli, bundleLib, engineVersion } from "./bundle.ts";

const repo = resolve(fileURLToPath(new URL("..", import.meta.url)));

// npm provenance compares this case-sensitively to GITHUB_REPOSITORY; the one place the slug is written.
export const REPO_SLUG = "RepoLadder/repoladder";
export const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

const NODE_BUILTINS = new Set(builtinModules.flatMap((m) => [m, m.replace(/^node:/, "")]));

const pkgOf = (spec: string): string => {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
};

/** The bare package names a declaration file imports (skips relative specifiers and Node builtins). */
export function typeImports(dts: string): string[] {
  const specs: string[] = [];
  for (const re of [/\bfrom\s+["']([^"']+)["']/g, /\bimport\(\s*["']([^"']+)["']\s*\)/g, /\/\/\/\s*<reference\s+types=["']([^"']+)["']/g]) {
    for (const m of dts.matchAll(re)) specs.push(m[1]);
  }
  const out = new Set<string>();
  for (const s of specs) {
    if (s.startsWith(".") || s.startsWith("/") || s.startsWith("node:")) continue;
    const name = pkgOf(s);
    if (NODE_BUILTINS.has(name) || NODE_BUILTINS.has(s) || name === "node") continue;
    out.add(name);
  }
  return [...out].sort();
}

const relSpecs = (dts: string): string[] =>
  [...dts.matchAll(/\bfrom\s+["'](\.[^"']*)["']|\bimport\(\s*["'](\.[^"']*)["']\s*\)/g)].map((m) => m[1] ?? m[2]);

/** The .d.ts files reachable from `entry` by following relative specifiers. */
export function dtsClosure(entry: string): string[] {
  const seen = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file) || !existsSync(file)) return;
    seen.add(file);
    for (const spec of relSpecs(readFileSync(file, "utf8"))) {
      const base = join(dirname(file), spec);
      const stem = base.replace(/\.(ts|js|mjs)$/, "");
      const cands = stem !== base ? [`${stem}.d.ts`] : [`${base}.d.ts`, join(base, "index.d.ts")];
      const hit = cands.find((c) => existsSync(c));
      if (hit) visit(hit);
    }
  };
  visit(entry);
  return [...seen].sort();
}

/** Exact-pinned dependencies: the plugin runtime pins, plus every package the shipped types import, at its lockfile version. */
export function libDependencies(o: {
  typePkgs: string[];
  pluginDeps: Record<string, string>;
  lock: { packages: Record<string, { version?: string }> };
}): Record<string, string> {
  const deps: Record<string, string> = { ...o.pluginDeps };
  for (const name of o.typePkgs) {
    if (name in deps || name === "@types/node") continue;
    const v = o.lock.packages[`node_modules/${name}`]?.version;
    if (!v) throw new Error(`NPM_PACKAGE_FAILED types import ${name}, which is not in package-lock.json`);
    deps[name] = v;
  }
  for (const [name, v] of Object.entries(deps)) {
    if (!SEMVER.test(v)) throw new Error(`NPM_PACKAGE_FAILED dependency ${name} is not an exact version: ${v}`);
  }
  return Object.fromEntries(Object.entries(deps).sort(([a], [b]) => a.localeCompare(b)));
}

/** The version to publish: `--version`, else a `vX.Y.Z` tag ref, else the root package.json one (`fallback`). */
export function packageVersion(args: string[], env: Record<string, string | undefined>, fallback: string): string {
  const i = args.indexOf("--version");
  const flag = i >= 0 ? args[i + 1] : undefined;
  if (i >= 0 && !flag) throw new Error("NPM_PACKAGE_FAILED --version needs a value");
  const tag = env.GITHUB_REF_TYPE === "tag" && /^v\d/.test(env.GITHUB_REF_NAME ?? "") ? env.GITHUB_REF_NAME!.slice(1) : undefined;
  if (flag !== undefined && tag !== undefined && flag !== tag) throw new Error(`NPM_VERSION_MISMATCH tag=${env.GITHUB_REF_NAME} version=${flag}`);
  const v = flag ?? tag ?? fallback;
  if (!SEMVER.test(v)) throw new Error(`NPM_PACKAGE_FAILED version ${v} is not semver`);
  return v;
}

/** What the CLI reports as its version (and pings carry): `<semver>+<commit>`, the bare semver when that is too long for the ping's check. */
export function stamp(semver: string, commit: string): string {
  for (const s of [`${semver}+${commit}`, semver]) if (/^[0-9A-Za-z.+-]{1,24}$/.test(s)) return s;
  return "dev";
}

export function packageJson(o: { version: string; rootPkg: { description?: string; license?: string }; dependencies: Record<string, string> }) {
  if (!SEMVER.test(o.version)) throw new Error(`NPM_PACKAGE_FAILED version ${o.version} is not semver`);
  return {
    name: "repoladder",
    version: o.version,
    description: o.rootPkg.description,
    type: "module",
    exports: {
      ".": { types: "./dist/types/lib.d.ts", import: "./dist/lib.mjs" },
      "./package.json": "./package.json",
    },
    types: "./dist/types/lib.d.ts",
    bin: { repoladder: "bin/repoladder.mjs" },
    files: ["bin", "dist", "LICENSE", "NOTICE", "THIRD-PARTY-NOTICES.txt", "LICENSE-Geist.txt"],
    engines: { node: ">=20.6" },
    dependencies: o.dependencies,
    repository: { type: "git", url: `git+https://github.com/${REPO_SLUG}.git` },
    homepage: "https://repoladder.com",
    bugs: `https://github.com/${REPO_SLUG}/issues`,
    license: o.rootPkg.license,
    publishConfig: { access: "public", provenance: true },
    keywords: ["architecture", "diagram", "typescript", "javascript", "d2", "codebase", "visualization"],
  };
}

const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));

async function main(): Promise<void> {
  const i = process.argv.indexOf("--out");
  const out = resolve(repo, i >= 0 ? process.argv[i + 1] : ".npm-package");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const version = packageVersion(process.argv.slice(2), process.env, engineVersion());
  const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
  execFileSync(process.execPath, [tsc, "-p", join(repo, "tsconfig.lib.json"), "--outDir", join(out, "dist/types")], { stdio: "inherit", cwd: repo });
  const typePkgs = [...new Set(dtsClosure(join(out, "dist/types/lib.d.ts")).flatMap((f) => typeImports(readFileSync(f, "utf8"))))].sort();
  const dependencies = libDependencies({
    typePkgs,
    pluginDeps: readJson(join(repo, "plugin/package.json")).dependencies,
    lock: readJson(join(repo, "package-lock.json")),
  });
  await bundleLib({ outfile: join(out, "dist/lib.mjs"), version });
  await bundleCli({ outfile: join(out, "bin/repoladder.mjs"), channel: "npm", version: stamp(version, commitId(repo)), engine: version });
  writeFileSync(join(out, "package.json"), JSON.stringify(packageJson({ version, rootPkg: readJson(join(repo, "package.json")), dependencies }), null, 2) + "\n");
  copyFileSync(join(repo, "scripts/npm-readme.md"), join(out, "README.md"));
  for (const f of ["LICENSE", "NOTICE", "THIRD-PARTY-NOTICES.txt", "LICENSE-Geist.txt"]) copyFileSync(join(repo, f), join(out, f));
  console.log(`NPM_PACKAGE_OK ${out} ${version}`);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(msg.startsWith("NPM_PACKAGE_FAILED") ? msg : `NPM_PACKAGE_FAILED ${msg}`);
    process.exit(1);
  }
}
