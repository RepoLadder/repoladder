// Store boards: a data store opened into its collections (model/storeboards.ts). Draws the
// collection boxes (subcollections inside their parent) and the reader/writer boxes around them,
// and renders the collection and store panels.
import { parentColl } from "../model/storeboards.ts";
import { SQUEEZE, collSub, framePad, nameWidth } from "../build/storelayout.ts";
import { boxBody, boxClass, type Box } from "./shapes.ts";
import { catIcon } from "./categories.ts";
import { legend } from "./legend.ts";
import { foots } from "./keycard.ts";
import { fileRef } from "./codelink.ts";
import { idRow } from "./idchip.ts";
import { $, N, S, board, catOf, edgeKey, esc, isColl, nameOf, plural, st, type PageEdge, type PathRef } from "./state.ts";

const HOW: Record<string, string> = { d: "declared", w: "written", q: "queried", r: "read" };
interface Field { name: string; declared: boolean; hows: string[]; sites: number; ev: [PathRef, number, string][] }

const storeOf = () => st.data.stores![st.cur];
export const collPath = (id: string) => id.slice(2);

function fieldsOf(name: string): Field[] {
  return (storeOf()[name] ?? []).map(([n, hows, sites, ...ev]) => {
    const out: Field["ev"] = [];
    for (let i = 0; i + 2 < ev.length; i += 3) out.push([ev[i] as PathRef, ev[i + 1] as number, HOW[ev[i + 2] as string]]);
    return { name: n, declared: hows.includes("d"), hows: [...hows].filter((h) => h !== "d").map((h) => HOW[h]), sites, ev: out };
  });
}

const subsOf = (name: string) => Object.keys(storeOf()).filter((c) => parentColl(c) === name);

/**
 * A collection name in a box `w` wide: as is when it fits, narrowed when it is a little too long
 * (the layout sizes cells for that, build/storelayout.ts), cut with an ellipsis when far too long.
 */
function nameText(s: string, x: number, y: number, w: number): string {
  const room = w - 20;
  if (nameWidth(s) > room * SQUEEZE) {
    while (s.length > 1 && nameWidth(`${s}…`) > room * SQUEEZE) s = s.slice(0, -1);
    s = `${s}…`;
  }
  const fit = nameWidth(s) > room ? ` textLength="${room}" lengthAdjust="spacingAndGlyphs"` : "";
  return `<text class="name" x="${x}" y="${y}"${fit}>${esc(s)}</text>`;
}

/**
 * One box of a store board: a part that reads or writes, or a collection. A collection says how many
 * fields it has (the panel lists them); one with subcollections is a frame around them, its name and
 * count in its first cell (build/storelayout.ts).
 */
export function storeBoardBox(id: string, x: number, y: number, w: number, h: number): string {
  if (!isColl(id)) {
    const n = N()[id], p = n?.parent;
    const b: Box = { x, y, w, h, name: nameOf(id), subs: [p && p !== "root" ? `in ${N()[p].name}` : "part"], ctx: true, kind: n?.kind };
    return `<g class="${boxClass(b)}" data-hit="n:${esc(id)}" tabindex="0" role="button" aria-label="${esc(nameOf(id))}">${boxBody(b)}</g>`;
  }
  const path = collPath(id), subs = subsOf(path), p = subs.length ? framePad(path) : 0;
  const lx = x + p + 10, name = nameOf(id);
  return `<g class="node coll${subs.length ? " group" : ""}" data-hit="n:${esc(id)}" tabindex="0" role="button" aria-label="${esc(name)}"><title>${esc(path)}</title><rect class="body" x="${x}" y="${y}" width="${w}" height="${h}" rx="${subs.length ? 9 : 6}"/>`
    + `${nameText(name, lx, y + p + 19, w - 2 * p)}<text class="sub" x="${lx}" y="${y + p + 35}">${esc(collSub(fieldsOf(path).length, subs.length))}</text></g>`;
}

/** Collection boxes that hold others are drawn under the wires, so arrows into their subcollections show. */
export const isGroupBox = (id: string) => isColl(id) && subsOf(collPath(id)).length > 0;

