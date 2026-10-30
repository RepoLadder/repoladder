// What an import cluster is named after (#283). One rule for both namers (pass 2: communities.ts
// nameCluster; pass 4: budgetsplit.ts splitLeaf rule 3): a file names a cluster only if more than half
// of the cluster's other members import it (and its name says something: not index.ts). Otherwise the
// cluster is named after its members' common folder ("Locales" for zod's locales, not "Ar", the
// alphabetically first of equals). Callers fall back to their own naming only when the members share
// no folder. rl#225's Express naming builds on the same helpers.
// boxnames.ts is a leaf module (humanize, commonDir), so there is no import cycle with grouping.ts.
import { commonDir, humanize } from "./boxnames.ts";

export { commonDir };

const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const stem = (p: string) => p.slice(p.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");

/** File stems that say nothing about what they hold: never a cluster's name on their own. */
export const GENERIC = /^(index|types?|utils?|helpers?|constants|common|shared|main)$/i;

/**
 * The file most of the cluster depends on: imported by more than half of the other members
 * (distinct files; one file importing it twice counts once). Among several, a non-generic stem first,
 * then the most importers, then alphabetical. Undefined when no file has a majority.
 */
export function dominantFile(files: string[], imports: { from: string; to: string }[]): string | undefined {
  const set = new Set(files);
  const by = new Map<string, Set<string>>();
  for (const e of imports) {
    if (e.from === e.to || !set.has(e.from) || !set.has(e.to)) continue;
    by.set(e.to, (by.get(e.to) ?? new Set()).add(e.from));
  }
  const n = (f: string) => by.get(f)?.size ?? 0;
  const gen = (f: string) => (GENERIC.test(stem(f)) ? 1 : 0);
  return files.filter((f) => n(f) * 2 > files.length - 1)
    .sort((a, b) => gen(a) - gen(b) || n(b) - n(a) || a.localeCompare(b))[0];
}

/** The members' common folder as a box name ("src/v4/locales" -> "Locales"), or "" when they share none. */
export function folderName(files: string[]): string {
  const d = commonDir(files);
  return d ? humanize(d.split("/").pop()!) : "";
}

/**
 * What to name a cluster after: `hub`, a dominant file whose name says something, else `folder`
 * (folderName; "" when the files share no folder, and the caller keeps its old naming).
 */
export function clusterBasis(files: string[], imports: { from: string; to: string }[]): { hub?: string; folder: string } {
  const d = dominantFile(files, imports);
  return { hub: d && !GENERIC.test(stem(d)) ? d : undefined, folder: folderName(files) };
}
