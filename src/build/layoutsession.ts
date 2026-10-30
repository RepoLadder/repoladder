// One D2 pool and one per-board memo for a whole build, so the layout passes of `build --default`
// share compiles (and save the union of them in the cache file) and reuse unchanged boards.
import { createHash } from "node:crypto";
import type { Model } from "../model/rollup.ts";
import { STORY } from "../viewer/state.ts";
import { boardOf } from "./boxsize.ts";
import { d2Pool, type D2Pool } from "./d2pool.ts";
import type { BoardLayout } from "./layout.ts";

/** Test tooling: on a reuse hit also lay the board out for real and throw when the two differ. */
export const verifyLayout = () => process.env.REPOLADDER_VERIFY_LAYOUT === "1";

export interface LayoutSession {
  pool: D2Pool;
  /** boardKey -> the board's layout from an earlier pass of this build */
  reuse: Map<string, BoardLayout>;
  stats: { laidOut: number; reused: number };
  /** Saves the pool's cache now; the entry count, or null when nothing was saved. */
  flush(): number | null;
  /** Closes the pool, which saves the union of every pass's cache entries. */
  close(): Promise<void>;
}

const positive = (v: string | undefined) => (v && /^[1-9]\d*$/.test(v) ? Number(v) : undefined);

export function layoutSession(opts: { cacheDir?: string; saveEvery?: number; saveMs?: number } = {}): LayoutSession {
  const pool = d2Pool({
    cacheDir: opts.cacheDir,
    saveEvery: opts.saveEvery ?? positive(process.env.REPOLADDER_CACHE_SAVE_EVERY),
    saveMs: opts.saveMs ?? positive(process.env.REPOLADDER_CACHE_SAVE_MS),
  });
  return { pool, reuse: new Map(), stats: { laidOut: 0, reused: 0 }, flush: () => pool.flush(), close: () => pool.close() };
}

const active = new Set<LayoutSession>();
/** Registers a running session so an interrupt can save it; returns the remover. */
export function trackSession(s: LayoutSession): () => void {
  active.add(s);
  return () => { active.delete(s); };
}
/** Saves every tracked session; the sum of entries saved, or null when none saved. */
export function flushActive(): number | null {
  let total: number | null = null;
  for (const s of active) { const n = s.flush(); if (n !== null) total = (total ?? 0) + n; }
  return total;
}

/**
 * Everything a board's layout can depend on. Deliberately broader than what layoutOne reads (fewer
 * hits), never narrower: REPOLADDER_VERIFY_LAYOUT=1 checks every hit against a fresh layout.
 */
export function boardKey(model: Model, id: string, opts: { lane: boolean; cylGap?: number }): string {
  const board = boardOf(model, id);
  const ids = new Set<string>([id, ...board.nodes, ...board.context, ...board.throughout, ...board.hubs, ...board.edges.flatMap((e) => [e.a, e.b])]);
  // whereLine and rangeorder walk up the ancestor chain, but read only each ancestor's name and parent: a
  // split elsewhere changes an ancestor's children and counts, and that must not invalidate every board
  const up = new Set<string>();
  for (const x of ids) for (let p = model.nodes[x]?.parent; p && !ids.has(p) && !up.has(p); p = model.nodes[p]?.parent) up.add(p);
  const per = [...ids].sort().map((x) => [x, model.nodes[x] ?? null, model.services[x] ?? null, model.categories?.[x] ?? null, model.does?.[x] ?? null, model.stores?.[x] ?? null, !!model.boards[x]]);
  // rangeorder sorts sibling ranges by their place in the parent's children: the relative order of the ones here
  const parents = [...new Set([...ids].map((x) => model.nodes[x]?.parent).filter((p): p is string => !!p))].sort();
  const siblings = parents.map((p) => [p, model.nodes[p]?.children.filter((c) => ids.has(c)) ?? null]);
  const ancestors = [...up].sort().map((x) => [x, model.nodes[x]?.name ?? null, model.nodes[x]?.parent ?? null, !!model.boards[x]]);
  const files = (model.nodes[id]?.files ?? []).map((p) => [p, model.files?.[p] ?? null, model.names?.[p] ?? null]);
  const key = { id, lane: opts.lane, cylGap: opts.cylGap ?? null, board, per, siblings, ancestors, files, story: id === STORY ? model.story : null, storeBoard: model.stores?.[id] ?? null };
  return createHash("sha256").update(JSON.stringify(key)).digest("hex");
}
