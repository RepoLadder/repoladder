import type { Readme } from "../model/schema.ts";
import { inSkippedDir } from "./files.ts";
import type { FileSource } from "./source.ts";

// README hints for box descriptions (#359): the first H1 and the first prose paragraph of the README in
// each folder that holds source. Reads are bounded: 16 KB per file, 2000 files.
const MAX_BYTES = 16 * 1024;
const MAX_READMES = 2000;
const MAX_TEXT = 300;
const README_NAME = /^readme(\.(md|markdown|mdx|txt))?$/i;
const NOT_PROSE = /^(#|\||>|<|- |\* |\+ |\d+\.|---|\*\*\*)/;

/** Inline markdown reduced to plain words, on one line. */
function inline(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/!\[[^\]]*\]\[[^\]]*\]/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/(^|\s)[*_]+(?=\S)|(?<=\S)[*_]+(?=\s|$)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** The first H1 and first prose paragraph of a markdown text, each cleaned and cut to 300 chars. */
export function readmeHint(md: string): { title?: string; text?: string } {
  let src = md.replace(/\r\n?/g, "\n");
  if (src.startsWith("---\n")) {
    const end = src.indexOf("\n---", 4);
    if (end >= 0) src = src.slice(src.indexOf("\n", end + 1) + 1 || src.length);
  }
  const lines: string[] = [];
  let fence = false;
  for (const l of src.split("\n")) {
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; continue; }
    if (!fence) lines.push(l);
  }
  let title: string | undefined;
  let text: string | undefined;
  for (let i = 0; i < lines.length && (!title || !text); i++) {
    const l = lines[i];
    if (!title) {
      const h = /^# +(.*?)(?: +#+)?\s*$/.exec(l);
      const setext = l.trim() && !NOT_PROSE.test(l) && /^=+\s*$/.test(lines[i + 1] ?? "");
      const t = inline(h ? h[1] : setext ? l : "");
      if (t) { title = t.slice(0, MAX_TEXT); if (setext) i++; continue; }
    }
    if (!text && l.trim() && !NOT_PROSE.test(l.trim())) {
      const para: string[] = [];
      let j = i;
      while (j < lines.length && lines[j].trim()) para.push(lines[j++].trim());
      const t = inline(para.join(" "));
      if (/[\p{L}\p{N}]/u.test(t)) text = t.slice(0, MAX_TEXT);
      i = j;
    }
  }
  return { ...(title ? { title } : {}), ...(text ? { text } : {}) };
}

const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

function readHead(src: FileSource, rel: string): string | null {
  try {
    return Buffer.from(src.read(rel), "utf8").subarray(0, MAX_BYTES).toString("utf8");
  } catch {
    return null;
  }
}

/** READMEs in the repo root and in every folder above a source file, as hints. Sorted by folder. */
export function readmeFacts(src: FileSource, allPaths: string[], sourcePaths: string[]): Readme[] {
  const candidates = new Set([""]);
  for (const p of sourcePaths) for (let d = dirOf(p); d; d = dirOf(d)) candidates.add(d);
  const byDir = new Map<string, string[]>();
  for (const p of allPaths) {
    const name = p.slice(p.lastIndexOf("/") + 1);
    if (!README_NAME.test(name) || !candidates.has(dirOf(p)) || inSkippedDir(p)) continue;
    byDir.set(dirOf(p), [...(byDir.get(dirOf(p)) ?? []), p]);
  }
  const depth = (d: string) => (d ? d.split("/").length : 0);
  const dirs = [...byDir.keys()].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b)).slice(0, MAX_READMES);
  const out: Readme[] = [];
  for (const dir of dirs) {
    const files = byDir.get(dir)!;
    const pick = files.find((f) => f.slice(f.lastIndexOf("/") + 1).toLowerCase() === "readme.md") ?? [...files].sort()[0];
    const md = readHead(src, pick);
    if (md === null) continue;
    const h = readmeHint(md);
    if (h.title || h.text) out.push({ dir, ...h });
  }
  return out.sort((a, b) => a.dir.localeCompare(b.dir));
}
