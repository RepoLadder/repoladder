// Leak guard: fails on internal terms, home-directory paths and secrets, so the public cut stays clean.
//
//   node scripts/leakguard.ts                    tree: every tracked file (allowlist + baseline from leakguard.private.json)
//   node scripts/leakguard.ts --strict           tree with no allowlist and no baseline (the scrubbed-tree gate)
//   node scripts/leakguard.ts --diff <range>     only lines added in a git range, minus lines already on origin/develop or origin/main
//   node scripts/leakguard.ts --pre-push         the pre-push hook (reads git's stdin), scanned the same way
//   node scripts/leakguard.ts --text < draft.md  arbitrary text, rules only (also --file <path>)
//   flags: --dry-run (always exit 0) --json --update-baseline --gitleaks --no-gitleaks --require-gitleaks
//
// Output is `file:line: [rule] why` and never the matched text (CI logs and drafts may end up public).
// Rules live in leakguard.config.json (patterns only); owner-only extras in .leakguard.local.json (gitignored).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export type Rule = { id: string; why: string; re: RegExp; placeholderGroup?: number; placeholders?: Set<string> };
export type Finding = { file: string; line: number; rule: string; why: string };
export type ConfigJson = {
  rules?: { id: string; why: string; regex?: string; parts?: string[]; flags?: string; placeholderGroup?: number }[];
  placeholders?: string[];
};
export type PrivateJson = { allowlist?: string[]; baseline?: Record<string, number> };
export type Mode = "tree" | "diff" | "pre-push" | "text";
export type Options = {
  mode: Mode;
  range?: string;
  file?: string;
  strict: boolean;
  dryRun: boolean;
  json: boolean;
  updateBaseline: boolean;
  gitleaks: boolean;
  noGitleaks: boolean;
  requireGitleaks: boolean;
};

const IMAGE = /\.(png|jpe?g|gif|webp|ico)$/i;
const EXCLUDED = [/^plugin\/dist\//, /^package-lock\.json$/, /^judge\/holdout\.json$/, /^\.git\//];
const LOCAL_FILE = ".leakguard.local.json";
const PRIVATE_FILE = "scripts/leakguard.private.json";
const MAX_BYTES = 8 << 20;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function isExcluded(path: string): boolean {
  return EXCLUDED.some((r) => r.test(path));
}

/** Rules from the shared config plus optional owner terms (`{ terms: string[] }`); a bad local value is ignored. */
export function loadRules(config: ConfigJson, local?: unknown): Rule[] {
  const placeholders = new Set((config.placeholders ?? []).map((p) => p.toLowerCase()));
  const rules: Rule[] = [];
  for (const r of config.rules ?? []) {
    const source = r.parts ? escapeRe(r.parts.join("")) : r.regex;
    if (!source) continue;
    const flags = new Set(`${r.flags ?? ""}${r.parts ? "i" : ""}g`.split(""));
    const rule: Rule = { id: r.id, why: r.why, re: new RegExp(source, [...flags].join("")) };
    if (r.placeholderGroup) Object.assign(rule, { placeholderGroup: r.placeholderGroup, placeholders });
    rules.push(rule);
  }
  const terms = local && typeof local === "object" ? (local as { terms?: unknown }).terms : undefined;
  if (Array.isArray(terms)) {
    for (const t of terms) {
      if (typeof t === "string" && t.trim()) rules.push({ id: "local-term", why: "owner-private term", re: new RegExp(escapeRe(t.trim()), "gi") });
    }
  }
  return rules;
}

/** Every rule that hits `text`, one finding per rule per line. */
export function scanText(name: string, text: string, rules: Rule[], firstLine = 1): Finding[] {
  const out: Finding[] = [];
  text.split("\n").forEach((line, i) => {
    for (const rule of rules) {
      rule.re.lastIndex = 0;
      for (const m of line.matchAll(rule.re)) {
        if (rule.placeholderGroup && rule.placeholders?.has((m[rule.placeholderGroup] ?? "").toLowerCase())) continue;
        out.push({ file: name, line: firstLine + i, rule: rule.id, why: rule.why });
        break;
      }
    }
  });
  return out;
}

/** A file name that itself matches a rule (reported as line 0). */
export function scanPath(path: string, rules: Rule[]): Finding[] {
  return scanText(path, path, rules).map((f) => ({ ...f, line: 0 }));
}

/** Added lines (file, line number, text) from `git diff --unified=0` output. */
export function parseAddedLines(diff: string): { file: string; line: number; text: string }[] {
  const out: { file: string; line: number; text: string }[] = [];
  let file = "";
  let next = 0;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("+++ ")) {
      file = raw === "+++ /dev/null" ? "" : raw.replace(/^\+\+\+ (b\/)?/, "");
      continue;
    }
    if (raw.startsWith("--- ")) continue;
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (h) {
      next = Number(h[1]);
      continue;
    }
    if (raw.startsWith("+") && file) out.push({ file, line: next++, text: raw.slice(1) });
  }
  return out;
}

