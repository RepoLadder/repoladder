// The story level (level 0): who uses the system and what for, told in a few sentences next to
// a board of actors and the level-1 parts. Each sentence lights up the parts and arrows it names,
// and plays them as a flow (pulse.ts).
import { actorGlyph, type ActorKind } from "./figures.ts";
import { edgeId, idRow } from "./idchip.ts";
import { legend } from "./legend.ts";
import { box } from "./box.ts";
import { notesBox } from "./keycard.ts";
import { fileRef } from "./codelink.ts";
import { snippet } from "./panels.ts";
import { MIN_NAME_PX, NAME_PX, setOpening } from "./fit.ts";
import { syncReframe } from "./reframe.ts";
import { tourList } from "./walk.ts";
import { pulse, stopPulse } from "./pulse.ts";
import { waves } from "./walkorder.ts";
import { $, N, S, STORY, actorOf, board, edgeKey, esc, isStore, nameOf, path, plural, st, type PageEdge } from "./state.ts";

/** Same syntax as STORY_REF in model/story.ts: [[id]] or [[id|shown text]]. */
const REF = /\[\[([a-z0-9][a-z0-9-]*)(?:\|([^\[\]|]+))?\]\]/g;

const story = () => st.data.story!;
/** The sentence a tap pinned, lit until tapped again or the board changes. */
let pinned: number | null = null;
const onBoard = (id: string) => board().nodes.includes(id);

/** The box a reference lights up on the story board: actors and services as they are, groups as their level-1 part. */
export function boxOf(id: string): string | null {
  if (actorOf(id) || S()[id]) return onBoard(id) ? id : null;
  let n = N()[id];
  while (n && n.parent && n.parent !== "root") n = N()[n.parent];
  return n && onBoard(n.id) ? n.id : null;
}

/** What a sentence lights: the boxes it names, plus what a named actor does when the sentence names none of its parts. */
export function litBy(sentence: string, edges: PageEdge[]): { boxes: Set<string>; edges: Set<string> } {
  const named = new Set([...sentence.matchAll(REF)].map((m) => boxOf(m[1])).filter((x): x is string => !!x));
  const boxes = new Set(named);
  for (const id of named) {
    if (!actorOf(id)) continue;
    const mine = edges.filter((e) => e.a === id);
    if (!mine.some((e) => named.has(e.b))) mine.forEach((e) => boxes.add(e.b));
  }
  const lit = edges.filter((e) => boxes.has(e.a) && boxes.has(e.b) && (!actorOf(e.a) || named.has(e.b) || !edges.some((x) => x.a === e.a && named.has(x.b))));
  return { boxes, edges: new Set(lit.map(edgeKey)) };
}

const tint = (id: string) => (actorOf(id) ? "r-actor" : isStore(id) ? "r-store" : S()[id] ? "r-svc" : `r-${N()[id]?.kind ?? "part"}`);

/** A narrative sentence as HTML, references as buttons that select their box. */
export function sentenceHtml(s: string, start: boolean): string {
  let out = "", at = 0;
  for (const m of s.matchAll(REF)) {
    const id = m[1], box = boxOf(id), a = actorOf(id);
    let text = m[2]?.trim() || nameOf(id);
    // a person's role reads as a common noun mid-sentence ("a patient"); names of things keep their capitals
    if (!m[2] && a?.kind === "person" && (m.index! > 0 || !start) && /^[A-Z][a-z]+(\s|$)/.test(text)) text = text[0].toLowerCase() + text.slice(1);
    out += esc(s.slice(at, m.index));
    out += box ? `<button class="ref ${tint(box)}" data-sel="n:${esc(box)}">${esc(text)}</button>` : esc(text);
    at = m.index! + m[0].length;
  }
  return out + esc(s.slice(at));
}

const medal = (kind: ActorKind) => `<svg class="medal ${kind}" viewBox="0 0 28 28" aria-hidden="true">${actorGlyph(kind, 14, 14, 12.5)}</svg>`;

