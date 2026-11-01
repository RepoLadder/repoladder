// The side panel: what is selected (part, elsewhere box, service, connection) or the board overview.
import { fileItems } from "./files.ts";
import { whereLine, whereText } from "./where.ts";
import { box } from "./box.ts";
import { legend } from "./legend.ts";
import { focusButton } from "./filterui.ts";
import { tourList } from "./walk.ts";
import { edgeId, idRow } from "./idchip.ts";
import { countTiles } from "./counts.ts";
import { CATEGORY_NAMES, catIcon } from "./categories.ts";
import { renderStoreOverview } from "./collections.ts";
import { everyNote } from "./everydraw.ts";
import { notesBox } from "./keycard.ts";
import { code, fileRef, folderLink } from "./codelink.ts";
import { $, N, S, board, collectionsOf, edgeKey, edgeLabel, esc, catOf, isOpenable, isStore, nameOf, onStoreBoard, path, plural, st, type PageEdge, type PathRef } from "./state.ts";

export function snippet(f: PathRef, line: number): string {
  const s = code().snips?.[`${f}:${line}`];
  if (!s) return "";
  return `<pre class="snip">${s[1].split("\n").map((l, i) => `<span${s[0] + i === line ? ' class="hit"' : ""}><i>${s[0] + i}</i>${esc(l)}</span>`).join("")}</pre>`;
}

export function connList(id: string): string {
  const es = board().edges;
  const row = (e: PageEdge, other: string) => `<li><button class="item${e.major ? "" : " minor"}" data-sel="e:${esc(edgeKey(e))}"><span>${esc(nameOf(other))}</span><span class="num">${esc(edgeLabel(e) || plural(e.uses, "use"))}</span></button></li>`;
  const out = es.filter((e) => e.a === id), inc = es.filter((e) => e.b === id);
  const list = (xs: PageEdge[], side: "a" | "b") => xs.length ? xs.map((e) => row(e, e[side])).join("") : `<li class="num none">Nothing at this rung</li>`;
  return `<p>${focusButton(id)}</p><h4>Uses</h4><ul class="list">${list(out, "b")}</ul><h4>Used by</h4><ul class="list">${list(inc, "a")}</ul>`;
}

/** Every file path under a box: its own files, or those of its descendant leaves. */
const filesUnder = (id: string): string[] => N()[id].children.length ? N()[id].children.flatMap(filesUnder) : N()[id].files.map(path);

export function renderNode(id: string): void {
  const n = N()[id];
  const list = (xs: PathRef[] | undefined, w: string, f: (x: PathRef) => string) => xs?.length ? `<details class="files"><summary>${plural(xs.length, w)}</summary><div class="ev">${xs.map((x) => `<div>${f(x)}</div>`).join("")}</div></details>` : "";
  const files = list(n.files, "file", (f) => fileRef(f)) + list(n.endpoints, "endpoint", esc);
  const pages = n.pages?.length ? `<h4>Pages</h4><p class="num">${n.pages.map((r) => `<span class="mono" style="white-space:nowrap">${esc(r)}</span>`).join(", ")}</p>` : "";
  $("details").innerHTML = `<h2>Part</h2><div class="panel"><h3>${esc(n.name)}</h3>${idRow(id)}${n.summary ? `<p>${esc(n.summary)}</p>` : ""}<p class="num">${plural(n.count, "file")} · ${n.loc.toLocaleString()} lines</p>${folderLink(filesUnder(id))}${isOpenable(id) ? `<p><button class="open" data-open="${esc(id)}">Open ${esc(n.name)} <span aria-hidden="true">›</span></button></p>` : ""}${pages}${files}${connList(id)}</div>`;
}

export function renderContext(id: string): void {
  const n = N()[id], where = whereLine(N(), st.cur, id);
  $("details").innerHTML = `<h2>${esc(where[0].toUpperCase() + where.slice(1))}</h2><div class="panel"><h3>${esc(n.name)}</h3>${idRow(id)}<p class="where">${esc(whereText(N(), st.cur, id, st.data.repo))}</p>${n.summary ? `<p>${esc(n.summary)}</p>` : ""}<p><button class="open" data-goto="${esc(id)}">Go to ${esc(n.name)} <span aria-hidden="true">›</span></button></p>${connList(id)}</div>`;
}

