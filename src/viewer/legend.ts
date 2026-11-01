// The key under the overview panel: only the box kinds and wire types on the current board,
// each drawn with the same shapes as the diagram (shapes.ts). Items for things a reader may want
// out of the way (services, stores, elsewhere boxes, each wire type) are filter toggles (filterui.ts).
import { flt, type Cat } from "./filter.ts";
import { revealCounts } from "./filterui.ts";
import { boxBody, boxClass, type Box, type Kind } from "./shapes.ts";
import { N, S, board, edgeClass, isOpenable, isStore, onStoreBoard, st } from "./state.ts";
import { CATEGORY_NAMES, categoriesOf } from "./categories.ts";
import { weightClass } from "./weight.ts";
import { keyCard } from "./keycard.ts";

const KIND_NAMES: [Kind, string][] = [["web", "Web app"], ["backend", "Server"], ["library", "Library"], ["scripts", "Scripts"]];

const icon = (b: Omit<Box, "x" | "y" | "w" | "h" | "name" | "subs">) => {
  const box: Box = { x: 3, y: 4, w: 52, h: 34, name: "", subs: [], ...b };
  return `<svg class="lgi" viewBox="0 0 64 46" aria-hidden="true"><g class="${boxClass(box)}">${boxBody(box).replace(/<text class="name"[^>]*><\/text>/, "")}</g></svg>`;
};
// the glyph alone, at twice its board size so it reads at legend scale
const glyphIcon = (d: string) => `<svg class="lgi" viewBox="0 0 64 46" aria-hidden="true"><g class="node svc"><path class="ico" transform="translate(16 7) scale(2)" d="${d}"/></g></svg>`;
const wire = (cls: string) => `<svg class="lgi" viewBox="0 0 64 46" aria-hidden="true"><g class="wire ${cls}"><path class="line" d="M6 23H58"/></g></svg>`;

/** A legend item that shows or hides a category; pressed means shown. */
const toggle = (cat: Cat, body: string, title: string) => `<button class="lgt" data-filter="${cat}" aria-pressed="${flt.on[cat]}" title="${title}">${body}</button>`;
// Strength: a thin and a thick line. Boxes on a board share one size, so size needs no key.
const weights = `<svg class="lgi lgw" viewBox="0 0 64 46" aria-hidden="true"><g class="wire"><path class="line" d="M6 14H58"/><path class="line thick" d="M6 32H58"/></g></svg>`;

/** The key's rows in order; `toggle` rows are the filter buttons (the Filters popover shows only those). */
export function legendItems(): { html: string; toggle: boolean }[] {
  const b = board(), parts = b.nodes.filter((id) => N()[id] && !b.context.includes(id));
  const kinds = new Set(parts.map((id) => N()[id].kind));
  const items: { html: string; toggle: boolean }[] = [];
  const plain = (html: string) => items.push({ html, toggle: false });
  const tog = (cat: Cat, body: string, title: string) => items.push({ html: toggle(cat, body, title), toggle: true });
  for (const [k, label] of KIND_NAMES) if (kinds.has(k)) plain(`${icon({ kind: k })}${label}`);
  if (b.hubs.length) plain(`${icon({ kind: N()[b.hubs[0]]?.kind, hub: true })}Used by most ${N()[b.hubs[0]] ? "parts" : "files"}`);
  if (b.context.length) tog("ctx", `${icon({ kind: N()[b.context[0]]?.kind, ctx: true })}Other parts this one talks to`, "Show or hide the dashed boxes: parts outside this one that it connects with");
  if (b.nodes.some((id) => S()[id] && !isStore(id))) tog("svc", `${icon({ svc: true })}External service`, "Show or hide external services");
  for (const c of categoriesOf(b.nodes.filter((id) => S()[id] && !isStore(id)))) plain(`${glyphIcon(st.data.icons![c]!)}${CATEGORY_NAMES[c]}`);
  if (b.nodes.some(isStore)) tog("stores", `${icon({ svc: true, store: true })}Data store`, "Show or hide data stores and their reads and writes");
  if (parts.some(isOpenable)) plain(`${icon({ kind: N()[parts.find(isOpenable)!].kind, openable: true })}Has more inside`);
  const edges = b.edges.filter((e) => e.major);
  const wires: [Cat, string, string, boolean][] = [
    ["imports", "", "Imports", edges.some((e) => e.imports && !e.reads && !e.writes && !e.uses)],
    ["calls", "call", "Runtime calls", edges.some((e) => e.calls)],
    ["svc", "svc", "Service SDK", edges.some((e) => edgeClass(e) === "svc")],
    ["stores", "data", "Reads / writes", edges.some((e) => edgeClass(e) === "data")],
  ];
  for (const [cat, cls, label, has] of wires) if (has) tog(cat, `${wire(cls)}${label}`, `Show or hide ${label.toLowerCase()}`);
  const more = revealCounts();
  if (more.hubs) tog("hubs", `${wire("xw xhub")}Arrows into shared parts (${more.hubs})`, "Draw the arrows into parts used by most others");
  if (more.minor) {
    if (onStoreBoard()) tog("minor", `${wire("xw data")}Every read and write (${more.minor})`, "Draw every read and write, not just the selection's");
    else tog("minor", `${wire("xw")}Weaker connections (${more.minor})`, "Draw the connections left out to keep the board readable");
  }
  if (new Set(edges.map(weightClass).filter(Boolean)).size > 1) plain(`${weights}Thicker: more imports and calls`);
  return items;
}

export const toggleRows = (): string => legendItems().filter((i) => i.toggle).map((i) => `<li>${i.html}</li>`).join("");

export function legend(extraRows = ""): string {
  return keyCard(extraRows + legendItems().map((i) => `<li>${i.html}</li>`).join(""));
}
