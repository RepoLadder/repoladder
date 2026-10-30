// The story level's own marks: actors and the arrows of what they do.
// Actors are outside the code, so they are drawn in ink, not in a kind's hue: a person's card carries a round
// medallion with a head and shoulders, a system's a squared medallion with an app grid. Their arrows
// are solid ink with the plain-language verbs on them. See DESIGN.md.
import { curveLabelAt, curvePath, labelAt, roundPath } from "./curves.ts";
import { splitName } from "./namewrap.ts";
import { esc } from "./state.ts";

export type ActorKind = "person" | "system";

// An actor is a card like every other box, so its arrows meet a visible edge: medallion on the left,
// name and role to its right. All actors share one width (the longest name or role), so they stack as one tidy column.
const PAD = 12, MEDAL = 15, GAP = 10, NAME_CH = 10.3;
// 11px mono sub line (board.css .node .sub), as build/boxsize.ts SUB_CH
const SUB_CH = 6.7;
export const ACTOR_H = 56;
/** Corner radius of an actor's card (build/outline.ts traces the same card). */
export const CARD_RX = 10;

/** The sub line under an actor's name. */
export const actorRole = (kind: ActorKind) => (kind === "person" ? "person" : "outside system");

/** Width and height of every actor card on a board, fitting the longest name and role (#283); build/layout.ts reserves exactly this much in D2. */
export function actorSize(actors: readonly { name: string; kind: ActorKind }[]): [number, number] {
  const text = Math.max(Math.max(6, ...actors.map((a) => a.name.length)) * NAME_CH, ...actors.map((a) => actorRole(a.kind).length * SUB_CH));
  return [Math.round(PAD + 2 * MEDAL + GAP + text + PAD + 2), ACTOR_H];
}

/** The medallion and glyph, centered on (cx, cy) with radius r. */
export function actorGlyph(kind: ActorKind, cx: number, cy: number, r: number): string {
  if (kind === "person") {
    const hr = r * 0.3, sw = r * 0.58;
    return `<circle class="body" cx="${cx}" cy="${cy}" r="${r}"/>`
      + `<circle class="glyph" cx="${cx}" cy="${cy - r * 0.2}" r="${hr}"/>`
      + `<path class="glyph" d="M${cx - sw} ${cy + r * 0.62}a${sw} ${r * 0.46} 0 0 1 ${2 * sw} 0z"/>`;
  }
  const s = r * 0.27, g = r * 0.12;
  let cells = "";
  for (const dx of [-1, 1]) for (const dy of [-1, 1]) {
    cells += `<rect class="glyph" x="${cx + (dx < 0 ? -s - g / 2 : g / 2)}" y="${cy + (dy < 0 ? -s - g / 2 : g / 2)}" width="${s}" height="${s}" rx="${s * 0.28}"/>`;
  }
  return `<rect class="body" x="${cx - r}" y="${cy - r}" width="${2 * r}" height="${2 * r}" rx="${r * 0.38}"/>${cells}`;
}

/** One actor: a card with the medallion on its left and the name and role beside it. */
export function actorBody(kind: ActorKind, name: string, x: number, y: number, w: number, h: number): string {
  const cy = y + h / 2, tx = x + PAD + 2 * MEDAL + GAP;
  return `<rect class="card" x="${x}" y="${y}" width="${w}" height="${h}" rx="${CARD_RX}"/>${actorGlyph(kind, x + PAD + MEDAL, cy, MEDAL)}`
    + `<text class="name" x="${tx}" y="${cy - 2}">${esc(name)}</text>`
    + `<text class="sub" x="${tx}" y="${cy + 15}">${actorRole(kind)}</text>`;
}

const LINE = 16;

/** Whether `a` has only one arrow with a pill on the board: its pill may go taller (sayLines). */
export const soleSay = (edges: readonly { a: string; says?: string[] | null }[], a: string) => edges.filter((e) => e.a === a && e.says?.length).length === 1;
/** On an actor's only arrow, phrases longer than this go on two lines, while the pill stays within SAY_ROWS lines. */
const SAY_WRAP = 20, SAY_ROWS = 3;

/**
 * The pill's lines: one per phrase, and on an actor's only arrow (`alone`) the longest phrases split
 * in two while there is room. Every actor's lane is as wide as the widest pill (build/storylayout.ts),
 * and the lanes set where the story's parts start, so one long phrase would push the whole board wider
 * and make it read smaller (#236). An actor with more arrows has them a port apart (storylayout.ts
 * ports), too close for taller pills, so its phrases stay on one line each.
 */
export function sayLines(says: string[], alone = false): string[] {
  if (!alone) return says;
  const rows = says.map((t) => [t]);
  for (const i of says.map((_, i) => i).sort((a, b) => says[b].length - says[a].length || a - b)) {
    const split = splitName(says[i]);
    if (says[i].length <= SAY_WRAP || rows.flat().length >= SAY_ROWS) break;
    if (split) rows[i] = split;
  }
  return rows.flat();
}

/** Size of the pill that lists what an actor does, one phrase per line or two (labels.ts places it). */
export function sayBox(says: string[], alone = false): [number, number] {
  const lines = sayLines(says, alone);
  return [Math.max(...lines.map((t) => t.length)) * 6.9 + 20, lines.length * LINE + 8];
}

/**
 * An actor's arrow: solid ink, with each thing the actor does on its own line in a pill. Returns the
 * wire and its label separately, like draw.ts, so labels sit above every wire. The pill always shows.
 */
export function storyWire(a: string, z: string, curve: 0 | 1, p: number[], says: string[], alone: boolean, label: string, at?: { x: number; y: number }): [string, string] {
  const [lx, ly] = at ? [at.x, at.y] : curve ? curveLabelAt(p) : labelAt(p);
  const d = curve ? curvePath(p) : roundPath(p, 10);
  const [w, h] = sayBox(says, alone), top = ly - h / 2;
  const g = `class="wire story" data-hit="e:${esc(a)}>${esc(z)}"`;
  const text = sayLines(says, alone).map((t, i) => `<text class="say" x="${lx}" y="${top + 4 + LINE * (i + 0.5) + 4}" text-anchor="middle">${esc(t)}</text>`).join("");
  return [
    `<g ${g} tabindex="0" role="button" aria-label="${esc(label)}"><path class="hitline" d="${d}"/><path class="line" d="${d}" marker-end="url(#arw-story)"/></g>`,
    `<g ${g} aria-hidden="true"><g class="lab"><rect class="pill" x="${lx - w / 2}" y="${top}" width="${w}" height="${h}" rx="8"/>${text}</g></g>`,
  ];
}
