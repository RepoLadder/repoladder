// Box silhouettes, shared by the viewer (draw.ts) and the SVG export (build/export.ts).
// Each kind has its own shape cue on top of its color, so kinds read without labels:
// web = browser window (top bar, three dots), backend = server (side rail, status lights),
// library = folder tab, scripts = square terminal with a prompt, shared hub = double border,
// elsewhere = dashed outline, external service = cylinder with its category glyph (icons.ts) above the name. See DESIGN.md.

import { NAME_LINE } from "./namewrap.ts";
import { esc } from "./state.ts";

export type Kind = "web" | "backend" | "library" | "scripts";

export interface Box {
  x: number; y: number; w: number; h: number;
  name: string;
  /** The name on two lines (namewrap.ts, the story level); one line, `name`, when absent. */
  lines?: string[];
  /** Lines under the name: a file count, "service", or a store's collections. */
  subs: string[];
  kind?: Kind;
  svc?: boolean;
  /** A data store (a cylinder in the data hue). */
  store?: boolean;
  /** A service's category glyph: a path on a 16×16 grid (icons.ts), drawn above the name. */
  icon?: string;
  ctx?: boolean;
  hub?: boolean;
  openable?: boolean;
}

/** Corner radius per kind (build/lint.ts traces the same outlines). */
export const R: Record<Kind | "part", number> = { web: 8, backend: 4, library: 8, scripts: 2, part: 8 };
/** Offsets of the two cards drawn behind an openable box. */
export const STACK = [8, 4];
/** Depth of a cylinder's lid ellipse. */
export const lidRy = (h: number) => Math.min(9, h * 0.14);

const rect = (cls: string, x: number, y: number, w: number, h: number, r: number) =>
  `<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/>`;

/** Space-separated classes for the node's <g>: "node", plus its kind or role. */
export function boxClass(b: Box): string {
  if (b.svc) return `node svc${b.store ? " store" : ""}`;
  return `node k-${b.kind ?? "part"}${b.ctx ? " ctx" : b.hub ? " hub" : ""}`;
}

function cylinder(x: number, y: number, w: number, h: number): string {
  const ry = lidRy(h), a = `${w / 2} ${ry} 0 0 1`;
  return `<path class="body" d="M${x} ${y + ry}a${a} ${w} 0v${h - 2 * ry}a${a} ${-w} 0z"/><path class="lid" d="M${x} ${y + ry}a${a} ${w} 0a${a} ${-w} 0z"/>`;
}


/** Extra height a service cylinder gets for its category glyph (build/layout.ts sizes it, boxBody draws it). */
export const ICON_ROOM = 24;

/** Shape and labels of one box, without the interactive wrapper. */
export function boxBody(b: Box): string {
  const { x, y, w, h } = b;
  let cx = x + w / 2, ty = y + h / 2;
  let out = "";
  if (b.svc) {
    // a store that opens into its collections gets the same stacked cue as a part
    if (b.openable) out = (cylinder(x + 8, y + 8, w, h) + cylinder(x + 4, y + 4, w, h)).replace(/class="(body|lid)"/g, `class="stack"`);
    out += cylinder(x, y, w, h);
    ty += 4;
  } else if (b.ctx) {
    out = rect("body", x, y, w, h, 8);
  } else {
    const k = b.kind ?? "part", r = R[k];
    // two cards behind: "there is more inside" has to read at a glance, even zoomed out
    if (b.openable) out += STACK.map((d) => rect("stack", x + d, y + d, w, h, r)).join("");
    if (k === "library") out += `<path class="band" d="M${x + 10} ${y + 2}L${x + 14} ${y - 5}H${x + 42}L${x + 46} ${y + 2}z"/>`;
    out += rect("body", x, y, w, h, r);
    if (k === "web") {
      out += `<path class="band" d="M${x} ${y + 10}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + 10}z"/>`;
      for (const dx of [9, 15, 21]) out += `<circle class="dot" cx="${x + dx}" cy="${y + 5}" r="1.6"/>`;
      ty += 4;
    } else if (k === "backend") {
      out += `<path class="band" d="M${x + 10} ${y}H${x + r}Q${x} ${y} ${x} ${y + r}V${y + h - r}Q${x} ${y + h} ${x + r} ${y + h}H${x + 10}z"/>`;
      for (const dy of [-7, 0, 7]) out += `<circle class="dot" cx="${x + 5}" cy="${y + h / 2 + dy}" r="1.6"/>`;
      cx += 5;
    } else if (k === "scripts") {
      out += `<text class="glyph" x="${x + 7}" y="${y + 14}">&gt;_</text>`;
    }
    if (b.hub) out += rect("inset", x + 3.5, y + 3.5, w - 7, h - 7, Math.max(1, r - 2));
  }
  const lines = b.lines ?? [b.name], more = (lines.length - 1) * NAME_LINE;
  ty -= (b.subs.length - 1) * 7.5 + more / 2; // must match how build/layout.ts sized the box
  // a 20px glyph above the name; build/layout.ts made the cylinder ICON_ROOM taller for it, so the text moves down by half
  if (b.svc && b.icon) {
    ty += ICON_ROOM / 2;
    out += `<path class="ico" transform="translate(${cx - 10} ${ty - 42}) scale(1.25)" d="${b.icon}"/>`;
  }
  const subs = b.subs.map((t, i) => `<text class="sub" x="${cx}" y="${ty + more + 14 + i * 15}" text-anchor="middle">${esc(t)}</text>`).join("");
  const name = lines.map((t, i) => `<text class="name" x="${cx}" y="${ty - 3 + i * NAME_LINE}" text-anchor="middle">${esc(t)}</text>`).join("");
  return `${out}${name}${subs}`;
}
