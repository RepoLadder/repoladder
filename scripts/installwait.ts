// Helpers for scripts/installcheck.ts: a bounded wait for the runtime deps that Claude Code installs
// after "claude plugin install" returns, and best-effort diagnostics for when they never arrive.
// No top-level side effects, so tests can import it.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { RUNTIME_DEPS } from "../src/install.ts";

export const NEEDS_INSTALL = "PREFLIGHT_NEEDS_INSTALL";
const OK = "PREFLIGHT_OK";

export const sleepSync = (ms: number): void => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

export interface WaitResult { ok: boolean; out: string; attempts: number; waitedMs: number }

export function waitForDeps(
  check: () => string,
  opts: { attempts?: number; delayMs?: number; sleep?: (ms: number) => void; now?: () => number } = {},
): WaitResult {
  const { attempts = 5, delayMs = 10_000, sleep = sleepSync, now = Date.now } = opts;
  let out = check();
  let count = 1;
  if (out.includes(OK)) return { ok: true, out, attempts: count, waitedMs: 0 };
  if (!out.includes(NEEDS_INSTALL)) return { ok: false, out, attempts: count, waitedMs: 0 };
  const start = now();
  for (let i = 0; i < attempts; i++) {
    sleep(delayMs);
    out = check();
    count++;
    if (out.includes(OK)) return { ok: true, out, attempts: count, waitedMs: now() - start };
    if (!out.includes(NEEDS_INSTALL)) return { ok: false, out, attempts: count, waitedMs: now() - start };
  }
  return { ok: false, out, attempts: count, waitedMs: now() - start };
}

const probe = (f: () => string[]): string[] => { try { return f(); } catch (e) { return [`(probe failed: ${(e as Error).message})`]; } };
const names = (dir: string): string[] => readdirSync(dir).filter((n) => n !== ".git").slice(0, 50);
const LOGGY = /\.(log|txt|jsonl)$/i;

function findLogs(root: string): { path: string; mtime: number }[] {
  const found: { path: string; mtime: number }[] = [];
  const walk = (dir: string, depth: number): void => {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const n of entries) {
      if (n === "node_modules" || n === ".git") continue;
      const p = join(dir, n);
      try {
        const st = statSync(p);
        if (st.isDirectory()) { if (depth < 3) walk(p, depth + 1); }
        else if (LOGGY.test(n) || /debug|logs/i.test(relative(root, p))) found.push({ path: p, mtime: st.mtimeMs });
      } catch { /* unreadable: skip */ }
    }
  };
  walk(root, 0);
  return found;
}

export function diagnoseInstall(installPath: string, configDir: string, deps: string[] = RUNTIME_DEPS): string[] {
  const lines: string[] = [];
  const has = (p: string): boolean => { try { return existsSync(p); } catch { return false; } };
  lines.push(...probe(() => [`installPath: ${installPath} exists=${has(installPath)}`]));
  for (const d of deps) lines.push(...probe(() => [`node_modules/${d}: ${has(join(installPath, "node_modules", d, "package.json")) ? "present" : "MISSING"}`]));
  for (const f of ["package.json", "package-lock.json"]) lines.push(...probe(() => [`${f}: ${has(join(installPath, f)) ? "present" : "MISSING"}`]));
  lines.push(...probe(() => has(installPath) ? [`installPath listing: ${names(installPath).join(", ")}`] : []));
  lines.push(...probe(() => has(join(installPath, "node_modules")) ? [`node_modules listing: ${names(join(installPath, "node_modules")).join(", ")}`] : []));
  lines.push(...probe(() => {
    const logs = findLogs(configDir).sort((a, b) => b.mtime - a.mtime).slice(0, 5);
    if (!logs.length) return [`no Claude log files found under ${configDir}`];
    return logs.flatMap((l) => {
      try {
        const body = readFileSync(l.path, "utf8").split("\n").slice(-40).join("\n").slice(-4096);
        return [`--- ${relative(configDir, l.path)} ---`, ...body.split("\n")];
      } catch (e) { return [`--- ${relative(configDir, l.path)} --- (unreadable: ${(e as Error).message})`]; }
    });
  }));
  lines.push(...probe(() => [`npm: ${String(execFileSync("npm", ["--version"], { encoding: "utf8", shell: process.platform === "win32" })).trim()}`]));
  return lines;
}
