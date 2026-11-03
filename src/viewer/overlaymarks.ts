// The overlay's pure part (no DOM): which mark an id wears, the path of a removed connection, the legend's numbers.
export interface Marks {
  changed: string[];
  added: string[];
  addedEdges: string[];
  removedEdges: string[];
  parts: { id: string; name: string; files?: number }[];
}
export type Mark = "changed" | "new" | "added";
export interface Rect { x: number; y: number; w: number; h: number }

const sets = new WeakMap<Marks, { changed: Set<string>; added: Set<string>; addedEdges: Set<string> }>();

/** The mark for a `data-hit` key: a new box beats a changed one; a connection is only ever "added" (removed ones are drawn by the overlay itself). */
export function markFor(marks: Marks, hit: string): Mark | null {
  let s = sets.get(marks);
  if (!s) sets.set(marks, (s = { changed: new Set(marks.changed), added: new Set(marks.added), addedEdges: new Set(marks.addedEdges) }));
  if (s.added.has(hit)) return "new";
  if (s.changed.has(hit)) return "changed";
  if (s.addedEdges.has(hit)) return "added";
  return null;
}

/** How far along a ray from a rectangle's center (toward `dx, dy`) its border lies, as a fraction of that vector. */
const exit = (r: Rect, dx: number, dy: number) => Math.min(dx ? r.w / 2 / Math.abs(dx) : Infinity, dy ? r.h / 2 / Math.abs(dy) : Infinity);
const num = (n: number) => String(Math.round(n * 100) / 100);

/** An SVG path `d` from box `a` to box `b`, clipped to their borders. Rectangles that touch, overlap or share a center get a short stub under `a` instead, so the path is never empty or NaN. */
export function removedBetween(a: Rect, b: Rect): string {
  const ax = a.x + a.w / 2, ay = a.y + a.h / 2, bx = b.x + b.w / 2, by = b.y + b.h / 2;
  const dx = bx - ax, dy = by - ay;
  const ta = exit(a, dx, dy), tb = exit(b, -dx, -dy);
  if ((dx || dy) && ta + tb < 0.98) {
    return `M${num(ax + dx * ta)} ${num(ay + dy * ta)}L${num(bx - dx * tb)} ${num(by - dy * tb)}`;
  }
  const y = a.y + a.h;
  return `M${num(ax)} ${num(y)}L${num(ax)} ${num(y + 24)}`;
}

export interface LegendModel {
  counts: { changed: number; new: number; added: number; removed: number };
  parts: Marks["parts"];
}

export function legendModel(marks: Marks): LegendModel {
  const added = new Set(marks.added);
  return {
    counts: { changed: marks.changed.filter((h) => !added.has(h)).length, new: marks.added.length, added: marks.addedEdges.length, removed: marks.removedEdges.length },
    parts: marks.parts,
  };
}
