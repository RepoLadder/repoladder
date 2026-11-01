// The page's design tokens (palette from @repoladder/brand). build/viewer.ts turns them into the page's CSS custom
// properties; build/export.ts substitutes them into standalone SVGs. See DESIGN.md.

import { EXTRAS, THEMES as BRAND } from "@repoladder/brand";
import { FONT_FACES } from "./fontfaces.ts";

export type ThemeName = "light" | "dark";

export { FONT_FACES };

const SYSTEM_SANS = `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;

/** Font stacks for the page: display and UI text share the embedded Geist (a variable face, so every UI weight is exact); mono is for code-like text, section labels and diagram boxes. Glyphs the embedded subsets lack fall through to the system stacks. */
export const FONTS = {
  display: `"${FONT_FACES.display}", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`,
  ui: `"${FONT_FACES.display}", ${SYSTEM_SANS}`,
  mono: `"${FONT_FACES.mono}", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`,
};

/** Chrome shape, matching the site: cards, controls and the search box round to `radius`; chips are pills. Not colors (the palette is THEMES). */
export const SHAPE = { radius: "12px", "radius-sm": "8px", pill: "999px" };

/** Spacing scale on a 4px grid (24, 8 and 16 are the side panel's rhythm). Not colors. */
export const SPACE = { "space-1": "4px", "space-2": "8px", "space-3": "12px", "space-4": "16px", "space-5": "24px", "space-6": "32px" };

/** Floating chrome: three shadow tiers built on the `shadow` color token, and the backdrop blur (off at 0px; a surface that wants it writes `backdrop-filter: blur(var(--float-blur))`). Not colors. */
export const ELEVATION = {
  "shadow-1": "0 1px 2px var(--shadow)",
  "shadow-2": "0 4px 12px var(--shadow)",
  "shadow-3": "0 12px 32px var(--shadow)",
  "float-blur": "0px",
};

/** Chrome type scale, mirroring the site's (`web/src/styles/theme.css`): size and line-height only, no weights or tracking. Keep in sync with the site; a follow-up moves this into `@repoladder/brand`. Diagram text is sized by the box-size model and does not use it. */
export const TYPE = {
  "text-micro": "12px",
  "text-small": "14px",
  "text-body": "16px",
  "text-lg": "18px",
  "text-h3": "20px",
  "lh-micro": "1.4",
  "lh-small": "1.5",
  "lh-body": "1.6",
};

/** Standalone SVG exports can't carry the page's fonts, so they name system stacks only. */
export const EXPORT_FONTS = {
  display: SYSTEM_SANS,
  ui: SYSTEM_SANS,
  mono: `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`,
};

// The palette (neutrals, accent, halo, kind hues, wire, call) comes from @repoladder/brand; change colors
// there, not here. Only tokens the brand package doesn't carry live in this file.
// Kind hues sit far apart on the wheel (blue, green, violet, slate, rose) so a box reads by color
// before its label; every kind also has its own silhouette (draw.ts), so color is never the only cue.

// Viewer-only tokens: the search scrim, the floating sheet/menu shadows and the two floating surface tiers (`float` is the brand `surface`; `float-raised` is the brand's `paper`, the neutral nearest `surface`, so menus above a panel differ from it and no color is invented); `accent-ink` (text on an accent fill) is the brand's own extra.
const LOCAL: Record<ThemeName, Record<string, string>> = {
  light: { scrim: "#0005", shadow: "#0002", float: BRAND.light.surface, "float-raised": BRAND.light.paper, "accent-ink": EXTRAS.light["accent-ink"] },
  dark: { scrim: "#0005", shadow: "#0002", float: BRAND.dark.surface, "float-raised": BRAND.dark.paper, "accent-ink": EXTRAS.dark["accent-ink"] },
};

export const THEMES: Record<ThemeName, Record<string, string>> = {
  light: { ...BRAND.light, ...LOCAL.light },
  dark: { ...BRAND.dark, ...LOCAL.dark },
};

const props = (t: Record<string, string>) => Object.entries(t).map(([k, v]) => `--${k}:${v};`).join("");

/** Custom properties for both themes, following the Artifact rules: OS preference unless the page pins one. */
export function tokenCss(): string {
  const fonts = `--font-display:${FONTS.display};--font-ui:${FONTS.ui};--font-mono:${FONTS.mono};`;
  const dark = `color-scheme:dark;${props(THEMES.dark)}`;
  return `:root{${fonts}${props(SHAPE)}${props(TYPE)}${props(SPACE)}${props(ELEVATION)}${props(THEMES.light)}}`
    + `@media (prefers-color-scheme:dark){:root:not([data-theme=light]){${dark}}}`
    + `:root[data-theme=dark]{${dark}}`;
}

/** Replaces var(--token) with literal values, for SVG files that have to render without the page. */
export function resolveTokens(css: string, theme: ThemeName, fonts: { display: string; ui: string; mono: string } = EXPORT_FONTS): string {
  const t: Record<string, string> = { ...THEMES[theme], "font-display": fonts.display, "font-ui": fonts.ui, "font-mono": fonts.mono };
  return css.replace(/var\(--([\w-]+)\)/g, (m, k: string) => t[k] ?? m);
}
