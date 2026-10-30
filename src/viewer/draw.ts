// Renders one board's layout to an SVG string: wires first, then their labels (above every wire,
// so no other wire crosses a pill), then boxes and service cylinders.
import type { BoardLayout } from "../build/layout.ts";
import { boxBody, boxClass, type Box } from "./shapes.ts";
import { partSub, weightClass } from "./weight.ts";
import { curvePath, roundPath } from "./curves.ts";
import { actorBody, soleSay, storyWire } from "./figures.ts";
import { pillSize, type Placed } from "./labels.ts";
import { labelRect, labelShown, placeBoardLabels } from "./placement.ts";
import { boardViewBox } from "./bounds.ts";
import { fileBox } from "./files.ts";
import { isGroupBox, storeBoardBox, storeMarkers } from "./collections.ts";
import { whereLine } from "./where.ts";
import { everyBox, isContainer, onEvery } from "./everydraw.ts";
import { castPill } from "./storycut.ts";
import { nameLines } from "./namewrap.ts";
import { STORY, N, actorOf, board, edgeClass, edgeKey, wireLabel as edgeLabel, esc, isCtx, isFile, isOpenable, iconOf, isStore, nameOf, onStoreBoard, st, storeLines, type PageEdge } from "./state.ts";

const labelW = (t: string) => pillSize(t)[0];

/** The wire, and its label as a separate group with the same data-hit (drawn in the label layer). */
function wire(a: string, z: string, curve: 0 | 1, p: number[], e: PageEdge | undefined, at: Placed | undefined): [string, string] {
  const d = curve ? curvePath(p) : roundPath(p, 10);
  const t = e ? edgeLabel(e) : "";
  const w = labelW(t), lx = at?.x ?? 0, ly = at?.y ?? 0;
  const cls = e ? edgeClass(e) : "";
  const g = `class="wire ${cls}${e?.hub ? " hub" : ""}${e && weightClass(e) ? ` ${weightClass(e)}` : ""}" data-hit="e:${esc(a)}>${esc(z)}"`;
  return [
    `<g ${g} tabindex="0" role="button" aria-label="${esc(nameOf(a))} to ${esc(nameOf(z))}"><path class="hitline" d="${d}"/><path class="line" d="${d}" ${storeMarkers(e, cls)}/></g>`,
    t && at ? `<g ${g} aria-hidden="true"><g class="lab${at.lo ? " lo" : ""}"><rect class="pill" x="${lx - w / 2}" y="${ly - 9}" width="${w}" height="18" rx="9"/><text class="n" x="${lx}" y="${ly + 4}" text-anchor="middle">${esc(t)}</text></g></g>` : "",
  ];
}

function box(id: string, x: number, y: number, w: number, h: number, cyl: 0 | 1): string {
  const every = onEvery() ? everyBox(id, x, y, w, h) : null;
  if (every) return every;
  if (isFile(id)) return fileBox(id, x, y, w, h);
  if (onStoreBoard()) return storeBoardBox(id, x, y, w, h);
  const ctx = !cyl && isCtx(id), n = N()[id];
  const b: Box = {
    x, y, w, h, name: nameOf(id), svc: !!cyl, store: !!cyl && isStore(id), icon: cyl ? iconOf(id) : undefined, ctx, kind: n?.kind, hub: board().hubs.includes(id), openable: isOpenable(id),
    subs: cyl && isStore(id) ? storeLines(id) : [cyl ? st.data.does?.[id] ?? "service" : ctx ? whereLine(N(), st.cur, id) : partSub(n.count, n.loc)],
  };
  // the story level sized its parts for long names on two lines (build/boxsize.ts partSizes)
  if (st.cur === STORY && !cyl && !ctx) b.lines = nameLines(b.name, w, n?.kind === "backend" ? 12 : 0);
  return `<g class="${boxClass(b)}" data-hit="n:${esc(id)}" tabindex="0" role="button" aria-label="${esc(nameOf(id))}">${boxBody(b)}</g>`;
}

const marker = (k: string, c: string) => `<marker id="arw-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 1L10 5L0 9z" class="arw ${c}"/></marker>`;

export function draw(layout: BoardLayout): string {
  const out: string[] = [], labs: string[] = [];
  const info = new Map(board().edges.map((e) => [edgeKey(e), e]));
  // Everything draws no arrow labels: on hundreds of boxes they would only crowd (the panel has them)
  const placed = onEvery() ? [] : [...placeBoardLabels(layout, info, edgeLabel)];
  const at = new Map(placed.map(([e, l]) => [e, l.at]));
  for (const [a, z, curve, ...p] of layout.e) {
    const e = info.get(`${a}>${z}`);
    const alone = !!e?.says && soleSay(board().edges, a);
    const [line, lab] = e?.says ? storyWire(a, z, curve, p, e.says, alone, `${nameOf(a)}: ${e.says.join(", ")}`, at.get(e) ?? (onEvery() ? castPill(p, e.says, alone) : undefined)) : wire(a, z, curve, p, e, e && at.get(e));
    out.push(line);
    labs.push(lab);
  }
  out.push(...labs);
  const under: string[] = [];
  for (const [id, x, y, w, h, cyl] of layout.n) {
    const actor = actorOf(id);
    (isGroupBox(id) || isContainer(id) ? under : out).push(actor ? `<g class="node actor ${actor.kind}" data-hit="n:${esc(id)}" tabindex="0" role="button" aria-label="${esc(actor.name)}">${actorBody(actor.kind, actor.name, x, y, w, h)}</g>` : box(id, x, y, w, h, cyl));
  }
  const [x0, y0, W, H] = boardViewBox(layout, N()[st.cur]?.children.length === 0 || onStoreBoard(), placed.filter(([e, l]) => labelShown(e, l)).map(([, l]) => labelRect(l)));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${W} ${H}" role="group" aria-label="Architecture diagram"><defs>${marker("n", "")}${marker("call", "call")}${marker("svc", "svc")}${marker("data", "data")}${marker("story", "story")}${marker("lit", "lit")}</defs>${under.join("")}${out.join("")}</svg>`;
}
