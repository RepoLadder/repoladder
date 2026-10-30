// Showing a stop of the detail dial (docs/detail-dial-v2.md). Default is the page as built. Simple
// swaps in Claude's named splits (stopsimple.ts), laying out the boards that differ with elkjs.
// Every other stop is a box budget, Everything the top one: a board is that group cut at the budget
// (budget.ts cut), its parts opened in place as containers (stoplayout.ts cutLayout); a cut that
// opens nothing is the Default board, with its D2 layout. A budget stop draws only its layers
// (#327, layers.ts): a group has a board while a board that exists draws it closed, and turning
// lands on the nearest board that survives (dial.ts). Only the board shown is waited for (a spinner after 150ms); the boards a click
// opens next are laid out in the background, and opening one that isn't ready yet waits for it.
import type { BoardLayout } from "../build/layout.ts";
import { cut, extraBoxes, stopsFor, type StopDef } from "./budget.ts";
import { featuresOf, stopsShown } from "../features.ts";
import { landAt, landOn } from "./dialmap.ts";
import type { Place } from "./history.ts";
import { hasLayer, holdOn, layerOf } from "./layers.ts";
import { loadElk } from "./elkload.ts";
import { installEvery } from "./everyview.ts";
import { aspectBucket, laneSide, type LaneSide } from "./everyfit.ts";
import { cutLayout, reusedLayout, stopData, stopLayout } from "./stoplayout.ts";
import { storyLayout } from "./storycut.ts";
import { $, STORY, st, type ViewerData } from "./state.ts";

/** Stands in `layout` for a Simple board still being laid out: truthy, so its box still opens (isOpenable). */
const PENDING: BoardLayout = { n: [], e: [] };
const DEFAULT: StopDef = { key: "default", budget: 0, label: "Default" };
let base: ViewerData | null = null;
let current: StopDef = DEFAULT;
let showBoard: (id: string, back?: Place, hit?: string | null) => void = () => {};
/** A budget stop's page data -> its budget, and the boards already swapped for their cut. */
const cuts = new WeakMap<ViewerData, { budget: number; ready: Set<string> }>();

export function installStops(show: (id: string, back?: Place, hit?: string | null) => void): void {
  showBoard = show;
}

let side: LaneSide | undefined;
/** What a cut's packing aims for: the canvas's shape, bucketed, and the lane's side, kept for the visit unless the canvas moves well past the line (everyfit.ts laneSide). */
export function canvasFit(): { aspect: number; side: LaneSide } {
  const w = st.svgEl?.clientWidth ?? 0, h = st.svgEl?.clientHeight ?? 0, aspect = aspectBucket(w, h);
  side = laneSide(w > 0 && h > 0 ? w / h : aspect, side);
  return { aspect, side };
}

/** The page as built (Default), whatever stop is on screen. */
export const baseData = (): ViewerData => base ?? st.data;

/** The key of the stop on screen (budget.ts StopDef). */
export const currentStop = (): string => current.key;

const watchers: ((key: string) => void)[] = [];
/** Called whenever the stop on screen changes (the dial follows a tour or the script hook). */
export const onStop = (f: (key: string) => void) => void watchers.push(f);
const setCurrent = (d: StopDef) => { current = d; for (const w of watchers) w(d.key); };

let spinning = 0;
/** Shows a spinner on the canvas while `p` runs, from 150ms on (most boards are ready before that). */
export function busy<T>(p: Promise<T>): Promise<T> {
  spinning++;
  const t = setTimeout(() => { if (!document.querySelector(".stop-busy")) $("canvas").insertAdjacentHTML("beforeend", '<div class="stop-busy" role="status" aria-label="Laying out"><span></span></div>'); }, 150);
  const done = () => { clearTimeout(t); if (!--spinning) document.querySelector(".stop-busy")?.remove(); };
  p.then(done, done);
  return p;
}

const defsOf = new WeakMap<ViewerData, StopDef[]>();
/** This repo's stops, top to bottom (budget.ts stopsFor, on the tree with Simple's fine nodes), cached per page. */
export const stopDefs = (): StopDef[] => {
  const b = base ?? st.data;
  return defsOf.get(b) ?? (defsOf.set(b, stopsShown(stopsFor(b.tree ?? b.nodes, b.paths), featuresOf(b))), defsOf.get(b)!);
};

/** The script hook `__repoladder.stop(key, at?)`: a stop by key; one this repo lacks lands on its nearest (dialmap.ts landOn). */
export function viewStop(key: string, at?: string): Promise<boolean> {
  const defs = stopDefs(), k = landOn(key, defs.map((d) => d.key));
  return viewStopDef(defs.find((d) => d.key === k) ?? DEFAULT, at);
}

/**
 * Shows the stop `def` on board `at`, or else on the board you are on. Resolves false, leaving the
 * page as it was, when the stop can't be shown: Simple on a page without splits, or elkjs couldn't
 * load (elkload.ts ELK_NOTE).
 */
export async function viewStopDef(def: StopDef, at?: string, back?: Place): Promise<boolean> {
  base ??= st.data;
  at = landAt(at, !!base.story);
  if (def.key === current.key && !at) return true;
  if (def.key === "simple" && !base.simple) return false;
  const target = boardAtStop(def.key, at ?? st.cur);
  if (def.key === "default") {
    st.data = base;
    setCurrent(def);
    showBoard(target, back);
    return true;
  }
  return def.key === "simple" ? simple(def, target, back) : budgeted(def, target, back, at ?? st.cur);
}

/** A Simple-only id (a split's part or bucket) -> the Default box that holds it; any other id is itself. */
function toDefault(id: string): string {
  return base?.simple ? stopData(base, "simple").toDefault?.[id] ?? id : id;
}

