// The opt-in usage ping (PRIVACY.md). Nothing is sent unless the user said yes
// and no opt-out env var is set. The payload is a fixed set of small values: never names, paths or code.
// The only module that makes outbound requests; src/serve/ only listens on loopback (PRIVACY.md). test/no-network.test.ts keeps analyze, build and model off it.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { REPO_URL } from "./build/brand.ts";

/** Where pings go: server/ping/ (Cloudflare Worker + D1) on its custom domain. REPOLADDER_PING_URL overrides it (tests, a staging worker). */
export const PING_URL = "https://ping.repoladder.com/";
/** A failed or slow ping must never slow a run down. */
export const PING_TIMEOUT_MS = 1500;

declare const __REPOLADDER_VERSION__: string | undefined;
declare const __REPOLADDER_CHANNEL__: "plugin" | "npm" | undefined;
/** Which build this is: the npm package, the plugin bundle, or a source run (`node src/cli.ts`). */
export const channel = (): "npm" | "plugin" | "source" =>
  typeof __REPOLADDER_CHANNEL__ !== "undefined" ? __REPOLADDER_CHANNEL__ : "source";
const VERSION_RE = /^[0-9A-Za-z.+-]{1,24}$/;
/** The short git commit the code was built from: stamped by scripts/build.ts, read from git for source runs, else "dev". */
export function commitId(cwd: string): string {
  try {
    const id = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000 }).trim();
    return VERSION_RE.test(id) ? id : "dev";
  } catch { return "dev"; }
}
export function version(): string {
  if (typeof __REPOLADDER_VERSION__ !== "undefined") return __REPOLADDER_VERSION__;
  return commitId(fileURLToPath(new URL("..", import.meta.url)));
}

type Env = Record<string, string | undefined>;
export const pingUrl = (env: Env = process.env) => env.REPOLADDER_PING_URL || PING_URL;
export type Consent = { consent: "yes" | "no"; id?: string; at: string };

export const configDir = (env: Env = process.env) =>
  env.REPOLADDER_CONFIG_DIR || join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "repoladder");
const consentFile = (env: Env) => join(configDir(env), "usage.json");

/** An opt-out in the environment beats a stored yes: DO_NOT_TRACK (consoledonottrack.com) or REPOLADDER_NO_USAGE. */
export const envOptOut = (env: Env = process.env) =>
  [env.DO_NOT_TRACK, env.REPOLADDER_NO_USAGE].some((v) => v !== undefined && v !== "" && v !== "0" && v.toLowerCase() !== "false");

export function readConsent(env: Env = process.env): Consent | null {
  try {
    const c = JSON.parse(readFileSync(consentFile(env), "utf8"));
    return c?.consent === "yes" || c?.consent === "no" ? c : null;
  } catch { return null; }
}

/** Stores the answer. A yes gets a fresh random install id; a no keeps no id at all. */
export function writeConsent(answer: "yes" | "no", env: Env = process.env, now = new Date()): Consent {
  const prev = readConsent(env);
  const c: Consent = answer === "yes"
    ? { consent: "yes", id: prev?.consent === "yes" && prev.id ? prev.id : randomUUID(), at: now.toISOString() }
    : { consent: "no", at: now.toISOString() };
  mkdirSync(configDir(env), { recursive: true });
  writeFileSync(consentFile(env), JSON.stringify(c, null, 1) + "\n");
  return c;
}

/** What the skill should do: ask once, or nothing. The env opt-out also means never asking. */
export function usageState(env: Env = process.env): "ask" | "on" | "off" {
  if (envOptOut(env)) return "off";
  const c = readConsent(env);
  return !c ? "ask" : c.consent === "yes" ? "on" : "off";
}

export const PRIVACY_URL = `${REPO_URL}/blob/main/PRIVACY.md`;
type In = NodeJS.ReadableStream & { isTTY?: boolean };
type Out = NodeJS.WritableStream & { isTTY?: boolean };
/** The npm package's one-time question (PRIVACY.md). Asks only on an interactive terminal, outside CI,
 *  with no stored answer, no env opt-out and a ping URL set. Default no. */
export async function askUsageOnce(io: { input: In; output: Out; prompt: NodeJS.WritableStream }, env: Env = process.env): Promise<"yes" | "no" | null> {
  if (!io.input.isTTY || !io.output.isTTY || env.CI || usageState(env) !== "ask" || !pingUrl(env)) return null;
  const rl = createInterface({ input: io.input, output: io.prompt, terminal: false });
  try {
    const line = await new Promise<string>((done) => {
      rl.once("line", done);
      rl.once("close", () => done(""));
      io.prompt.write(`Share anonymous usage stats (version, success, size range, no names, paths or code)? See ${PRIVACY_URL} [y/N] `);
    });
    const answer = /^y(es)?$/i.test(line.trim()) ? "yes" : "no";
    writeConsent(answer, env);
    return answer;
  } finally { rl.close(); }
}

/** Repo size as a coarse range of source files, never the exact count. */
export function sizeRange(files: number): string {
  if (files <= 0) return "0";
  for (const [max, label] of [[50, "1-49"], [200, "50-199"], [1000, "200-999"], [5000, "1000-4999"]] as const)
    if (files < max) return label;
  return "5000+";
}

export type Ping = {
  v: 1;
  version: string;
  ok: boolean;
  error: string | null;
  size: string;
  seconds: number;
  mode: "ai" | "default";
  id: string;
};

export function makePing(r: { ok: boolean; error?: string; files: number; ms: number; mode: "ai" | "default" }, id: string): Ping {
  return { v: 1, version: version(), ok: r.ok, error: r.ok ? null : r.error ?? "UNKNOWN", size: sizeRange(r.files), seconds: Math.round(r.ms / 1000), mode: r.mode, id };
}

/** Sends one ping if allowed; resolves to whether it was sent. Never throws, never waits past the timeout. */
export async function sendPing(
  r: Parameters<typeof makePing>[0],
  opts: { env?: Env; url?: string; fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<boolean> {
  const env = opts.env ?? process.env;
  const url = opts.url ?? pingUrl(env);
  if (!url || envOptOut(env)) return false;
  const c = readConsent(env);
  if (c?.consent !== "yes" || !c.id) return false;
  try {
    const res = await (opts.fetch ?? fetch)(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(makePing(r, c.id)),
      signal: AbortSignal.timeout(opts.timeoutMs ?? PING_TIMEOUT_MS),
    });
    return res.ok;
  } catch { return false; }
}
