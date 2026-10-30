import type { Model, ModelEdge } from "./rollup.ts";

/** A few source lines around an evidence line: [first line number, text with "\n" between lines]. */
export type Snippet = [start: number, text: string];

/** Total snippet text kept in a model. Pages must stay small, so evidence beyond this is link-only. */
export const SNIPPET_BUDGET = 12 * 1024;
const CONTEXT = 1; // lines above and below the evidence line: 3 lines in all
const MAX_COLS = 100;

export const snippetKey = (file: string, line: number) => `${file}:${line}`;

/**
 * The lines around `line` (1-based): blank edge lines dropped, common indentation removed, long
 * lines cut. Null when the line is out of range, e.g. the file changed since it was analyzed.
 */
export function snippetAt(text: string, line: number): Snippet | null {
  const lines = text.split(/\r?\n/);
  if (line < 1 || line > lines.length) return null;
  let start = Math.max(1, line - CONTEXT), end = Math.min(lines.length, line + CONTEXT);
  while (start < line && !lines[start - 1].trim()) start++;
  while (end > line && !lines[end - 1].trim()) end--;
  const win = lines.slice(start - 1, end).map((l) => l.replace(/\s+$/, "").replace(/\t/g, "  "));
  const indent = Math.min(...win.filter((l) => l).map((l) => l.match(/^ */)![0].length));
  const out = win.map((l) => l.slice(indent)).map((l) => (l.length > MAX_COLS ? `${l.slice(0, MAX_COLS - 1)}…` : l));
  return [start, out.join("\n")];
}

/**
 * Attaches snippets for the model's evidence, within `budget` bytes of text: first one per edge
 * (drawn edges first, from the root down), then the rest of each edge's evidence.
 */
export function addSnippets(model: Model, read: (file: string) => string | null, budget = SNIPPET_BUDGET): void {
  const boards = [model.story?.board, model.boards.root, ...Object.keys(model.boards).filter((id) => id !== "root").sort().map((id) => model.boards[id])];
  const edges: ModelEdge[] = boards.flatMap((b) => b?.edges ?? []);
  const drawn = edges.filter((e) => e.major), listed = edges.filter((e) => !e.major);
  const order = [...drawn, ...listed].map((e) => e.ev.slice(0, 1)).concat(edges.map((e) => e.ev.slice(1))).flat();

  const texts = new Map<string, string | null>();
  const snippets: Record<string, Snippet> = {};
  let used = 0;
  for (const [file, line] of order) {
    const k = snippetKey(file, line);
    if (k in snippets) continue;
    if (!texts.has(file)) texts.set(file, read(file));
    const t = texts.get(file);
    const s = t == null ? null : snippetAt(t, line);
    if (!s) continue;
    const size = new TextEncoder().encode(s[1]).length;
    if (used + size > budget) continue; // a smaller one later may still fit
    used += size;
    snippets[k] = s;
  }
  model.snippets = Object.fromEntries(Object.entries(snippets).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
