import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "./analyze/index.ts";
import { BuildError, buildDiagram } from "./build/pipeline.ts";
import { InputError, LIMIT_MESSAGES, NO_LIMITS } from "./build/limits.ts";
import { defaultGrouping } from "./model/grouping.ts";
import { boardSvg, fileNames, svgsToPngs, type Theme } from "./build/export.ts";
import { layoutBoards } from "./build/layout.ts";
import { flushActive } from "./build/layoutsession.ts";
import { installInterrupt } from "./build/interrupt.ts";
import { progressPrinter, stepSync, type OnProgress } from "./build/progress.ts";
import { timedSync, timing } from "./build/timings.ts";
import { budgetLines, fileArrowWarnings } from "./build/budget.ts";
import { coverageLines } from "./model/coverage.ts";
import { resolveProfile, type Profile } from "./model/profile.ts";
import type { Model } from "./model/rollup.ts";
import { Facts, Grouping } from "./model/schema.ts";
import { PartError, summarize, summarizePart } from "./model/summary.ts";
import { askUsageOnce, channel, sendPing, usageState, version, writeConsent } from "./usage.ts";

import { RUNTIME_DEPS, runNpmInstall } from "./install.ts";
import { resolveFeatures } from "./features.ts";

// Runtime deps live next to the bundle in plugin/node_modules (see install.ts).
const missingDeps = () =>
  RUNTIME_DEPS.filter((d) => {
    try { import.meta.resolve(d); return false; } catch { return true; }
  });

const [cmd, ...rest] = process.argv.slice(2);
const flags = new Map<string, string | true>();
const args: string[] = [];
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (!a.startsWith("--")) args.push(a);
  else if (rest[i + 1] && !rest[i + 1].startsWith("--")) flags.set(a.slice(2), rest[++i]);
  else flags.set(a.slice(2), true);
}
const root = resolve(args[0] ?? ".");
const out = typeof flags.get("out") === "string" ? resolve(flags.get("out") as string) : join(root, ".repoladder");

/** A clean failure with a stable code: the message is already printed; the code is what a usage ping reports. */
class Exit extends Error {
  code: string; status: number;
  constructor(code: string, status: number) { super(code); this.code = code; this.status = status; }
}

const exitOnFail = <T>(f: () => T): T => {
  try { return f(); } catch (e) { if (e instanceof Exit) process.exit(e.status); throw e; }
};

const writeJson = (name: string, v: unknown) => writeFileSync(join(out, name), JSON.stringify(v, null, 1) + "\n");
// Machine files (read only by tools) are written compact: facts.json alone is ~40MB indented on a very large repo.
const writeCompact = (name: string, v: unknown) => writeFileSync(join(out, name), JSON.stringify(v) + "\n");

function runAnalyze(log: (s: string) => void = console.log, onProgress?: OnProgress): { facts: Facts; grouping: Grouping } {
  mkdirSync(out, { recursive: true });
  const t0 = performance.now();
  let facts: Facts;
  try {
    facts = analyze(root, {}, NO_LIMITS, onProgress);
  } catch (e) {
    if (e instanceof InputError) {
      console.error(`${e.code}: ${LIMIT_MESSAGES[e.code].message({ ...e.detail, root })}`);
      throw new Exit(e.code, LIMIT_MESSAGES[e.code].status);
    }
    throw e;
  }
  const grouping = defaultGrouping(facts);
  writeCompact("facts.json", facts);
  writeJson("grouping.default.json", grouping);
  log(`analyzed ${facts.files.length} files in ${Math.round(performance.now() - t0)}ms → ${join(out, "facts.json")}`);
  for (const p of facts.packages) {
    const n = facts.files.filter((f) => f.pkg === p.id).length;
    log(`  ${p.id.padEnd(16)} ${p.kind.padEnd(8)} ${String(n).padStart(5)} files  ${p.dir || "."}`);
  }
  log(`  imports ${facts.imports.length} · externals ${facts.externals.length} · unresolved ${facts.unresolved.length}`);
  log(`  services ${facts.services.map((s) => s.name).join(", ") || "none"}`);
  log(`  endpoints ${facts.endpoints.length} · calls ${facts.calls.length}`);
  return { facts, grouping };
}

