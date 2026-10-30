// Agent-side leak hook: a Claude Code PreToolUse hook (wired in .claude/settings.json) that runs the leak guard
// (scripts/leakguard.ts --text) on the text a `git commit` or `gh issue|pr create|comment|edit` call is about to
// publish, so an agent rewords a commit message or post in the same turn instead of CI catching it later.
//
//   stdin  PreToolUse JSON: { "tool_name": "Bash", "tool_input": { "command": "..." }, "cwd": "..." }
//   exit 0 allow (also every uncertainty: guard absent, crashed or timed out, unreadable file, bad input, bug)
//   exit 2 block; stderr says to reword and carries the guard's reasons
//
// Only message and title/body text is scanned (flag values, heredoc bodies, -F / --body-file contents), never the
// command's path or repo arguments. The staged diff is left to the pre-push hook and CI.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const GUARD_REL = "scripts/leakguard.ts";
export const GUARD_ARGS = ["--text"];

export type Extracted = { texts: string[]; warnings: string[]; kinds: Set<"commit" | "gh"> };
export type Verdict = { code: 0 | 2; stderr: string };
type HookInput = { tool_name?: string; tool_input?: { command?: string }; cwd?: string };

const HEREDOC_IN_CAT = /\$\(\s*cat\s*<<-?\s*(['"]?)(\w+)\1[^\n]*\n([\s\S]*?)\n[ \t]*\2[ \t]*\)/g;
const HEREDOC = /<<-?\s*(['"]?)(\w+)\1([^\n]*)\n([\s\S]*?)\n[ \t]*\2[ \t]*(?=\n|$)/g;

/** Splits a command line into segments of words, honouring quotes; never throws. */
export function tokenize(src: string): string[][] {
  const segs: string[][] = [[]];
  let word = "", has = false, q: "" | "'" | '"' = "";
  const endWord = () => { if (has) segs[segs.length - 1].push(word); word = ""; has = false; };
  const endSeg = () => { endWord(); if (segs[segs.length - 1].length) segs.push([]); };
  const text = src.replace(/\\\r?\n/g, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q === "'") { if (c === "'") q = ""; else word += c; continue; }
    if (q === '"') {
      if (c === '"') q = "";
      else if (c === "\\" && i + 1 < text.length) { const n = text[++i]; word += n === '"' || n === "\\" || n === "$" || n === "`" ? n : "\\" + n; }
      else word += c;
      continue;
    }
    if (c === "'" || c === '"') { q = c; has = true; }
    else if (c === "\\" && i + 1 < text.length) { word += text[++i]; has = true; }
    else if (c === "#" && !has) { while (i + 1 < text.length && text[i + 1] !== "\n") i += 1; }
    else if (c === " " || c === "\t") endWord();
    else if (c === "\n" || c === ";" || c === "|" || c === "&" || c === "(" || c === ")") endSeg();
    else { word += c; has = true; }
  }
  endWord();
  return segs.filter((s) => s.length);
}

function readText(file: string, base: string, out: Extracted) {
  if (file === "-" || file === "") return;
  try {
    out.texts.push(readFileSync(isAbsolute(file) ? file : resolve(base, file), "utf8"));
  } catch {
    out.warnings.push(`leakhook: could not read ${file}; its text was not scanned`);
  }
}

// Value of an option given as `--opt value`, `--opt=value` or (for the listed short flags) `-x value`.
function optionValue(words: string[], i: number, longs: string[], shorts: string[]): { value: string; next: number } | null {
  const w = words[i];
  if (longs.includes(w) || shorts.includes(w)) return i + 1 < words.length ? { value: words[i + 1], next: i + 2 } : { value: "", next: i + 1 };
  for (const l of longs) if (w.startsWith(l + "=")) return { value: w.slice(l.length + 1), next: i + 1 };
  return null;
}

function gitCommit(words: string[], cwd: string, out: Extracted): boolean {
  let i = 1, base = cwd;
  while (i < words.length) {
    const w = words[i];
    if (w === "-C") { base = resolve(base, words[i + 1] ?? ""); i += 2; }
    else if (w === "-c" || w === "--exec-path" || w === "--namespace") i += 2;
    else if (w.startsWith("-")) i += 1;
    else break;
  }
  if (words[i] !== "commit") return false;
  out.kinds.add("commit");
  for (i += 1; i < words.length;) {
    const w = words[i];
    const msg = optionValue(words, i, ["--message"], ["-m"]);
    if (msg) { out.texts.push(msg.value); i = msg.next; continue; }
    const file = optionValue(words, i, ["--file"], ["-F"]);
    if (file) { readText(file.value, base, out); i = file.next; continue; }
    const cluster = /^-([a-zA-Z]*)m(.*)$/.exec(w);
    if (cluster && !w.startsWith("--")) {
      if (cluster[2]) { out.texts.push(cluster[2]); i += 1; } else { out.texts.push(words[i + 1] ?? ""); i += 2; }
      continue;
    }
    i += 1;
  }
  return true;
}

function ghPost(words: string[], cwd: string, out: Extracted): boolean {
  let i = 1;
  while (i < words.length && words[i].startsWith("-")) i += words[i] === "-R" || words[i] === "--repo" ? 2 : 1;
  if (!["issue", "pr"].includes(words[i]) || !["create", "comment", "edit"].includes(words[i + 1])) return false;
  out.kinds.add("gh");
  for (i += 2; i < words.length;) {
    const t = optionValue(words, i, ["--title", "--body"], ["-t", "-b"]);
    if (t) { out.texts.push(t.value); i = t.next; continue; }
    const f = optionValue(words, i, ["--body-file"], ["-F"]);
    if (f) { readText(f.value, cwd, out); i = f.next; continue; }
    i += 1;
  }
  return true;
}

/** The text a commit / gh post would publish, or null when the command is neither (the fast path). */
export function extractTexts(command: string, cwd: string): Extracted | null {
  try {
    if (!/\bgit\b|\bgh\b/.test(command)) return null;
    const bodies: string[] = [];
    const stripped = command
      .replace(HEREDOC_IN_CAT, (_m, _q, _d, body: string) => { bodies.push(body); return "HEREDOC"; })
      .replace(HEREDOC, (_m, _q, _d, rest: string, body: string) => { bodies.push(body); return rest; });
    const out: Extracted = { texts: [], warnings: [], kinds: new Set() };
    for (const seg of tokenize(stripped)) {
      let s = 0;
      while (s < seg.length && /^[A-Za-z_]\w*=/.test(seg[s])) s += 1;
      while (seg[s] === "env" || seg[s] === "command" || seg[s] === "exec") { s += 1; while (s < seg.length && /^[A-Za-z_]\w*=/.test(seg[s])) s += 1; }
      const words = seg.slice(s);
      if (words[0] === "git") gitCommit(words, cwd, out);
      else if (words[0] === "gh") ghPost(words, cwd, out);
    }
    if (!out.kinds.size) return null;
    out.texts.push(...bodies);
    return out;
  } catch {
    return null;
  }
}

/** Runs the guard once over all texts. A missing, crashed or timed-out guard is ok with a warning. */
export function runGuard(texts: string[], root: string): { ok: boolean; reasons: string } {
  const guard = join(root, GUARD_REL);
  if (!existsSync(guard)) return { ok: true, reasons: `leakhook: ${GUARD_REL} not found; nothing was checked` };
  const r = spawnSync(process.execPath, [guard, ...GUARD_ARGS], { input: texts.join("\n\n"), cwd: root, encoding: "utf8", timeout: 15000 });
  if (r.error || r.status === null) return { ok: true, reasons: `leakhook: the guard did not finish (${r.error?.message ?? r.signal}); nothing was checked` };
  if (r.status === 0) return { ok: true, reasons: "" };
  const reasons = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  // Findings exit 1 with plain lines; any other exit, or a stack trace, is the guard itself breaking.
  if (r.status !== 1 || /^\s+at |SyntaxError|ERR_MODULE_NOT_FOUND/m.test(r.stderr ?? "")) {
    return { ok: true, reasons: `leakhook: the guard failed (exit ${r.status}); nothing was checked` };
  }
  return { ok: false, reasons };
}

export function decide(input: HookInput, root: string): Verdict {
  const command = input?.tool_input?.command;
  if (input?.tool_name !== "Bash" || typeof command !== "string") return { code: 0, stderr: "" };
  const ex = extractTexts(command, input.cwd ?? root);
  if (!ex) return { code: 0, stderr: "" };
  const warn = ex.warnings.join("\n");
  if (!ex.texts.length) return { code: 0, stderr: warn };
  const g = runGuard(ex.texts, root);
  if (g.ok) return { code: 0, stderr: [warn, g.reasons].filter(Boolean).join("\n") };
  const what = ex.kinds.size === 2 ? "commit message and gh post" : ex.kinds.has("commit") ? "commit message" : "gh post";
  return { code: 2, stderr: `leak guard blocked this ${what}. Reword it and retry; do not work around the check.\n\n${g.reasons}\n` };
}

function main() {
  try {
    let input: HookInput = {};
    try { input = JSON.parse(readFileSync(0, "utf8")); } catch { /* malformed input: allow */ }
    const root = process.env.CLAUDE_PROJECT_DIR ?? input?.cwd ?? process.cwd();
    const v = decide(input, root);
    if (v.stderr) process.stderr.write(v.stderr.endsWith("\n") ? v.stderr : v.stderr + "\n");
    process.exit(v.code);
  } catch (e) {
    process.stderr.write(`leakhook: internal error (${e instanceof Error ? e.message : String(e)}); allowed\n`);
    process.exit(0);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
