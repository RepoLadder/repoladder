// The hard lint for Everything's board (#146), which the board lint (lint.ts) can't take as is:
// there, a box inside another is an overlap and a wire over a box is a crossing, and Everything
// nests every box in its group. Here boxes overlap only within one container, a box must sit inside
// its container, and a wire may cross only its two ends and the containers that hold them.
import type { BoardLayout } from "./layout.ts";
import type { StopBoard } from "../viewer/stops.ts";
import { overlapWH, segHitsRect, type Pt, type Rect } from "./outline.ts";
import { TOL, type Defect } from "./lint.ts";

const border = ([x, y]: Pt, r: Rect) => {
  const dx = Math.max(r.x - x, 0, x - r.x - r.w), dy = Math.max(r.y - y, 0, y - r.y - r.h);
  // outside: the distance to the rect; inside: the distance to its nearest side
  return dx || dy ? Math.hypot(dx, dy) : Math.min(x - r.x, r.x + r.w - x, y - r.y, r.y + r.h - y);
};

export function everyDefects(b: StopBoard, l: BoardLayout): Defect[] {
  const out: Defect[] = [], inside = b.inside ?? {};
  const at = new Map<string, Rect>(l.n.map(([id, x, y, w, h]) => [id, { x, y, w, h }]));
  const up = (id: string) => { const s = new Set<string>(); for (let c = inside[id]; c && c !== "root"; c = inside[c]) s.add(c); return s; };
  const by = new Map<string, string[]>();
  for (const id of at.keys()) by.set(inside[id] ?? "root", [...(by.get(inside[id] ?? "root") ?? []), id]);
  for (const [c, ids] of by) {
    const cr = at.get(c);
    for (const id of ids) {
      const r = at.get(id)!;
      if (cr && (r.x < cr.x - 0.5 || r.y < cr.y - 0.5 || r.x + r.w > cr.x + cr.w + 0.5 || r.y + r.h > cr.y + cr.h + 0.5)) out.push({ kind: "overlap", ids: [id, c], detail: "outside its container" });
    }
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const [w, h] = overlapWH(at.get(ids[i])!, at.get(ids[j])!);
      if (w > 0.5 && h > 0.5) out.push({ kind: "overlap", ids: [ids[i], ids[j]], detail: `${w.toFixed(1)}×${h.toFixed(1)}` });
    }
  }
  for (const [a, z, , ...p] of l.e) {
    const pts: Pt[] = [];
    for (let i = 0; i + 1 < p.length; i += 2) pts.push([p[i], p[i + 1]]);
    const ra = at.get(a), rz = at.get(z);
    if (!ra || !rz || pts.length < 2) { out.push({ kind: "endpoint", ids: [a, z], detail: "not drawn" }); continue; }
    if (border(pts[0], ra) > TOL || border(pts[pts.length - 1], rz) > TOL) out.push({ kind: "endpoint", ids: [a, z], detail: "an end off its box" });
    if (pts.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y)) || pts.some((q, i) => i && q[0] === pts[i - 1][0] && q[1] === pts[i - 1][1])) out.push({ kind: "endpoint", ids: [a, z], detail: "a doubled or missing point" });
    const ok = new Set([a, z, ...up(a), ...up(z)]);
    for (const [id, r] of at) {
      if (ok.has(id)) continue;
      const inner = { x: r.x + 2, y: r.y + 2, w: r.w - 4, h: r.h - 4 };
      if (pts.some((q, i) => i && segHitsRect(pts[i - 1], q, inner))) { out.push({ kind: "through", ids: [a, z, id], detail: "crosses a box" }); break; }
    }
  }
  return out;
}