const globRe = (g: string) => new RegExp(`^${g.split("*").map(escapeRe).join(".*")}(?:/.*)?$`);

/** Allowlist entries: an exact path, a directory (`dir/` or `dir`), or a `*` glob. */
export function isAllowlisted(path: string, allowlist: string[]): boolean {
  return allowlist.some((g) => (g.endsWith("/") ? path.startsWith(g) : globRe(g).test(path)));
}

export function applyAllowlist(findings: Finding[], allowlist: string[]): Finding[] {
  return findings.filter((f) => !isAllowlisted(f.file, allowlist));
}

const baselineKey = (f: Finding) => `${f.rule}:${f.file}`;

/** Ratchet: a `rule:path` pair fails only when its hit count exceeds the baseline. `shrink` lists pairs that fell. */
export function applyBaseline(findings: Finding[], baseline: Record<string, number>): { findings: Finding[]; shrink: string[] } {
  const groups = new Map<string, Finding[]>();
  for (const f of findings) groups.set(baselineKey(f), [...(groups.get(baselineKey(f)) ?? []), f]);
  const failing: Finding[] = [];
  for (const [key, fs] of groups) if (fs.length > (baseline[key] ?? 0)) failing.push(...fs);
  const shrink = Object.entries(baseline).filter(([key, n]) => (groups.get(key)?.length ?? 0) < n).map(([key]) => key);
  return { findings: failing, shrink };
}

