// What a caller can tell the analyzer instead of letting it ask git: the repo's name, the commit and
// where the files live on GitHub. `resolveMeta` validates them and settles each field.
import type { Facts } from "../model/schema.ts";

export type GitMode = "auto" | "off";

export interface AnalyzeOptions {
  /** Display name (Facts.repo, the page title, the root package's fallback name). Default: the root folder's name. */
  repo?: string;
  /** The analyzed commit, 7-64 hex chars. null = none. Default: from git when git is in use, else null. Facts.sha keeps its first 7 chars (display). */
  sha?: string | null;
  /** Where the files live on GitHub, for code links; sha must be the full commit. null = no links. Default: from git when git is in use, else null. */
  github?: { repo: string; sha: string; dir: string } | null;
  /** "auto" (default): use git only when gitOwns(root). "off": never spawn git; list files with a plain walk. Ignored (treated as "off") for a non-disk FileSource. */
  git?: GitMode;
}

export interface ResolvedMeta { repo: string; sha: string | null; github: Facts["github"] }

const bad = (field: string, v: unknown): never => {
  throw new Error(`invalid ${field}: ${JSON.stringify(v)}`);
};

function validate(opts: AnalyzeOptions): void {
  if (opts.repo !== undefined && (typeof opts.repo !== "string" || opts.repo.trim() === "")) bad("repo", opts.repo);
  if (typeof opts.sha === "string" && !/^[0-9a-f]{7,64}$/i.test(opts.sha)) bad("sha (want 7-64 hex characters)", opts.sha);
  else if (opts.sha !== undefined && opts.sha !== null && typeof opts.sha !== "string") bad("sha", opts.sha);
  const g = opts.github;
  if (g) {
    if (typeof g.repo !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(g.repo)) bad("github.repo (want owner/name)", g.repo);
    if (typeof g.sha !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(g.sha)) bad("github.sha (want the full 40 or 64 hex commit)", g.sha);
    const okDir = typeof g.dir === "string" && (g.dir === "" || (!g.dir.startsWith("/") && !g.dir.includes("\\") && g.dir.endsWith("/") && g.dir.slice(0, -1).split("/").every((s) => s !== "" && s !== "." && s !== "..")));
    if (!okDir) bad("github.dir (want \"\" or relative segments each ending in /)", g.dir);
  }
}

/** Validate the overrides, then resolve repo / sha / github. `fromGit`'s thunks run only for a field no override settles. */
export function resolveMeta(
  opts: AnalyzeOptions,
  fallbackRepo: string,
  fromGit: { sha: () => string | null; github: () => Facts["github"] } | null,
): ResolvedMeta {
  validate(opts);
  const repo = opts.repo?.trim() ?? fallbackRepo;
  const github = opts.github !== undefined ? opts.github : opts.sha !== undefined ? null : fromGit?.github() ?? null;
  const sha = opts.sha === null ? null : typeof opts.sha === "string" ? opts.sha.slice(0, 7) : opts.github ? opts.github.sha.slice(0, 7) : fromGit?.sha() ?? null;
  return { repo, sha, github };
}
