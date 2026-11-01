// Moving between boards and selections: show, breadcrumbs, select, and the click/keyboard handlers.
import { syncInspector } from "./inspector.ts";
import { renderTrail } from "./crumbs.ts";
import { renderRepoTitle } from "./repotitle.ts";
import { syncTopActions } from "./topactions.ts";
import { metaHtml } from "./mono.ts";
import { writeHash } from "./deeplink.ts";
import { onEscape } from "./deselect.ts";
import { draw } from "./draw.ts";
import { shadeOk } from "./shapes.ts";
import { tourShown } from "./tour.ts";
import { applyFilters } from "./filterui.ts";
import { fitBoard } from "./fit.ts";
import { refocus } from "./focus.ts";
import { focusSettled, focusZoom } from "./focuszoom.ts";
import { leaving, type Place } from "./history.ts";
import { jumpOf, page } from "./jump.ts";
import { setView } from "./panzoom.ts";
import { renderFile } from "./files.ts";
import { connList, renderContext, renderEdge, renderNode, renderOverview, renderService } from "./panels.ts";
import { renderCollection, storeMeta } from "./collections.ts";
import { storyMeta, storyPick, storyShown } from "./story.ts";
import { $, N, S, STORY, home, isColl, isCtx, isFile, isOpenable, onStoreBoard, plural, st } from "./state.ts";
import { zoomBetween } from "./transition.ts";
import { boardHere, currentStop, deferShow, boardAtStop, hasBoardAt, holdHere } from "./stopview.ts";
import { forgetJump, openDown } from "./dial.ts";

/**
 * `back` restores a place from the history (history.ts) instead of recording one. `hit` is selected
 * once the board is shown. A board this dial stop has no layer for shows its nearest one (#327),
 * with what holds the asked place selected. `exact` shows the board as asked (cutview.ts shows any board at any budget).
 */
export function show(id: string, back?: Place, hit: string | null = null, exact = false): void {
  const to = exact ? id : boardAtStop(currentStop(), id);
  if (to !== id) {
    const h = holdHere(to, back ? back.hit : hit) ?? holdHere(to, `n:${id}`);
    if (back) back = { ...back, board: to, hit: h, view: [] }; else hit = h;
    id = to;
  }
  forgetJump(); // a no-op while the dial is off: nothing remembered
  // a detail-dial stop may still be laying this board out (stopview.ts)
  if (deferShow(id, () => show(id, back, hit, exact))) return;
  const from = st.cur;
  if (!back && st.svgEl && from !== id) leaving(here());
  st.cur = id;
  const host = $("canvas");
  const old = host.querySelector<SVGSVGElement>("svg.board");
  const tmp = document.createElement("div");
  tmp.innerHTML = draw(st.data.layout[id]);
  st.svgEl = tmp.querySelector("svg")!;
  st.svgEl.classList.add("board");
  st.svgEl.classList.toggle("shaded", shadeOk(st.svgEl.querySelectorAll("g.node").length));
  st.svgEl.setAttribute("preserveAspectRatio", "xMidYMid meet");
  host.prepend(st.svgEl);
  storyShown(id);
  applyFilters();
  renderRepoTitle();
  fitBoard();
  if (back?.view.length) setView(back.view);
  zoomBetween(old, from, st.svgEl, id);

  renderCrumbs();
  if (back) { pick(back.hit); writeHash(); focusSettled(); }
  else select(hit);
  tourShown();
}

export const here = (): Place => ({ board: st.cur, hit: st.selected, view: [...st.view], stop: currentStop() });
/** Back/Forward: the board with its selection and viewport, through the same zoom transition. */
export const restore = (p: Place) => {
  // a place seen at another detail stop: its board may be Simple's only, and its view is another layout's
  if (p.stop && p.stop !== currentStop()) p = { board: boardHere(p.board), hit: null, view: [] };
  if (st.data.layout[p.board]) show(p.board, p);
};

/** The board above this one; a level-1 part's is the overview (the story level when there is one). */
const up = (id: string) => { const p = N()[id]?.parent; return !p || p === "root" ? home() : p; };
export const goTo = (id: string) => show(up(id), undefined, `n:${id}`);

/** Opens the box `id`: an elsewhere box or a store jumps (jump.ts), a part drills in. */
export function open(id: string): void {
  const j = jumpOf(page(), id);
  if (j) return show(j.board, undefined, j.hit ?? null);
  if (!isOpenable(id)) return;
  // openDown finds no stop to turn to (and does nothing) while the dial is off
  return hasBoardAt(currentStop(), id) ? show(id) : void openDown(id);
}

function renderCrumbs(): void {
  const n = N()[st.cur === STORY ? "root" : st.cur];
  // the meta first: the crumbs collapse to fit the room it leaves
  const plain = onStoreBoard() ? storeMeta() : `${st.cur === STORY ? storyMeta() : ""}${n.children.length ? `${plural(n.children.length, "part")} · ` : ""}${plural(n.count, "file")}`;
  $("meta").innerHTML = metaHtml(plain, !onStoreBoard() && st.cur === home() && st.data.sha ? st.data.sha : null);
  renderTrail(st.cur);
  syncTopActions();
}

export function select(hit: string | null): void {
  pick(hit);
  writeHash();
  focusZoom();
}

function pick(hit: string | null): void {
  pickPanel(hit);
  syncInspector();
}

function pickPanel(hit: string | null): void {
  st.selected = hit;
  st.svgEl.querySelectorAll("g.sel").forEach((g) => g.classList.remove("sel"));
  if (onStoreBoard()) applyFilters();
  refocus();
  if (storyPick(hit)) return;
  if (!hit) return renderOverview();
  [...st.svgEl.querySelectorAll<SVGGElement>("g[data-hit]")].filter((g) => g.dataset.hit === hit).forEach((g) => g.classList.add("sel"));
  if (hit.startsWith("e:")) { const [a, b] = hit.slice(2).split(">"); return renderEdge(a, b); }
  const id = hit.slice(2);
  return S()[id] ? renderService(id) : isFile(id) ? renderFile(id, connList(id)) : isColl(id) ? renderCollection(id) : isCtx(id) ? renderContext(id) : renderNode(id);
}

export function installNavigation(): void {
  document.addEventListener("click", (ev) => {
    const t = (ev.target as Element).closest<HTMLElement | SVGGElement>("[data-go],[data-part],[data-goto],[data-open],[data-sel],g[data-hit]");
    if (!t) return;
    const d = t.dataset;
    if (d.go) return show(d.go);
    if (d.part) return goTo(d.part);
    if (d.goto) return open(d.goto);
    if (d.open) return open(d.open);
    if (d.sel) return select(d.sel);
    if (!st.dragged) select(d.hit === st.selected ? null : d.hit!);
  });
  document.addEventListener("dblclick", (ev) => {
    const g = (ev.target as Element).closest<SVGGElement>("g[data-hit^='n:']");
    if (!g) return;
    open(g.dataset.hit!.slice(2));
  });
  document.addEventListener("keydown", (ev) => {
    const g = (ev.target as Element).closest?.<SVGGElement>("g[data-hit]");
    if (g && (ev.key === "Enter" || ev.key === " ")) {
      ev.preventDefault();
      const hit = g.dataset.hit!, id = hit.slice(2);
      if (st.selected === hit && (isOpenable(id) || jumpOf(page(), id))) open(id);
      else select(hit);
    } else if (ev.key === "Escape" && !(ev.target as Element).closest?.("input,textarea,select,dialog")) onEscape(select, () => show(up(st.cur)));
  });
}
