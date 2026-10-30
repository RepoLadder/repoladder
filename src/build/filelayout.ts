// D2 labels for file boards (see model/fileboards.ts); the viewer draws the same lines.
import { FILE, MORE, exportLine, filePath, linesLabel, moreLabel } from "../model/fileboards.ts";
import { boxName } from "../model/filenames.ts";
import type { Model, ModelEdge } from "../model/rollup.ts";

export const isFileBoard = (model: Model, boardId: string) => !!model.nodes[boardId] && !model.nodes[boardId].children.length;

/** Name, exports (when any) and line count, one per line. */
export function fileBoxLabel(model: Model, boardId: string, id: string): string {
  if (id === MORE) {
    const shown = model.boards[boardId].nodes.filter((x) => x.startsWith(FILE)).length;
    return `${moreLabel(model.nodes[boardId].files.length - shown)}\nleast connected`;
  }
  const p = filePath(id), f = model.files?.[p];
  const ex = exportLine(f?.exports ?? []);
  return `${boxName(model.names, p)}\n${ex ? `${ex}\n` : ""}${linesLabel(f?.loc ?? 0)}`;
}

/**
 * File box sizes: one common size for every file box on the board (and the "more" box), with room
 * for the longest label lines as viewer/files.ts draws them (13px name, 10.5–11px mono).
 */
export function fileBoxSizes(model: Model, boardId: string): Record<string, [number, number]> {
  const ids = model.boards[boardId].nodes.filter((id) => id.startsWith(FILE) || id === MORE);
  const base = (id: string): [number, number] => {
    const [name, ...rest] = fileBoxLabel(model, boardId, id).split("\n");
    return [Math.ceil(Math.max(120, name.length * 8.4, ...rest.map((l) => l.length * 6.6)) + 32), 30 + 15 * rest.length];
  };
  const common = ids.map(base).reduce<[number, number]>((m, [w, h]) => [Math.max(m[0], w), Math.max(m[1], h)], [0, 0]);
  return Object.fromEntries(ids.map((id) => [id, common]));
}