export function renderService(id: string): void {
  if (isStore(id)) return renderStore(id);
  const c = catOf(id), what = c && c !== "other" ? ` · ${CATEGORY_NAMES[c]}` : "", does = st.data.does?.[id];
  $("details").innerHTML = `<h2>External service${esc(what)}</h2><div class="panel"><h3>${catIcon(c)}${esc(S()[id])}</h3>${does && does.toLowerCase() !== (c && CATEGORY_NAMES[c].toLowerCase()) ? `<p class="does">${esc(does[0].toUpperCase() + does.slice(1))}</p>` : ""}${idRow(id)}<p>Detected from SDK imports in the code.</p>${connList(id)}</div>`;
}

function renderStore(id: string): void {
  const names = (ids: string[]) => ids.map((x) => esc(nameOf(x))).join(", ");
  const rows = collectionsOf(id).map((c) => `<li class="coll"><div class="cname">${esc(c.name)}</div>${c.reads.length ? `<div class="who">read by ${names(c.reads)}</div>` : ""}${c.writes.length ? `<div class="who">written by ${names(c.writes)}</div>` : ""}<details><summary>evidence</summary>${c.ev.map(([f, l, op]) => `<div class="ev">${fileRef(f, l)}<span> ${esc(op)}</span></div>`).join("")}</details></li>`).join("");
  $("details").innerHTML = `<h2>Data store</h2><div class="panel"><h3>${catIcon(catOf(id), true)}${esc(S()[id])}</h3>${idRow(id)}<p>Collections (or tables) the parts on this board read and write, found in the code.</p>${isOpenable(id) ? `<p><button class="open" data-open="${esc(id)}">Open ${esc(S()[id])} <span aria-hidden="true">›</span></button></p>` : ""}<h4>Collections</h4><ul class="list colls">${rows || `<li class="num none">None at this rung</li>`}</ul>${connList(id)}</div>`;
}

export function renderEdge(a: string, b: string): void {
  const e = board().edges.find((x) => x.a === a && x.b === b);
  if (!e) return renderOverview();
  const total = e.imports + e.calls + e.uses;
  $("details").innerHTML = `<h2>Connection</h2><div class="panel"><h3>${esc(nameOf(a))} → ${esc(nameOf(b))}</h3>${idRow(edgeId(a, b))}${onStoreBoard() && !board().nodes.includes(a) && N()[a] ? `<p><button class="open" data-part="${esc(a)}">Go to ${esc(nameOf(a))} <span aria-hidden="true">›</span></button></p>` : ""}${countTiles(e)}${e.calls && !e.imports ? `<p>Reached at runtime (function name or URL), not by import.</p>` : ""}<h4>Evidence${total > e.ev.length ? ` (first ${e.ev.length} of ${total})` : ""}</h4>${e.ev.map(([f, l, t]) => `<div class="ev">${fileRef(f, l)}<br><span>→ ${typeof t === "number" ? fileRef(t) : esc(t)}</span>${snippet(f, l)}</div>`).join("")}</div>`;
}

export function renderOverview(): void {
  if (st.data.stores?.[st.cur]) return renderStoreOverview();
  const n = N()[st.cur], b = board();
  const all = b.edges.filter((e) => !e.uses), shown = all.filter((e) => e.major).length;
  const hidden = all.length > shown ? `<p class="foot">Showing the ${shown} strongest of ${all.length} connections. Select a box to see all of its connections.</p>` : "";
  const kids = !n.children.length ? fileItems() : n.children.map((id) => `<li><button class="item" data-sel="n:${esc(id)}"><span><i class="sw k-${N()[id].kind ?? "part"}"></i>${esc(N()[id].name)}</span><span class="num">${N()[id].count}</span></button></li>`).join("");
  const hubs = b.hubs.length ? `<p class="foot">Shared by most ${n.children.length ? "parts" : "files"} (arrows into it not drawn): ${b.hubs.map((x) => esc(nameOf(x))).join(", ")}.</p>` : "";
  const throughout = b.throughout.length ? `<p class="foot">Used throughout: ${b.throughout.map((x) => isStore(x) ? `<button class="open" data-sel="n:${esc(x)}">${esc(nameOf(x))}</button>` : esc(nameOf(x))).join(", ")}.</p>` : "";
  $("details").innerHTML = box(st.cur === "root" ? "Overview" : "Inside", `${idRow(st.cur)}<ul class="list">${kids}</ul>`, { open: true }) + `${tourList()}${legend()}${notesBox(hubs, throughout, hidden, everyNote())}`;
}