export function countBaseline(findings: Finding[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of findings) counts[baselineKey(f)] = (counts[baselineKey(f)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export function formatFinding(f: Finding): string {
  return `${f.file}:${f.line}: [${f.rule}] ${f.why}`;
}

export type ImageReport = { count: number; bytes: number; dirs: Record<string, number> };

export function imageReport(files: string[], size: (path: string) => number): ImageReport {
  const imgs = files.filter((f) => IMAGE.test(f) && !f.startsWith("plugin/dist/"));
  const dirs: Record<string, number> = {};
  for (const f of imgs) {
    const dir = f.includes("/") ? f.slice(0, f.lastIndexOf("/") + 1) : "./";
    dirs[dir] = (dirs[dir] ?? 0) + 1;
  }
  return { count: imgs.length, bytes: imgs.reduce((n, f) => n + size(f), 0), dirs: Object.fromEntries(Object.entries(dirs).sort(([a], [b]) => (a < b ? -1 : 1))) };
}

const ZERO = /^0+$/;

export function integrationBase(sha: string, git: (args: string[]) => string): { ref: string; sha: string } | null {
  for (const ref of ["origin/develop", "origin/main"]) {
    try {
      const b = git(["merge-base", sha, ref]).trim();
      if (b) return { ref, sha: b };
    } catch {
      // try the next base
    }
  }
  return null;
}

/** The right-hand side of `a..b` / `a...b`, or null when the range has no explicit tip. */
export function rangeTip(range: string): string | null {
  const i = range.indexOf("..");
  if (i <= 0) return null;
  const tip = range.slice(i).replace(/^\.+/, "");
  return tip || null;
}

/** Diff ranges for git's pre-push stdin (`<lref> <lsha> <rref> <rsha>` per line). `range: null` means scan the whole tree. */
export function pushRanges(stdin: string, git: (args: string[]) => string): { ref: string; range: string | null }[] {
  const out: { ref: string; range: string | null }[] = [];
  const mergeBase = (sha: string): string | null => {
    const b = integrationBase(sha, git);
    return b ? `${b.sha}..${sha}` : null;
  };
  for (const line of stdin.split("\n")) {
    const [lref, lsha, , rsha] = line.trim().split(/\s+/);
    if (!lref || !lsha || !rsha || ZERO.test(lsha)) continue;
    if (ZERO.test(rsha)) {
      out.push({ ref: lref, range: mergeBase(lsha) });
      continue;
    }
    try {
      git(["cat-file", "-e", `${rsha}^{commit}`]);
      out.push({ ref: lref, range: `${rsha}..${lsha}` });
    } catch {
      out.push({ ref: lref, range: mergeBase(lsha) });
    }
  }
  return out;
}

export function parseOptions(argv: string[]): Options {
  const o: Options = { mode: "tree", strict: false, dryRun: false, json: false, updateBaseline: false, gitleaks: false, noGitleaks: false, requireGitleaks: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--strict") o.strict = true;
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--json") o.json = true;
    else if (a === "--update-baseline") o.updateBaseline = true;
    else if (a === "--gitleaks") o.gitleaks = true;
    else if (a === "--no-gitleaks") o.noGitleaks = true;
    else if (a === "--require-gitleaks") o.requireGitleaks = true;
    else if (a === "--pre-push") o.mode = "pre-push";
    else if (a === "--text") o.mode = "text";
    else if (a === "--diff") {
      o.mode = "diff";
      o.range = argv[++i];
      if (!o.range) throw new Error("--diff needs a range");
    } else if (a === "--file") {
      o.mode = "text";
      o.file = argv[++i];
      if (!o.file) throw new Error("--file needs a path");
    } else if (a.startsWith("-")) throw new Error(`unknown flag ${a}`);
    // bare arguments are ignored: git passes the remote name and url to a pre-push hook
  }
  return o;
}

/** Runs gitleaks with the args; returns its exit status, or null when it is not installed. */
export type GitleaksRunner = (args: string[]) => number | null;

export type Deps = {
  git: (args: string[]) => string;
  gitleaks: GitleaksRunner;
  readFile: (path: string) => string | null;
  fileSize: (path: string) => number;
  readStdin: () => string;
  config: ConfigJson;
  readPrivate: () => PrivateJson | null;
  readLocal: () => { value?: unknown; warning?: string };
  writePrivate: (p: PrivateJson) => void;
  out: (s: string) => void;
  err: (s: string) => void;
};

const gitleaksArgs = (sub: string[]) => [...sub, "--redact", "--no-banner", "--config", ".gitleaks.toml"];

export function run(opts: Options, d: Deps): number {
  const local = d.readLocal();
  if (local.warning) d.err(`leak guard: ${local.warning}`);
  const rules = loadRules(d.config, local.value);
  const priv = opts.strict || opts.mode === "text" ? null : d.readPrivate();
  const allowlist = priv?.allowlist ?? [];
  let findings: Finding[] = [];
  let shrink: string[] = [];
  let images: ImageReport | null = null;
  const gitleaksRuns: string[][] = [];
  const treeScan = () => {
    const files = d.git(["ls-files", "-z"]).split("\0").filter((f) => f && !isExcluded(f));
    const scope = opts.strict ? files : files.filter((f) => !isAllowlisted(f, allowlist));
    const fs: Finding[] = [];
    for (const f of scope) {
      fs.push(...scanPath(f, rules));
      const text = d.readFile(f);
      if (text !== null) fs.push(...scanText(f, text, rules));
    }
    images = imageReport(files, d.fileSize);
    return fs;
  };
  const diffScan = (range: string): { findings: Finding[]; logOpts: string } => {
    const diffOf = (r: string) => d.git(["-c", "core.quotepath=off", "diff", "--unified=0", "--no-color", "--no-ext-diff", r]);
    let added = parseAddedLines(diffOf(range)).filter((l) => !isExcluded(l.file));
    let logOpts = range;
    // lines already on the integration branch (e.g. from merging develop in) are not this push's to answer for
    if (!opts.strict) {
      try {
        const tip = rangeTip(range);
        const base = tip ? integrationBase(tip, d.git) : null;
        if (tip && base) {
          const key = (l: { file: string; text: string }) => `${l.file}\0${l.text}`;
          const known = new Set(parseAddedLines(diffOf(`${base.sha}..${tip}`)).map(key));
          added = added.filter((l) => known.has(key(l)));
          logOpts = `${range} ^${base.ref}`;
        }
      } catch {
        // never loosen the scan on a git failure
      }
    }
    const files = new Set(added.map((l) => l.file));
    let fs: Finding[] = [...files].flatMap((f) => scanPath(f, rules));
    for (const l of added) fs.push(...scanText(l.file, l.text, rules, l.line));
    if (!opts.strict) fs = applyAllowlist(fs, allowlist);
    return { findings: fs, logOpts };
  };

  let defaultGitleaks = false;
  if (opts.mode === "text") {
    if (opts.file !== undefined) {
      const text = d.readFile(opts.file);
      if (text === null) throw new Error(`cannot read ${opts.file}`);
      findings = scanText(opts.file, text, rules);
      gitleaksRuns.push(["dir", opts.file]);
    } else {
      findings = scanText("<stdin>", d.readStdin(), rules);
    }
  } else if (opts.mode === "diff") {
    const r = diffScan(opts.range as string);
    findings = r.findings;
    gitleaksRuns.push(["git", `--log-opts=${r.logOpts}`]);
  } else if (opts.mode === "pre-push") {
    defaultGitleaks = true;
    for (const { range } of pushRanges(d.readStdin(), d.git)) {
      if (range) {
        const r = diffScan(range);
        findings.push(...r.findings);
        gitleaksRuns.push(["git", `--log-opts=${r.logOpts}`]);
      } else {
        // no base to diff against: scan the whole tree, with the ratchet so known hits don't block the push
        const tree = treeScan();
        findings.push(...(opts.strict ? tree : applyBaseline(tree, priv?.baseline ?? {}).findings));
        gitleaksRuns.push(["dir", "."]);
      }
    }
  } else {
    defaultGitleaks = !opts.strict && !opts.dryRun;
    findings = treeScan();
    gitleaksRuns.push(["dir", "."]);
    if (opts.updateBaseline) {
      d.writePrivate({ ...(priv ?? {}), allowlist, baseline: countBaseline(applyAllowlist(findings, allowlist)) });
      d.err(`leak guard: wrote the baseline to ${PRIVATE_FILE}`);
      return 0;
    }
    if (!opts.strict) {
      const r = applyBaseline(findings, priv?.baseline ?? {});
      findings = r.findings;
      shrink = r.shrink;
    }
  }

  let failed = findings.length > 0;
  let gitleaksState = "skipped";
  const wantGitleaks = !opts.noGitleaks && (opts.gitleaks || opts.requireGitleaks || defaultGitleaks);
  if (wantGitleaks) {
    if (opts.mode === "text" && opts.file === undefined) {
      d.err("leak guard: gitleaks cannot scan stdin; use --file for a secrets scan");
    } else {
      gitleaksState = "ok";
      for (const args of gitleaksRuns) {
        const status = d.gitleaks(gitleaksArgs(args));
        if (status === null) {
          gitleaksState = "absent";
          if (opts.requireGitleaks) {
            d.err("leak guard: gitleaks is required but not installed");
            failed = true;
          } else d.err("leak guard: gitleaks not installed, secrets scan skipped (brew install gitleaks)");
          break;
        }
        if (status !== 0) {
          gitleaksState = "found";
          failed = true;
        }
      }
    }
  }

  if (opts.json) {
    d.out(JSON.stringify({ findings, images, gitleaks: gitleaksState }, null, 2));
  } else {
    for (const f of findings) d.out(formatFinding(f));
  }
  const im = images as ImageReport | null;
  if (im && im.count > 0) {
    const where = Object.entries(im.dirs).map(([dir, n]) => `${dir} (${n})`).join(", ");
    d.err(`leak guard: ${im.count} images (${(im.bytes / 1048576).toFixed(1)} MB) cannot be text-scanned: review by hand: ${where}`);
  }
  if (shrink.length > 0) d.err(`leak guard: baseline can shrink (${shrink.length} entries are lower now): node scripts/leakguard.ts --update-baseline`);
  if (findings.length > 0) d.err(`leak guard: ${findings.length} finding${findings.length === 1 ? "" : "s"}`);
  if (opts.dryRun) return 0;
  return failed ? 1 : 0;
}

function realDeps(root: string): Deps {
  const readJson = <T>(rel: string): T | null => {
    try {
      return JSON.parse(readFileSync(join(root, rel), "utf8")) as T;
    } catch {
      return null;
    }
  };
  return {
    git: (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 256 << 20, stdio: ["ignore", "pipe", "ignore"] }),
    gitleaks: (args) => {
      // a checkout without the config file (a copied-out guard) falls back to gitleaks' defaults
      const withConfig = existsSync(join(root, ".gitleaks.toml")) ? args : args.filter((a, i) => a !== "--config" && args[i - 1] !== "--config");
      const r = spawnSync("gitleaks", withConfig, { cwd: root, stdio: ["ignore", "inherit", "inherit"] });
      return (r.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT" ? null : (r.status ?? 1);
    },
    readFile: (p) => {
      try {
        const abs = join(root, p);
        if (statSync(abs).size > MAX_BYTES) return null;
        const buf = readFileSync(abs);
        return buf.includes(0) ? null : buf.toString("utf8");
      } catch {
        return null;
      }
    },
    fileSize: (p) => {
      try {
        return statSync(join(root, p)).size;
      } catch {
        return 0;
      }
    },
    readStdin: () => {
      try {
        return readFileSync(0, "utf8");
      } catch {
        return "";
      }
    },
    config: JSON.parse(readFileSync(join(root, "scripts/leakguard.config.json"), "utf8")) as ConfigJson,
    readPrivate: () => readJson<PrivateJson>(PRIVATE_FILE),
    readLocal: () => {
      // never in CI: the owner's terms are for local runs only
      if (process.env.CI || !existsSync(join(root, LOCAL_FILE))) return {};
      const value = readJson<unknown>(LOCAL_FILE);
      return value === null ? { warning: `${LOCAL_FILE} is not valid JSON; ignoring it` } : { value };
    },
    writePrivate: (p) => writeFileSync(join(root, PRIVATE_FILE), JSON.stringify(p, null, 2) + "\n"),
    out: (s) => console.log(s),
    err: (s) => console.error(s),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const opts = parseOptions(process.argv.slice(2));
    const text = opts.mode === "text";
    // text mode reads files by path from the caller's cwd, not from the repo root
    const deps = realDeps(root);
    if (text && opts.file !== undefined) {
      const base = deps.readFile;
      deps.readFile = (p) => {
        try {
          return readFileSync(p, "utf8");
        } catch {
          return base(p);
        }
      };
    }
    process.exit(run(opts, deps));
  } catch (e) {
    console.error(`leak guard: ${(e as Error).message}`);
    process.exit(2);
  }
}
