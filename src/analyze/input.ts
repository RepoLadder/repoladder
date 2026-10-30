// The input pre-pass the analyzer runs when it is given limits: shape and size checks, first failure wins.
import { InputError, type Limits } from "../build/limits.ts";

/** Empty, no TS/JS source, too many files: all before any file is read. */
export function checkPaths(allPaths: string[], sourcePaths: string[], limits: Limits, root?: string, hasSkippedEntries = false): void {
  const detail = root === undefined ? {} : { root };
  if (allPaths.length === 0 && !hasSkippedEntries) throw new InputError("EMPTY", detail);
  if (sourcePaths.length === 0) throw new InputError("NO_SOURCE_FILES", detail);
  if (sourcePaths.length > limits.maxFiles) throw new InputError("TOO_MANY_FILES", { files: sourcePaths.length, limit: limits.maxFiles });
}

/** Above this share of NUL characters a file is binary, not text with a stray NUL. */
const MAX_NUL_SHARE = 0.01;

/** Reads the source files in sorted order, stopping at the first unreadable, oversize or over-budget one. */
export function readSources(sourcePaths: string[], read: (p: string) => string | null, limits: Limits, onFile?: (done: number, total: number) => void): Map<string, string> {
  const texts = new Map<string, string>();
  let total = 0, i = 0;
  for (const path of [...sourcePaths].sort()) {
    let text: string | null;
    try { text = read(path); } catch (e) {
      const code = (e as { code?: unknown })?.code;
      throw new InputError("UNREADABLE", { path, error: typeof code === "string" ? code : e instanceof Error ? e.message : String(e) });
    }
    if (text === null) throw new InputError("UNREADABLE", { path });
    if (text.includes("\u0000")) {
      // A few stray NULs in a text file ('\x00env' in a string, a fixture) must not sink the build (#405): drop them and map the file.
      const nuls = text.split("\u0000").length - 1;
      if (nuls > text.length * MAX_NUL_SHARE) throw new InputError("UNREADABLE", { path, error: "binary file" });
      text = text.replaceAll("\u0000", "");
    }
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes > limits.maxFileBytes) throw new InputError("FILE_TOO_LARGE", { path, bytes, limit: limits.maxFileBytes });
    total += bytes;
    if (total > limits.maxBytes) throw new InputError("TOO_MANY_BYTES", { bytes: total, limit: limits.maxBytes });
    texts.set(path, text);
    onFile?.(++i, sourcePaths.length);
  }
  return texts;
}
