// Leaf (file) boards multiply a page's data (hundreds of file boxes and wires), and JSON this
// repetitive deflates about 5:1. So the page data is reshaped for compression (viewer/wire.ts),
// deflated, and written in basE91 (viewer/base91.ts); the viewer inflates it with the browser's
// DecompressionStream (viewer/unpack.ts). The viewer's own CSS and JS travel the same way and
// are unpacked by the page's one inline script (viewer/boot.ts).
// Same input and same zlib build give the same bytes; output can differ across Node/zlib builds (see scripts/verifydist.ts).
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { decode91, encode91 } from "../viewer/base91.ts";
import type { ViewerData } from "../viewer/state.ts";
import { decodeWire, encodeWire } from "../viewer/wire.ts";
import type { ViewerAssets } from "./viewer.ts";

const pack = (text: string): string => encode91(deflateRawSync(Buffer.from(text), { level: 9 }));
const unpackText = (s: string): string => inflateRawSync(decode91(s)).toString();

export const packData = (data: ViewerData): string => pack(JSON.stringify(encodeWire(data)));

// Every page a process writes carries the same viewer, so it is packed once.
const viewers = new WeakMap<ViewerAssets, string>();
/** The viewer's CSS and JS, NUL-separated, packed like the data. */
export function packViewer(assets: ViewerAssets): string {
  let v = viewers.get(assets);
  if (v === undefined) viewers.set(assets, (v = pack(`${assets.css}\0${assets.js}`)));
  return v;
}

/**
 * The fonts as one blob: a 4-byte big-endian length each for the sans and mono woff2, the two files, then the
 * licence as UTF-8. The woff2 bytes don't deflate but the licence does (about 2KB instead of 4.4KB).
 */
export function packFonts(sans: Uint8Array, mono: Uint8Array, license: string): string {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(sans.length, 0);
  head.writeUInt32BE(mono.length, 4);
  return encode91(deflateRawSync(Buffer.concat([head, sans, mono, Buffer.from(license)]), { level: 9 }));
}

/** The fonts inside a rendered diagram.html, or null for a page from before they were embedded. */
export function pageFonts(html: string): { sans: Uint8Array; mono: Uint8Array; license: string } | null {
  const packed = pageParts(html).fonts;
  if (packed === undefined) return null;
  const b = inflateRawSync(decode91(packed));
  const a = b.readUInt32BE(0), m = b.readUInt32BE(4);
  return { sans: b.subarray(8, 8 + a), mono: b.subarray(8 + a, 8 + a + m), license: b.subarray(8 + a + m).toString() };
}

/** The packed strings of the boot call in a rendered diagram.html (`fonts` is absent in older pages). */
export function pageParts(html: string): { viewer: string; data: string; fonts?: string } {
  const m = html.match(/repoladderBoot\(("[^"]*"),("[^"]*")(?:,("[^"]*"))?\);/);
  if (!m) throw new Error("not a packed diagram.html: no repoladderBoot(...) call");
  return { viewer: JSON.parse(m[1]), data: JSON.parse(m[2]), ...(m[3] !== undefined ? { fonts: JSON.parse(m[3]) } : {}) };
}

/** The viewer's CSS and JS inside a rendered diagram.html. */
export function pageViewer(html: string): { css: string; js: string } {
  const text = unpackText(pageParts(html).viewer);
  const cut = text.indexOf("\0");
  return { css: text.slice(0, cut), js: text.slice(cut + 1) };
}

/** The page data inside a rendered diagram.html (for tests and tooling). */
export function pageData(html: string): any {
  return decodeWire(JSON.parse(unpackText(pageParts(html).data)));
}
