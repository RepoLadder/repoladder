// Volume and strength encoding, shared by the layout (build/layout.ts), the viewer and the SVG export:
// a part's sub line counts its files and lines (boxes on a board share one size), an arrow thickens
// with its weight. See DESIGN.md.

/** "640 lines", "6.2k lines", "128k lines". */
export function linesLabel(loc: number): string {
  const n = loc < 1000 ? String(loc) : loc < 100_000 ? `${(loc / 1000).toFixed(1).replace(/\.0$/, "")}k` : `${Math.round(loc / 1000)}k`;
  return `${n} line${loc === 1 ? "" : "s"}`;
}

/** The line under a part's name: "38 files · 6.2k lines". */
export const partSub = (count: number, loc: number) => `${count} file${count === 1 ? "" : "s"} · ${linesLabel(loc)}`;

/** How much an import/call edge matters: a runtime call crosses a process boundary, so it counts triple. */
export const edgeWeight = (e: { imports: number; calls: number }) => e.imports + 3 * e.calls;

/** Weight buckets for stroke width: w1 up to 4, w2 up to 19, w3 up to 79, w4 above. */
const BUCKETS = [5, 20, 80];

/** "w1".."w4" for import and call edges; "" for service and data edges, whose styles are fixed. */
export function weightClass(e: { imports: number; calls: number; uses: number; reads?: number; writes?: number }): string {
  if (e.reads || e.writes || e.uses) return "";
  const w = edgeWeight(e);
  return `w${1 + BUCKETS.filter((b) => w >= b).length}`;
}
