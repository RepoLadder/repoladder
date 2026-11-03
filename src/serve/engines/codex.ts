// The Codex engine for Ask: runs the user's own signed-in `codex exec` headless, read-only, and reads its JSONL stream.
//
// Flags used (checked 2026-11-02 against the openai/codex sources on main: codex-rs/exec/src/cli.rs, exec_events.rs and
// codex-rs/utils/cli shared_options.rs; no Codex binary was available to the build, so no CLI version was run):
//   codex exec --sandbox read-only -c approval_policy="never" --json --color never --skip-git-repo-check -- <prompt>
//   --sandbox/-s and --json are documented flags; `-c key=value` is the config override; `--color` is an exec-only flag.
//   JSONL: thread.started{thread_id}, item.completed{item:{type:agent_message|command_execution|file_change|mcp_tool_call|web_search|...}},
//   turn.completed, turn.failed{error:{message}}, error{message}.
// Not verified, so not relied on: whether the sandbox flags carry over to `exec resume` (every turn is therefore a fresh session),
// and any way to deny secret globs or limit reads to the repo (the sandbox limits writes and network, not reads).
// The question is the last argv element after `--`; the child is spawned with shell:false by ask.ts.
import { KINDS } from "./claude.ts";
import { BASE_PASS, cleanStderr, filterEnv, type AskEvent, type Engine, type Failure, type FailureInput } from "./types.ts";

export const CODEX_MIN_VERSION = "not pinned (no Codex CLI was run when this was written)";

export function codexPrompt(cmdPrefix: string, question: string): string {
  return [
    "You answer questions about the code in the current directory. You work read-only.",
    "Read files and search only inside this directory; do not read outside it and do not open secret files such as .env or keys.",
    `If you run a command, run only this one, in this form: ${cmdPrefix} . <kind> <arg>   (kind is one of ${KINDS})`,
    "Do not write or change anything and do not use the network.",
    "Cite files as path:line and name only things you saw in a tool result.",
    "Say so when you are unsure.",
    "",
    `Question: ${question.trim()}`,
  ].join("\n");
}

const PASS = new RegExp(`^(${BASE_PASS}|OPENAI_.*|CODEX_.*)$`);

const TOOL_ITEMS = new Set(["command_execution", "file_change", "mcp_tool_call", "web_search", "collab_tool_call"]);

/** Stateful per child: keeps the last agent message and emits the result when the turn ends. */
export function codexParser(): (line: string) => AskEvent[] {
  const messages: string[] = [];
  return (line) => {
    let o: any;
    try { o = JSON.parse(line); } catch { return []; }
    if (!o || typeof o !== "object") return [];
    switch (o.type) {
      case "thread.started": return typeof o.thread_id === "string" && o.thread_id ? [{ type: "session", id: o.thread_id }] : [];
      case "item.completed": {
        const it = o.item;
        if (!it || typeof it !== "object") return [];
        if (it.type === "agent_message" && typeof it.text === "string") {
          if (!it.text) return [];
          // several messages are joined by a blank line, in the stream and in the result, so what streamed is what is checked
          messages.push(it.text);
          return [{ type: "text", text: messages.length > 1 ? `\n\n${it.text}` : it.text }];
        }
        if (TOOL_ITEMS.has(it.type)) return [{ type: "tool", name: "Bash" }];
        return [];
      }
      case "turn.completed": return [{ type: "result", ok: true, text: messages.join("\n\n") }];
      case "turn.failed": {
        const m = typeof o.error?.message === "string" ? o.error.message : "";
        return [{ type: "result", ok: false, text: "", error: m || "turn failed" }];
      }
      case "error": return [{ type: "result", ok: false, text: "", error: typeof o.message === "string" ? o.message : "error" }];
      default: return [];
    }
  };
}

export function explainFailure(f: FailureInput): Failure {
  const text = `${f.stderr ?? ""}\n${f.resultError ?? ""}`;
  if (f.spawnError === "ENOENT") return { code: "NO_AGENT", message: "Codex isn't installed or isn't on your PATH. Install Codex, then try again." };
  if (f.timedOut) return { code: "TIMEOUT", message: "Codex took too long to answer, so the question was stopped. Try a narrower question." };
  if (/unexpected argument|unrecognized|unknown option/i.test(text)) return { code: "OLD_CLI", message: "Your Codex is too old for this feature (the flags it needs are `exec --sandbox read-only --json`; no minimum version has been verified). Update it, then try again." };
  if (/not logged in|please (log ?in|run `?codex login)|invalid (or expired )?(api key|credentials)|expired|unauthorized|\b401\b|sign in/i.test(text)) {
    return { code: "SIGNED_OUT", message: "Codex is installed but signed out. Run `codex login` in a terminal, then ask again." };
  }
  if (/rate.?limit|usage limit|limit reached|\b429\b|overloaded|quota/i.test(text)) return { code: "RATE_LIMIT", message: "Codex says you've reached a usage limit on your plan. Try again later." };
  const clean = cleanStderr(f.stderr);
  const code = f.spawnError ? `could not start (${f.spawnError})` : `exit code ${f.exitCode ?? "unknown"}`;
  return { code: "AGENT_FAILED", message: `Codex stopped unexpectedly (${code})${clean ? `: ${clean}` : "."}` };
}

export const codexEngine: Engine = {
  id: "codex",
  label: "Codex",
  binEnv: "REPOLADDER_CODEX_BIN",
  defaultBin: "codex",
  versionArgv: ["--version"],
  authArgv: ["login", "status"],
  sessions: "reported",
  // every turn is a fresh session: `resume` is accepted and ignored, so no follow-up ever runs with unverified permissions
  argv: (r) => [
    "exec",
    "--sandbox", "read-only",
    "-c", 'approval_policy="never"',
    "--json",
    "--color", "never",
    "--skip-git-repo-check",
    "--",
    codexPrompt(r.cmdPrefix, r.prompt),
  ],
  env: (parent) => filterEnv(parent, PASS),
  parser: codexParser,
  explainFailure,
};
