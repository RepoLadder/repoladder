// Decides which heavy CI jobs a pull request needs. Used by the `changes` job in .github/workflows/ci.yml.
//
//   EVENT=pull_request BASE_REF=develop BASE_SHA=<sha> HEAD_SHA=<sha> node scripts/cichanges.ts
//
// Writes `code=`, `windows=` and `viewer=` to $GITHUB_OUTPUT (stdout when unset). Fails safe: any doubt
// (not a PR, a PR into main, a git error, an empty or unparsable diff) means both are true, so every job runs.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export type Entry = { status: string; path: string };
export type Decision = { code: boolean; windows: boolean };

// Added or modified files here cannot affect any test, typecheck, build or install check.
// Not server/ (tests import server/ping/worker.ts).
const SKIP = [/^docs\//, /^CLAUDE\.md$/];

// Files that can change how the plugin installs or packages; the Windows (2x cost) install leg runs for these.
const WINDOWS = [
  /^src\/install/, /^src\/(cli|lib)\.ts$/,
  /^scripts\/(installcheck|build|bundle|npm-package|cichanges)\.ts$/,
  /^plugin\//, /^\.claude-plugin\//, /^package(-lock)?\.json$/, /^tsconfig/,
  /^\.github\/workflows\/ci\.yml$/,
];

// Paths that can change the viewer's fit, wire routing or drill-in timing; the viewer guard job (guardbase + motioncheck) runs for these.
const VIEWER = [
  /^src\/(viewer|build)\//, /^scripts\/(guardbase|guardcompare|motioncheck|cichanges)\.ts$/,
  /^test\/baselines\//, /^test\/fixtures\/tourapp\//, /^package(-lock)?\.json$/, /^\.github\/workflows\/ci\.yml$/,
];

export function touchesViewer(entries: Entry[]): boolean {
  return entries.some((e) => VIEWER.some((r) => r.test(e.path)));
}

export function classify(entries: Entry[]): Decision {
  if (entries.length === 0) return { code: true, windows: true };
  const code = !entries.every((e) => (e.status === "A" || e.status === "M") && SKIP.some((r) => r.test(e.path)));
  const windows = entries.some((e) => WINDOWS.some((r) => r.test(e.path)));
  return { code, windows };
}

// `git diff --name-status --no-renames` lines: "<status>\t<path>". Returns null when any line is unparsable.
export function parseNameStatus(out: string): Entry[] | null {
  const entries: Entry[] = [];
  for (const line of out.split("\n")) {
    if (line === "") continue;
    const m = /^([A-Z])\t(.+)$/.exec(line);
    if (!m) return null;
    entries.push({ status: m[1], path: m[2] });
  }
  return entries;
}

// Everything runs for anything that is not a feature PR: pushes, manual runs and PRs into main
// (the develop -> main release PR is the only CI gate, and it exists to run Windows).
export function runsEverything(event: string | undefined, baseRef: string | undefined): boolean {
  return event !== "pull_request" || baseRef === "main";
}

export function decide(env: Record<string, string | undefined>, git: (range: string) => string): Decision & { files: number } {
  const all = { code: true, windows: true, files: 0 };
  if (runsEverything(env.EVENT, env.BASE_REF) || !env.BASE_SHA || !env.HEAD_SHA) return all;
  try {
    const entries = parseNameStatus(git(`${env.BASE_SHA}...${env.HEAD_SHA}`));
    if (!entries || entries.length === 0) return all;
    return { ...classify(entries), files: entries.length };
  } catch {
    return all;
  }
}

// Fail-safe like `decide`: true for anything but a feature PR, and on any doubt.
export function decideViewer(env: Record<string, string | undefined>, git: (range: string) => string): boolean {
  if (runsEverything(env.EVENT, env.BASE_REF) || !env.BASE_SHA || !env.HEAD_SHA) return true;
  try {
    const entries = parseNameStatus(git(`${env.BASE_SHA}...${env.HEAD_SHA}`));
    return !entries || entries.length === 0 || touchesViewer(entries);
  } catch {
    return true;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const git = (range: string) => execFileSync("git", ["diff", "--name-status", "--no-renames", range], { encoding: "utf8" });
  const d = decide(process.env, git), viewer = decideViewer(process.env, git);
  const lines = `code=${d.code}\nwindows=${d.windows}\nviewer=${viewer}\n`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines);
  else process.stdout.write(lines);
  console.log(`::notice title=CI scope::code=${d.code} windows=${d.windows} viewer=${viewer} (${d.files} files)`);
}
