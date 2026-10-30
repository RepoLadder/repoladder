// Drawing a board with containers: Everything's one board (#146), or any cut (cutboard.ts). Every
// opened group is a container, every file a small box inside its leaf, and a closed group a box
// drawn as on Default (draw.ts). A container's frame sits under everything and takes no clicks (a click inside it is a click
// on empty canvas, a double-click opens it: everyview.ts); its name band is what selects it, so
// hovering inside a container never fades the files it holds.
import { linesLabel } from "../model/fileboards.ts";
import { bandOf, depthOf, EVERY_PAD, nameSize } from "./everylayout.ts";
import type { StopBoard } from "./stops.ts";
import { N, board, esc, nameOf, st } from "./state.ts";

const every = () => board() as StopBoard | undefined;
/** The board on screen is Everything's. */
export const onEvery = () => !!every()?.inside;

const held = new WeakMap<StopBoard, Set<string>>();
/** The containers of Everything's board: every id some box sits inside. */
export function containersOf(b: StopBoard): Set<string> {
  let s = held.get(b);
  if (!s) held.set(b, (s = new Set(Object.values(b.inside ?? {}))));
  return s;
}
export const isContainer = (id: string) => onEvery() && containersOf(every()!).has(id);

/** A box of Everything's board, or null for a box drawn as on any board (a service). */
export function everyBox(id: string, x: number, y: number, w: number, h: number): string | null {
  const b = every()!;
  if (containersOf(b).has(id)) {
    const d = depthOf(b, id), px = nameSize(b, d, N()), band = bandOf(px), name = nameOf(id);
    const kind = d === 1 ? ` k-${N()[id]?.kind ?? "part"}` : "";
    return `<g class="every-c ${d === 1 ? "d1" : d % 2 ? "odd" : "even"}${kind}" data-c="${esc(id)}"><rect class="frame" x="${x}" y="${y}" width="${w}" height="${h}" rx="${d === 1 ? 14 : 10}"/></g>`
      + `<g class="every-name" data-hit="n:${esc(id)}" tabindex="0" role="button" aria-label="${esc(name)}"><rect class="band" x="${x}" y="${y}" width="${w}" height="${band}" rx="${d === 1 ? 14 : 10}"/><text class="cname" x="${x + (d === 1 ? 22 : EVERY_PAD.side)}" y="${y + band / 2 + px * 0.36}" style="font-size:${px}px">${esc(name)}</text></g>`;
  }
  if (id[0] !== "@") return null;
  const loc = st.data.files?.[id]?.[0], cx = x + w / 2;
  return `<g class="node file every-f" data-hit="n:${esc(id)}" tabindex="0" role="button" aria-label="${esc(nameOf(id))}"><rect class="body" x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/>`
    + `<text class="name" x="${cx}" y="${y + (loc ? 20 : 27)}" text-anchor="middle">${esc(nameOf(id))}</text>${loc ? `<text class="sub" x="${cx}" y="${y + 36}" text-anchor="middle">${esc(linesLabel(loc))}</text>` : ""}</g>`;
}

/** The overview panel's note on Everything: it is one board you zoom into, not a board to take in at once. */
export const everyNote = () => (onEvery() && (every()!.cut?.budget ?? Infinity) < Infinity
  ? `<p class="foot every-note"><b>Up to ${every()!.cut!.budget} boxes</b> on this board: the parts that fit are opened in place, each a container with its parts inside. Double-click a container to open it.</p>`
  : onEvery() ? `<p class="foot every-note"><b>Everything</b> on this board: zoom to read. Every group is a container and every file sits in its group; an arrow joins the two boxes where a connection's ends part. Double-click a container to open it.</p>` : "");
