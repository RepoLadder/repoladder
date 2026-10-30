// Where every label on a board goes: store verbs slide along their wire (labels.ts), and the story's
// "what they do" pills sit on their own arrow's straight runs (storylabels.ts). Shared by draw.ts and
// build/lint.ts, so the lint measures the labels the reader sees.
import type { BoardLayout } from "../build/layout.ts";
import { sayBox, soleSay } from "./figures.ts";
import { labelPrio, pillSize, placeLabels, type Placed } from "./labels.ts";
import { placePills } from "./storylabels.ts";

interface LabelledEdge { a: string; says?: string[]; reads?: number; writes?: number; hub?: true }

export interface BoardLabel { at: Placed; w: number; h: number; text: string }

/** A label shows at the fit unless it is a store verb with no free spot (`lo`); a story pill always shows. */
export const labelShown = (e: LabelledEdge, l: BoardLabel) => !!e.says || !l.at.lo;

/** A label's rect in board units. */
export const labelRect = (l: BoardLabel) => ({ x: l.at.x - l.w / 2, y: l.at.y - l.h / 2, w: l.w, h: l.h });

/** Each labelled edge of the layout, keyed by the edge object from `info` (keyed "a>b"). */
export function placeBoardLabels<E extends LabelledEdge>(layout: BoardLayout, info: Map<string, E>, text: (e: E) => string): Map<E, BoardLabel> {
  const boxes = layout.n.map(([, x, y, w, h]) => ({ x, y, w, h }));
  const labelled = layout.e.map(([a, z, curve, ...p]) => ({ e: info.get(`${a}>${z}`), curve, p })).map((x) => ({ ...x, t: x.e ? text(x.e) : "" })).filter((x) => x.t);
  const all = [...info.values()], pill = (e: E) => sayBox(e.says!, soleSay(all, e.a));
  const size = (x: { e?: E; t: string }) => (x.e!.says ? pill(x.e!) : pillSize(x.t));
  const spots = placeLabels(boxes, labelled.map((x) => { const [w, h] = size(x); return { curve: x.curve, p: x.p, w, h, prio: labelPrio(x.e!) }; }));
  const out = new Map(labelled.map((x, i): [E, BoardLabel] => { const [w, h] = size(x); return [x.e!, { at: spots[i], w, h, text: x.t }]; }));
  const says = layout.e.flatMap(([a, z], i) => { const e = info.get(`${a}>${z}`); return e?.says ? [{ e, wire: i }] : []; });
  const pills = placePills(boxes, layout.e.map(([, , curve, ...p]) => ({ curve, p })), says.map(({ e, wire }) => { const [w, h] = pill(e); return { wire, w, h }; }));
  says.forEach(({ e }, i) => { const [w, h] = pill(e); out.set(e, { at: pills[i], w, h, text: e.says!.join(" · ") }); });
  return out;
}
