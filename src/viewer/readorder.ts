// Reading order for a board (the fallback tour on a board without flows, walk.ts): the layout's layers, in the direction the board
// flows, and a caption per step built from the board's real edges. Pure, so node tests cover it.
import type { BoardLayout } from "../build/layout.ts";
import type { PageEdge } from "./state.ts";

export type Flow = "right" | "down";
/** Lit for this step, or faded with the rest (passed steps fade back too). */
export type Mark = "now" | "off";

/** The way the arrows run: right-flowing unless they mostly point down. */
export function flowOf(layout: BoardLayout): Flow {
  const c = new Map(layout.n.map(([id, x, y, w, h]) => [id, [x + w / 2, y + h / 2]]));
  let dx = 0, dy = 0;
  for (const [a, b] of layout.e) {
    const p = c.get(a), q = c.get(b);
    if (p && q) { dx += q[0] - p[0]; dy += q[1] - p[1]; }
  }
  return dy > dx ? "down" : "right";
}

/**
 * The board's layers in reading order: boxes whose spans along the flow overlap share a layer
 * (ELK puts a layer's boxes in one column, or one row on a down-flowing board). Within a layer,
 * top to bottom (left to right).
 */
export function layersOf(layout: BoardLayout, flow = flowOf(layout)): string[][] {
  const r = flow === "right";
  const boxes = layout.n.map(([id, x, y, w, h]) => ({ id, s: r ? x : y, e: r ? x + w : y + h, o: r ? y : x }));
  boxes.sort((a, b) => a.s - b.s || a.o - b.o || (a.id < b.id ? -1 : 1));
  const out: (typeof boxes)[] = [];
  let end = -Infinity;
  for (const b of boxes) {
    // a few px of slack: neighbouring layers can touch, and that is not an overlap
    if (b.s < end - 4) { out[out.length - 1].push(b); end = Math.max(end, b.e); }
    else { out.push([b]); end = b.e; }
  }
  return out.map((l) => l.sort((a, b) => a.o - b.o || (a.id < b.id ? -1 : 1)).map((b) => b.id));
}

/** Most boxes a step reveals at once, unless they all hang off one box. */
export const STEP_MAX = 4;

/**
 * Reading steps: the first layer, then each later layer in one step, or, when it holds more than
 * STEP_MAX boxes, in chunks by the earlier box that leads to them (the first in reading order), so
 * "KioskPage uses 6 screens" is one step and the pages that share the app shell are the next.
 * Small neighbouring chunks share a step. Boxes nothing earlier connects to come last.
 */
export function stepsOf(layout: BoardLayout, layers = layersOf(layout)): string[][] {
  if (!layers.length) return [];
  const steps = [layers[0]];
  const order = new Map(layers[0].map((id, i) => [id, i]));
  for (const layer of layers.slice(1)) {
    if (layer.length <= STEP_MAX) steps.push(layer);
    else {
      const via = (id: string) => {
        const ks = layout.e.flatMap(([a, b]) => (b === id ? [a] : a === id ? [b] : [])).filter((x) => order.has(x)).map((x) => order.get(x)!);
        return ks.length ? Math.min(...ks) : Infinity;
      };
      const chunks = new Map<number, string[]>();
      for (const id of layer) { const k = via(id); chunks.set(k, [...(chunks.get(k) ?? []), id]); }
      let cur: string[] = [];
      for (const [, ids] of [...chunks].sort((a, b) => a[0] - b[0])) {
        if (cur.length && cur.length + ids.length > STEP_MAX) { steps.push(cur); cur = []; }
        cur = [...cur, ...ids];
      }
      steps.push(cur);
    }
    for (const id of layer) order.set(id, order.size);
  }
  return steps;
}

export const rankOf = (layers: string[][]) => new Map(layers.flatMap((l, i) => l.map((id) => [id, i] as const)));

/**
 * What step `step` (0-based) lights: the step's layer, the arrows (of `arrows`, `a>b`) into or out of
 * it, and the boxes those arrows come from or go to. The rest, earlier steps included, dims.
 */