function overview(): void {
  const beats = story().narrative.map((s, i) => `<li class="beat" tabindex="0" data-beat="${i}"><span class="bn">${i + 1}</span><p>${sentenceHtml(s, true)}</p></li>`).join("");
  const actors = Object.values(story().actors).map((a) => {
    const does = board().edges.filter((e) => e.a === a.id).flatMap((e) => e.says ?? []);
    return `<li><button class="item actor-row" data-sel="n:${esc(a.id)}">${medal(a.kind)}<span><b>${esc(a.name)}</b><small>${esc(does.join(" · "))}</small></span></button></li>`;
  }).join("");
  const key = [`${medal("person")}Person`, `${medal("system")}Outside system`, `<svg class="lgi" viewBox="0 0 64 46" aria-hidden="true"><g class="wire story"><path class="line" d="M6 23H58"/></g></svg>What they do`]
    .map((x) => `<li>${x}</li>`).join("");
  $("details").innerHTML = box("The story", `<ol class="beats">${beats}</ol><p class="hint">Point at or tap a sentence to light it up on the diagram. Select a part to look inside it.</p>`, { open: true, cls: "story-panel" })
    + box("Who uses it", `<ul class="list">${actors}</ul>`) + `${tourList()}${legend(key)}`
    + notesBox(`<p class="foot">The people and systems, and what they do, are written by the diagram's author; each arrow from them points at a real entry point in the code.</p>`);
}

function actorPanel(id: string): void {
  const a = actorOf(id)!, mine = board().edges.filter((e) => e.a === id);
  const rows = mine.map((e) => `<li><button class="item" data-sel="e:${esc(edgeKey(e))}"><span>${esc((e.says ?? []).join(", "))}</span><span class="num">${esc(nameOf(e.b))}</span></button></li>`).join("");
  $("details").innerHTML = `<h2>${a.kind === "person" ? "Person" : "Outside system"}</h2><div class="panel"><h3 class="actor-h">${medal(a.kind)}${esc(a.name)}</h3>${idRow(id)}${a.summary ? `<p>${esc(a.summary)}</p>` : ""}<h4>What they do</h4><ul class="list">${rows}</ul></div>`;
}

function usePanel(e: PageEdge): void {
  const says = (e.says ?? []).map((s) => `<li>${esc(s)}</li>`).join("");
  // a page's entry is its file (line 1, all imports): the path says it all; an endpoint gets its snippet
  const ev = e.ev.map(([f, l, t]) => `<div class="ev">${fileRef(f, l > 1 ? l : undefined)}${path(t) !== path(f) ? `<br><span>${esc(path(t))}</span>` : ""}${l > 1 ? snippet(f, l) : ""}</div>`).join("");
  $("details").innerHTML = `<h2>What they do</h2><div class="panel"><h3>${esc(nameOf(e.a))} → ${esc(nameOf(e.b))}</h3>${idRow(edgeId(e.a, e.b))}<ul class="says">${says}</ul><h4>Where it starts in the code</h4>${ev}<p class="foot">Written by the diagram's author; the build checked that each entry point exists in ${esc(nameOf(e.b))}.</p></div>`;
}

/** Side panel on the story board. Returns false for what the ordinary panels show (parts, services, code arrows). */
export function storyPick(hit: string | null): boolean {
  if (st.cur !== STORY) return false;
  pinned = null;
  light(null);
  if (!hit) return overview(), true;
  if (hit.startsWith("n:") && actorOf(hit.slice(2))) return actorPanel(hit.slice(2)), true;
  const e = hit.startsWith("e:") ? board().edges.find((x) => `e:${edgeKey(x)}` === hit) : undefined;
  if (e?.says) return usePanel(e), true;
  return false;
}


function light(i: number | null): void {
  const svg = st.svgEl;
  document.querySelectorAll(".beat.on").forEach((b) => b.classList.remove("on"));
  svg.querySelectorAll("g.told").forEach((g) => g.classList.remove("told"));
  svg.classList.toggle("telling", i !== null);
  if (i === null) return stopPulse(svg);
  document.querySelector(`.beat[data-beat="${i}"]`)?.classList.add("on");
  const { boxes, edges } = litBy(story().narrative[i], board().edges);
  svg.querySelectorAll<SVGGElement>("g[data-hit]").forEach((g) => {
    const h = g.dataset.hit!;
    if (h.startsWith("n:") ? boxes.has(h.slice(2)) : edges.has(h.slice(2))) g.classList.add("told");
  });
  // the sentence's part of the system as a flow: a pulse runs its arrows from the actor onward
  pulse(svg, waves([...edges]));
}

const beatOf = (ev: Event) => (ev.target as Element).closest?.<HTMLElement>(".beat");

/** Hover, keyboard focus or tap on a sentence lights it; a tap pins it until tapped again. */
export function installStory(): void {
  const panel = $("details");
  let over: number | null = null;
  const hover = (i: number | null) => { if (i !== over && st.cur === STORY) light((over = i) ?? pinned); };
  panel.addEventListener("mouseover", (ev) => { const b = beatOf(ev); hover(b ? +b.dataset.beat! : null); });
  panel.addEventListener("mouseleave", () => hover(null));
  panel.addEventListener("focusin", (ev) => { const b = beatOf(ev); if (b) light(+b.dataset.beat!); });
  panel.addEventListener("focusout", () => { if (st.cur === STORY) light(pinned); });
  panel.addEventListener("click", (ev) => {
    const b = beatOf(ev);
    if (!b || (ev.target as Element).closest(".ref")) return;
    const i = +b.dataset.beat!;
    pinned = pinned === i ? null : i;
    light(pinned ?? i);
    frame(pinned === null ? null : i);
  });
}

