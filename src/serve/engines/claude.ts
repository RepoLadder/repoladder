// The Claude Code engine for Ask: the exact `claude` arguments, the child's environment, stream parsing and plain-language failures. No I/O, no `process`.
import { BASE_PASS, cleanStderr, filterEnv, type AskEvent, type Engine, type Failure, type FailureInput } from "./types.ts";

/** Glob patterns (gitignore style) of files the agent may never read. */
export const SECRET_DENY = [
  "**/.env", "**/.env.*", "**/*.pem", "**/*.key", "**/*.p12", "**/*.pfx", "**/id_rsa*", "**/id_ed25519*",
  "**/.npmrc", "**/.netrc", "**/.pypirc", "**/credentials", "**/credentials.json", "**/service-account*.json",
  "**/secrets/**", "**/.ssh/**", "**/.aws/**", "**/.gnupg/**", "~/.ssh/**", "~/.aws/**", "~/.claude/**",
];

/** Tools and shell shapes that stay denied even if something else would allow them. */
export const TOOL_DENY = ["Write", "Edit", "MultiEdit", "NotebookEdit", "WebFetch", "WebSearch", "Task", "Bash(* --fresh*)"];

const denyList = (): string[] => [...TOOL_DENY, ...SECRET_DENY.map((p) => `Read(${p})`)];

/** The tools whose paths the read guard checks. */
export const GUARDED_TOOLS = "Read|Grep|Glob";

export const KINDS = "definitions|importers|callers|touches|files";

export function systemPrompt(cmdPrefix: string): string {
  return [
    "You answer questions about the code in the current directory.",
    "You may read files, grep and glob. You may run exactly one shell command, in this form and no other shell syntax:",
    `${cmdPrefix} . <kind> <arg>   (kind is one of ${KINDS})`,
    "You cannot write files, read outside this directory or run anything else.",
    "Cite files as path:line and name only things you saw in a tool result.",
    "Say so when you are unsure.",
  ].join("\n");
}

export type AskArgs = { prompt: string; session: string; resume: boolean; cmdPrefix: string; guardCmd: string };


export function askArgv({ prompt, session, resume, cmdPrefix, guardCmd }: AskArgs): string[] {
  const deny = denyList();
  const question = prompt.trim();
  return [
    "-p",
    "--output-format", "stream-json", "--verbose", "--include-partial-messages",
    "--tools", "Read,Grep,Glob,Bash",
    "--allowedTools", `Bash(${cmdPrefix}:*)`,
    "--disallowedTools", ...deny,
    "--permission-mode", "dontAsk",
    "--setting-sources", "user",
    "--settings", JSON.stringify({ permissions: { deny }, hooks: { PreToolUse: [{ matcher: GUARDED_TOOLS, hooks: [{ type: "command", command: guardCmd }] }] } }),
    "--append-system-prompt", systemPrompt(cmdPrefix),
    resume ? "--resume" : "--session-id", session,
    question.startsWith("-") ? `Question: ${question}` : question,
  ];
}

const PASS = new RegExp(`^(${BASE_PASS}|ANTHROPIC_.*|CLAUDE_.*|AWS_.*|GOOGLE_APPLICATION_CREDENTIALS|CLOUD_ML_REGION)$`);

// Variables a host app (the Claude desktop app, an SDK session) sets for its own session. Passed on, they make the child
// report "Authentication required" even when the user's own login works, so the child gets the user's login instead.
const HOST_SESSION = /^(CLAUDECODE|CLAUDE_CODE_(ENTRYPOINT|EXECPATH|CHILD_SESSION|HOST_SESSION_ID|SESSION_ID|SESSION_ATTENDED|MESSAGING_.*|SDK_.*|DESKTOP_.*|ACCOUNT_UUID|ORGANIZATION_UUID|USER_EMAIL|OAUTH_SCOPES)|CLAUDE_AGENT_SDK_.*)$/;

export const childEnv = (parent: Record<string, string | undefined>): Record<string, string> => {
  const env = filterEnv(parent, PASS);
  for (const k of Object.keys(env)) if (HOST_SESSION.test(k)) delete env[k];
  return env;
};

const TOOLS = new Set(["Read", "Grep", "Glob", "Bash"]);

/** Tolerant: unknown or malformed lines give []. Never throws. */
export function parseStreamLine(line: string): AskEvent[] {
  let o: any;
  try { o = JSON.parse(line); } catch { return []; }
  if (!o || typeof o !== "object") return [];
  if (o.type === "stream_event") {
    const d = o.event?.delta;
    if (o.event?.type === "content_block_delta" && d?.type === "text_delta" && typeof d.text === "string" && d.text) return [{ type: "text", text: d.text }];
    return [];
  }
  if (o.type === "assistant" && Array.isArray(o.message?.content)) {
    return o.message.content
      .filter((b: any) => b?.type === "tool_use")
      .map((b: any) => ({ type: "tool" as const, name: TOOLS.has(b.name) ? b.name : "Bash" }));
  }
  if (o.type === "result") {
    const text = typeof o.result === "string" ? o.result : "";
    const ok = o.is_error !== true && !(typeof o.subtype === "string" && o.subtype.startsWith("error"));
    return [{ type: "result", ok, text, ...(ok ? {} : { error: text || String(o.subtype ?? "") }) }];
  }
  return [];
}

export function explainFailure(f: FailureInput): Failure {
  const text = `${f.stderr ?? ""}\n${f.resultError ?? ""}`;
  if (f.spawnError === "ENOENT") return { code: "NO_AGENT", message: "Claude Code isn't installed or isn't on your PATH. Install Claude Code, then try again." };
  if (f.timedOut) return { code: "TIMEOUT", message: "Claude took too long to answer, so the question was stopped. Try a narrower question." };
  if (/unknown option|unrecognized/i.test(text)) return { code: "OLD_CLI", message: "Your Claude Code is too old for this feature (tested with 2.1.296 and newer). Update it, then try again." };
  if (/not logged in|please run \/login|invalid (or expired )?(api key|credentials)|expired credentials|oauth|authentication_error|\/login/i.test(text)) {
    return { code: "SIGNED_OUT", message: "Claude Code is installed but signed out. Run `claude` once in a terminal to sign in, then ask again." };
  }
  if (/rate.?limit|usage limit|limit reached|\b429\b|overloaded/i.test(text)) return { code: "RATE_LIMIT", message: "Claude says you've reached a usage limit on your plan. Try again later." };
  const clean = cleanStderr(f.stderr);
  const code = f.spawnError ? `could not start (${f.spawnError})` : `exit code ${f.exitCode ?? "unknown"}`;
  return { code: "AGENT_FAILED", message: `Claude Code stopped unexpectedly (${code})${clean ? `: ${clean}` : "."}` };
}

export const claudeEngine: Engine = {
  id: "claude",
  label: "Claude Code",
  binEnv: "REPOLADDER_CLAUDE_BIN",
  defaultBin: "claude",
  versionArgv: ["--version"],
  sessions: "assigned",
  argv: (r) => askArgv({ prompt: r.prompt, session: r.session ?? "", resume: r.resume, cmdPrefix: r.cmdPrefix, guardCmd: r.guardCmd }),
  env: childEnv,
  parser: () => parseStreamLine,
  explainFailure,
};
