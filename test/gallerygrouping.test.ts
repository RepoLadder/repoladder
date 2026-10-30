import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { parseEntries } from "../scripts/gallery.ts";
import { assign } from "../src/model/grouping.ts";
import { Grouping } from "../src/model/schema.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const galleryDir = join(root, "gallery");

// Entries whose pinned commit is not in this clone (other repos) skip; the gallery build checks those.
// A checked-in grouping is validated against the pinned tree, not develop, so editing it for newer code can break the gallery build.
const entries = parseEntries(JSON.parse(readFileSync(join(galleryDir, "repos.json"), "utf8")), "repos.json");

for (const e of entries) {
  test(`gallery grouping for ${e.name} is valid against its pinned snapshot`, (t) => {
    const g = e.grouping ? resolve(galleryDir, e.grouping) : join(galleryDir, "groupings", `${e.name}.json`);
    if (!existsSync(g)) return t.skip(`no hand-written grouping for ${e.name}`);
    try {
      execFileSync("git", ["cat-file", "-e", `${e.sha}^{commit}`], { cwd: root, stdio: "ignore" });
    } catch {
      return t.skip(`pinned commit ${e.sha} is not in local history (shallow clone); the gallery build checks it`);
    }
    const dir = mkdtempSync(join(tmpdir(), "gallerygrouping-"));
    try {
      const tar = execFileSync("git", ["archive", e.sha!], { cwd: root, maxBuffer: 256 * 1024 * 1024 });
      execFileSync("tar", ["-x", "-C", dir], { input: tar });
      const a = assign(Grouping.parse(JSON.parse(readFileSync(g, "utf8"))), analyze(dir));
      assert.deepEqual(a.errors, [], `INVALID grouping for ${e.name} at ${e.sha}:\n${a.errors.join("\n")}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
