// Deep links. Artifact hosts pass only a bare #token (letters, digits and `. _ ~ -`), so the whole
// view state is one token:
//   <node>            the box on the board it belongs to, selected
//   <a>.<b>           the connection a→b on the board it belongs to, selected
//   <board>~          that board, nothing selected ("" is the overview)
//   <board>~<sel>     that board with <node> or <a>.<b> selected, for things that live on several
//                     boards (services, "elsewhere" boxes) or are selected away from their home board
//   tour.<id>.<n>     step n (from 1) of a tour, while it plays (tourlink.ts)
import { dropToken, stripEmbed } from "./embed.ts";
import { STORY, st, type ViewerData } from "./state.ts";

export interface Target { board: string; hit: string | null }

const known = (d: ViewerData, id: string) => !!(d.nodes[id] || d.services[id] || d.story?.actors[id] || d.files?.[id] || id === "+more");
/** The overview: the story level when there is one. Level-1 parts live there too. */
const homeId = (d: ViewerData) => (d.story ? STORY : "root");
const board0 = (d: ViewerData, b: string | null | undefined) => (b === "root" ? homeId(d) : b);
// File boxes ("@12", "+more"; see viewer/files.ts) travel as "_12" and "_more": "@" and "+" don't
// survive the host, and slugs never start with "_".
const enc = (id: string) => (id[0] === "@" ? `_${id.slice(1)}` : id === "+more" ? "_more" : id);
const dec = (t: string) => (t === "_more" ? "+more" : t[0] === "_" ? `@${t.slice(1)}` : t);
const drawn = (d: ViewerData, b: string, id: string) => d.layout[b].n.some((n) => n[0] === id);
const hasEdge = (d: ViewerData, b: string, x: string, y: string) => !!d.boards[b]?.edges.some((e) => e.a === x && e.b === y);

/** `n:<id>` or `e:<a>><b>` for a token, or null when it names nothing in this diagram. */
function hitOf(d: ViewerData, token: string): string | null {
  if (known(d, dec(token))) return `n:${dec(token)}`;
  // Ids are slugs today, but try every split so an id holding a dot still round-trips.
  for (let i = token.indexOf("."); i > 0; i = token.indexOf(".", i + 1)) {
    const a = dec(token.slice(0, i)), b = dec(token.slice(i + 1));
    if (known(d, a) && known(d, b)) return `e:${a}>${b}`;
  }
  return null;
}

/** The board a selection opens on when the link does not name one. */
export function homeOf(d: ViewerData, hit: string): string | null {
  const boards = Object.keys(d.layout);
  if (hit.startsWith("e:")) {
    const [a, b] = hit.slice(2).split(">");
    const pref = [board0(d, d.nodes[a]?.parent), board0(d, d.nodes[b]?.parent)].filter((x): x is string => !!x && !!d.layout[x]);
    return [...pref, ...boards].find((x) => hasEdge(d, x, a, b)) ?? null;
  }
  const id = hit.slice(2), p = board0(d, d.nodes[id]?.parent);
  if (p && d.layout[p]) return p;
  return boards.find((x) => drawn(d, x, id)) ?? null;
}

const tokenOf = (hit: string) => (hit.startsWith("e:") ? hit.slice(2).split(">").map(enc).join(".") : enc(hit.slice(2)));

export function hashFor(d: ViewerData, board: string, hit: string | null): string {
  if (!hit) return board === homeId(d) ? "" : `${board}~`;
  const t = tokenOf(hit);
  return homeOf(d, hit) === board ? t : `${board}~${t}`;
}

