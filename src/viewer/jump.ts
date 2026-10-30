// Jumps to another part of the system: a dashed "elsewhere" box goes to the board it lives on, and a
// store opens into its collections. A jump changes branch, so it is where readers get lost (#106):
// the first click only selects (the panel says where the box lives and offers "Go to"), the jump
// itself selects the box you went to, with no pulse (#168). The way back is the canvas's ←
// (history.ts), whose tooltip names the board it returns to; there is no second back button (#165).
import { home, nameOf, st } from "./state.ts";

/** What a jump needs to know about the page: node parents, the current board's context, the boards. */
export interface JumpPage {
  nodes: Record<string, { parent: string | null }>;
  /** The "elsewhere" boxes on the current board. */
  context: string[];
  layout: Record<string, unknown>;
  stores?: Record<string, unknown>;
  home: string;
}

export interface Jump { board: string; hit: string | null }

/**
 * Where the box `id` on the current board jumps to, or null when it does not jump (its own parts
 * drill in instead, and a service without a board opens nothing). Exported for tests.
 */
export function jumpOf(p: JumpPage, id: string): Jump | null {
  if (p.context.includes(id) && p.nodes[id]) {
    const up = p.nodes[id].parent, board = !up || up === "root" ? p.home : up;
    return p.layout[board] ? { board, hit: `n:${id}` } : null;
  }
  if (p.stores?.[id] && p.layout[id]) return { board: id, hit: null };
  return null;
}

export const page = (): JumpPage => ({ nodes: st.data.nodes, context: st.data.boards[st.cur]?.context ?? [], layout: st.data.layout, stores: st.data.stores, home: home() });

/** The board's name as the breadcrumbs say it. */
export const boardName = (id: string) => (id === home() ? "Overview" : id === "root" ? "All parts" : nameOf(id));
