// The viewBox a board is drawn in. Shared by draw.ts and build/lint.ts, so the lint's "name size at
// fit" and "wasted space" measure the same frame the reader sees.
import type { BoardLayout } from "../build/layout.ts";
import type { Rect } from "./labels.ts";

const PAD = 24;

/**
 * Every box, wire point and shown edge label, padded; a file or store board is at least 720×450 so a
 * few boxes aren't blown up. Labels count because a pill centered on a wire along the board's outer
 * edge sticks out past it by half its width (#137).
 */
export function boardViewBox(layout: BoardLayout, fileBoard: boolean, labels: readonly Rect[] = []): [number, number, number, number] {
  const xs: number[] = [], ys: number[] = [];
  for (const [, , , ...p] of layout.e) for (let i = 0; i < p.length; i += 2) { xs.push(p[i]); ys.push(p[i + 1]); }
  for (const [, x, y, w, h] of layout.n) { xs.push(x, x + w); ys.push(y, y + h); }
  for (const { x, y, w, h } of labels) { xs.push(x, x + w); ys.push(y, y + h); }
  let x0 = Math.min(...xs) - PAD, y0 = Math.min(...ys) - PAD, W = Math.max(...xs) - x0 + PAD, H = Math.max(...ys) - y0 + PAD;
  if (fileBoard) {
    const w = Math.max(W, 720), h = Math.max(H, 450);
    x0 -= (w - W) / 2; y0 -= (h - H) / 2; W = w; H = h;
  }
  return [x0, y0, W, H];
}
