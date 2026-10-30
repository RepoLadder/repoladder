// What the analyzer reads a repo through: a real folder, or a set of files held in memory (the
// library entry, lib.ts). Paths are repo-relative and posix.
import type TS from "typescript";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join, posix, resolve } from "node:path";
import { listAllPaths } from "./files.ts";

export interface FileSource {
  readonly kind: "disk" | "memory";
  /** Absolute root the repo-relative paths hang off: a real folder, or "/repo" for memory. */
  readonly root: string;
  /** The repo's name when nothing better is known (disk: basename(root)). */
  readonly name: string;
  /** Every repo-relative posix path, sorted. */
  list(): string[];
  /** The file's UTF-8 text; throws when there is no such file. */
  read(rel: string): string;
  exists(rel: string): boolean;
  /** "" is the root and always exists. */
  dirExists(rel: string): boolean;
}

export function diskSource(rootArg: string, o: { useGit?: boolean; name?: string } = {}): FileSource {
  const root = resolve(rootArg);
  let paths: string[] | undefined;
  return {
    kind: "disk",
    root,
    name: o.name ?? basename(root),
    list: () => (paths ??= listAllPaths(root, o.useGit ?? true).filter((p) => existsSync(join(root, p)))),
    read: (rel) => readFileSync(join(root, rel), "utf8"),
    exists: (rel) => existsSync(join(root, rel)),
    dirExists: (rel) => statSync(join(root, rel), { throwIfNoEntry: false })?.isDirectory() ?? false,
  };
}

const normalizeKey = (k: string): string | null => {
  const n = posix.normalize(k.replace(/\\/g, "/").replace(/^(\.?\/)+/, ""));
  return n === "" || n === "." || n === ".." || n.startsWith("../") ? null : n;
};

export function memorySource(files: Record<string, string> | Map<string, string>, o: { name?: string } = {}): FileSource {
  const byPath = new Map<string, string>();
  for (const [k, v] of files instanceof Map ? files : Object.entries(files)) {
    const n = normalizeKey(k);
    if (n !== null) byPath.set(n, v);
  }
  const sorted = [...byPath.keys()].sort();
  const dirs = new Set<string>([""]);
  for (const p of sorted) for (let d = posix.dirname(p); d !== "." && !dirs.has(d); d = posix.dirname(d)) dirs.add(d);
  return {
    kind: "memory",
    root: "/repo",
    name: o.name ?? "repo",
    list: () => sorted,
    read: (rel) => {
      const t = byPath.get(rel);
      if (t === undefined) throw new Error(`ENOENT: ${rel}`);
      return t;
    },
    exists: (rel) => byPath.has(rel),
    dirExists: (rel) => dirs.has(rel),
  };
}

export const asSource = (x: FileSource | string): FileSource => (typeof x === "string" ? diskSource(x) : x);

/** The TypeScript hosts for module resolution and tsconfig parsing over a source. */
export function tsHosts(src: FileSource, ts: typeof TS): { module: TS.ModuleResolutionHost; config: TS.ParseConfigHost } {
  if (src.kind === "disk") {
    return {
      module: {
        fileExists: (f) => ts.sys.fileExists(f),
        readFile: (f) => ts.sys.readFile(f),
        directoryExists: (d) => ts.sys.directoryExists!(d),
        realpath: (p) => ts.sys.realpath!(p),
        getCurrentDirectory: () => src.root,
      },
      config: ts.sys,
    };
  }
  const relOf = (abs: string): string | null => {
    const r = posix.relative(src.root, abs.replace(/\\/g, "/"));
    return r === ".." || r.startsWith("../") ? null : r;
  };
  const fileExists = (f: string) => { const r = relOf(f); return r !== null && r !== "" && src.exists(r); };
  const readFile = (f: string) => {
    const r = relOf(f);
    if (r === null) return undefined;
    try { return src.read(r); } catch { return undefined; }
  };
  return {
    module: {
      fileExists,
      readFile,
      directoryExists: (d) => { const r = relOf(d); return r !== null && src.dirExists(r); },
      realpath: (p) => p,
      getCurrentDirectory: () => src.root,
    },
    config: { useCaseSensitiveFileNames: true, fileExists, readFile, readDirectory: () => [] },
  };
}
