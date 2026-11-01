// The in-page viewer (src/viewer/) as minified JS and CSS strings for html.ts to inline.
// The plugin bundle has them baked in by scripts/build.ts through `define`. Running from
// source, they are built on first use with esbuild (a devDependency).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { tokenCss } from "../viewer/theme.ts";
import { packFonts } from "./filepack.ts";

/**
 * `boardCss` is the diagram-only part of `css`, still holding var(--token) references (for build/export.ts).
 * `boot` is the small inline script that unpacks the packed `css` and `js` in the page (viewer/boot.ts).
 * `fonts` is the packed Geist and Geist Mono subsets with their licence (filepack.ts `packFonts`), which boot registers.
 */
export interface ViewerAssets { js: string; css: string; boardCss: string; boot: string; fonts: string }

declare const __REPOLADDER_VIEWER__: ViewerAssets | undefined;
declare const __REPOLADDER_ASK__: { js: string; css: string } | undefined;

let cached: ViewerAssets | undefined;

export function viewerAssets(): ViewerAssets {
  if (typeof __REPOLADDER_VIEWER__ !== "undefined") return __REPOLADDER_VIEWER__;
  return (cached ??= buildViewer());
}

let askCached: { js: string; css: string } | undefined;

/** The served-only Ask bundle (global `repoladderAsk`, `start()`) and its CSS, appended to the page by `repoladder serve`. Never part of ViewerAssets. */
export function askAssets(): { js: string; css: string } {
  if (typeof __REPOLADDER_ASK__ !== "undefined") return __REPOLADDER_ASK__;
  return (askCached ??= buildAsk());
}

export function buildAsk(): { js: string; css: string } {
  const esbuild: typeof import("esbuild") = createRequire(import.meta.url)("esbuild");
  const dir = fileURLToPath(new URL("../viewer/", import.meta.url));
  const out = (f: string, o: Record<string, unknown>) => esbuild.buildSync({
    entryPoints: [dir + f], bundle: true, minify: true, target: "es2020", write: false, legalComments: "none", charset: "utf8", ...o,
  }).outputFiles[0].text.trim();
  // the page already carries the tokens; a `</script` or `</style` can't close the tag early
  return {
    js: out("ask/main.ts", { format: "iife", globalName: "repoladderAsk" }).replace(/<\/(script|style)/gi, "<\\/$1"),
    css: out("ask.css", {}).replace(/<\/(script|style)/gi, "<\\/$1"),
  };
}

/** Bundles src/viewer to an IIFE defining the global `repoladder` (with `start(data)`), plus its CSS. */
export function buildViewer(): ViewerAssets {
  const esbuild: typeof import("esbuild") = createRequire(import.meta.url)("esbuild");
  const dir = fileURLToPath(new URL("../viewer/", import.meta.url));
  const iife = (f: string, globalName?: string) => esbuild.buildSync({
    entryPoints: [dir + f], bundle: true, minify: true, format: "iife", globalName,
    target: "es2020", write: false, legalComments: "none", charset: "utf8",
  }).outputFiles[0].text.trim();
  const js = iife("main.ts", "repoladder");
  const sheet = (f: string) => esbuild.buildSync({
    entryPoints: [dir + f], bundle: true, minify: true, write: false, legalComments: "none", charset: "utf8",
  }).outputFiles[0].text.trim();
  const font = (f: string) => readFileSync(dir + "fonts/" + f);
  const license = readFileSync(fileURLToPath(new URL("../../LICENSE-Geist.txt", import.meta.url)), "utf8");
  return { js, css: tokenCss() + sheet("styles.css"), boardCss: sheet("board.css"), boot: iife("boot.ts"), fonts: packFonts(font("geist.woff2"), font("geist-mono.woff2"), license) };
}
