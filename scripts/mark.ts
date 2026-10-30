// Regenerates FAVICON_HREF and HEADER_MARK in src/build/mark.ts from mark.svg and mark-dark.svg.
//   node scripts/mark.ts
// Exits non-zero if the favicon is over FAVICON_KB.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FAVICON_KB, composeMark, headerMark, svgDataUri } from "../src/build/mark.ts";

const dir = new URL("../src/build/", import.meta.url);
const light = readFileSync(new URL("mark.svg", dir), "utf8"), dark = readFileSync(new URL("mark-dark.svg", dir), "utf8");
const favicon = svgDataUri(composeMark(light, dark)), header = headerMark(light, dark);
const file = fileURLToPath(new URL("mark.ts", dir));
const src = readFileSync(file, "utf8")
  .replace(/^export const FAVICON_HREF = .*;$/m, () => `export const FAVICON_HREF = ${JSON.stringify(favicon)};`)
  .replace(/^export const HEADER_MARK = .*;$/m, () => `export const HEADER_MARK = ${JSON.stringify(header)};`);
writeFileSync(file, src);
console.log(`FAVICON_HREF ${Buffer.byteLength(favicon)} bytes, HEADER_MARK ${Buffer.byteLength(header)} bytes`);
if (Buffer.byteLength(favicon) > FAVICON_KB * 1024) { console.error(`favicon is over ${FAVICON_KB}KB`); process.exit(1); }
