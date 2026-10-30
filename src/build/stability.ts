// Layout stability: how much of a board's arrangement survives a change of window shape, commit or
// level (#462, part of #245). Pure and standalone: report-only, nothing here feeds the layout.
import type { BoardLayout } from "./layout.ts";

/** Two box centers closer than this many px on an axis count as the same band (the lint's alignment tolerance). */
export const STABLE_EPS = 2;
/** Above this many shared boxes the score is taken over a deterministic sample of them. */
export const STABLE_SAMPLE = 400;

/** A box row: id, x, y, w, h and anything after (accepts BoardLayout["n"] rows). */
export type Rect = [id: string, x: number, y: number, w: number, h: number, ...rest: unknown[]];

export interface Stability { kept: number; total: number; score: number | null; shared: number; sampled: boolean }

const rows = (l: BoardLayout | BoardLayout["n"] | Rect[]): Rect[] => (Array.isArray(l) ? l : l.n) as Rect[];
const rel = (d: number): -1 | 0 | 1 => (Math.abs(d) <= STABLE_EPS ? 0 : d < 0 ? -1 : 1);

/**
 * The share of box pairs that keep their left/right/above/below relation between layouts `a` and `b`.
 * Boxes are joined by id; only ids in both count (and in `ids`, when given). For a pair the box
 * centers are compared on each axis: the relation is the sign of the difference, or "same" within
 * STABLE_EPS; the pair is kept when both axes match. `score` is kept / total, null for fewer than 2
 * shared boxes. Above STABLE_SAMPLE shared boxes it takes every ceil(shared / STABLE_SAMPLE)-th id
 * in sorted order and scores all pairs of that sample (`sampled: true`); no randomness.
 */
export function pairStability(a: BoardLayout | BoardLayout["n"], b: BoardLayout | BoardLayout["n"], ids?: Iterable<string>): Stability {
  const center = (rs: Rect[]) => new Map(rs.map(([k, x, y, w, h]) => [k, [x + w / 2, y + h / 2] as const]));
  const ca = center(rows(a)), cb = center(rows(b)), want = ids ? new Set(ids) : null;
  let shared = [...ca.keys()].filter((k) => cb.has(k) && (!want || want.has(k))).sort();
  const n = shared.length, sampled = n > STABLE_SAMPLE;
  if (sampled) { const step = Math.ceil(n / STABLE_SAMPLE); shared = shared.filter((_, i) => i % step === 0); }
  let kept = 0, total = 0;
  for (let i = 0; i < shared.length; i++) for (let j = i + 1; j < shared.length; j++) {
    const [p, q] = [shared[i], shared[j]], [pa, qa, pb, qb] = [ca.get(p)!, ca.get(q)!, cb.get(p)!, cb.get(q)!];
    total++;
    if (rel(qa[0] - pa[0]) === rel(qb[0] - pb[0]) && rel(qa[1] - pa[1]) === rel(qb[1] - pb[1])) kept++;
  }
  return { kept, total, score: n < 2 ? null : kept / total, shared: n, sampled };
}
