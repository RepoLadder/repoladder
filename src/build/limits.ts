// Input size and shape limits and the result codes for bad input. Pure: no node: imports, no process.
// The CLI prints `${code}: ${message}`; the hosted site turns each code into a friendly page.

export type Limits = { maxFiles: number; maxBytes: number; maxFileBytes: number };

// Placeholders until spike rl#356 measures real repos; tune here only.
export const DEFAULT_LIMITS: Limits = { maxFiles: 5000, maxBytes: 50 * 1024 * 1024, maxFileBytes: 1024 * 1024 };
export const NO_LIMITS: Limits = { maxFiles: Infinity, maxBytes: Infinity, maxFileBytes: Infinity };

export const INPUT_CODES = ["EMPTY", "NO_SOURCE_FILES", "TOO_MANY_FILES", "TOO_MANY_BYTES", "FILE_TOO_LARGE", "UNREADABLE", "ANALYZE_FAILED"] as const;
export type InputCode = (typeof INPUT_CODES)[number];

export type InputDetail = { root?: string; path?: string; files?: number; bytes?: number; limit?: number; error?: string };
export type BuildFailure = { ok: false; code: InputCode; message: string; detail?: InputDetail };

export class InputError extends Error {
  code: InputCode; detail: InputDetail;
  constructor(code: InputCode, detail: InputDetail = {}) { super(code); this.code = code; this.detail = detail; }
}

/** `partial` over the defaults; a value that is not a number above 0 (Infinity is fine) is a programmer error. */
export function resolveLimits(partial?: Partial<Limits>): Limits {
  const l = { ...DEFAULT_LIMITS, ...Object.fromEntries(Object.entries(partial ?? {}).filter(([, v]) => v !== undefined)) };
  for (const k of ["maxFiles", "maxBytes", "maxFileBytes"] as const) {
    if (typeof l[k] !== "number" || !(l[k] > 0)) throw new RangeError(`limits.${k} must be a number above 0, got ${String(l[k])}`);
  }
  return l;
}

const mb = (n: number) => (n / 1048576).toFixed(1) + " MB";
const kb = (n: number) => Math.round(n / 1024) + " KB";
const smaller = "Try mapping a smaller folder, such as one package of a monorepo.";

/** One message per code, without the `CODE: ` prefix, and the CLI's exit status. */
export const LIMIT_MESSAGES: Record<InputCode, { status: number; message: (d: InputDetail) => string }> = {
  EMPTY: { status: 3, message: (d) => `found no files in ${d.root ?? "the files given"}. Point RepoLadder at a folder with code in it.` },
  NO_SOURCE_FILES: {
    status: 3,
    message: (d) => `found no JavaScript or TypeScript source in ${d.root ?? "the files given"} (tests, build output and node_modules are skipped). RepoLadder currently maps TS/JS repos only.`,
  },
  TOO_MANY_FILES: { status: 3, message: (d) => `${d.files} JavaScript/TypeScript source files is more than the limit of ${d.limit}. ${smaller}` },
  TOO_MANY_BYTES: { status: 3, message: (d) => `the JavaScript/TypeScript source adds up to more than the ${mb(d.limit ?? 0)} limit. ${smaller}` },
  FILE_TOO_LARGE: {
    status: 3,
    message: (d) => `${d.path} is ${kb(d.bytes ?? 0)}, more than the ${kb(d.limit ?? 0)} limit for one source file. Files this big are usually generated or bundled code.`,
  },
  UNREADABLE: { status: 3, message: (d) => `could not read ${d.path} as text${d.error ? ` (${d.error})` : ""}.` },
  ANALYZE_FAILED: { status: 1, message: (d) => `the analyzer failed on these files${d.error ? `: ${d.error}` : ""}. This is a RepoLadder bug; please report it.` },
};

export function failure(code: InputCode, detail: InputDetail = {}): BuildFailure {
  return { ok: false, code, message: LIMIT_MESSAGES[code].message(detail), ...(Object.keys(detail).length ? { detail } : {}) };
}

export function failureOf(e: unknown): BuildFailure {
  if (e instanceof InputError) return failure(e.code, e.detail);
  return failure("ANALYZE_FAILED", { error: e instanceof Error ? e.message : String(e) });
}
