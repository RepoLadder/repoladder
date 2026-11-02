// The `overlay` build option: ids of boxes and connections to mark on the page, validated here and
// resolved against the model. Ids are the viewer's own stable hits (viewer/deeplink.ts `hitOf`):
// `n:<box id>` for a box, `e:<from>><to>` for a connection over box (or service) ids.
// A touched part is `{ id, files?, filesChanged?, name? }`: `id` may be bare or `n:`-prefixed, `filesChanged` is an
// alias of `files` (`files` wins), and `name` is accepted and ignored (the page always shows the model's own name).
// Resolving is tolerant and never fails a build: ids the model does not know are dropped and counted, and a connection
// endpoint that is a file path in the model (not a box id) is lifted to the box that owns the file.
import { z } from "zod";
import type { Model } from "./rollup.ts";

const NodeHit = z.string().regex(/^n:\S{1,200}$/);
const EdgeHit = z.string().regex(/^e:[^\s>]{1,200}>[^\s>]{1,200}$/);

const Part = z.object({
  id: z.string().regex(/^(?:n:)?\S{1,200}$/),
  files: z.number().int().min(0).optional(),
  filesChanged: z.number().int().min(0).optional(),
  name: z.string().max(500).optional(),
}).strict().transform((p): { id: string; files?: number } => {
  const files = p.files ?? p.filesChanged;
  return { id: p.id.startsWith("n:") ? p.id : `n:${p.id}`, ...(files === undefined ? {} : { files }) };
});

export const Overlay = z.object({
  /** Existing boxes whose content changed. */
  changed: z.array(NodeHit).max(2000).optional(),
  /** Boxes that are new. */
  added: z.array(NodeHit).max(2000).optional(),
  addedEdges: z.array(EdgeHit).max(5000).optional(),
  removedEdges: z.array(EdgeHit).max(5000).optional(),
  /** The touched-parts list. */
  parts: z.array(Part).max(200).optional(),
}).strict();
/** What a caller passes (bare part ids, `filesChanged`, `name` all allowed). */
export type Overlay = z.input<typeof Overlay>;
/** The overlay after validation: part ids prefixed, `files` resolved, `name` gone. */
export type ParsedOverlay = z.output<typeof Overlay>;

/** What the page's overlay bundle receives: only ids the model knows. */
export interface Marks {
  changed: string[];
  added: string[];
  addedEdges: string[];
  removedEdges: string[];
  parts: { id: string; name: string; files?: number }[];
}

type Kind = keyof Marks;

export interface OverlayReport {
  applied: Record<Kind, number>;
  dropped: Record<Kind, number>;
}

const counts = (): Record<Kind, number> => ({ changed: 0, added: 0, addedEdges: 0, removedEdges: 0, parts: 0 });

/** Keeps the ids that name a part or a service in the model; drops (and counts) the rest, since a stale id must not fail a build. */
export function resolveOverlay(overlay: ParsedOverlay, model: Model): { marks: Marks; report: OverlayReport } {
  const name = (id: string): string | null => model.nodes[id]?.name ?? model.services[id] ?? null;
  const box = (hit: string) => name(hit.slice(2)) !== null;
  // file path -> its leaf box, built on first use
  let owner: Map<string, string> | undefined;
  const lift = (end: string): string | null => {
    if (name(end) !== null) return end;
    owner ??= new Map(Object.values(model.nodes).flatMap((n) => n.files.map((p) => [p, n.id] as [string, string])));
    return owner.get(end) ?? null;
  };
  /** The connection's id over box ids, or null when an end is unknown or a lifted connection stays inside one box. */
  const edgeId = (hit: string): string | null => {
    const i = hit.indexOf(">"), a = hit.slice(2, i), b = hit.slice(i + 1);
    const from = lift(a), to = lift(b);
    if (from === null || to === null) return null;
    return (from !== a || to !== b) && from === to ? null : `e:${from}>${to}`;
  };
  const marks: Marks = { changed: [], added: [], addedEdges: [], removedEdges: [], parts: [] };
  const report: OverlayReport = { applied: counts(), dropped: counts() };
  const list = (kind: Exclude<Kind, "parts">, resolve: (h: string) => string | null) => {
    const seen = new Set<string>();
    for (const h of new Set(overlay[kind] ?? [])) {
      const id = resolve(h);
      if (id !== null && !seen.has(id)) { seen.add(id); marks[kind].push(id); report.applied[kind]++; } else report.dropped[kind]++;
    }
  };
  list("changed", (h) => (box(h) ? h : null));
  list("added", (h) => (box(h) ? h : null));
  list("addedEdges", edgeId);
  list("removedEdges", edgeId);
  const seen = new Set<string>();
  for (const p of overlay.parts ?? []) {
    const id = p.id.slice(2), n = name(id);
    if (n === null || seen.has(id)) { report.dropped.parts++; continue; }
    seen.add(id);
    marks.parts.push({ id, name: n, ...(p.files === undefined ? {} : { files: p.files }) });
    report.applied.parts++;
  }
  return { marks, report };
}
