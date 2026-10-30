// Getting out of a selection (#107). A click or tap on empty canvas clears it, and Escape clears it
// before it climbs a level. A drag that pans never clears: panzoom.ts marks the gesture as a drag
// once it moves past dragged(). Clearing zooms back out to the board's fit when the selection had
// zoomed in (focuszoom.ts zoomStep); Escape and the click do the same.
import { $, home, st } from "./state.ts";

/** Pixels a press may wander and still count as a click: a finger wobbles more than a mouse. */
export const dragged = (dx: number, dy: number, pointer: string) => Math.abs(dx) + Math.abs(dy) > (pointer === "touch" ? 8 : 4);

/** Something to clear: a selected box or arrow, or a story sentence pinned by a tap (story.ts). */
export const hasSelection = () => !!st.selected || !!st.svgEl?.classList.contains("telling");

/** A click on empty canvas: inside the board, on no box, arrow or label (overlays sit outside the svg). */
export const onEmpty = (t: Element | null) => !!t?.closest?.("svg.board") && !t.closest("g[data-hit]");

/** What Escape does: clear a selection first, then go up a level, and nothing on the top board. Exported for tests. */
export const escapeStep = (selected: boolean, atHome: boolean): "clear" | "up" | null => (selected ? "clear" : atHome ? null : "up");

/** Called by navigate.ts for an Escape the modes (tour, walkthrough) and inputs left alone. */
export function onEscape(select: (hit: string | null) => void, up: () => void): void {
  const s = escapeStep(hasSelection(), st.cur === home());
  if (s === "clear") select(null);
  else if (s === "up") up();
}

export function installDeselect(select: (hit: string | null) => void): void {
  $("canvas").addEventListener("click", (e) => {
    if (!st.dragged && hasSelection() && onEmpty(e.target as Element)) select(null);
  });
}
