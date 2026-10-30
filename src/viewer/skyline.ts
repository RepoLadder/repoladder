// Packing boxes of fixed sizes into a strip of a given width, each at the lowest spot it fits, then
// the leftmost (skyline packing). Used by everyfit.ts to pack a container's parts: unlike row-by-row
// packing, a short box tucks in beside a tall one instead of leaving a hole under it. Pure.

export interface Packed { at: [number, number][]; w: number; h: number }

/** Boxes of sizes `s`, in order, at least `g` apart, in a strip `width` wide (at least the widest box). */
export function skyline(s: [number, number][], width: number, g: number): Packed {
  const at: [number, number][] = [];
  for (const [w] of s) {
    let bx = 0, by = Infinity;
    // a box goes at the left edge or just right of a placed one, as high as the boxes under that span let it
    for (const x of [0, ...at.map(([ax], j) => ax + s[j][0] + g)]) {
      if (x + w > width + 1e-6) continue;
      const y = Math.max(0, ...at.map(([ax, ay], j) => (ax < x + w + g && ax + s[j][0] + g > x ? ay + s[j][1] + g : 0)));
      if (y < by || (y === by && x < bx)) [bx, by] = [x, y];
    }
    at.push([bx, by]);
  }
  return { at, w: Math.max(...at.map(([x], i) => x + s[i][0])), h: Math.max(...at.map(([, y], i) => y + s[i][1])) };
}

/** Boxes of sizes `s`, in order, left to right, a new row (a gap below the last) when the next doesn't fit in `width`. */
function shelf(s: [number, number][], width: number, g: number): Packed {
  const at: [number, number][] = [];
  let x = 0, y = 0, rh = 0;
  for (const [w, h] of s) {
    if (x && x + w > width + 1e-6) [x, y, rh] = [0, y + rh + g, 0];
    at.push([x, y]);
    x += w + g;
    rh = Math.max(rh, h);
  }
  return { at, w: Math.max(...at.map(([x], i) => x + s[i][0])), h: y + rh };
}

/**
 * Every packing tried for boxes `s` aiming at aspect ratio `t`: in the given order (skyline and
 * shelf), tallest first and largest first, each at the widths where a row breaks and at the width the
 * aim asks for. Each comes with the order it packed, as indices into `s`, and `ordered`: the boxes,
 * read row by row (top to bottom, then left to right), are in the given order (#463).
 */
export function packings(s: [number, number][], t: number, g: number): (Packed & { order: number[]; ordered: boolean })[] {
  const idx = s.map((_, i) => i), widest = Math.max(...s.map(([w]) => w));
  const area = s.reduce((a, [w, h]) => a + (w + g) * (h + g), 0);
  const out: (Packed & { order: number[]; ordered: boolean })[] = [];
  const by = (k: (q: [number, number]) => number) => [...idx].sort((a, b) => k(s[b]) - k(s[a]) || a - b);
  const reads = (p: Packed) => [...idx].sort((a, b) => (Math.abs(p.at[a][1] - p.at[b][1]) > 1e-6 ? p.at[a][1] - p.at[b][1] : p.at[a][0] - p.at[b][0])).every((k, i) => k === i);
  for (const order of [idx, by(([, h]) => h), by(([w, h]) => w * h)].filter((o, i) => i === 0 || o.some((k, j) => k !== j))) {
    let row = -g;
    const widths = new Set([0.7, 0.85, 1, 1.15, 1.3, 1.5].map((f) => Math.max(widest, Math.sqrt(area * t) * f - g)));
    for (const i of order) if ((row += s[i][0] + g) >= widest) widths.add(row);
    const same = order.every((k, i) => k === i), boxes = order.map((i) => s[i]);
    for (const w of widths) {
      const p = skyline(boxes, w, g);
      out.push({ ...p, order, ordered: same && reads(p) });
      if (same) out.push({ ...shelf(boxes, w, g), order, ordered: true });
    }
  }
  return out;
}
