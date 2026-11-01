// Makes a private temp directory of symlinks so the one allowed shell command has a short, clean, absolute path.
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

/** A staged path ends up inside a permission rule: only plain characters. */
export const SAFE_PATH = /^[A-Za-z0-9_@%+=:,./~-]+$/;

export type Staged = { prefix: string; /** The PreToolUse hook command that keeps reads inside the repo. */ guard: string; dir: string; cleanup(): void };
export type StageOpts = { out: string; root: string; node: string; cli: string };

/** Returns null when no safe path can be built (the caller reports UNSAFE_PATH). */
export function stageAgentCommand({ out, root, node, cli }: StageOpts): Staged | null {
  let dir = "";
  try {
    dir = mkdtempSync(join(tmpdir(), "rl-ask-"));
    const cliName = `cli${extname(cli) || ".mjs"}`;
    symlinkSync(node, join(dir, "node"));
    symlinkSync(cli, join(dir, cliName));
    symlinkSync(out, join(dir, "out"));
    symlinkSync(root, join(dir, "root"));
    const prefix = `${dir}/node ${dir}/${cliName} query --out ${dir}/out`;
    const guard = `${dir}/node ${dir}/${cliName} readguard ${dir}/root`;
    if (SAFE_PATH.test(`${prefix} ${guard}`.replace(/ /g, ""))) return { prefix, guard, dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  } catch { /* fall through to the real paths */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
  const real = `${node} ${cli} query --out ${out}`;
  if ([node, cli, out, root].every((p) => SAFE_PATH.test(p))) return { prefix: real, guard: `${node} ${cli} readguard ${root}`, dir: "", cleanup: () => {} };
  return null;
}
