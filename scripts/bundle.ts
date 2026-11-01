// Shared esbuild pieces: the engine version, the library bundle (src/lib.ts) and the CLI bundle (src/cli.ts), each one ESM file.
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAsk, buildViewer } from "../src/build/viewer.ts";
import { commitId } from "../src/usage.ts";

const repo = resolve(fileURLToPath(new URL("..", import.meta.url)));

export const ENGINE_VERSION_DEFINE = "__REPOLADDER_ENGINE_VERSION__";

/** The root package.json version: the single source for the engine version. */
export function engineVersion(): string {
  return String(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version);
}

/** The library bundle: src/lib.ts as one ESM file with the viewer and engine version baked in. */
export async function bundleLib(o: { outfile: string; version: string }): Promise<void> {
  await build({
    entryPoints: [resolve(repo, "src/lib.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["typescript", "@terrastruct/d2"],
    define: { __REPOLADDER_VIEWER__: JSON.stringify(buildViewer()), [ENGINE_VERSION_DEFINE]: JSON.stringify(o.version) },
    outfile: o.outfile,
    logLevel: "info",
  });
}

export type Channel = "plugin" | "npm";

/** The CLI bundle: src/cli.ts as one ESM file with a shebang. `version` is what usage pings report; `engine` the semver. */
export async function bundleCli(o: { outfile: string; channel: Channel; version: string; engine: string }): Promise<void> {
  await build({
    entryPoints: [resolve(repo, "src/cli.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["typescript", "@terrastruct/d2"],
    // Line 2 is a greppable stamp: scripts/verifydist.ts rebuilds with it to check plugin/dist.
    banner: { js: `#!/usr/bin/env node\n// repoladder-build: ${o.version}` },
    define: {
      __REPOLADDER_VIEWER__: JSON.stringify(buildViewer()),
      __REPOLADDER_ASK__: JSON.stringify(buildAsk()),
      __REPOLADDER_VERSION__: JSON.stringify(o.version),
      __REPOLADDER_CHANNEL__: JSON.stringify(o.channel),
      [ENGINE_VERSION_DEFINE]: JSON.stringify(o.engine),
    },
    outfile: o.outfile,
    logLevel: "info",
  });
}

/** The plugin bundle (plugin/dist/repoladder.mjs). Shared by the build and scripts/verifydist.ts so their options cannot drift. */
export async function bundlePlugin(o: { outfile?: string; version?: string } = {}): Promise<void> {
  await bundleCli({
    outfile: o.outfile ?? "plugin/dist/repoladder.mjs",
    channel: "plugin",
    version: o.version ?? commitId(process.cwd()),
    engine: engineVersion(),
  });
}
