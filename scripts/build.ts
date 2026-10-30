// Bundles the CLI to plugin/dist/repoladder.mjs with the in-page viewer baked in,
// so the shipped plugin never needs esbuild at runtime.
import { bundlePlugin } from "./bundle.ts";

await bundlePlugin();
