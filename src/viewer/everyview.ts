// Moving around a board of containers (a cut, Everything included; docs/detail-dial-v2.md). A
// container has no board at this stop (#327): a double-click on its frame or its name band, or
// Enter on its selected name band, opens it by turning the dial down to the highest stop where it
// has one (dial.ts openDown, through navigate.ts). A single click on the name band selects it, as on any box.
import { containersOf, onEvery } from "./everydraw.ts";
import { open } from "./navigate.ts";
import type { StopBoard } from "./stops.ts";
import { $, board } from "./state.ts";

/**
 * What a focus lights on a board of containers: a focused container lights what it holds too, so
 * selecting a group never fades its own files (focus.ts).
 */
export function everyLit(hit: string, on: Set<string>, hits: string[]): Set<string> {
  if (!onEvery() || !hit.startsWith("n:") || !containersOf(board() as StopBoard).has(hit.slice(2))) return on;
  const b = board() as StopBoard, inside = b.inside ?? {}, root = hit.slice(2), top = b.cut?.board ?? "root";
  const under = (id: string) => { for (let c = inside[id]; c && c !== top; c = inside[c]) if (c === root) return true; return false; };
  for (const h of hits) {
    if (h.startsWith("n:") ? under(h.slice(2)) : h.slice(2).split(">").every(under)) on.add(h);
  }
  return on;
}

let installed = false;
/** A double-click on a container's frame opens it (its name band opens through navigate.ts, as any box). */
export function installEvery(): void {
  if (installed) return;
  installed = true;
  $("canvas").addEventListener("dblclick", (ev) => {
    if (!onEvery()) return;
    const c = (ev.target as Element).closest<SVGGElement>("[data-c]")?.dataset.c;
    if (c) open(c);
  });
}
