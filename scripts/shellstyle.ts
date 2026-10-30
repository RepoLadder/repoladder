// CSS variables for the dev and lab shell pages (lab, gallery, shots sheet). Palette and fonts come from
// @repoladder/brand; change colors there. Only the status hues the brand doesn't carry live here.
import { EXTRAS, FONTS, THEMES, type ThemeName } from "@repoladder/brand";

const BRAND_KEYS = ["ground", "surface", "ink", "muted", "line", "accent"] as const;
// good/warn: the brand has no tokens for these. Checked at >= 4.5:1 against both grounds and surfaces of the brand.
const STATUS: Record<ThemeName, { good: string; warn: string }> = {
  light: { good: "#2E7D4F", warn: "#A0611B" },
  dark: { good: "#6CC58F", warn: "#E0A75E" },
};

const vars = (t: ThemeName) =>
  BRAND_KEYS.map((k) => `--${k}:${THEMES[t][k]};`).join("")
  + `--good:${STATUS[t].good};--warn:${STATUS[t].warn};--bad:${EXTRAS[t].danger};`;

/** Three blocks (light, OS dark unless pinned light, pinned dark), plus the brand font stacks as --font-ui / --font-mono. */
export function shellTokens(): string {
  const dark = `color-scheme:dark;${vars("dark")}`;
  return `:root{--font-ui:${FONTS.ui};--font-mono:${FONTS.mono};${vars("light")}}\n`
    + `@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${dark}}}\n`
    + `:root[data-theme="dark"]{${dark}}`;
}

export { FONTS as SHELL_FONTS };
