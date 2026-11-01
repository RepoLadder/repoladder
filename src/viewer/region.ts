// The part of the canvas the floating chrome leaves open (dock.ts), and a view framed into it.
import { heights } from "./sheet.ts";
import { topEdge } from "./embed.ts";
import { STORY, st } from "./state.ts";
import type { Dock } from "./dock.ts";

export interface Region { x: number; y: number; w: number; h: number }
type View = number[];
const GAP = 8;

/** The open part of a cw×ch canvas: below the header band, left of the wide-window panel, above `bottom` px the phone's sheet covers. */
export function openRegion(cw: number, ch: number, d: Dock, bottom = 0): Region {
  const y = d.top ? d.top + GAP : 0;
  return { x: 0, y, w: Math.max(cw - (d.right ? d.right + GAP : 0), 1), h: Math.max(ch - y - bottom, 1) };
}

/** View `v` as a view of the whole cw×ch canvas, scaled to fit region `r` and centered in it. */
export function atRegion(v: View, cw: number, ch: number, r: Region): View {
  const s = Math.min(r.w / v[2], r.h / v[3]);
  return [v[0] + v[2] / 2 - (r.x + r.w / 2) / s, v[1] + v[3] / 2 - (r.y + r.h / 2) / s, cw / s, ch / s];
}

/** How many px of the canvas's bottom the phone's sheet covers: its peek, or its half height at the story level (sheet.ts). */
export function coveredBottom(ch: number): number {
  if (!matchMedia("(max-width: 760px)").matches) return 0;
  const h = heights(innerHeight, topEdge()), up = st.cur === STORY ? h.half : h.peek;
  const covered = document.getElementById("canvas")!.getBoundingClientRect().bottom - (innerHeight - up);
  return Math.min(Math.max(0, covered), ch * 0.6);
}
