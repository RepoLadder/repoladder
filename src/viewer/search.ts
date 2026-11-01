// Search (`/` or Cmd/Ctrl+K): fuzzy match over parts, files, endpoints, pages, services and collections,
// then jump to the board where the match is drawn and select it.
import { ICONS } from "./baricons.ts";
import { chrome } from "./embed.ts";
import { goTo, show } from "./navigate.ts";
import { $, esc, st, type ViewerData } from "./state.ts";

/** [kind, label, where, node to select, board to show (default: the node's parent board)]. */
export type Hit = [kind: string, label: string, where: string, node: string, board?: string];

const isStart = (t: string, i: number) => !i || /\W|_/.test(t[i - 1]);

/** Case-insensitive subsequence match; higher is better, -1 is no match. A substring beats any scattered match. */
export function score(q: string, s: string): number {
  const t = s.toLowerCase();
  let at = t.indexOf(q), best = -1;
  if (at >= 0) return (t === q ? 2e3 : 999) - at + (isStart(t, at) ? 50 : 0) - s.length / 99;
  // try each place the first letter occurs; letters strewn across a long path are noise, not a match
  for (let first = t.indexOf(q[0]); first >= 0; first = t.indexOf(q[0], first + 1)) {
    let sc = 0, prev = first - 1;
    for (const c of q) {
      at = t.indexOf(c, prev + 1);
      if (at < 0 || at - first > q.length * 2 + 2) { sc = -1; break; }
      sc += (at === prev + 1 ? 3 : 1) + (isStart(t, at) || s[at] !== t[at] ? 2 : 0);
      prev = at;
    }
    if (sc > best) best = sc - s.length / 99;
  }
  return best;
}

export function buildIndex(d: ViewerData): Hit[] {
  const hits: Hit[] = [], N = d.nodes, B = d.boards;
  const trail = (id: string | null) => { const p: string[] = []; for (; id && id !== "root"; id = N[id].parent) p.unshift(N[id].name); return p.join(" › ") || "Overview"; };
  for (const n of Object.values(N)) {
    if (n.id === "root") continue;
    hits.push(["part", n.name, trail(n.parent), n.id]);
    const at = trail(n.id), add = (k: string) => (x: unknown) => hits.push([k, typeof x === "number" ? d.paths[x] : String(x), at, n.id]);
    n.files.forEach(add("file"));
    n.endpoints?.forEach(add("endpoint"));
    n.pages?.forEach(add("page"));
  }
  for (const [id, name] of Object.entries(d.services)) {
    // boards are listed root first, so this is the shallowest board that draws it
    const ids = Object.keys(B), b = ids.find((k) => B[k].nodes.includes(id)) ?? "root";
    hits.push(["service", name, id.startsWith("store-") ? "data store" : "external service", id, b]);
    // an opened store: collections and fields go to their box on the store's own board
    const fs = d.stores?.[id];
    if (fs && d.layout[id]) {
      for (const [c, list] of Object.entries(fs)) {
        hits.push(["collection", c, name, `c:${c}`, id]);
        for (const [f] of list) hits.push(["field", f, `${name} · ${c}`, `c:${c}`, id]);
      }
      continue;
    }
    const seen = new Set<string>();
    for (const k of ids) for (const [c] of B[k].collections?.[id] ?? []) if (!seen.has(c)) { seen.add(c); hits.push(["collection", c, name, id, k]); }
  }
  return hits;
}

export function find(index: Hit[], q: string): Hit[] {
  q = q.trim().toLowerCase();
  // files also match on their basename, so "billing" ranks billing.ts above billing/x.ts
  const sc = ([k, l]: Hit) => Math.max(score(q, l), k === "file" ? score(q, l.slice(l.lastIndexOf("/") + 1)) * 1.01 : -1);
  return q ? index.map((h) => [sc(h), h] as const).filter(([s]) => s >= 0).sort((a, b) => b[0] - a[0]).slice(0, 40).map(([, h]) => h) : [];
}

function go([kind, label, , node, board]: Hit): void {
  if (board) show(board, undefined, `n:${node}`); else goTo(node);
  if (kind === "part" || kind === "service") return;
  // point at the file, endpoint, page or collection in the side panel
  const el = [...$("details").querySelectorAll<HTMLElement>(".files .ev div,.cname,p.num span")].find((e) => e.textContent === label);
  const box = el?.closest(".coll") ?? el;
  if (!box) return;
  box.classList.add("found");
  el!.closest("details")?.setAttribute("open", "");
  box.scrollIntoView({ block: "center" });
}

export function installSearch(): void {
  let index: Hit[], res: Hit[] = [], act = 0;
  // before the actions (Export is there, in the header or the embedded toolbar)
  const tail = chrome().querySelector("#actions, #zexp");
  const sbtn = `<button class="sbtn" aria-haspopup="dialog" aria-keyshortcuts="/" aria-label="Search files, parts…" title="Search (/)">${ICONS.search}<span class="lbl">Search files, parts…</span><kbd>/</kbd></button>`;
  if (tail) tail.insertAdjacentHTML("beforebegin", sbtn); else chrome().insertAdjacentHTML("beforeend", sbtn);
  document.body.insertAdjacentHTML("beforeend", `<div class="search" role="dialog" aria-label="Search the diagram" hidden><div class="sbox"><input type="search" role="combobox" aria-expanded="true" aria-controls="sres" autocomplete="off" spellcheck="false" placeholder="Files, parts, endpoints, services…"><ul id="sres" role="listbox"></ul></div></div>`);
  const btn = document.querySelector<HTMLElement>(".sbtn")!, dlg = document.querySelector<HTMLElement>(".search")!;
  const input = dlg.querySelector("input")!, list = dlg.querySelector("ul")!;

  const paint = () => {
    list.innerHTML = res.map(([k, l, w], i) => `<li id="sr${i}" role="option" aria-selected="${i === act}" data-i="${i}"><b>${k}</b><i>${esc(l).replace(/\//g, "/<wbr>")}</i><span>${esc(w)}</span></li>`).join("") || (input.value.trim() ? `<li>No matches</li>` : "");
    input.setAttribute("aria-activedescendant", `sr${act}`);
    list.querySelector("[aria-selected=true]")?.scrollIntoView({ block: "nearest" });
  };
  const open = () => { index ??= buildIndex(st.data); dlg.hidden = false; input.select(); input.focus(); };
  const close = () => { dlg.hidden = true; btn.focus(); };
  const pick = (i: number) => { if (res[i]) { close(); go(res[i]); } };

  btn.onclick = open;
  input.oninput = () => { res = find(index, input.value); act = 0; paint(); };
  dlg.onclick = (ev) => {
    const li = (ev.target as Element).closest<HTMLElement>("[data-i]");
    if (li) pick(+li.dataset.i!);
    else if (ev.target === dlg) close();
  };
  input.onkeydown = (ev) => {
    // handled here so the board's own Escape (up a level) doesn't also fire
    ev.stopPropagation();
    const k = ev.key, n = res.length || 1;
    if (k === "Escape") close();
    else if (k === "Enter") pick(act);
    else if (k === "ArrowDown" || k === "ArrowUp") { act = (act + (k === "ArrowUp" ? n - 1 : 1)) % n; paint(); }
    else return;
    ev.preventDefault();
  };
  document.addEventListener("keydown", (ev) => {
    if (document.fullscreenElement) return; // the dialog lives in body, which isn't shown in full screen
    if ((ev.key === "/" && !(ev.target as Element).closest("input,textarea")) || (ev.key === "k" && (ev.metaKey || ev.ctrlKey))) { ev.preventDefault(); open(); }
  });
}
