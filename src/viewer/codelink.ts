// Links from the side panel to GitHub at the analyzed commit (page data `gh`, absent without a GitHub remote).
import type { Snippet } from "../model/snippets.ts";
import { esc, path, st, type PathRef, type ViewerData } from "./state.ts";

/** Page data for code links (absent without a GitHub remote) and snippets keyed "<path index>:<line>" (build/html.ts). */
export interface CodeData { gh?: string; snips?: Record<string, Snippet> }
export const code = () => st.data as ViewerData & CodeData;

/** The GitHub URL of a file (at a line) or, with `tree`, of a folder; undefined without `gh`. Not escaped. */
export function codeHref(p: string, line?: number, tree = false): string | undefined {
  const gh = code().gh;
  if (!gh) return undefined;
  return `${tree ? gh.replace(/\/blob\/([0-9a-f]{40,64}\/)/, "/tree/$1") : gh}${p.split("/").map(encodeURIComponent).join("/")}${line && !tree ? `#L${line}` : ""}`;
}

const anchor = (href: string | undefined, txt: string) => href ? `<a class="code mono" href="${esc(href)}" target="_blank" rel="noopener">${txt}</a>` : txt;

/** A file (and line) as text, linked to GitHub at the analyzed commit when the repo has a GitHub remote. */
export const fileRef = (f: PathRef, line?: number): string => { const p = path(f); return anchor(codeHref(p, line), `${esc(p)}${line ? `<span>:${line}</span>` : ""}`); };

/** A file path given as a string, linked the same way. */
export const pathLink = (p: string): string => anchor(codeHref(p), esc(p));

/** The folder all paths share (whole segments, no trailing slash); "" when they share none. */
export function commonDir(paths: string[]): string {
  const dirs = paths.map((p) => p.split("/").slice(0, -1));
  if (!dirs.length) return "";
  let n = dirs[0].length;
  for (const d of dirs) { let i = 0; while (i < n && d[i] === dirs[0][i]) i++; n = i; }
  return dirs[0].slice(0, n).join("/");
}

/** "Folder: <dir>/" linked to the folder at the analyzed commit; "" without `gh` or a shared non-root folder. */
export function folderLink(paths: string[]): string {
  const dir = commonDir(paths), href = dir ? codeHref(dir, undefined, true) : undefined;
  return href ? `<p class="num">Folder: ${anchor(href, `${esc(dir)}/`)}</p>` : "";
}
