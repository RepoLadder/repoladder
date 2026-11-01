// Where a diagram.html's bytes go, for the gallery stats and the page budget (scripts/gallery.ts).
import { deflateRawSync } from "node:zlib";
import { pageData, pageParts, pageViewer } from "./filepack.ts";
import { encodeWire } from "../viewer/wire.ts";

/**
 * The page budget from CLAUDE.md: the viewer is a fixed cost (about 65KB packed, with its boot
 * script; 70KB with the dial control, #145; 74KB once the dial lists the repo's stops with viewer/budget.ts, #172) and the packed data grows with the boards (0.4 to 1KB each across the gallery), so the
 * budget does too. The detail dial's in-page stops (roll-up and layout, viewer/stoplayout.ts) are
 * about 13KB of that: the spike priced them at ~14KB a page. Dial v2
 * adds the box-budget cut and container layout for any board (#171): 75KB, with room for CI's deflate (about 0.5KB bigger than macOS'). 76KB with the dial's
 * names as an overlay (#185): main sat within bytes of 75KB on CI.
 * Packing containers to fit the window (viewer/everyfit.ts, skyline.ts, #183): 77KB. Deep links to a
 * tour step, the tour as Back/Forward steps and the strip's copy-link button (viewer/tourlink.ts, #199): 79KB.
 * The up / across / down move between boards (viewer/travel.ts, #194): 81KB, as CI packs it 0.3KB bigger than macOS.
 * Story names on two lines (viewer/namewrap.ts, #236) and the held lane side (#246): 82KB; the dial labels (#265) and file names (#251): 83KB.
 * #211 trimmed about 1.3KB of duplicated helpers and build-only code out of the page (80.5KB locally, about
 * 80.9KB on CI): 82KB, with about 1KB of headroom for CI's bigger deflate.
 * The tour gutter routing (#281), phone dial fixes (#287) and story opening (#288) left main within bytes
 * of 82KB on CI with about 0.8KB still to land: 85KB, about 2KB of cushion after them.
 * #325 drops the dial's middle-stop hint (`opensHint`), a little under the 85KB.
 * #365's shared escaper (`'` and backtick) left main within bytes of 85KB on CI: 86KB.
 * 2026-10: the viewer's Export button (viewer/exportsvg.ts, exportui.ts, #355): 88.5KB on top of that, so 90KB (CI packs about 0.5KB bigger).
 * #498 fullscreen and Reframe buttons: about 1KB, on top of the wire separation.
 * 2026-10: wire separation on the Everything stops (outline.ts separateWires, #497): about 0.9KB packed (CI packs about 0.5KB bigger).
 * Both together: 93KB.
 * 2026-10: the hosted fidelity profile's arrow budgeting shared with the viewer's file boards (rollrules.ts, #449): 94KB, the page was 72 bytes over 93KB.
 * 2026-10: the +, - and F zoom keys and the upward export popover (zoomkeys.ts, anchor.ts): 95KB, the page was a few bytes over 94KB.
 * 2026-10: the full-window canvas's open region (#78) merged with the phone's edge cue (#76): 95KB, the page was 110 bytes over 94KB.
 * 2026-10: the floating zoom control at the bottom right (zoomcontrol, +, - and F): 96KB, CI packed the page 242 bytes over the 95KB cap.
 */
export const VIEWER_KB = 96;
/**
 * The embedded Geist and Geist Mono subsets with their licence (#337): a packed blob of about 58KB, a separate
 * line outside the VIEWER_KB ratchet (the fonts change when the font files do, not with viewer code).
 */
export const FONT_KB = 60;
export const BOARD_KB = 1;
export const budgetKb = (boards: number) => VIEWER_KB + FONT_KB + BOARD_KB * boards;

export interface PageSize {
  total: number;
  /** The viewer's JS and CSS as they sit in the page: the boot script counts as JS, and the packed viewer is split in proportion to each part's deflated size. */
  js: number;
  css: number;
  /** The packed page data as it sits in the page. */
  data: number;
  /** The packed fonts (the boot call's third argument; 0 in a page without them). */
  fonts: number;
  /** The page data as plain JSON before packing. */
  rawData: number;
  /** `data` split by section, in proportion to each section's deflated size (bytes, sums to `data`). */
  sections: Record<string, number>;
}

const SECTIONS = ["edges", "evidence", "layout", "flows", "collections", "paths", "nodes", "files", "snips", "fgraph", "simple", "other"] as const;

export function pageSize(html: string): PageSize {
  const bytes = (s: string) => Buffer.byteLength(s);
  const boot = html.match(/<script>\n([\s\S]*?)\nrepoladderBoot\(/)?.[1] ?? "";
  const { viewer, data: packed, fonts } = pageParts(html);
  const v = pageViewer(html);
  const zJs = deflateRawSync(Buffer.from(v.js), { level: 9 }).length, zCss = deflateRawSync(Buffer.from(v.css), { level: 9 }).length;
  const css = Math.round((zCss / (zJs + zCss)) * bytes(viewer)), js = bytes(boot) + bytes(viewer) - css;
  const data = pageData(html);
  const wire = encodeWire(data);
  const parts: Record<(typeof SECTIONS)[number], unknown[]> = { edges: [], evidence: [wire.ev], layout: [wire.layout], flows: [wire.flows ?? {}], collections: [], paths: [wire.paths], nodes: [wire.nodes], files: [wire.files ?? {}], snips: [data.snips ?? {}], fgraph: [wire.fg ?? []], simple: [wire.simple ?? {}], other: [] };
  for (const b of Object.values(wire.boards)) {
    const { edges, collections, ...rest } = b;
    parts.edges.push(edges.filter((_, i) => i !== 6));
    parts.evidence.push(edges[6]);
    parts.collections.push(collections ?? {});
    parts.other.push(rest);
  }
  const { boards: _b, layout: _l, paths: _p, nodes: _n, files: _f, snips: _s, ev: _e, flows: _fl, fg: _fg, simple: _si, ...rest } = wire as typeof wire & { snips?: unknown };
  parts.other.push(rest);
  const z = Object.fromEntries(SECTIONS.map((k) => [k, deflateRawSync(Buffer.from(JSON.stringify(parts[k])), { level: 9 }).length]));
  // a page without splits has no Simple section, rather than a few bytes of empty JSON
  if (!wire.simple) z.simple = 0;
  const sum = Object.values(z).reduce((a, b) => a + b, 0);
  const sections = Object.fromEntries(SECTIONS.map((k) => [k, Math.round((z[k] / sum) * bytes(packed))]));
  return { total: bytes(html), js, css, data: bytes(packed), fonts: fonts === undefined ? 0 : bytes(fonts), rawData: bytes(JSON.stringify(data)), sections };
}

export const overBudget = (kb: number, boards: number) => kb > budgetKb(boards);

const kb = (n: number) => `${(n / 1024).toFixed(1)}KB`;
/** One line: "122.0KB = viewer 72.5KB (js 52.9KB, css 19.6KB) + data 50.6KB (248.0KB as JSON: edges …) + fonts 58.1KB". */
export function describeSize(s: PageSize): string {
  const secs = Object.entries(s.sections).filter(([, v]) => v).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${kb(v)}`).join(", ");
  return `${kb(s.total)} = viewer ${kb(s.js + s.css)} (js ${kb(s.js)}, css ${kb(s.css)}) + data ${kb(s.data)} (${kb(s.rawData)} as JSON: ${secs}) + fonts ${kb(s.fonts)}`;
}
