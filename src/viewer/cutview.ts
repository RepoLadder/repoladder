// Shows one board cut at a box budget (docs/detail-dial-v2.md): the board's parts opened in place
// as containers, laid out in the Worker (stoplayout.ts cutLayout) and drawn by draw.ts through
// everydraw.ts. Only that board changes; its closed boxes still open their Default boards. The
// dial (#172) will turn stops through this; until then `__repoladder.cut(board, budget)` shows one.
import { cut, extraBoxes } from "./budget.ts";
import { installEvery } from "./everyview.ts";
import { cutLayout } from "./stoplayout.ts";
import { busy, canvasFit } from "./stopview.ts";
import { st, type ViewerData } from "./state.ts";

let base: ViewerData | null = null;
let showBoard: (id: string) => void = () => {};

/** Called once the page data is in: the Default data every cut starts from. */
export function installCut(show: (id: string) => void): void {
  base = st.data;
  showBoard = show;
}

/**
 * Shows `board` cut at `budget`; false when there is no such board or elkjs couldn't load. `opts`
 * tries the budget's rules for experiments: `extra: false` doesn't count the
 * lane and services, `containers` is what an opened part counts (budget.ts CutOptions), `lane`
 * places the lane (everylayout.ts EveryOpts); the layout aims for the canvas's shape.
 */
export async function viewCut(board: string, budget: number, opts: { extra?: boolean; containers?: number; lane?: "packed" | "edge" } = {}): Promise<boolean> {
  const b = base ?? st.data;
  if (!b.nodes[board]) return false;
  // the board's elsewhere lane and services count toward the budget, as on Default
  const tree = b.tree ?? b.nodes;
  // extraBoxes reads Default's children (the tree may hold a bucketed group's children under fine buckets)
  const got = cutLayout(b, cut(tree, b.paths, board, budget, { extra: opts.extra === false ? 0 : extraBoxes(b.nodes, b.boards[board], board), containers: opts.containers }), undefined, { lane: opts.lane, ...canvasFit() });
  let l;
  try { l = await busy(got.laid); } catch { return false; }
  // a board drawn as on Default keeps its walkthrough; a board of containers has none (walk.ts)
  const flows = { ...b.flows };
  if (got.board !== b.boards[board]) delete flows[board];
  st.data = { ...b, boards: { ...b.boards, [board]: got.board }, layout: { ...b.layout, [board]: l }, flows };
  installEvery();
  showBoard(board);
  return true;
}
