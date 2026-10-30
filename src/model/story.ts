import type { Facts, GroupNode, Grouping } from "./schema.ts";
import { endpointLabel } from "./endpoints.ts";

/**
 * Inline references in narrative sentences: [[id]] shows the referenced actor's, group's or
 * service's name; [[id|text]] shows `text` instead. Ids are actor ids, group ids, service ids as
 * "svc-<service>" (e.g. [[svc-stripe]]) or store ids as "store-<store>" (e.g. [[store-prisma]]).
 * The viewer renders them as links.
 */
export const STORY_REF = /\[\[([a-z0-9][a-z0-9-]*)(?:\|([^\[\]|]+))?\]\]/g;

export interface StoryRef { id: string; text: string | null; index: number; length: number }

export function storyRefs(sentence: string): StoryRef[] {
  return [...sentence.matchAll(STORY_REF)].map((m) => ({ id: m[1], text: m[2]?.trim() || null, index: m.index!, length: m[0].length }));
}

/** Where an entry points: an exact source file path, a page route ("/check-in"), or a server endpoint by name. */
export interface EntryHit { file: string; line: number; label: string }

export function resolveEntry(entry: string, facts: Facts): EntryHit[] {
  const file = facts.files.find((f) => f.path === entry);
  if (file) return [{ file: file.path, line: 1, label: entry }];
  if (entry.startsWith("/")) {
    const pages = facts.pages.filter((p) => p.route === entry);
    if (pages.length) return pages.map((p) => ({ file: p.file, line: 1, label: `${entry} (page)` })).sort((a, b) => a.file.localeCompare(b.file));
  }
  return facts.endpoints
    .filter((e) => e.name === entry)
    .map((e) => ({ file: e.file, line: e.line, label: `${endpointLabel(e)} (${e.kind} endpoint)` }))
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/** Level-1 group id for each group id in the tree. */
export function topLevelOf(grouping: Grouping): Map<string, string> {
  const top = new Map<string, string>();
  const walk = (n: GroupNode, root: string) => { top.set(n.id, root); n.children?.forEach((c) => walk(c, root)); };
  grouping.children.forEach((c) => walk(c, c.id));
  return top;
}

/**
 * The story is the one place Claude declares relationships, so every use must cite an entry
 * point that exists in the facts and lives inside the part it claims.
 */
export function validateStory(grouping: Grouping, facts: Facts, leafOf: Map<string, string>): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const story = grouping.story;
  if (!story) return { errors, warnings };
  const top = topLevelOf(grouping);
  const parts = grouping.children.map((c) => c.id);
  const services = new Set([...facts.services.map((s) => `svc-${s.id}`), ...(facts.stores ?? []).map((s) => `store-${s.id}`)]);

  const actors = new Set<string>();
  for (const a of story.actors) {
    if (actors.has(a.id)) errors.push(`story: duplicate actor id "${a.id}"`);
    else if (top.has(a.id) || a.id === "root" || a.id.startsWith("svc-")) errors.push(`story: actor id "${a.id}" clashes with a group, service or "root" id`);
    actors.add(a.id);
  }

  story.uses.forEach((u, i) => {
    const at = `story.uses[${i}]`;
    if (!actors.has(u.actor)) errors.push(`${at}: unknown actor "${u.actor}" (actors: ${[...actors].join(", ")})`);
    if (!parts.includes(u.part)) {
      errors.push(`${at}: unknown part "${u.part}"${top.has(u.part) ? " (it is a deeper group; use its first-rung part)" : ""} (first-rung parts: ${parts.join(", ")})`);
      return;
    }
    const hits = resolveEntry(u.entry, facts);
    if (!hits.length) {
      const stem = (p: string) => p.replace(/\.[^./]+$/, "");
      const near = facts.files.map((f) => f.path).filter((p) => stem(p) === stem(u.entry)).slice(0, 3);
      errors.push(`${at}: entry "${u.entry}" is not a source file path, page route or endpoint name in the facts${near.length ? `; did you mean ${near.map((p) => `"${p}"`).join(", ")}?` : ""}`);
      return;
    }
    if (!hits.some((h) => top.get(leafOf.get(h.file) ?? "") === u.part)) {
      const where = [...new Set(hits.map((h) => top.get(leafOf.get(h.file) ?? "") ?? "an unassigned file"))].join(", ");
      errors.push(`${at}: entry "${u.entry}" is in ${where}, not in part "${u.part}"`);
    }
  });
  for (const a of story.actors) if (!story.uses.some((u) => u.actor === a.id)) warnings.push(`story: actor "${a.id}" has no uses`);

  story.narrative.forEach((s, i) => {
    for (const r of storyRefs(s)) {
      if (actors.has(r.id) || top.has(r.id) || services.has(r.id)) continue;
      const near = closest(r.id, [...actors, ...top.keys(), ...services]);
      errors.push(`story.narrative[${i}]: unknown reference [[${r.id}]]${near ? `; did you mean [[${near}]]?` : ""} (service and store ids: ${[...services].sort().join(", ") || "none"})`);
    }
    if (s.replace(STORY_REF, "").includes("[[")) errors.push(`story.narrative[${i}]: malformed reference; write [[id]] or [[id|text]]`);
  });
  return { errors, warnings };
}

/** The known id nearest to a mistyped or guessed one (edit distance), when it is close enough to be what was meant. */
export function closest(id: string, ids: string[]): string | null {
  let best: string | null = null, bestD = Infinity;
  for (const c of [...new Set(ids)].sort()) {
    const d = editDistance(id, c);
    if (d < bestD) { best = c; bestD = d; }
  }
  return best !== null && bestD <= Math.max(2, Math.floor(id.length / 3)) ? best : null;
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
