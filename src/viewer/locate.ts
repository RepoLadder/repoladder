// Opens a part or file the code facts name, for a served Ask answer's citations (`window.__repoladder.locate`).
// A file opens its leaf part with the file row highlighted, as Search does; a page that doesn't hold it changes nothing.
import { homeOf } from "./deeplink.ts";
import { go } from "./search.ts";
import { show } from "./navigate.ts";
import type { ViewerData } from "./state.ts";

export type Ref = { file: string; line?: number } | { box: string };
export type Found = { board: string; hit: string; file?: string };

export function resolveRef(d: ViewerData, ref: Ref): Found | null {
  if ("box" in ref) {
    if (!Object.hasOwn(d.nodes, ref.box) || ref.box === "root") return null;
    const hit = `n:${ref.box}`, board = homeOf(d, hit);
    return board ? { board, hit } : null;
  }
  for (const n of Object.values(d.nodes)) {
    if (n.children.length || !n.files.some((f) => (typeof f === "number" ? d.paths[f] : f) === ref.file)) continue;
    const hit = `n:${n.id}`, board = homeOf(d, hit);
    return board ? { board, hit, file: ref.file } : null;
  }
  return null;
}

export function locate(ref: Ref, d: ViewerData): boolean {
  const f = resolveRef(d, ref);
  if (!f) return false;
  if (f.file) go(["file", f.file, "", f.hit.slice(2)]);
  else show(f.board, undefined, f.hit);
  return true;
}
