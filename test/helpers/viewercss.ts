// Reads a viewer stylesheet with its `@import "./x.css";` lines replaced by the imported text, as the bundle sees it.
import { readFileSync } from "node:fs";

/** `skip` names imported files left out (their `@import` becomes empty), at any depth. */
export function viewerCss(file = "styles.css", skip: string[] = []): string {
  const text = readFileSync(new URL(`../../src/viewer/${file}`, import.meta.url), "utf8");
  return text.replace(/@import "\.\/([\w-]+\.css)";\n?/g, (_m, f: string) => (skip.includes(f) ? "" : viewerCss(f, skip)));
}
