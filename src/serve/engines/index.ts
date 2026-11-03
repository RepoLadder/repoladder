// The engines Ask can run through, and how one is chosen: --agent, then REPOLADDER_AGENT, then auto (Claude Code first).
import { claudeEngine } from "./claude.ts";
import { codexEngine } from "./codex.ts";
import type { Engine, EngineId } from "./types.ts";

export type { Engine, EngineId } from "./types.ts";
export type AgentChoice = EngineId | "auto";

/** Auto-detect order. */
export const ENGINES: Engine[] = [claudeEngine, codexEngine];

export const engineById = (id: EngineId): Engine => ENGINES.find((e) => e.id === id)!;

export function parseAgentChoice(value: unknown): AgentChoice | undefined {
  if (value === "claude" || value === "codex" || value === "auto") return value;
  return undefined;
}

/** The effective choice: the flag if given, else the env var, else auto. An invalid value gives undefined. */
export function chooseAgent(flag: string | true | undefined, env: Record<string, string | undefined>): AgentChoice | undefined {
  if (flag !== undefined) return flag === true ? undefined : parseAgentChoice(flag);
  const e = env.REPOLADDER_AGENT;
  return e === undefined || e === "" ? "auto" : parseAgentChoice(e);
}

/** Status text when no candidate engine starts. */
export const noAgentMessage = (candidates: Engine[]): string =>
  candidates.length === 1 ? `Ask needs ${candidates[0].label} on your PATH. Install it and sign in, then try again.` : `Ask needs ${candidates.map((e) => e.label).join(" or ")} on your PATH. Install one and sign in, then try again.`;
