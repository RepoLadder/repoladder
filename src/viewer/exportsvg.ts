// The viewer's own export (#355): the board on screen as a standalone SVG, and that SVG rasterized to a PNG.
// The CLI exporter (build/export.ts) redraws whole boards from the model and pulls Node code in, so the page
// instead clones the live board and inlines the page's rules that match it. The pure helpers are unit-tested.
import type { decode91 } from "./base91.ts";
import { esc, home, nameOf, st } from "./state.ts";
import { EXPORT_FONTS, FONT_FACES, FONTS, resolveTokens, THEMES, type ThemeName } from "./theme.ts";
import { finishTransition, settled } from "./transition.ts";
import { inflated } from "./unpack.ts";

export const themeOf = (pinned: string | undefined, prefersDark: boolean): ThemeName =>
  pinned === "dark" || (pinned !== "light" && prefersDark) ? "dark" : "light";

export function exportName(repo: string, board: string, theme: ThemeName, ext: "svg" | "png"): string {
  const slug = `${repo}-${board}`.replace(/[^a-z0-9._-]+/gi, "_").replace(/^[_.]+/, "").replace(/_+$/, "").slice(0, 80) || "board";
  return `${slug}-${theme}.${ext}`;
}

/** The PNG's scale: 2x, held under iOS Safari's canvas limits. Below 1 means no PNG. */
export const pngScale = (w: number, h: number): number => Math.min(2, 8192 / w, 8192 / h, Math.sqrt(16e6 / (w * h)));

/** Drops what only makes sense in the page. `data-*` stays: board rules select on `g[data-hit]`. */
export const bare = (markup: string): string => markup.replace(/ (?:tabindex|role|inert)="[^"]*"/g, "");

export const fontCss = (sansUrl: string, monoUrl: string): string =>
  [[FONT_FACES.display, sansUrl], [FONT_FACES.mono, monoUrl]].map(([f, u]) => `@font-face{font-family:"${f}";src:url(${u}) format("woff2");font-weight:100 900}`).join("");

const text = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const attr = (s: string) => esc(s);

interface Parts { w: number; h: number; fontSize?: string; label: string; ground: string; css: string; classes: string; inner: string }

/** The file: the page's inherited font size (the board inherits it), ground, then a `<g>` wearing the live svg's ancestor classes so the page's selectors match unchanged. */
export const standalone = (o: Parts): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${o.w}" height="${o.h}" viewBox="0 0 ${o.w} ${o.h}"${o.fontSize ? ` font-size="${attr(o.fontSize)}"` : ""} role="img" aria-label="${attr(o.label)}"><title>${text(o.label)}</title>`
  + `<style>${text(o.css)}*{animation:none!important;transition:none!important}</style><rect width="${o.w}" height="${o.h}" fill="${attr(o.ground)}"/><g class="${attr(o.classes)}">${o.inner}</g></svg>`;

function collect(rules: CSSRuleList, svg: SVGSVGElement, out: string[]): void {
  for (const r of Array.from(rules)) {
    try {
      if (r instanceof CSSStyleRule) { if (!r.selectorText.includes(".shaded") && (svg.matches(r.selectorText) || svg.querySelector(r.selectorText))) out.push(r.cssText); }
      else if (r instanceof CSSMediaRule) { if (matchMedia(r.conditionText).matches) collect(r.cssRules, svg, out); }
      else if (r instanceof CSSSupportsRule) { if (CSS.supports(r.conditionText)) collect(r.cssRules, svg, out); }
    } catch { /* a selector the browser rejects, or a rule it can't read */ }
  }
}

/** The page's rules that touch the board, judged against the live svg so ancestor-dependent ones count. */
function boardCss(svg: SVGSVGElement): string {
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) { try { collect(sheet.cssRules, svg, out); } catch { /* cross-origin sheet */ } }
  return out.join("");
}

function ancestorClasses(svg: Element): string {
  const seen = new Set<string>();
  for (let e = svg.parentElement; e; e = e.parentElement) e.classList.forEach((c) => seen.add(c));
  return [...seen].join(" ");
}

export type FontUrls = [sans: string, mono: string];

/** The current view as SVG text. `fonts` embeds Geist (for the PNG only; the saved SVG keeps system stacks). */
export async function viewSvg(fonts: FontUrls | null): Promise<{ text: string; w: number; h: number }> {
  finishTransition();
  await settled();
  const r = st.svgEl.getBoundingClientRect(), w = Math.round(r.width), h = Math.round(r.height);
  const clone = st.svgEl.cloneNode(true) as SVGSVGElement;
  clone.removeAttribute("style");
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  const theme = pageTheme();
  const css = resolveTokens(boardCss(st.svgEl), theme, fonts ? FONTS : EXPORT_FONTS) + (fonts ? fontCss(...fonts) : "");
  const label = `${st.data.repo} · ${boardLabel()}`;
  return { text: standalone({ w, h, label, fontSize: getComputedStyle(st.svgEl).fontSize, ground: THEMES[theme].paper, css, classes: ancestorClasses(st.svgEl), inner: bare(new XMLSerializer().serializeToString(clone)) }), w, h };
}

const pageTheme = (): ThemeName => themeOf(document.documentElement.dataset.theme, matchMedia("(prefers-color-scheme: dark)").matches);
export const boardLabel = (): string => (st.cur === home() ? "Overview" : nameOf(st.cur));
export const boardSlug = (ext: "svg" | "png"): string =>
  exportName(st.data.repo, st.cur === home() ? "overview" : nameOf(st.cur), pageTheme(), ext);

const dataUrl = (b: Blob) => new Promise<string>((ok, no) => { const f = new FileReader(); f.onload = () => ok(f.result as string); f.onerror = () => no(f.error); f.readAsDataURL(b); });

/** The two woff2 subsets as data URLs (blob layout: filepack.ts `packFonts`), or null: the PNG then uses system stacks. */
export async function fontUrls(decode?: typeof decode91, fonts?: string): Promise<FontUrls | null> {
  try {
    if (!decode || !fonts) return null;
    const b = new Uint8Array(await inflated(fonts, decode).arrayBuffer()), n = new DataView(b.buffer), a = n.getUint32(0), m = n.getUint32(4);
    const woff = (s: Uint8Array) => dataUrl(new Blob([s as BlobPart], { type: "font/woff2" }));
    return [await woff(b.slice(8, 8 + a)), await woff(b.slice(8 + a, 8 + a + m))];
  } catch { return null; }
}

/** Rasterizes SVG text on a canvas. A data URI with no external references never taints it. */
export async function toPng(svg: string, w: number, h: number): Promise<Blob> {
  const s = pngScale(w, h), src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  const c = document.createElement("canvas");
  c.width = Math.round(w * s);
  c.height = Math.round(h * s);
  const x = c.getContext("2d")!;
  // Safari draws text in a not-yet-loaded font as nothing, and starts an SVG image's fonts only when it paints it:
  // draw once to start them, give them a moment, then clear and draw from a second image.
  for (let pass = 0; pass < 2; pass++) {
    const img = new Image();
    img.src = src;
    await img.decode();
    await new Promise((f) => requestAnimationFrame(f));
    x.clearRect(0, 0, c.width, c.height);
    x.drawImage(img, 0, 0, c.width, c.height);
    if (!pass) await new Promise((f) => setTimeout(f, 250));
  }
  return new Promise((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("no PNG"))), "image/png"));
}