/** Store boards draw no arrow labels: an arrow into a collection is a write, one back out to the part a read. */
export function storeMarkers(e: PageEdge | undefined, cls: string): string {
  const m = `url(#arw-${cls || "n"})`;
  if (!e || !onStore()) return `marker-end="${m}"`;
  return `${e.writes ? `marker-end="${m}"` : ""}${e.reads ? ` marker-start="${m}"` : ""}`;
}
const onStore = () => !!st.data.stores?.[st.cur];
/** Too many readers to draw beside the collections (model/storeboards.ts storeReaders): the panels list them. */
export const readersListed = () => onStore() && !board().context.length && board().edges.length > 0;

const partButtons = (es: PageEdge[]) => es.length ? `<ul class="list">${es.map((e) => `<li><button class="item" data-sel="e:${esc(edgeKey(e))}"><span>${esc(nameOf(e.a))}</span><span class="num">${plural(e.uses, "place")}</span></button></li>`).join("")}</ul>` : `<p class="num none">Nothing found in the code</p>`;

export function renderCollection(id: string): void {
  const path = collPath(id), parent = parentColl(path), fs = fieldsOf(path);
  const es = board().edges.filter((e) => e.b === id);
  const subs = board().nodes.filter((k) => isColl(k) && parentColl(collPath(k)) === path);
  const declared = fs.some((f) => f.declared);
  const rows = fs.map((f) => `<li class="fld"><div class="fname${f.declared ? "" : " inf"}">${esc(f.name)}<span class="how">${esc([f.declared ? "declared" : "", ...f.hows].filter(Boolean).join(" · "))}</span></div>${f.ev.map(([file, l, how]) => `<div class="ev">${fileRef(file, l)}<span> ${esc(how)}</span></div>`).join("")}${f.sites > f.ev.length ? `<div class="num">+${plural(f.sites - f.ev.length, "more place")}</div>` : ""}</li>`).join("");
  $("details").innerHTML = `<h2>Collection</h2><div class="panel"><h3>${esc(nameOf(id))}</h3><div class="ev cname">${esc(path)}</div>`
    + `${parent ? `<p>Inside <button class="open" data-sel="n:c:${esc(parent)}">${esc(nameOf(`c:${parent}`))}</button>: one per ${esc(nameOf(`c:${parent}`))} document.</p>` : ""}`
    + `${subs.length ? `<p class="num">Holds ${subs.map((k) => `<button class="open" data-sel="n:${esc(k)}">${esc(nameOf(k))}</button>`).join(", ")}</p>` : ""}`
    + `<h4>Written by</h4>${partButtons(es.filter((e) => e.writes))}<h4>Read by</h4>${partButtons(es.filter((e) => e.reads))}`
    + `<h4>Fields (${fs.length})</h4><p class="foot">${declared ? "Declared in the schema, with where the code uses them." : "Inferred from the code: keys it writes, fields it queries, properties it reads back. Not a schema; dynamic keys are left out."}</p>`
    + `<ul class="list flds">${rows || `<li class="num none">None seen in the code</li>`}</ul></div>`;
}

/** The panel of a store board with nothing selected. */
export function renderStoreOverview(): void {
  const sid = st.cur, names = Object.keys(storeOf());
  const total = names.reduce((n, c) => n + (storeOf()[c]?.length ?? 0), 0);
  const depth = (c: string) => c.split("/").length - 1;
  const items = names.map((c) => `<li><button class="item" data-sel="n:c:${esc(c)}"><span style="padding-left:${depth(c) * 14}px">${esc(nameOf(`c:${c}`))}</span><span class="num">${storeOf()[c].length}</span></button></li>`).join("");
  $("details").innerHTML = `<h2>Data store</h2><div class="panel"><h3>${catIcon(catOf(sid), true)}${esc(S()[sid])}</h3>${idRow(sid)}<p class="num">${plural(names.length, "collection")} · ${plural(total, "field")}</p><p>Each box is a collection and how many fields the code uses on it; subcollections sit inside their parent. Select a collection to see every field and where it is written and read.</p><ul class="list">${items}</ul></div>${legend()}${foots(`<p class="foot">${readersListed() ? "Too many parts read and write this store to draw them beside its collections. Select a collection to see which parts write and read it, then one of them for where in the code." : "An arrow into a collection: that part writes it. An arrow back out to the part: it reads it. Every arrow comes from a read or write in the code."}</p>`)}`;
}

/** Breadcrumbs and meta line of a store board: Overview › the store. */
export function storeMeta(): string {
  const names = Object.keys(storeOf());
  return `${plural(names.length, "collection")} · ${plural(names.reduce((n, c) => n + storeOf()[c].length, 0), "field")}`;
}
