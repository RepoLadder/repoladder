// Stores on group boards (#254). A service most of a part's groups use is listed "Used throughout",
// not drawn (rollrules.ts), which is right for Firebase-everywhere SDKs but hid the database on the
// very boards that read and write it. A newcomer opening a part asks "where does this save?", so a
// store is drawn whenever the board has room for its box. It gets up to 3 arrows, like a service
// under the line, writers first: all of them when they fit in the board's arrow budget, otherwise
// only the writers. The arrows left out are minor (shown by "reveal minor edges"), and the store's
// panel still lists every reader and writer.
import type { RollEdge } from "./rollrules.ts";

/** The digestibility budget's boxes and wires (build/budget.ts `BUDGET`, which test/storeroom.test.ts keeps in step). */
export const ROOM = { boxes: 12, edges: 20 } as const;

/** Arrows drawn into a store that was over the "used throughout" line. */
const PER_STORE = 3;

export const isStoreId = (id: string) => id.startsWith("store-");

const writesFirst = (x: RollEdge, y: RollEdge) =>
  Number(!!y.writes) - Number(!!x.writes) || y.uses - x.uses || x.a.localeCompare(y.a);

/**
 * Of the stores `used` that are not `drawn`, the ones to draw. `boxes` and `arrows` count what the
 * board already shows; each store taken marks its arrows that fit major and the rest minor.
 */
export function roomForStores(list: RollEdge[], used: Iterable<string>, drawn: string[], boxes: number, arrows: number): string[] {
  const out: string[] = [];
  const left = [...used].filter((s) => isStoreId(s) && !drawn.includes(s));
  // the most-used store first, so the main database wins a board with room for one
  const into = (s: string) => list.filter((e) => e.b === s && e.uses > 0);
  left.sort((x, y) => into(y).length - into(x).length || x.localeCompare(y));
  for (const s of left) {
    const room = ROOM.edges - arrows;
    if (boxes + 1 > ROOM.boxes || room < 1) continue;
    const mine = into(s).sort(writesFirst);
    // all its arrows when they fit; on a busy board only the writers, which answer "where does this save?"
    const take = Math.min(PER_STORE, mine.length <= room ? mine.length : Math.min(room, mine.filter((e) => e.writes).length));
    if (!take) continue;
    mine.forEach((e, i) => { e.major = i < take; });
    out.push(s);
    boxes++;
    arrows += take;
  }
  return out;
}
