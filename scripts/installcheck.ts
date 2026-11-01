// Installs the plugin the way a user gets it and runs it on a fixture, outside this repo so
// nothing resolves from the repo's own node_modules. Needs a built plugin/dist (npm run build).
//
//   node scripts/installcheck.ts            # with the `claude` CLI: marketplace add + plugin install
//   node scripts/installcheck.ts --simulate # without it: copy the plugin and install its deps as Claude Code does
//   node scripts/installcheck.ts --pack [dir] # the npm package: pack it, install the tarball into a fresh dir,
//                                             # run the repoladder bin, then run and type-check buildFromFiles()
//
// The real install fetches the plugin from a git repo (a throwaway local one standing in for
// GitHub) into a fresh Claude config dir, so it takes the copy-to-cache path a GitHub install
// takes, including Claude Code's own dependency install from plugin/package-lock.json.
import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { REPO_SLUG } from "./npm-package.ts";
import { diagnoseInstall, waitForDeps } from "./installwait.ts";

const repo = resolve(import.meta.dirname, "..");
const simulate = process.argv.includes("--simulate");
const packAt = process.argv.indexOf("--pack");
const pack = packAt >= 0;
const packDir = pack && process.argv[packAt + 1] && !process.argv[packAt + 1].startsWith("--") ? resolve(process.argv[packAt + 1]) : null;
const win = process.platform === "win32";
const tmp = mkdtempSync(join(tmpdir(), "repoladder-install-"));
const env = { ...process.env, REPOLADDER_NO_USAGE: "1", CLAUDE_CONFIG_DIR: join(tmp, "claude-config") };

const run = (cmd: string, args: string[], opts: ExecFileSyncOptions = {}): string => {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  // npm and claude are .cmd shims on Windows, which only run through a shell
  const out = String(execFileSync(cmd, args, { encoding: "utf8", env, shell: win, ...opts }) ?? "");
  process.stdout.write(out);
  return out;
};
const fail = (msg: string): never => { console.error(`INSTALLCHECK_FAILED ${msg}`); process.exit(1); };