const groupingFile = () => (typeof flags.get("grouping") === "string" ? resolve(flags.get("grouping") as string) : join(out, "grouping.json"));
const usingDefault = () => flags.has("default") || !existsSync(groupingFile());

// The map's name for this build, in place of the folder name; the facts on disk keep the folder name.
const titleFlag = (): string | undefined => {
  const t = flags.get("title");
  if (t === undefined) return undefined;
  if (t === true || !t.trim()) {
    console.error('INVALID_TITLE: --title needs a name, e.g. --title "My App"');
    throw new Exit("INVALID_TITLE", 1);
  }
  return t.trim();
};

// The fidelity profile (model/profile.ts); anything but "full" or "hosted" exits 2.
const profileFlag = (): Profile => {
  const p = flags.get("profile");
  try { return resolveProfile(p === true ? "" : p); } catch (e) {
    console.error(`INVALID_OPTIONS: ${(e as Error).message}`);
    throw new Exit("INVALID_OPTIONS", 2);
  }
};

async function runBuild(seen: { files: number }) {
  const title = titleFlag();
  const profile = profileFlag();
  const started = performance.now();
  const factsPath = join(out, "facts.json");
  const progress = flags.has("quiet") ? undefined : progressPrinter({ write: (l) => console.error(l) });
  // installed only once the async layout starts: the analyzer is synchronous, so a handler would make it uninterruptible
  let uninstall = () => {};
  try {
    const reuse = existsSync(factsPath) && !flags.has("fresh");
    if (reuse) progress?.({ stage: "read", kind: "note", message: `using the facts in ${factsPath} (--fresh re-reads the source)` });
    const analyzed = reuse ? null : timedSync("analyze", () => runAnalyze(console.log, progress));
    const loaded: Facts = analyzed ? analyzed.facts : Facts.parse(JSON.parse(readFileSync(factsPath, "utf8")));
    const facts: Facts = title ? { ...loaded, repo: title } : loaded;
    seen.files = facts.files.length;
    const groupingPath = groupingFile();
    let grouping: Grouping | null = null;
    if (usingDefault()) {
      console.log("using the default (folder-based) grouping");
    } else {
      const parsed = Grouping.safeParse(JSON.parse(readFileSync(groupingPath, "utf8")));
      if (!parsed.success) {
        console.error(`INVALID ${groupingPath}\n` + parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n"));
        throw new Exit("INVALID_SCHEMA", 2);
      }
      grouping = parsed.data;
    }
    let r;
    uninstall = installInterrupt({ flush: flushActive, write: (m) => progress?.({ stage: "layout", kind: "note", message: m }) });
    try {
      r = await buildDiagram({
        facts, grouping,
        // the default grouping runAnalyze just wrote; --title changes facts.repo, which its summary text embeds
        // (and it was split with the full profile's arrow counts)
        defaultGrouping: title || profile !== "full" ? undefined : analyzed?.grouping,
        profile,
        read: (f) => { try { return readFileSync(join(root, f), "utf8"); } catch { return null; } },
        cacheDir: out, lane: !flags.has("no-lane"), log: (s) => console.log(s), onProgress: progress,
        features: resolveFeatures(process.env, { dial: flags.has("dial") || undefined, story: flags.has("story") || undefined }),
      });
    } catch (e) {
      if (e instanceof BuildError) { console.error(e.message); throw new Exit(e.code, e.status); }
      throw e;
    }
    const { model, html, report } = r;
    const file = join(out, "diagram.html");
    stepSync(progress, { stage: "write" }, () => {
      writeCompact("model.json", model);
      writeFileSync(file, html);
      // the digestibility budget (budget.ts): a board over it likely wants another level; reported, not an error
      writeCompact("lint.json", report);
    });
    const over = budgetLines(report);
    if (over.length) console.log(`${over.length}/${report.budget.boards} boards over the digestibility budget (lint.json has every board):\n${over.join("\n")}`);
    // a grouping Claude wrote is never split mechanically, so its dense file boards are warned about instead
    if (grouping && profile === "full") for (const w of fileArrowWarnings(model, report, facts)) console.log(`WARN ${w}`);
    // every connection should be an arrow on some rung (#452): a warning, never a failure
    for (const l of coverageLines(report.coverage)) console.log(l);
    console.log(`BUILD_OK ${file} (${Math.round(html.length / 1024)}KB, ${Object.keys(model.boards).length} boards)`);
    timing("total", performance.now() - started);
  } finally {
    uninstall();
  }
}

async function runExport() {
  const modelPath = join(out, "model.json");
  if (!existsSync(modelPath)) {
    console.error(`NO_MODEL: ${modelPath} not found. Run \`repoladder build\` first.`);
    process.exit(2);
  }
  const model: Model = JSON.parse(readFileSync(modelPath, "utf8"));
  const format = flags.get("format") ?? "svg", theme = flags.get("theme") ?? "light", only = flags.get("board");
  if (format !== "svg" && format !== "png") { console.error("--format must be svg or png"); process.exit(1); }
  if (theme !== "light" && theme !== "dark") { console.error("--theme must be light or dark"); process.exit(1); }
  const ids = Object.keys(model.boards).sort();
  if (typeof only === "string" && !model.boards[only]) {
    console.error(`UNKNOWN_BOARD ${only}; boards: ${ids.join(", ")}`);
    process.exit(2);
  }
  const layout = await layoutBoards(model, { cacheDir: out, lane: !flags.has("no-lane") });
  const dir = join(out, "export");
  mkdirSync(dir, { recursive: true });
  const names = fileNames(ids);
  const files: { svg: string; png: string; width: number; height: number }[] = [];
  ids.forEach((id, i) => {
    if (typeof only === "string" && id !== only) return;
    const svg = boardSvg(model, id, layout[id], theme as Theme);
    const base = join(dir, `${names[i]}-${theme}`);
    writeFileSync(`${base}.svg`, svg);
    const [, , w, h] = svg.match(/viewBox="([^"]+)"/)![1].split(" ").map(Number);
    files.push({ svg: `${base}.svg`, png: `${base}.png`, width: w, height: h });
  });
  for (const f of files) console.log(`  ${f.svg}`);
  if (format === "png") {
    if (await svgsToPngs(files)) for (const f of files) console.log(`  ${f.png}`);
    else console.log("PNG_UNAVAILABLE: Playwright (with Chromium) is not installed, so only SVGs were written. `npm i -D playwright && npx playwright install chromium` enables PNG.");
  }
  console.log(`EXPORT_OK ${dir} (${files.length} board${files.length === 1 ? "" : "s"}, ${theme})`);
}

