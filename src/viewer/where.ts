// Where a dashed "elsewhere" box lives, in words a non-engineer gets on first read. Shared by the
// build (box sizes, D2 labels, SVG export) and the viewer (box sub line, panel), so they always agree.

/** The slice of model or page nodes this needs. */
export type Tree = Record<string, { name: string; parent: string | null }>;

// keeps the sub line near the width of a box name
const MAX = 22;
const short = (s: string) => (s.length > MAX ? `${s.slice(0, MAX - 1).trimEnd()}…` : s);

/** The board and its ancestors, nearest first, ending at root. Empty for a board that is not a node (the story level). */
function chain(nodes: Tree, boardId: string): string[] {
  const up: string[] = [];
  for (let b: string | null = nodes[boardId] ? boardId : null; b && nodes[b]; b = nodes[b].parent) up.push(b);
  return up;
}

type Where = { how: "outside" | "also in" | "in"; group: string } | null;

function where(nodes: Tree, boardId: string, id: string): Where {
  const p = nodes[id]?.parent, up = chain(nodes, boardId);
  if (!p || !nodes[p] || !up.length) return null;
  if (p === "root") {
    // a top-level part: name the top-level part this board belongs to
    const top = up[up.length - 2];
    return top && top !== id ? { how: "outside", group: top } : null;
  }
  return { how: up.includes(p) ? "also in" : "in", group: p };
}

/** The line under the box's name: "outside Web app", "also in Web app", "in Cloud backend". */
export function whereLine(nodes: Tree, boardId: string, id: string): string {
  const w = where(nodes, boardId, id);
  return w ? `${w.how} ${short(nodes[w.group].name)}` : "elsewhere";
}

/** The panel's first sentence: what the box is and why it is drawn dashed on this board. */
export function whereText(nodes: Tree, boardId: string, id: string, repo: string): string {
  const w = where(nodes, boardId, id), name = nodes[id]?.name ?? id, here = nodes[boardId]?.name ?? "this board";
  const why = `It's drawn dashed because ${here} connects with it.`;
  if (!w) return `${name} is not part of ${here}. ${why}`;
  const group = nodes[w.group].name;
  if (w.how === "outside") return `${name} is outside ${group}: it's one of the main parts of ${repo}. ${why}`;
  if (w.how === "also in") return `${name} is another part of ${group}, outside ${here}. ${why}`;
  return `${name} is part of ${group}, outside ${here}. ${why}`;
}
