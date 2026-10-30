// Counters for where a layout's D2 compiles go (REPOLADDER_TIMINGS=1, scripts/layoutbench.ts). Collected
// only when a caller passes a stats object, so ordinary runs take no timestamps and count nothing.

export interface LayoutStats {
  /** pool.compile requests, before the pool's cache and in-flight sharing */
  dir: Record<string, number>;
  spread: Record<string, number>;
  lane: Record<string, number>;
  /** times `clear` laid a board out a second time with the through-wire labels dropped */
  clearRetries: number;
  /** times `lay` ran the second lane compile (the lane order differed from the first layout's) */
  laneSecond: number;
  /** spread rung index (0-based) where the early stop fired, by number of boards */
  stopRung: Record<string, number>;
  /** boards that ran every rung without stopping */
  fullLadder: number;
  /** cumulative time awaiting pool.compile across concurrent boards (not wall time) */
  d2Ms: number;
  /** cumulative time in the JS around the compiles (lint, wires, D2 source, box sizes) */
  jsMs: number;
  /** candidates dropped as exact duplicates of an earlier one of the same board */
  dupes: number;
}

export const newStats = (): LayoutStats => ({ dir: {}, spread: {}, lane: {}, clearRetries: 0, laneSecond: 0, stopRung: {}, fullLadder: 0, d2Ms: 0, jsMs: 0, dupes: 0 });

export const bump = (r: Record<string, number>, k: string | number) => { r[String(k)] = (r[String(k)] ?? 0) + 1; };

const hist = (r: Record<string, number>) => Object.keys(r).sort((a, b) => Number(a) - Number(b) || a.localeCompare(b)).map((k) => `${k}:${r[k]}`).join(",") || "-";

/** Space-separated key=value tokens, none containing a space. */
export function formatStats(s: LayoutStats): string {
  return [
    `dir=${hist(s.dir)}`, `spread=${hist(s.spread)}`, `lane=${hist(s.lane)}`,
    `clearRetries=${s.clearRetries}`, `laneSecond=${s.laneSecond}`,
    `stopRung=${hist(s.stopRung)}`, `fullLadder=${s.fullLadder}`,
    `d2Ms=${Math.round(s.d2Ms)}`, `jsMs=${Math.round(s.jsMs)}`, `dupes=${s.dupes}`,
  ].join(" ");
}

/** Adds `b` into `a`. */
export function addStats(a: LayoutStats, b: LayoutStats): void {
  for (const k of ["dir", "spread", "lane", "stopRung"] as const) for (const [x, n] of Object.entries(b[k])) a[k][x] = (a[k][x] ?? 0) + n;
  a.clearRetries += b.clearRetries; a.laneSecond += b.laneSecond; a.fullLadder += b.fullLadder;
  a.d2Ms += b.d2Ms; a.jsMs += b.jsMs; a.dupes += b.dupes;
}

/**
 * Drops every candidate structurally equal to an earlier one. Safe for pickLayout, which keeps the first of
 * equals, and for the lint-clean filter, which depends only on content.
 */
export function dedupe<T>(cands: T[], seen: Set<string>): { kept: T[]; dropped: number } {
  const kept: T[] = [];
  for (const c of cands) {
    const k = JSON.stringify(c);
    if (seen.has(k)) continue;
    seen.add(k);
    kept.push(c);
  }
  return { kept, dropped: cands.length - kept.length };
}