/** A tap (or click) on a sentence also zooms to what it names, which matters most on a phone; tapping again zooms back out. */
function frame(i: number | null): void {
  const lit = [...st.svgEl.querySelectorAll<SVGGElement>("g.told")];
  if (i === null || !lit.length) st.view = [...st.base];
  else {
    const bs = lit.map((g) => g.getBBox()), pad = 40;
    const x0 = Math.min(...bs.map((b) => b.x)) - pad, y0 = Math.min(...bs.map((b) => b.y)) - pad;
    const x1 = Math.max(...bs.map((b) => b.x + b.width)) + pad, y1 = Math.max(...bs.map((b) => b.y + b.height)) + pad;
    // fit into the part of the canvas the bottom sheet (sheet.ts, phones) leaves open, never closer than 2.5x the whole board
    const c = $("canvas").getBoundingClientRect(), sheet = document.querySelector("aside")!.getBoundingClientRect();
    const open = sheet.top > c.top && sheet.top < c.bottom ? sheet.top - c.top : c.height;
    // on a phone never past the readable zoom (#210): what doesn't fit is read from its left, the actor
    const s = Math.max(Math.min(c.width / (x1 - x0), open / (y1 - y0), 2.5 * Math.min(c.width / st.base[2], c.height / st.base[3])), c.width < 760 ? MIN_NAME_PX / NAME_PX : 0);
    const w = c.width / s, h = c.height / s;
    st.view = [Math.min((x0 + x1) / 2 - w / 2, x0), (y0 + y1) / 2 - open / s / 2, w, h];
  }
  st.svgEl.setAttribute("viewBox", st.view.join(" "));
  syncReframe();
}

const CAPTIONS: [string, (id: string) => boolean][] = [
  ["People & systems", (id) => !!actorOf(id)],
  ["Its parts", (id) => !!N()[id]],
  ["What it relies on", (id) => !!S()[id]],
];

/** Column headings over the story board, so it reads as who → what → built on. Skipped where columns overlap. */
function captions(): void {
  const n = st.data.layout[STORY].n, top = Math.min(...n.map((r) => r[2])) - 22;
  const L = Math.min(...n.map((r) => r[1])), R = Math.max(...n.map((r) => r[1] + r[3]));
  let right = -Infinity, out = "";
  for (const [label, has] of CAPTIONS) {
    const rows = n.filter((r) => has(r[0]));
    if (!rows.length) continue;
    const x0 = Math.min(...rows.map((r) => r[1])), x1 = Math.max(...rows.map((r) => r[1] + r[3]));
    const half = label.length * 4.6, cx = Math.max(L + half, Math.min(R - half, (x0 + x1) / 2));
    if (cx - half < right + 24 || x0 < right) continue;
    out += `<text class="cap" x="${cx}" y="${top}" text-anchor="middle">${esc(label.toUpperCase())}</text>`;
    right = Math.max(cx + half, x1);
  }
  st.svgEl.insertAdjacentHTML("afterbegin", `<g class="captions" aria-hidden="true">${out}</g>`);
  // Room for the headings below the zoom buttons (about 46px of screen, in board units). This widens
  // the drawn viewBox before fit.ts reads it as the whole board.
  const v = st.svgEl.getAttribute("viewBox")!.split(" ").map(Number);
  const r = st.svgEl.getBoundingClientRect(), k = r.width ? Math.max(v[2] / r.width, v[3] / r.height) : 1;
  // on a phone fit.ts opens at its readable zoom (names at 11px of 14.5), not at the whole board
  const extra = 36 + 46 * (r.width < 760 ? Math.min(k, 14.5 / 11) : Math.min(k, 3));
  st.svgEl.setAttribute("viewBox", [v[0], v[1] - extra, v[2], v[3] + extra].join(" "));
}

/** Called when a board is shown: the pin belongs to the story board only. */
export function storyShown(id: string): void {
  pinned = null;
  setOpening(id === STORY ? litBy(story().narrative[0] ?? "", board().edges).boxes : null);
  document.body.classList.toggle("at-story", id === STORY);
  if (id === STORY) captions();
}

export const storyMeta = () => `${plural(Object.keys(story().actors).length, "actor")} · `;