function pluginCheck(): void {
  if (!existsSync(join(repo, "plugin/dist/repoladder.mjs"))) fail("plugin/dist/repoladder.mjs is missing; run npm run build");
  function viaClaude(): string {
    // a git repo holding only what ships, standing in for github.com/repoladder/repoladder
    const src = join(tmp, "src");
    cpSync(join(repo, "plugin"), join(src, "plugin"), { recursive: true, filter: (p) => !p.includes("node_modules") });
    const git = (...a: string[]) => run("git", ["-c", "user.name=check", "-c", "user.email=check@example.com", ...a], { cwd: src, shell: false });
    git("init", "-q"); git("add", "-A"); git("commit", "-qm", "plugin");
    const mkt = join(tmp, "marketplace");
    const entry = JSON.parse(readFileSync(join(repo, ".claude-plugin/marketplace.json"), "utf8"));
    entry.plugins[0].source = { source: "git-subdir", url: pathToFileURL(src).href, path: "plugin" };
    mkdirSync(join(mkt, ".claude-plugin"), { recursive: true });
    writeFileSync(join(mkt, ".claude-plugin/marketplace.json"), JSON.stringify(entry, null, 2));
    run("claude", ["plugin", "marketplace", "add", mkt]);
    run("claude", ["plugin", "install", `${entry.plugins[0].name}@${entry.name}`]);
    const installed = JSON.parse(readFileSync(join(env.CLAUDE_CONFIG_DIR, "plugins/installed_plugins.json"), "utf8"));
    return Object.values(installed.plugins as Record<string, { installPath: string }[]>)[0][0].installPath;
  }

  function simulated(): string {
    // what Claude Code does for a copied plugin: copy it, then a pinned, script-free install from the lockfile
    const dir = join(tmp, "cache/repoladder");
    cpSync(join(repo, "plugin"), dir, { recursive: true, filter: (p) => !p.includes("node_modules") });
    run("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: dir });
    return dir;
  }

  const pluginRoot = simulate ? simulated() : viaClaude();
  const cli = join(pluginRoot, "dist/repoladder.mjs");
  console.log(`plugin installed at ${pluginRoot}`);

  const app = join(tmp, "app");
  cpSync(join(repo, "test/fixtures/basic-app"), app, { recursive: true });
  const node = (...a: string[]) => run(process.execPath, [cli, ...a], { cwd: app, shell: false });

  if (simulate) {
    // the simulated install is a synchronous npm ci: nothing to wait for
    if (!node("preflight").includes("PREFLIGHT_OK")) fail("preflight did not pass right after install (the runtime deps did not arrive with the plugin)");
  } else {
    // Claude Code may still be installing the deps when "claude plugin install" returns: wait a bounded time
    const r = waitForDeps(() => node("preflight"));
    if (r.ok && r.attempts > 1) console.log(`INSTALLCHECK_WARN the runtime deps arrived ${r.waitedMs / 1000}s after "claude plugin install" returned (after ${r.attempts} preflights): Claude Code installs them asynchronously, so a user may need to wait a moment before the first /map`);
    if (!r.ok) {
      for (const l of diagnoseInstall(pluginRoot, env.CLAUDE_CONFIG_DIR!)) for (const ln of l.split("\n")) console.log(`INSTALLCHECK_DIAG ${ln}`);
      fail(`preflight did not pass after install and ${r.waitedMs / 1000}s of waiting (the runtime deps did not arrive with the plugin); see INSTALLCHECK_DIAG above`);
    }
  }
  node("summary", app, "--fresh");
  if (!node("build", app, "--default").includes("BUILD_OK")) fail("build did not print BUILD_OK");
  if (!existsSync(join(app, ".repoladder/diagram.html"))) fail("no diagram.html");
  console.log(`INSTALLCHECK_OK ${simulate ? "simulated" : "claude plugin install"} on ${process.platform}, node ${process.version}`);
}

const LIB_CHECK = `import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, sep } from "node:path";
import { buildFromFiles, VERSION } from "repoladder";
const bad = (why) => { console.error("LIB_FAILED " + why); process.exit(1); };
const files = {};
const walk = (dir, rel) => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n), r = rel ? rel + "/" + n : n;
    if (statSync(p).isDirectory()) { if (n !== "node_modules" && n !== ".git") walk(p, r); } else files[r.split(sep).join("/")] = readFileSync(p, "utf8");
  }
};
walk(process.argv[2], "");
const result = await buildFromFiles(files);
if (result.ok === false) bad("build returned ok: false");
const installed = createRequire(import.meta.url)("repoladder/package.json").version;
if (VERSION !== installed) bad("VERSION " + VERSION + " is not the installed package version " + installed);
if (result.engineVersion !== VERSION) bad("engineVersion " + result.engineVersion + " is not VERSION");
const tag = '<meta name="generator" content="repoladder@' + VERSION + '">';
if (result.html.split(tag).length !== 2) bad("expected exactly one generator tag " + tag);
console.log("LIB_OK " + VERSION);
process.exit(0);
`;

function packCheck(): void {
  const rootLock = JSON.parse(readFileSync(join(repo, "package-lock.json"), "utf8"));
  const pkgDir = packDir ?? (() => {
    const d = join(tmp, "pkg");
    run(process.execPath, [join(repo, "scripts/npm-package.ts"), "--out", d], { cwd: repo, shell: false });
    return d;
  })();
  const packed = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", tmp, "--loglevel=error"], { cwd: pkgDir, env: { ...env, npm_config_cache: join(tmp, "npm-cache") } }).replace(/^[\s\S]*?(?=\[\s*\{)/, ""))[0];
  const paths: string[] = packed.files.map((f: { path: string }) => f.path.split("\\").join("/"));
  const allowed = new Set(["package.json", "README.md", "LICENSE", "NOTICE", "THIRD-PARTY-NOTICES.txt", "LICENSE-Geist.txt", "dist/lib.mjs", "bin/repoladder.mjs"]);
  for (const p of paths) if (!allowed.has(p) && !/^dist\/types\/.+\.d\.ts$/.test(p)) fail(`tarball contains ${p}`);
  const meta = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  if (meta.name !== "repoladder") fail("package.json name is not repoladder");
  if (typeof meta.license !== "string" || !meta.license) fail("package.json has no license");
  if (meta.repository?.url !== `git+https://github.com/${REPO_SLUG}.git`) fail("package.json repository.url does not match REPO_SLUG in scripts/npm-package.ts");
  if (meta.publishConfig?.provenance !== true || meta.publishConfig?.access !== "public") fail("package.json publishConfig is not { access: public, provenance: true }");
  for (const need of ["package.json", "dist/lib.mjs", "dist/types/lib.d.ts", "bin/repoladder.mjs"]) if (!paths.includes(need)) fail(`tarball is missing ${need}`);

  const consumer = join(tmp, "consumer");
  mkdirSync(consumer, { recursive: true });
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "consumer", private: true, type: "module" }));
  const nodeTypes = rootLock.packages["node_modules/@types/node"].version;
  const cenv = { ...env, npm_config_cache: join(tmp, "npm-cache") };
  run("npm", ["install", join(tmp, packed.filename), `@types/node@${nodeTypes}`, "--no-audit", "--no-fund", "--loglevel=error"], { cwd: consumer, env: cenv });

  const app = join(tmp, "app");
  cpSync(join(repo, "test/fixtures/basic-app"), app, { recursive: true });
  writeFileSync(join(consumer, "check.mjs"), LIB_CHECK);
  // the installed bin, the way `npx repoladder` runs it; no usage stats, config in the temp dir
  const benv = { ...env, REPOLADDER_NO_USAGE: "1", REPOLADDER_CONFIG_DIR: join(tmp, "config") };
  const binApp = join(tmp, "bin-app"); // its own copy: the library check below reads every file of `app`
  cpSync(join(repo, "test/fixtures/basic-app"), binApp, { recursive: true });
  const bin = (...a: string[]) => run(join(consumer, "node_modules/.bin", win ? "repoladder.cmd" : "repoladder"), a, { cwd: binApp, env: benv });
  if (!/usage: repoladder/.test(bin("--help"))) fail("--help did not print the usage line");
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z]+)?\s*$/m.test(bin("--version"))) fail("--version is not X.Y.Z[+commit]");
  const pre = bin("preflight");
  if (!pre.includes("PREFLIGHT_OK") || pre.includes("USAGE_ASK")) fail("preflight did not print PREFLIGHT_OK alone");
  if (!bin("build", binApp, "--default").includes("BUILD_OK")) fail("repoladder build did not print BUILD_OK");
  if (!existsSync(join(binApp, ".repoladder/diagram.html"))) fail("repoladder build wrote no diagram.html");

  const out = run(process.execPath, ["check.mjs", app], { cwd: consumer, shell: false, timeout: 300_000 });
  if (!out.includes("LIB_OK")) fail("library check did not print LIB_OK");

  const typeNames = [...readFileSync(join(repo, "src/lib.ts"), "utf8").matchAll(/^export (?:interface|type) (\w+)/gm)].map((m) => m[1]);
  const reexported = [...readFileSync(join(repo, "src/lib.ts"), "utf8").matchAll(/^export type \{([^}]*)\}/gm)].flatMap((m) => m[1].split(",").map((x) => x.trim()).filter(Boolean));
  const types = [...new Set([...typeNames, ...reexported])];
  writeFileSync(join(consumer, "check.ts"), [
    'import { buildFromFiles, VERSION } from "repoladder";',
    `import type { ${types.join(", ")} } from "repoladder";`,
    "const v: string = VERSION;",
    'const r = await buildFromFiles({ "src/a.ts": "export const a = 1;\\n" });',
    "if (!r.ok) throw new Error(r.message);",
    "const e: string = r.engineVersion;",
    `export type All = [${types.join(", ")}];`,
    "export { v, e };",
    "",
  ].join("\n"));
  writeFileSync(join(consumer, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true, skipLibCheck: false, types: ["node"] },
    files: ["check.ts"],
  }, null, 2));
  try { run(process.execPath, [join(consumer, "node_modules/typescript/bin/tsc"), "-p", consumer], { shell: false }); }
  catch { fail("types: the consumer's strict NodeNext type check failed"); }
  console.log(`INSTALLCHECK_OK npm pack (bin + library) on ${process.platform}, node ${process.version}`);
}

if (pack) packCheck(); else pluginCheck();
