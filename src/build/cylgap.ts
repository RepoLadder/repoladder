// Room around service and store cylinders stacked in a column (#131). ELK packs a layer's boxes
// ELK_GAP D2 units apart, which layoutBoards' spread shrinks to as little as 5px. Between rectangles
// that reads tight; between cylinders it reads as touching, because the bottom curve of one bulges
// toward the lid of the next ("these nodes (maybe due to the nature of their shape?) are a little too
// close together"). So D2 lays a cylinder out taller than it is drawn, and layoutBoards gives the
// drawn cylinder back its own height, centered in that room (fitCylinders moves the wires with it).
import type { Model } from "../model/rollup.ts";
import type { BoardLayout } from "./layout.ts";
import { ELK_GAP, LANE_GAP, laneSides, spacerSize } from "./lane.ts";
import { lidRy } from "../viewer/shapes.ts";
import { tidy } from "./storylayout.ts";
import { bbox, edgeDist, type Drawn } from "./outline.ts";

/**
 * Least visible gap between two cylinders stacked in a column, in board units: the lane's gap
 * (LANE_GAP, the board's spacing for a long run of boxes) plus a little, since curved outlines read
 * closer than straight ones.
 */
export const CYL_GAP = LANE_GAP + 4;

/**
 * Extra height (board units, a whole number) D2 reserves for a cylinder: half above it, half below.
 * Only on right-flowing boards, where a layer is a column; on a down-flowing board cylinders in a
 * layer stand side by side, where their curves don't face each other. In a lane, whose spacers
 * (lane.ts) already keep boxes about LANE_GAP apart, only the rest is added.
 * `target` replaces CYL_GAP for experiments (LayoutOpts.cylGap).
 */
export function cylPad(model: Model, boardId: string, id: string, direction: "right" | "down", spread: number, lane: boolean, target = CYL_GAP): number {
  if (!model.services[id] || direction !== "right") return 0;
  const spacer = lane && laneSides(model, boardId).has(id) ? spacerSize(direction, spread) : null;
  const gap = spacer ? (spacer[1] + 2 * ELK_GAP) / spread : ELK_GAP / spread;
  return Math.max(0, Math.ceil(target - gap));
}

/** How far inside a cylinder's straight side (below the lid's rim, above the bottom's) a wire meets it. */
const RIM = 4;

/**
 * Keeps every wire that meets a cylinder on its side on the drawn cylinder: ELK spread a box's wires
 * over the taller room it reserved, so one may meet the side above or below the drawn cylinder. The
 * end moves to the nearest height on the side; the bend before it moves along, so the wire stays
 * orthogonal, and a straight wire gets a step halfway. `padded` holds the cylinders given room.
 */
export function fitCylinders(layout: BoardLayout, padded: Set<string>): BoardLayout {
  if (!padded.size) return layout;
  const box = new Map(layout.n.map((n) => [n[0], n]));
  const e = layout.e.map((r): BoardLayout["e"][number] => {
    const [a, z, curve, ...p] = r;
    if (curve) return r;
    let q = [...p];
    for (const [id, end] of [[z, q.length - 2], [a, 0]] as const) {
      const n = box.get(id);
      if (!padded.has(id) || !n) continue;
      const [, x, y, w, h] = n, ry = lidRy(h), lo = y + ry + RIM, hi = y + h - ry - RIM;
      const ex = q[end], ey = q[end + 1], nb = end === 0 ? 2 : end - 2;
      // only an end on the left or right side, reached by a horizontal segment
      if ((Math.abs(ex - x) > 2 && Math.abs(ex - x - w) > 2) || q[nb + 1] !== ey || (ey >= lo && ey <= hi)) continue;
      const ny = Math.round(Math.min(hi, Math.max(lo, ey)));
      const far = end === 0 ? 4 : nb - 2;
      if (q.length >= 6 && q[far] === q[nb]) {
        q[end + 1] = ny; q[nb + 1] = ny; // the segment before is vertical: slide the bend with the end
      } else {
        const mx = Math.round((q[nb] + ex) / 2), step = end === 0 ? [ex, ny, mx, ny, mx, ey] : [mx, ey, mx, ny, ex, ny];
        q = end === 0 ? [...step, ...q.slice(2)] : [...q.slice(0, end), ...step];
      }
    }
    return [a, z, 0, ...tidy(q)];
  });
  return { n: layout.n, e };
}

/**
 * The smallest visible gap on a board between two cylinders stacked in a column (their drawn outlines
 * overlap across), from bottom curve to lid; null when no two are stacked. The lint reports it (#131).
 */
export function cylGap(drawn: Drawn[]): number | null {
  const cyls = drawn.filter((d) => d.kind === "service" || d.kind === "store");
  let min: number | null = null;
  for (const a of cyls) for (const b of cyls) {
    const A = bbox(a.parts.flat()), B = bbox(b.parts.flat());
    if (a === b || B.y < A.y || Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x) <= 0) continue;
    // between the outlines, so it is measured where the curves come closest
    const d = Math.min(...a.parts[0].map((p) => edgeDist(p, b.parts[0])), ...b.parts[0].map((p) => edgeDist(p, a.parts[0])));
    if (min === null || d < min) min = Math.round(d * 10) / 10;
  }
  return min;
}
