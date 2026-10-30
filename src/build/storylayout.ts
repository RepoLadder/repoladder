// Story-level geometry around D2. Each actor is laid out as a card plus an empty lane to its right,
// sized for its "what they do" pills, so ELK leaves every actor's arrows a long straight run to
// carry them. After layout the box shrinks back to the card and each arrow is extended back to the
// card's edge, so arrows start exactly where the card is drawn.
import type { BoardLayout } from "./layout.ts";
import { ACTOR_H, actorSize, sayBox, soleSay, type ActorKind } from "../viewer/figures.ts";
import { PILL_START } from "../viewer/storylabels.ts";
import { simplify } from "../viewer/curves.ts";

/** Room above and below a card in its D2 box: the gap between cards in the column. */
export const CARD_GAP = 10;
/** Line between a pill and whatever the arrow meets next (a bend, another lane). */
const LANE_END = 26;

/** Width of the pill lane: the widest pill any actor arrow carries (sayBox), plus line on both sides. */
export function laneWidth(edges: readonly { a: string; says?: string[] | null }[]): number {
  const told = edges.filter((e) => e.says?.length);
  return told.length ? Math.ceil(PILL_START + Math.max(...told.map((e) => sayBox(e.says!, soleSay(told, e.a))[0])) + LANE_END) : 0;
}

/** The D2 box for an actor card of size `card`. */
export const actorBox = (card: [number, number], lane: number): [number, number] => [card[0] + lane, card[1] + 2 * CARD_GAP];

/** Space between two pills stacked beside a card; one-line pills (24px) then sit 28px apart. */
const PILL_GAP = 4;
const ONE_LINE = sayBox(["x"])[1];
type Told = { a: string; b?: string; says?: string[] | null };

/** Distances between consecutive ports, so the pills of height `hs` (in port order) stack PILL_GAP apart. */
const steps = (hs: number[]) => hs.slice(1).map((h, i) => (hs[i] + h) / 2 + PILL_GAP);

/**
 * Where an actor's k arrows leave its card: around the middle, spaced by their pills' heights `hs`
 * (one-line pills by default) so the pills stack without overlapping (#263), never closer than 8 to
 * the card's top or bottom (squeezed only if the card is too short, which storyCardH prevents).
 */
export function ports(top: number, h: number, k: number, hs: number[] = Array(k).fill(ONE_LINE)): number[] {
  if (!k) return [];
  const st = steps(hs), span = st.reduce((s, d) => s + d, 0), f = span > h - 16 ? (h - 16) / span : 1;
  let y = top + h / 2 - (span * f) / 2;
  return [Math.round(y), ...st.map((d) => Math.round((y += d * f)))];
}

/** Height of each pill on the board, by `a>b`. */
export function pillHeights(edges: readonly Told[]): Record<string, number> {
  const told = edges.filter((e) => e.says?.length);
  return Object.fromEntries(told.map((e) => [`${e.a}>${e.b}`, sayBox(e.says!, soleSay(told, e.a))[1]]));
}

/**
 * The actor cards' shared height: ACTOR_H, or taller when an actor's pills would not stack beside
 * it, whatever order ELK gives its arrows: its ports must stay 8 inside the card, and its pills
 * may reach at most 8 past the card's top and bottom, so neighbours' pills (2 × CARD_GAP apart) never meet.
 */
export function storyCardH(edges: readonly Told[]): number {
  const told = edges.filter((e) => e.says?.length), by = new Map<string, number[]>();
  for (const e of told) by.set(e.a, [...(by.get(e.a) ?? []), sayBox(e.says!, soleSay(told, e.a))[1]]);
  let need = ACTOR_H;
  for (const hs of by.values()) {
    if (hs.length < 2) continue;
    const s = [...hs].sort((p, q) => p - q), stack = s.reduce((t, h) => t + h, 0) + PILL_GAP * (s.length - 1);
    // the worst order puts the two shortest pills at the ends
    need = Math.max(need, stack - (s[0] + s[1]) / 2 + 16, stack - 16);
  }
  return Math.ceil(need);
}

/** Every actor card's size on the story board: the longest name or role's width, storyCardH's height. */
export const storyCard = (actors: readonly { name: string; kind: ActorKind }[], edges: readonly Told[]): [number, number] => [actorSize(actors)[0], storyCardH(edges)];

/**
 * Shrinks each actor's box to its card (left edge kept, centered vertically) and starts each of its
 * arrows at the card's right edge, at evenly spaced ports around its middle (ELK's ports may fall
 * outside the card, since it spaced them over the whole box). The arrow keeps its route: when it
 * bends right after the lane, that bend moves to the port's height; when it runs straight on, it gets
 * a small step at the lane's end (unless it already leaves inside the card). An actor whose arrows don't leave its box's right side straight
 * keeps its whole box, so an arrow never floats loose.
 */
export function fitActors(layout: BoardLayout, actors: Set<string>, card: [number, number], pills: Record<string, number> = {}): BoardLayout {
  const n = layout.n.map((r) => [...r] as BoardLayout["n"][number]);
  const e = layout.e.map((r) => [...r] as BoardLayout["e"][number]);
  for (const node of n) {
    const [id, x, y, w, h] = node;
    if (!actors.has(id) || w < card[0] || h < card[1]) continue;
    const top = y + Math.round((h - card[1]) / 2), right = x + card[0];
    const mine = e.map((r, i) => [r, i] as const).filter(([r]) => r[0] === id);
    const ok = mine.every(([r]) => {
      const [, , curve, x0, y0, x1, y1] = r as [string, string, 0 | 1, ...number[]];
      return !curve && r.length >= 7 && Math.abs(x0 - (x + w)) <= 1 && Math.abs(y1 - y0) <= 1 && x1 >= x0;
    });
    if (!ok) continue;
    node[2] = top; node[3] = card[0]; node[4] = card[1];
    // keep ELK's top-to-bottom order of the arrows, so moving them adds no crossings among them
    const order = [...mine].sort((a, b) => (a[0][4] as number) - (b[0][4] as number) || a[1] - b[1]);
    const ys = ports(top, card[1], order.length, order.map(([r]) => pills[`${r[0]}>${r[1]}`] ?? ONE_LINE));
    const inCard = (v: number) => v >= top + 8 && v <= top + card[1] - 8;
    order.forEach(([r, i], k) => {
      const [a, z, , x0, y0, ...rest] = r as [string, string, 0, ...number[]];
      const vertical = rest.length >= 4 && Math.abs(rest[2] - rest[0]) <= 1;
      // A lone arrow keeps its height when it already leaves inside the card, or straightens out
      // when the height it bends to after the lane is inside the card. Otherwise it takes its port.
      const lone = order.length === 1;
      const ny = lone && vertical && inCard(rest[3]) ? rest[3] : lone && inCard(y0) ? y0 : ys[k];
      const p = vertical || ny === y0 ? [right, ny, rest[0], vertical ? ny : y0, ...rest.slice(2)] : [right, ny, x0, ny, x0, y0, ...rest];
      e[i] = [a, z, 0, ...tidy(p)];
    });
  }
  return { n, e };
}

/** Drops repeated points and the middle of three points on one straight line, so no zero-length bend is drawn. */
export function tidy(p: number[]): number[] {
  const pts: [number, number][] = [];
  for (let i = 0; i + 1 < p.length; i += 2) pts.push([p[i], p[i + 1]]);
  return simplify(pts).flat();
}
