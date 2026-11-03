// The Ask engine interface: one small file per agent CLI. Pure data and functions, no I/O, no `process`.
export type EngineId = "claude" | "codex";

export type AskEvent =
  | { type: "session"; id: string }
  | { type: "text"; text: string }
  | { type: "tool"; name: string }
  | { type: "result"; ok: boolean; text: string; error?: string };

export type Failure = { code: string; message: string };
export type FailureInput = { spawnError?: string; exitCode?: number | null; stderr?: string; resultError?: string; timedOut?: boolean };
export type AskRequest = { prompt: string; session?: string; resume: boolean; cmdPrefix: string; guardCmd: string };

export interface Engine {
  id: EngineId;
  /** User-facing name, e.g. "Claude Code". */
  label: string;
  /** Env var that overrides the binary. */
  binEnv: string;
  defaultBin: string;
  versionArgv: string[];
  /** When set, a non-zero exit of this command means signed out. */
  authArgv?: string[];
  /** `assigned`: ask.ts picks the session id up front. `reported`: the agent's stream reports it. */
  sessions: "assigned" | "reported";
  /** The complete child argv, the question last. */
  argv(req: AskRequest): string[];
  env(parent: Record<string, string | undefined>): Record<string, string>;
  /** A fresh stateful parser per child. Never throws; unknown lines give []. */
  parser(): (line: string) => AskEvent[];
  explainFailure(f: FailureInput): Failure;
}

/** The env names every engine passes: shell basics, proxies and CA bundles. Each engine adds its own auth names. */
export const BASE_PASS = "PATH|HOME|USER|LOGNAME|SHELL|LANG|LC_.*|TERM|TMPDIR|TEMP|TMP|SystemRoot|XDG_.*|(HTTP|HTTPS|ALL|NO)_PROXY|(http|https|all|no)_proxy|SSL_CERT_FILE|SSL_CERT_DIR|NODE_EXTRA_CA_CERTS";

export function filterEnv(parent: Record<string, string | undefined>, pass: RegExp): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(parent)) if (v !== undefined && pass.test(k)) env[k] = v;
  env.REPOLADDER_NO_USAGE = "1";
  env.REPOLADDER_READONLY = "1";
  return env;
}

/** Shared by both engines' failure text: stderr squeezed to one short line, no control characters. */
export const cleanStderr = (s: string | undefined) => (s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 200);