const defOf = (key: string) => stopDefs().find((d) => d.key === key) ?? DEFAULT;
/** The board that shows `id` at stop `key`: itself where it exists, else its nearest ancestor that does (#327). */
export const boardAtStop = (key: string, id: string): string =>
  key === "simple" ? id : key === "default" ? toDefault(id) : layerOf(baseData(), defOf(key).budget, toDefault(id));
/** Whether group board `id` exists at stop `key` (layers.ts). */
export const hasBoardAt = (key: string, id: string): boolean => boardAtStop(key, id) === id;
/** `hit` as drawn on `board` here, before it is laid out. */
export const holdHere = (board: string, hit: string | null): string | null => holdOn(baseData(), current.budget, board, hit);

/** Where a place seen at another stop opens here (history.ts Back): only Simple has Simple's ids. */
export const boardHere = (id: string): string => (current.key === "simple" ? id : toDefault(id));

/** A group's board cut at `budget`, its lane and services counted as on Default (the story: storycut.ts); null for a board that isn't a group's. */
function cutOf(id: string, budget: number) {
  const b = base!;
  if (id === STORY) return storyLayout(b, budget, undefined, canvasFit());
  if (!b.nodes[id] || !b.boards[id] || !b.layout[id]) return null;
  return cutLayout(b, cut(b.tree ?? b.nodes, b.paths, id, budget, { extra: extraBoxes(b.nodes, b.boards[id], id) }), undefined, canvasFit());
}

/** Swaps board `id` of a budget stop's data for its cut, laid out; false when elkjs can't load. */
async function cutInto(view: ViewerData, id: string): Promise<boolean> {
  const v = cuts.get(view)!;
  if (v.ready.has(id)) return true;
  const got = cutOf(id, v.budget);
  if (got && got.board !== base!.boards[id]) {
    if (!(await busy(loadElk()))) return false;
    let l: BoardLayout;
    try { l = await busy(got.laid); } catch { return false; }
    view.boards[id] = got.board;
    view.layout[id] = l;
    // a board of containers walks in reading order (walk.ts), not by Default's flows
    if (view.flows) delete view.flows[id];
  }
  v.ready.add(id);
  return true;
}

async function budgeted(def: StopDef, target: string, back?: Place, asked?: string): Promise<boolean> {
  const b = base!;
  const view: ViewerData = { ...b, boards: { ...b.boards }, layout: { ...b.layout }, flows: { ...b.flows } };
  cuts.set(view, { budget: def.budget, ready: new Set() });
  if (!(await cutInto(view, target))) return false;
  st.data = view;
  setCurrent(def);
  installEvery();
  showBoard(target, back, asked ? holdHere(target, `n:${toDefault(asked)}`) : null);
  void ahead(view, target);
  return true;
}

/** Lays out, one at a time, the boards a click on this board opens: its closed groups. */
async function ahead(view: ViewerData, from: string): Promise<void> {
  for (const id of view.boards[from]?.nodes ?? []) {
    if (st.data !== view) return;
    if (base!.nodes[id] && hasLayer(base!, cuts.get(view)!.budget, id) && !(await cutInto(view, id))) return;
  }
}

async function simple(def: StopDef, here: string, back?: Place): Promise<boolean> {
  const b = base!, s = stopData(b, "simple");
  if (!s.boards[here]) return false;
  const layout: Record<string, BoardLayout> = {}, flows: NonNullable<ViewerData["flows"]> = {};
  for (const id of Object.keys(s.boards)) {
    const l = reusedLayout(b, "simple", id);
    layout[id] = l ?? PENDING;
    // a board drawn as Default keeps its walkthrough; any other walks in reading order (readorder.ts)
    if (l && b.flows?.[id]) flows[id] = b.flows[id];
  }
  if (layout[here] === PENDING) {
    if (!(await busy(loadElk()))) return false;
    try { layout[here] = await busy(stopLayout(b, "simple", here)); } catch { return false; }
  }
  st.data = { ...b, nodes: s.nodes, boards: s.boards, layout, flows };
  setCurrent(def);
  showBoard(here, back);
  void background(st.data, here);
  return true;
}

/** Lays out the rest of Simple one board at a time, its children first, so a board asked for meanwhile goes next. */
async function background(view: ViewerData, from: string): Promise<void> {
  const kids = new Set(view.nodes[from]?.children ?? []);
  const todo = Object.keys(view.layout).filter((id) => view.layout[id] === PENDING).sort((x, y) => Number(kids.has(y)) - Number(kids.has(x)));
  for (const id of todo) {
    if (st.data !== view) return;
    if (view.layout[id] !== PENDING) continue;
    try { view.layout[id] = await stopLayout(base!, "simple", id); } catch { return; }
  }
}

/**
 * For navigate.ts show(): when board `id` isn't ready at this stop yet (being laid out, or not yet
 * cut), readies it (spinner after 150ms), then calls `again`, and returns true; otherwise false,
 * and show() goes on.
 */
export function deferShow(id: string, again: () => void): boolean {
  const view = st.data;
  if (current.key === "default") return false;
  if (current.key === "simple") {
    if (view.layout[id] !== PENDING) return false;
    busy(stopLayout(base!, "simple", id)).then((l) => { view.layout[id] = l; if (st.data === view) again(); }, () => {});
    return true;
  }
  const v = cuts.get(view);
  if (!v || v.ready.has(id)) return false;
  const got = cutOf(id, v.budget);
  if (!got || got.board === base!.boards[id]) { v.ready.add(id); return false; }
  void cutInto(view, id).then((ok) => {
    if (!ok || st.data !== view) return;
    again();
    void ahead(view, id);
  });
  return true;
}
