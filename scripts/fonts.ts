// Geist and Geist Mono for the viewer (#337). Two modes; rerun the first whenever a source file gains a character
// the viewer prints, or the @fontsource-variable packages move.
//
//   node scripts/fonts.ts [--sans <font>] [--mono <font>]
//     Regenerates src/viewer/fonts/geist.woff2 and geist-mono.woff2: the variable (wght) fonts subset to
//     U+0020-007E, U+00A0-00FF and every other character found in src/**/*.ts and *.css. Default sources are the
//     @fontsource-variable latin files; --sans/--mono override them (e.g. with upstream variable TTFs).
//     Prints FONTS_OK, FONTS_AXIS per family and FONTS_MISSING for requested code points the source lacks.
//
//   node scripts/fonts.ts measure --page <diagram.html> [--out <json>]
//     Opens a built page in Chromium and prints text widths (JSON) used to re-derive the text-width constants
//     (storelayout.ts, namewrap.ts, ...): per-character widths of box names, and widths of fixed sample strings
//     over the classes each constant sizes. Run it on a page built before and after a font change.
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import subsetFont from "subset-font";
import { convert } from "fontverter";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };

function sourceChars(): string {
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const f of readdirSync(dir).sort()) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) { if (f !== "fonts") walk(p); continue; }
      if (!/\.(ts|css)$/.test(f)) continue;
      for (const ch of readFileSync(p, "utf8")) if (ch.codePointAt(0)! > 0xff) found.add(ch);
    }
  };
  walk(join(root, "src"));
  let s = "";
  for (let c = 0x20; c <= 0x7e; c++) s += String.fromCodePoint(c);
  for (let c = 0xa0; c <= 0xff; c++) s += String.fromCodePoint(c);
  return s + [...found].sort().join("");
}

/** The tags in an sfnt's table directory. */
function tables(sfnt: Uint8Array): string[] {
  const v = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength);
  const n = v.getUint16(4);
  return Array.from({ length: n }, (_, i) => String.fromCharCode(...sfnt.slice(12 + i * 16, 16 + i * 16)));
}

async function regenerate() {
  const out = join(root, "src/viewer/fonts");
  mkdirSync(out, { recursive: true });
  const text = sourceChars();
  const jobs = [
    ["Geist", "geist.woff2", arg("--sans") ?? join(root, "node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2")],
    ["Geist Mono", "geist-mono.woff2", arg("--mono") ?? join(root, "node_modules/@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2")],
  ] as const;
  const sizes: number[] = [];
  for (const [family, file, src] of jobs) {
    let buf: Buffer;
    try { buf = readFileSync(src); } catch { console.error(`FONTS_FAILED ${family}: cannot read ${src}`); process.exit(1); }
    const sub = await subsetFont(buf, text, { targetFormat: "woff2" });
    const sfnt = new Uint8Array(await convert(sub, "sfnt"));
    if (!tables(sfnt).includes("fvar")) { console.error(`FONTS_FAILED ${family} lost its wght axis`); process.exit(1); }
    console.log(`FONTS_AXIS ${family} wght`);
    // which requested code points the source has: the subset's cmap is what survived
    const have = new Set(await cmapOf(sfnt));
    const missing = [...text].filter((ch) => !have.has(ch.codePointAt(0)!)).map((ch) => "U+" + ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0"));
    if (missing.length) console.log(`FONTS_MISSING ${family} ${missing.join(" ")}`);
    writeFileSync(join(out, file), sub);
    sizes.push(sub.length);
  }
  console.log(`FONTS_OK sans ${sizes[0]} mono ${sizes[1]} chars ${[...text].length}`);
}

/** Code points in the best Unicode cmap subtable (formats 4 and 12 only: what a subset writes). */
async function cmapOf(sfnt: Uint8Array): Promise<number[]> {
  const v = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength);
  const n = v.getUint16(4);
  let off = -1;
  for (let i = 0; i < n; i++) if (String.fromCharCode(...sfnt.slice(12 + i * 16, 16 + i * 16)) === "cmap") off = v.getUint32(12 + i * 16 + 8);
  if (off < 0) return [];
  const subs = v.getUint16(off + 2);
  const cps: number[] = [];
  for (let i = 0; i < subs; i++) {
    const so = off + v.getUint32(off + 4 + i * 8 + 4);
    const fmt = v.getUint16(so);
    if (fmt === 4) {
      const segs = v.getUint16(so + 6) / 2;
      for (let s = 0; s < segs; s++) {
        const end = v.getUint16(so + 14 + s * 2), start = v.getUint16(so + 16 + segs * 2 + s * 2);
        for (let c = start; c <= end && c !== 0xffff; c++) cps.push(c);
      }
    } else if (fmt === 12) {
      const groups = v.getUint32(so + 12);
      for (let g = 0; g < groups; g++) {
        const s = v.getUint32(so + 16 + g * 12), e = v.getUint32(so + 20 + g * 12);
        for (let c = s; c <= e; c++) cps.push(c);
      }
    }
  }
  return cps;
}

