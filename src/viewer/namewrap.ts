// Box names on two lines, for the story level (#236). The story is a sentence read left to right, so
// its width is its actor column plus one box per layer; a long part name ("Articles, comments & tags")
// widens every part box (they share one size), and the whole board shrinks to fit the screen. Laid out
// on two lines, the same names take a narrower box. build/boxsize.ts sizes the boxes and draw.ts
// splits a name only when it doesn't fit its box on one line, so both read the same rule.

/** Rough advance width of a box name (board.css: 14.5px Geist at weight 650, measured with `node scripts/fonts.ts measure`). */
export const NAME_CH = 8.9;
/** Room left and right of a box's text. */
export const TEXT_PAD = 36;
/** Height a second name line adds to a box. */
export const NAME_LINE = 18;
/** Names shorter than this stay on one line: they don't widen a box much. */
export const WRAP_MIN = 16;

/** The two-line split whose longer line is shortest, or null for a single word. */
export function splitName(name: string): [string, string] | null {
  const words = name.split(" ");
  let best: [string, string] | null = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" "), b = words.slice(i).join(" ");
    if (!best || Math.max(a.length, b.length) < Math.max(best[0].length, best[1].length)) best = [a, b];
  }
  return best;
}

/** Width a line of name text needs in a box, with `extra` for a kind's own cue (the backend rail). */
export const nameWidth = (text: string, extra = 0) => text.length * NAME_CH + TEXT_PAD + extra;

/** The lines a name is drawn on in a box `w` wide: one when it fits, else its best split. */
export function nameLines(name: string, w: number, extra = 0): string[] {
  if (nameWidth(name, extra) <= w + 0.5) return [name];
  return splitName(name) ?? [name];
}
