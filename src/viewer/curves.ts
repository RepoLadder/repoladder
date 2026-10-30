// Edge geometry. Points are flat [x0, y0, x1, y1, ...] lists from the D2 layout.

/** Drops repeated points and the middle of three points on one straight line, so no zero-length bend is drawn. */
export function simplify<P extends [number, number]>(pts: readonly P[]): P[] {
  const out: P[] = [];
  for (const p of pts) {
    const a = out[out.length - 2], b = out[out.length - 1];
    if (b && b[0] === p[0] && b[1] === p[1]) continue;
    if (a && ((a[0] === b[0] && b[0] === p[0]) || (a[1] === b[1] && b[1] === p[1]))) out.pop();
    out.push(p);
  }
  return out;
}

/** Polyline with its corners rounded by radius r. */
export function roundPath(p: number[], r: number): string {
  let d = `M${p[0]} ${p[1]}`;
  for (let i = 2; i < p.length - 2; i += 2) {
    const [x0, y0, x1, y1, x2, y2] = [p[i - 2], p[i - 1], p[i], p[i + 1], p[i + 2], p[i + 3]];
    const l1 = Math.hypot(x1 - x0, y1 - y0), l2 = Math.hypot(x2 - x1, y2 - y1), k = Math.min(r, l1 / 2, l2 / 2);
    d += `L${x1 - ((x1 - x0) / l1) * k} ${y1 - ((y1 - y0) / l1) * k}Q${x1} ${y1} ${x1 + ((x2 - x1) / l2) * k} ${y1 + ((y2 - y1) / l2) * k}`;
  }
  return d + `L${p[p.length - 2]} ${p[p.length - 1]}`;
}

/** Start point followed by cubic Bézier triples. */
export function curvePath(p: number[]): string {
  let d = `M${p[0]} ${p[1]}`;
  for (let i = 2; i + 5 < p.length; i += 6) d += `C${p[i]} ${p[i + 1]} ${p[i + 2]} ${p[i + 3]} ${p[i + 4]} ${p[i + 5]}`;
  return d;
}

/** Midpoint of the middle Bézier segment. */
export function curveLabelAt(p: number[]): [number, number] {
  const segs = Math.floor((p.length - 2) / 6), k = Math.floor(segs / 2) * 6;
  const [x0, y0, x1, y1, x2, y2, x3, y3] = p.slice(k, k + 8);
  return [(x0 + 3 * x1 + 3 * x2 + x3) / 8, (y0 + 3 * y1 + 3 * y2 + y3) / 8];
}

/** Midpoint of the longest straight segment. */
export function labelAt(p: number[]): [number, number] {
  let best = 0, at: [number, number] = [p[0], p[1]];
  for (let i = 0; i < p.length - 2; i += 2) {
    const l = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
    if (l > best) { best = l; at = [(p[i] + p[i + 2]) / 2, (p[i + 1] + p[i + 3]) / 2]; }
  }
  return at;
}