export function parseHash(d: ViewerData, raw: string): Target | null {
  let s = raw.replace(/^#/, "");
  try { s = decodeURIComponent(s); } catch { /* keep it raw */ }
  if (!s) return null;
  const tilde = s.indexOf("~");
  if (tilde >= 0) {
    const board = s.slice(0, tilde), hit = hitOf(d, s.slice(tilde + 1));
    if (!d.layout[board]) return null;
    const ok = hit && (hit.startsWith("n:") || hasEdge(d, board, ...(hit.slice(2).split(">") as [string, string])));
    return { board, hit: ok ? hit : null };
  }
  const hit = hitOf(d, s), home = hit && homeOf(d, hit);
  if (hit && home) return { board: home, hit };
  return d.layout[s] ? { board: s, hit: null } : null;
}

// Tour ids are slugs; anything else (a derived tour's id, say) travels as `~xx` hex.
const encId = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, (c) => `~${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
const decId = (t: string) => t.replace(/~([0-9a-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));

/** The token for step `i` (from 0) of tour `id`. */
export const tourToken = (id: string, i: number) => `tour.${encId(id)}.${i + 1}`;

/** `{ id, step }` (step from 0) for a tour token, or null when the hash isn't one. */
export function parseTourToken(raw: string): { id: string; step: number } | null {
  let s = raw.replace(/^#/, "");
  try { s = decodeURIComponent(s); } catch { /* keep it raw */ }
  const m = /^tour\.([A-Za-z0-9_~-]+)\.(\d+)$/.exec(s);
  return m ? { id: decId(m[1]), step: Math.max(0, Number(m[2]) - 1) } : null;
}

// A playing tour names the view by its step instead (tourlink.ts), and opens its own links.
let tourHash: (() => string | null) | null = null;
let tourOpen: ((hash: string) => boolean) | null = null;
export function tourLinks(current: () => string | null, open: (hash: string) => boolean): void {
  tourHash = current;
  tourOpen = open;
}
const viewHash = () => tourHash?.() ?? hashFor(st.data, st.cur, st.selected);

/** Mirror the view into the hash without adding history entries. Sandboxed frames may refuse it. */
export function writeHash(): void {
  if (typeof history === "undefined") return;
  const h = viewHash();
  if (location.hash.replace(/^#/, "") === h) return;
  try { history.replaceState(history.state, "", `${location.pathname}${location.search}${h ? `#${h}` : ""}`); } catch { /* not allowed here */ }
}

/** Open whatever the current hash names; on start, an unknown hash falls back to the overview. */
export function openHash(show: (id: string, back?: undefined, hit?: string | null) => void, first = false): void {
  if (tourOpen?.(location.hash)) return;
  const t = parseHash(st.data, location.hash);
  if (!t) return void (first && show(homeId(st.data)));
  show(t.board, undefined, t.hit);
}

/** A shareable URL for the current view. Inside an artifact frame the top page is the one to share. */
export function shareLink(): string {
  const clean = (u: string) => dropToken(stripEmbed(u));
  let base = clean(location.href);
  try {
    if (window.top && window.top !== window) base = clean(window.top.location.href);
  } catch {
    // Cross-origin parent: the referrer is the artifact page unless it was cut to a bare origin.
    try { if (document.referrer && new URL(document.referrer).pathname.length > 1) base = clean(document.referrer); } catch { /* keep ours */ }
  }
  const h = viewHash();
  return base.split("#")[0] + (h ? `#${h}` : "");
}

/** Clipboard fallback: show the link under the id row so it can be selected and copied by hand. */
export function linkBox(row: Element, url: string): Element {
  let box = row.nextElementSibling;
  if (!box?.classList.contains("linkbox")) {
    box = document.createElement("code");
    box.className = "linkbox";
    row.after(box);
  }
  box.textContent = url;
  return box;
}

/**
 * Copies `text`. The clipboard can be blocked inside a sandboxed frame: then `box()` (the id, or the
 * link shown under the buttons) is selected for Cmd/Ctrl+C. `said` gets "Copied" or "Selected".
 */
export function copyText(text: string, box: () => Element | null, said: (label: string) => void): void {
  const fallback = () => {
    const b = box(), sel = getSelection();
    if (sel && b) { sel.selectAllChildren(b); said("Selected"); }
  };
  try {
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => said("Copied"), fallback);
    else fallback();
  } catch { fallback(); }
}
