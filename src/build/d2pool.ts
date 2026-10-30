// Runs D2 compiles on a pool of D2 instances (each is its own worker thread with its own wasm),
// behind a cache of raw layouts keyed on the exact D2 source, engine and D2 version.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { availableParallelism, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** What layout.ts reads from a compiled diagram, unrounded: shapes [id, x, y, w, h, isCylinder], connections [src, dst, isCurve, ...points]. */
export interface RawLayout {
  s: [string, number, number, number, number, 0 | 1][];
  c: [string, string, 0 | 1, ...number[]][];
}

export type Engine = "elk" | "dagre";

// Bump when RawLayout changes shape, so old cache files are ignored.
const FORMAT = 1;
const CACHE_FILE = "layout-cache.json";

/** The installed D2 package version, read from its package.json (its exports do not expose that file). */
function d2Version(): string {
  try {
    let dir = dirname(fileURLToPath(import.meta.resolve("@terrastruct/d2")));
    for (let i = 0; i < 6; i++, dir = dirname(dir)) {
      const p = join(dir, "package.json");
      if (!existsSync(p)) continue;
      const pkg = JSON.parse(readFileSync(p, "utf8"));
      if (pkg.name === "@terrastruct/d2") return String(pkg.version);
    }
  } catch {}
  return "unknown";
}

export const cacheKey = (version: string, engine: Engine, source: string) =>
  createHash("sha256").update(`${FORMAT}\0${version}\0${engine}\0${source}`).digest("hex");

export interface D2Pool {
  compile(source: string, engine: Engine): Promise<RawLayout>;
  /** Stops the workers and, with a cache dir, saves the layouts this pool used, across every compile since it opened (and only those). */
  close(): Promise<void>;
  /** Writes the cache now (the old entries plus every layout this pool used, no pruning). Returns the entry count, or null when there is no file, the pool is read-only or nothing is new since the last save. */
  flush(): number | null;
  stats: { hits: number; misses: number };
  /** How many D2 instances compile in parallel. */
  size: number;
}

/** Hard ceiling for REPOLADDER_D2_WORKERS: each instance holds a ~250MB wasm heap. */
const MAX_WORKERS = 16;

/**
 * Worker count: an explicit `opt` wins; then a valid REPOLADDER_D2_WORKERS (digits, integer >= 1, clamped to
 * 16, and not held back by the memory guard); otherwise the default. An invalid value is ignored.
 */
export function workerCount(env: string | undefined, opt: number | undefined, cpus: number, mem: number): number {
  if (opt !== undefined) return Math.max(1, opt);
  if (env !== undefined && /^[0-9]+$/.test(env) && Number(env) >= 1) return Math.min(MAX_WORKERS, Number(env));
  return Math.max(1, Math.min(6, cpus - 1, Math.floor(mem / 2 ** 31)));
}

export interface D2PoolOptions {
  cacheDir?: string; size?: number; readOnly?: boolean;
  /** Save the cache after this many new compiles (default 500) or ... */
  saveEvery?: number;
  /** ... this many ms since the last save (default 60000), whichever comes first. */
  saveMs?: number;
  now?: () => number;
  /** Test seam: makes the D2 instances and skips the real D2 import and the V8 flag. */
  factory?: () => any;
}

/** Removes `layout-cache.json.<pid>.tmp` files left by a process that died mid-save; a live pid's file is left alone. */
function removeStaleTmp(dir: string) {
  try {
    for (const name of readdirSync(dir)) {
      const m = /^layout-cache\.json\.(\d+)\.tmp$/.exec(name);
      if (!m || Number(m[1]) === process.pid) continue;
      let alive = true;
      try { process.kill(Number(m[1]), 0); } catch (e: any) { if (e?.code === "ESRCH") alive = false; }
      if (!alive) { try { unlinkSync(join(dir, name)); } catch {} }
    }
  } catch {}
}