export function readLit(rank: Map<string, number>, arrows: string[], step: number): { boxes: string[]; arrows: string[] } {
  const r = (id: string) => rank.get(id) ?? -1;
  const now = arrows.filter((k) => Math.max(...k.split(">").map(r)) === step);
  const boxes = new Set([...rank].filter(([, k]) => k === step).map(([id]) => id));
  for (const k of now) k.split(">").forEach((id) => boxes.add(id));
  return { boxes: [...boxes], arrows: now };
}

/** "A", "A and B", "A, B and C". */
export function list(xs: string[]): string {
  return xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

/** The last capitalised word of a name, without its extension: CheckInScreen.tsx -> Screen. */
const kindWord = (name: string) => /([A-Z][a-z]+)(?:\.\w+)?$/.exec(name)?.[1];

/**
 * Names, summed up where they would run long: three or more sharing a last word read "8 screens",
 * and past four the rest read "and 3 more".
 */
export function sumUp(names: string[]): string {
  const by = new Map<string, string[]>();
  for (const n of names) { const k = kindWord(n); if (k) by.set(k, [...(by.get(k) ?? []), n]); }
  const grouped = [...by].filter(([, ns]) => ns.length >= 3).sort((a, b) => b[1].length - a[1].length);
  const used = new Set(grouped.flatMap(([, ns]) => ns));
  const parts = [...grouped.map(([k, ns]) => `${ns.length} ${k.toLowerCase()}s`), ...names.filter((n) => !used.has(n))];
  return parts.length > 4 ? `${parts.slice(0, 3).join(", ")} and ${parts.length - 3} more` : list(parts);
}

export function verb(es: PageEdge[]): string {
  if (es.every((e) => e.reads || e.writes)) {
    const r = es.some((e) => e.reads), w = es.some((e) => e.writes);
    return r && w ? "reads and writes" : w ? "writes" : "reads";
  }
  return es.every((e) => e.calls && !e.imports && !e.uses) ? "calls" : "uses";
}

/**
 * One sentence per box an arrow of this step starts from ("KioskPage uses 8 screens and kioskHttp"),
 * at most three; the first step names where the board starts. Only drawn edges (`shown`) count.
 */
export function caption(step: number, layers: string[][], edges: PageEdge[], shown: Set<string>, name: (id: string) => string): string {
  const rank = rankOf(layers);
  const r = (id: string) => rank.get(id) ?? -1;
  const fresh = edges.filter((e) => shown.has(`${e.a}>${e.b}`) && Math.max(r(e.a), r(e.b)) === step && r(e.a) >= 0 && r(e.b) >= 0);
  const by = new Map<string, PageEdge[]>();
  for (const e of fresh) by.set(e.a, [...(by.get(e.a) ?? []), e]);
  const srcs = [...by].sort((x, y) => r(x[0]) - r(y[0]) || y[1].length - x[1].length || (name(x[0]) < name(y[0]) ? -1 : 1));
  // boxes that do the same thing share a sentence: "4 pages use App shell and Marketing site"
  const same = new Map<string, string[]>();
  for (const [a, es] of srcs) {
    const k = `${verb(es)}|${sumUp(es.map((e) => name(e.b)).sort())}`;
    same.set(k, [...(same.get(k) ?? []), name(a)]);
  }
  const groups = [...same];
  const said = groups.slice(0, 3).map(([k, who]) => {
    const [v, what] = k.split("|");
    return `${sumUp(who)} ${who.length > 1 ? v.replace(/s\b/g, "") : v} ${what}.`;
  });
  const more = groups.slice(3).reduce((n, [, who]) => n + who.length, 0);
  if (more) said.push(`${more} more ${more === 1 ? "box connects" : "boxes connect"} here.`);
  // "+more" stands for the files a leaf board leaves out (files.ts): not a box to read about
  const here = sumUp(layers[step].filter((id) => id !== "+more").map(name));
  if (step === 0) return [`Start with ${here}.`, ...said].join(" ");
  return said.length ? said.join(" ") : `Then ${here}.`;
}
