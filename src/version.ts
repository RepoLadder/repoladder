// The engine's version: the root package.json `version`, which is also the npm package's version.
// Bundles get it baked in through `define` (scripts/bundle.ts); a source run reads package.json.
import { readFileSync } from "node:fs";

/** The npm package name pages and results refer to. */
export const PACKAGE = "repoladder";

declare const __REPOLADDER_ENGINE_VERSION__: string | undefined;
function read(): string {
  try { return String(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version); }
  catch { return "0.0.0-dev"; }
}
/** The engine's semver, e.g. "0.1.0". */
export const VERSION: string = typeof __REPOLADDER_ENGINE_VERSION__ !== "undefined" ? __REPOLADDER_ENGINE_VERSION__ : read();
