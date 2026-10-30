// The library entry: files in, diagram out. The hosted site calls this. It never reads the working
// directory or env, never writes to disk, never pings and never exits the process.
import { analyzeSource } from "./analyze/index.ts";
import { resolveMeta, type AnalyzeOptions, type GitMode } from "./analyze/options.ts";
import { memorySource } from "./analyze/source.ts";
import { BuildError, buildDiagram } from "./build/pipeline.ts";
import { failureOf, resolveLimits, type BuildFailure, type Limits } from "./build/limits.ts";
import { Grouping, type Facts } from "./model/schema.ts";
import type { Model } from "./model/rollup.ts";
import type { Coverage } from "./model/coverage.ts";
import { VERSION } from "./version.ts";
import { resolveFeatures, type Features } from "./features.ts";
import type { OnProgress } from "./build/progress.ts";

export interface BuildFromFilesOptions {
  /** Repo name shown in the page and digest; default: the name part of `github.repo`, else "repo". */
  repo?: string;
  /** Short commit shown in the page; default null. */
  sha?: string | null;
  /** Where the files live on GitHub, for links to the code; default null (no links). */
  github?: { repo: string; sha: string; dir: string } | null;
  /** A grouping (as `grouping.json` holds); default: the folder grouping, as `build --default`. */
  grouping?: Grouping;
  /** Launch switches (src/features.ts), explicit only: the library reads no env. Default: launch state (no detail dial). */
  features?: Partial<Features>;
  /** "elsewhere" lane at the board's edge; default true (`--no-lane` is false). */
  lane?: boolean;
  /** Size and shape limits, per field over DEFAULT_LIMITS. A bad value throws RangeError. */
  limits?: Partial<Limits>;
  /** Progress events: the same stage events as `build`'s stderr lines. A library build emits `read`, `parse` and `resolve` (one `tick` per file), `grouping` (only when no `grouping` option is passed), `model`, `layout` (one `tick` per board, `unit: "boards"`), `lint`, `split` (only in the default grouping, and only if boards are crowded) and `render`; never `write` or `note`. `pass`/`passes` on layout events: `passes` is an upper bound (1 with a custom grouping, up to 3 in default mode; later passes may be skipped). Events are raw and unthrottled: throttle in your callback. The callback is synchronous and must be cheap (a returned promise is ignored). An error it throws is swallowed and never fails the build. */
  onProgress?: OnProgress;
}

export type BuildResult =
  | {
      ok: true; html: string; facts: Facts; model: Model;
      /** The engine version that built this; equals the page's generator tag and the package version. */
      engineVersion: string;
      /** Connections with no arrow at the Default dial and tour steps on a board that doesn't draw them (#452); a warning to show, never a failure. */
      coverage: Coverage;
    }
  | BuildFailure;

/** Files in (repo-relative path → UTF-8 text), diagram out. Never reads the working directory or env, never writes, never pings. Bad input (empty, not TS/JS, too big, unreadable, analyzer failure) comes back as `{ ok: false, code, message }`; bad options and a bad grouping throw. */
export async function buildFromFiles(files: Record<string, string> | Map<string, string>, opts: BuildFromFilesOptions = {}): Promise<BuildResult> {
  const limits = resolveLimits(opts.limits);
  let meta;
  try {
    meta = resolveMeta({ repo: opts.repo, sha: opts.sha, github: opts.github }, opts.github?.repo.split("/")[1] ?? "repo", null);
  } catch (e) {
    throw new BuildError("INVALID_OPTIONS", 2, `INVALID_OPTIONS: ${(e as Error).message}`);
  }
  const onProgress: OnProgress | undefined = opts.onProgress && ((e) => { try { opts.onProgress!(e); } catch { /* a buggy hook must not fail a build */ } });
  const src = memorySource(files, { name: meta.repo });
  let facts: Facts;
  try {
    facts = analyzeSource(src, { sha: meta.sha, github: meta.github }, limits, onProgress);
  } catch (e) {
    return failureOf(e);
  }
  let grouping: Grouping | null = null;
  if (opts.grouping) {
    const parsed = Grouping.safeParse(opts.grouping);
    if (!parsed.success) {
      throw new BuildError("INVALID_SCHEMA", 2, "INVALID grouping\n" + parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n"));
    }
    grouping = parsed.data;
  }
  const r = await buildDiagram({ facts, grouping, read: (f) => (src.exists(f) ? src.read(f) : null), lane: opts.lane ?? true, onProgress, features: resolveFeatures({}, opts.features) });
  return { ok: true, html: r.html, facts, model: r.model, engineVersion: VERSION, coverage: r.report.coverage };
}

export { VERSION } from "./version.ts";
export type { AnalyzeOptions, GitMode };
export { BuildError } from "./build/pipeline.ts";
export type { Facts, Grouping } from "./model/schema.ts";
export type { Model } from "./model/rollup.ts";
export { DEFAULT_LIMITS, INPUT_CODES, LIMIT_MESSAGES } from "./build/limits.ts";
export type { OnProgress, ProgressEvent, Stage } from "./build/progress.ts";
export type { BuildFailure, InputCode, Limits } from "./build/limits.ts";
