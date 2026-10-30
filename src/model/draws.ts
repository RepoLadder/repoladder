// "Drawn as an arrow": what the viewer paints on a board by default (no filter toggles): a major
// edge a -> b whose two ends are both boxes there. Tours land only on boards that draw their
// edges (tours.ts, compose.ts); a board that merely lists a connection does not count.

/** Structural, so the model's Board and the page data's board both fit. */
export interface DrawBoard { nodes: string[]; edges: { a: string; b: string; major: boolean }[] }

export const drawsEdge = (board: DrawBoard, a: string, b: string): boolean =>
  board.nodes.includes(a) && board.nodes.includes(b) && board.edges.some((e) => e.a === a && e.b === b && e.major === true);
