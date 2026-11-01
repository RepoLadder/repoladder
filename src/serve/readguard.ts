// Keeps the Ask agent's Read, Grep and Glob inside the repo: the permission rules deny secrets by name, this denies everything outside the root.
// Run as a PreToolUse hook (`repoladder readguard <root>`): the tool call arrives as JSON on stdin and the answer is JSON on stdout. Fails closed.
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export type GuardDecision = { allow: true } | { allow: false; reason: string };

const GLOB_CHARS = /[*?[\]{}()!]/;

/** The path with symlinks resolved, using the nearest existing parent when the file itself is not there. */
function real(p: string): string {
  let cur = resolve(p);
  const tail: string[] = [];
  while (!existsSync(cur)) {
    const up = dirname(cur);
    if (up === cur) return resolve(p);
    tail.unshift(cur.slice(up.length + 1));
    cur = up;
  }
  try { return join(realpathSync(cur), ...tail); } catch { return resolve(p); }
}

const inside = (root: string, p: string): boolean => {
  const rel = relative(root, p);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
};

const expand = (p: string): string => (p === "~" || p.startsWith("~/") ? join(homedir(), p.slice(1)) : p);

/** The part of a glob before its first wildcard: the directory it is anchored in. */
const staticPrefix = (pattern: string): string => {
  const parts = pattern.split("/");
  const keep: string[] = [];
  for (const part of parts) { if (GLOB_CHARS.test(part)) break; keep.push(part); }
  return keep.join("/") || (pattern.startsWith("/") ? "/" : ".");
};

/** Whether one tool call may run. Only Read, Grep and Glob are judged; the hook is registered for those alone. */
export function decide(input: unknown, root: string): GuardDecision {
  const deny = (what: string): GuardDecision => ({ allow: false, reason: `Ask may only look inside the repo: ${what} is outside it.` });
  if (!input || typeof input !== "object") return { allow: false, reason: "Ask could not read the tool call, so it was refused." };
  const call = input as { tool_name?: unknown; tool_input?: unknown };
  const ti = call.tool_input && typeof call.tool_input === "object" ? (call.tool_input as Record<string, unknown>) : null;
  if (typeof call.tool_name !== "string" || !ti) return { allow: false, reason: "Ask could not read the tool call, so it was refused." };
  const base = real(root);
  const str = (k: string): string | undefined => (typeof ti[k] === "string" ? (ti[k] as string) : undefined);
  const check = (p: string, from: string): boolean => inside(base, real(resolve(from, expand(p))));

  switch (call.tool_name) {
    case "Read": {
      const f = str("file_path");
      if (f === undefined) return { allow: false, reason: "Read had no file path, so it was refused." };
      return check(f, base) ? { allow: true } : deny(f);
    }
    case "Grep":
    case "Glob": {
      const dir = str("path");
      let from = base;
      if (dir !== undefined) {
        if (!check(dir, base)) return deny(dir);
        from = real(resolve(base, expand(dir)));
      }
      for (const key of call.tool_name === "Glob" ? ["pattern"] : ["glob"]) {
        const g = str(key);
        if (g === undefined) continue;
        if (g.split("/").includes("..") || g.startsWith("~")) return deny(g);
        if (isAbsolute(g) && !check(staticPrefix(g), base)) return deny(g);
        if (!isAbsolute(g) && !check(staticPrefix(g), from)) return deny(g);
      }
      return { allow: true };
    }
    default:
      return { allow: true };
  }
}

/** The PreToolUse hook output Claude Code expects. An allowed call prints nothing, so the permission rules still decide it (a hook "allow" must not outrank them). */
export function hookOutput(d: GuardDecision): string {
  if (d.allow) return "";
  return JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: d.reason } });
}

/** Reads the hook input from stdin text; anything unparseable is refused. */
export function runGuard(stdin: string, root: string): string {
  let input: unknown;
  try { input = JSON.parse(stdin); } catch { input = null; }
  return hookOutput(decide(input, root));
}