const USAGE = `usage: repoladder <preflight|install|usage|analyze|summary|build|export|serve> [root] [--out dir] [--default] [--grouping file] [--fresh] [--title name] [--part leafId] [--board id] [--format svg|png] [--theme light|dark] [--no-lane] [--profile full|hosted] [--dial] [--story] [--quiet] [--port n] [--no-open] [--help] [--version]`;
if (cmd === "--help" || cmd === "-h" || cmd === "help") { console.log(USAGE); process.exit(0); }
if (cmd === "--version" || cmd === "-v" || cmd === "version") { console.log(version()); process.exit(0); }

switch (cmd) {
  case "preflight": {
    const major = Number(process.versions.node.split(".")[0]);
    const missing = missingDeps();
    if (major < 20) console.log(`PREFLIGHT_NODE_TOO_OLD node=${process.version} (need 20+)`);
    else if (missing.length) console.log(`PREFLIGHT_NEEDS_INSTALL missing=${missing.join(",")}${channel() === "npm" ? " (reinstall the repoladder package with npm)" : ""}`);
    else console.log(`PREFLIGHT_OK node=${process.version} cwd=${process.cwd()}`);
    // the skill asks the usage question once (PRIVACY.md); never when an env var opts out
    // (the npm package asks in the terminal at the first build instead)
    if (channel() !== "npm" && usageState() === "ask") console.log("USAGE_ASK");
    break;
  }
  case "usage": {
    // `usage yes|no` stores the answer; bare `usage` says what is stored
    const answer = args[0];
    if (answer === "yes" || answer === "no") writeConsent(answer);
    else if (answer !== undefined) { console.error("usage: repoladder usage [yes|no]"); process.exit(1); }
    console.log(`USAGE_${usageState().toUpperCase()}`);
    break;
  }
  case "install": {
    // the npm package's dependencies come with the package: nothing to install here
    if (channel() === "npm") {
      const missing = missingDeps();
      console.log(missing.length ? `INSTALL_FAILED missing=${missing.join(",")}: reinstall the repoladder package with npm` : "INSTALL_OK npm installed the dependencies with the repoladder package");
      break;
    }
    // dist/repoladder.mjs -> plugin root
    const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
    runNpmInstall(pluginRoot);
    console.log(missingDeps().length ? "INSTALL_FAILED" : "INSTALL_OK");
    break;
  }
  case "summary": {
    const part = flags.get("part");
    if (part === true) { console.error("--part needs a leaf id from grouping.json"); process.exit(1); }
    // two-pass grouping (#257): one placeholder leaf's digest, read against the grouping written so far
    let partOf = null;
    if (typeof part === "string") {
      try { partOf = Grouping.safeParse(JSON.parse(readFileSync(groupingFile(), "utf8"))); } catch { /* missing, or not JSON */ }
      if (!partOf?.success) { console.error(`NO_GROUPING: summary --part needs a valid ${groupingFile()} (write the top rungs first)`); process.exit(2); }
    }
    const factsPath = join(out, "facts.json");
    const facts = existsSync(factsPath) && !flags.has("fresh") ? Facts.parse(JSON.parse(readFileSync(factsPath, "utf8"))) : exitOnFail(() => runAnalyze((s) => console.error(s))).facts;
    if (typeof part === "string" && partOf?.success) {
      try { process.stdout.write(summarizePart(facts, partOf.data, part)); }
      catch (e) { if (e instanceof PartError) { console.error(e.message); process.exit(2); } throw e; }
      break;
    }
    // on a re-run, the digest also lists the earlier grouping's big leaves that have no split yet
    let written = null;
    try { written = Grouping.safeParse(JSON.parse(readFileSync(groupingFile(), "utf8"))); } catch { /* none yet, or not JSON */ }
    process.stdout.write(summarize(facts, written?.success ? written.data : undefined, resolveFeatures(process.env, { story: flags.has("story") || undefined })));
    break;
  }
  case "analyze":
    exitOnFail(() => runAnalyze());
    break;
  case "build": {
    if (channel() === "npm") await askUsageOnce({ input: process.stdin, output: process.stdout, prompt: process.stderr });
    const t0 = performance.now(), seen = { files: 0 };
    let status = 0, error: string | undefined;
    try { await runBuild(seen); }
    catch (e) {
      if (!(e instanceof Exit)) console.error(e);
      [status, error] = e instanceof Exit ? [e.status, e.code] : [1, "CRASH"];
    }
    await sendPing({ ok: !status, error, files: seen.files, ms: performance.now() - t0, mode: usingDefault() ? "default" : "ai" });
    process.exit(status); // the D2 wasm worker keeps the event loop alive
  }
  case "export":
    await runExport();
    process.exit(0);
  case "serve": {
    const portFlag = flags.get("port");
    let port = 0;
    if (portFlag !== undefined) {
      port = portFlag === true || !/^\d+$/.test(portFlag) ? -1 : Number(portFlag);
      if (port < 0 || port > 65535) { console.error("INVALID_OPTIONS: --port needs a number from 0 to 65535"); process.exit(2); }
    }
    const page = join(out, "diagram.html");
    if (!existsSync(page)) {
      console.error(`NO_MAP: no map at ${page}; building one with the folder-based grouping (run /map for a named one)`);
      flags.set("default", true);
      try { await runBuild({ files: 0 }); } catch (e) { if (e instanceof Exit) process.exit(e.status); throw e; }
    }
    const { startServer, pageFromFile } = await import("./serve/index.ts");
    let running;
    try { running = await startServer({ page: pageFromFile(page), port }); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EADDRINUSE") { console.error(`PORT_IN_USE: port ${port} is in use; pick another or omit --port`); process.exit(1); }
      throw e;
    }
    console.log(`SERVE_OK ${running.url}`);
    console.error("Press Ctrl+C to stop.");
    if (!flags.has("no-open")) (await import("./serve/open.ts")).openBrowser(running.url);
    const stop = async () => { await running.close(); console.log("SERVE_STOPPED"); process.exit(0); };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    break;
  }
  default:
    console.error(USAGE);
    process.exit(1);
}
