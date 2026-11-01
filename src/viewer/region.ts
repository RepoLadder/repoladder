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

/**
 * The phone's open height rule: the px of a `ch`-tall canvas's bottom the resting sheet (`sheetCover`, already
 * measured from the canvas's bottom edge) and the dock's other occupants (`dockH`) cover. The board keeps 40% of the canvas.
 */
export const phoneCover = (ch: number, sheetCover: number, dockH: number): number => Math.min(Math.max(0, sheetCover) + Math.max(0, dockH), ch * 0.6);

/** The height of what #dock holds besides the tour card, whose framing walkfit.ts does itself. */
const dockUsed = (): number =>
  [...(document.getElementById("dock")?.children ?? [])].filter((k) => !k.classList.contains("walk-card")).reduce((n, k) => n + k.getBoundingClientRect().height, 0);

/** How many px of the canvas's bottom the phone's sheet (its peek, or its half height at the story level, sheet.ts) and the dock cover. */
export function coveredBottom(ch: number): number {
  if (!matchMedia("(max-width: 760px)").matches) return 0;
  const h = heights(innerHeight, topEdge()), up = st.cur === STORY ? h.half : h.peek;
  return phoneCover(ch, document.getElementById("canvas")!.getBoundingClientRect().bottom - (innerHeight - up), dockUsed());
}
