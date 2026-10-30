/** Minimal globs: `**` spans folders, `*` stays within one, a plain folder path means everything under it. */
export interface Matcher {
  pattern: string;
  re: RegExp;
  /** Length of the literal part, used so the most specific pattern wins on overlap. */
  specificity: number;
}

export function compileGlob(pattern: string): Matcher {
  let p = pattern.replace(/^\.\//, "").replace(/\/+$/, "");
  const hasWild = /[*?]/.test(p);
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*" && p[i + 1] === "*") {
      re += p[i + 2] === "/" ? "(?:.*/)?" : ".*";
      i += p[i + 2] === "/" ? 2 : 1;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  // "web/src/hooks" matches the file itself or anything below it
  if (!hasWild) re += "(?:/.*)?";
  return { pattern, re: new RegExp(`^${re}$`), specificity: p.replace(/\*\*\/?|\*|\?/g, "").length + (hasWild ? 0 : 0.5) };
}

/**
 * The folder every path this pattern can match sits under: the literal part before the first `*` or `?`,
 * cut at its last `/` ("" for the repo root). Every compiled regex is `^literal…`, so a path outside
 * this folder never matches; assign() uses it to try only the patterns that can.
 */
export function literalDir(pattern: string): string {
  const p = pattern.replace(/^\.\//, "").replace(/\/+$/, "");
  const w = p.search(/[*?]/), lit = w < 0 ? p : p.slice(0, w);
  return lit.slice(0, Math.max(0, lit.lastIndexOf("/")));
}