/** With `readOnly`, the cache file is read but never rewritten (a lint pass over a finished build must not prune it to its own entries). */
export function d2Pool(opts: D2PoolOptions = {}): D2Pool {
  const version = d2Version();
  const file = opts.cacheDir ? join(opts.cacheDir, CACHE_FILE) : null;
  let old: Record<string, RawLayout> = {};
  if (file && existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      if (parsed && parsed.format === FORMAT && parsed.entries) old = parsed.entries;
    } catch {}
  }
  if (file && !opts.readOnly) removeStaleTmp(dirname(file));
  const used = new Map<string, RawLayout>();
  const saveEvery = opts.saveEvery ?? 500, saveMs = opts.saveMs ?? 60_000, now = opts.now ?? (() => performance.now());
  let unsaved = 0, lastSaveAt = now(), minGap = 0;
  // compiles still running, so a second request for the same source (layout.ts starts the "rows" lane
  // candidate's first layout alongside the identical "edge" one) waits for it instead of compiling again
  const running = new Map<string, Promise<RawLayout>>();
  const stats = { hits: 0, misses: 0 };

  // Instances are created on demand (up to `size`), so the wasm loads on the first cache miss and a small build holds few.
  // Each instance holds its own wasm heap (~250MB); past 6 the gain is small (a 477-file app: 1 → 10s, 4 → 3.5s, 6 → 3.1s).
  const size = workerCount(process.env.REPOLADDER_D2_WORKERS, opts.size, availableParallelism(), totalmem());
  let loader: Promise<() => any> | null = null;
  const all: any[] = [];
  const idle: any[] = [];
  const waiting: ((d: any) => void)[] = [];
  // `opts.factory` is a test seam: it makes the instances and skips the real D2 import and the V8 flag.
  const load = () => (loader ??= opts.factory ? Promise.resolve(opts.factory) : (async () => {
    // V8 keeps optimizing D2's 22MB wasm in the background, which stalls process exit by ~15s.
    // The baseline compiler alone is plenty fast for layout. The flag is process-wide, so it covers the workers.
    const v8 = await import("node:v8");
    v8.setFlagsFromString("--liftoff-only");
    const { D2 } = await import("@terrastruct/d2");
    return () => new D2();
  })());
  const release = (d: any) => { const w = waiting.shift(); if (w) w(d); else idle.push(d); };
  const acquire = async (): Promise<any> => {
    const make = await load();
    const d = idle.pop();
    if (d) return d;
    if (all.length < size) { const n = make(); all.push(n); return n; }
    return new Promise<any>((done) => waiting.push(done));
  };

  async function compile(source: string, engine: Engine): Promise<RawLayout> {
    const key = cacheKey(version, engine, source);
    const hit = used.get(key) ?? old[key];
    if (hit) { stats.hits++; used.set(key, hit); return hit; }
    const pending = running.get(key);
    if (pending) { stats.hits++; return pending; }
    stats.misses++;
    const p = run(key, source, engine);
    running.set(key, p);
    try {
      return await p;
    } finally {
      running.delete(key);
    }
  }

  async function run(key: string, source: string, engine: Engine): Promise<RawLayout> {
    const d2 = await acquire();
    try {
      const d = (await d2.compile({ fs: { index: source }, options: { layout: engine } })).diagram;
      // A layout is a pure function of its source: whichever instance ran it gives the same result.
      const raw: RawLayout = {
        s: d.shapes.map((sh: any) => [sh.id, sh.pos.x, sh.pos.y, sh.width, sh.height, sh.type === "cylinder" ? 1 : 0]),
        c: d.connections.map((c: any) => [c.src, c.dst, c.isCurve ? 1 : 0, ...c.route.flatMap((p: any) => [p.x, p.y])]),
      };
      used.set(key, raw);
      unsaved++;
      maybeSave();
      return raw;
    } finally {
      release(d2);
    }
  }

  /** Atomic write (tmp + rename); errors are swallowed because the cache only saves time. */
  function save(entries: Map<string, RawLayout> | Record<string, RawLayout>): boolean {
    if (!file) return false;
    const map = entries instanceof Map ? entries : new Map(Object.entries(entries));
    const sorted = Object.fromEntries([...map.keys()].sort().map((k) => [k, map.get(k)!]));
    try {
      mkdirSync(dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify({ format: FORMAT, d2: version, entries: sorted }));
      renameSync(tmp, file);
      return true;
    } catch { return false; }
  }

  function interim(): number | null {
    if (!file || opts.readOnly || unsaved === 0) return null;
    const t0 = now();
    const union = new Map<string, RawLayout>([...Object.entries(old), ...used]);
    const ok = save(union);
    unsaved = 0;
    const t1 = now();
    lastSaveAt = t1;
    minGap = 10 * Math.max(0, t1 - t0);
    return ok ? union.size : null;
  }

  function maybeSave() {
    if (!file || opts.readOnly || unsaved === 0) return;
    const since = now() - lastSaveAt;
    if ((unsaved >= saveEvery || since >= saveMs) && since >= minGap) interim();
  }

  async function close() {
    if (loader) await loader;
    for (const d of all) await d.worker?.terminate();
    if (!file || opts.readOnly || !stats.misses && Object.keys(old).length === used.size) return;
    save(used);
  }

  return { compile, close, flush: interim, stats, size };
}