// The strings each text-width constant sizes (see the comment on each constant).
const SAMPLES = ["PasswordResetEmailGuardLogs", "Kiosks", "Articles, comments & tags", "src/viewer/main.ts", "authentication middleware", "UserProfileSettings", "reads 3 · writes 1", "12 fields"];
// [label, class of the <g>, class of the <text>]; file and actor boxes use .node .name
const CLASSES: [string, string, string][] = [
  ["node.name", "node", "name"], ["node.sub", "node", "sub"], ["wire.n", "wire", "n"], ["captions.cap", "captions", "cap"],
  ["every.cname", "every-name", "cname"], ["file.name", "node file", "name"], ["wire.say", "wire", "say"],
];

async function measure() {
  const page = arg("--page");
  if (!page) throw new Error("usage: node scripts/fonts.ts measure --page <diagram.html> [--out <json>]");
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await p.goto(pathToFileURL(resolve(page)).href);
  await p.waitForFunction(() => (window as any).__repoladder, null, { timeout: 10000 });
  await p.evaluate(() => document.fonts.ready);
  const result = await p.evaluate(([samples, classes]) => {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("style", "position:absolute;left:-9999px;visibility:hidden");
    document.body.append(svg);
    const width = (parent: string, cls: string, text: string) => {
      const g = document.createElementNS(NS, "g");
      g.setAttribute("class", parent);
      const t = document.createElementNS(NS, "text");
      t.setAttribute("class", cls);
      t.textContent = text;
      g.append(t);
      svg.append(g);
      const w = t.getComputedTextLength();
      g.remove();
      return Math.round(w * 10) / 10;
    };
    const chars: Record<string, number> = {};
    let all = "";
    for (let c = 33; c <= 126; c++) all += String.fromCharCode(c);
    for (const ch of all) chars[ch] = Math.round(width("node", "name", ch) * 10);
    // a lone space collapses in SVG text, so it is the difference between "a a" and "aa"
    chars[" "] = Math.round((width("node", "name", "a\u00a0a") - width("node", "name", "aa")) * 10);
    const perClass: Record<string, Record<string, number>> = {};
    for (const [label, parent, cls] of classes) {
      perClass[label] = Object.fromEntries(samples.map((s) => [s, width(parent, cls, s)]));
      perClass[label].__sum = Math.round(samples.reduce((a, s) => a + width(parent, cls, s), 0) * 10) / 10;
    }
    return { chars, perClass, font: getComputedStyle(document.body).fontFamily };
  }, [SAMPLES, CLASSES] as const);
  await browser.close();
  const json = JSON.stringify(result, null, 2);
  const o = arg("--out");
  if (o) writeFileSync(o, json + "\n");
  else console.log(json);
}

if (process.argv[2] === "measure") await measure();
else await regenerate();
