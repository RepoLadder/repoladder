// The npm library package generator's pure helpers (#366). Never runs esbuild, tsc or npm.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dtsClosure, libDependencies, packageJson, packageVersion, stamp, typeImports } from "../scripts/npm-package.ts";

const json = (rel: string) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));
const root = json("../package.json"), plugin = json("../plugin/package.json"), lock = json("../package-lock.json");

test("packageJson: the publishable shape", () => {
  const p = packageJson({ version: "1.2.3", rootPkg: root, dependencies: { zod: "4.6.7" } }) as Record<string, unknown>;
  assert.equal(p.name, "repoladder");
  assert.equal(p.version, "1.2.3");
  assert.equal(p.type, "module");
  assert.deepEqual((p.exports as Record<string, unknown>)["."], { types: "./dist/types/lib.d.ts", import: "./dist/lib.mjs" });
  assert.equal((p.exports as Record<string, unknown>)["./package.json"], "./package.json");
  assert.deepEqual(p.files, ["bin", "dist", "LICENSE", "NOTICE", "THIRD-PARTY-NOTICES.txt", "LICENSE-Geist.txt"]);
  assert.deepEqual(p.bin, { repoladder: "bin/repoladder.mjs" });
  assert.equal(p.homepage, "https://repoladder.com");
  assert.equal((p.repository as { url: string }).url, "git+https://github.com/repoladder/repoladder.git");
  assert.equal((p.engines as { node: string }).node, ">=20.6");
  assert.equal(p.license, root.license);
  assert.equal(p.license, "Apache-2.0");
  assert.deepEqual(p.publishConfig, { access: "public", provenance: true });
  for (const k of ["private", "scripts", "devDependencies"]) assert.ok(!(k in p), k);
  assert.throws(() => packageJson({ version: "latest", rootPkg: root, dependencies: {} }));
});

test("typeImports: bare package names only", () => {
  const dts = [
    'import { z } from "zod";',
    'type A = import("elkjs/lib/elk-api.js").X;',
    'export type { B } from "@scope/pkg/sub";',
    'import { readFileSync } from "node:fs";',
    'import { join } from "fs";',
    'import { c } from "./a.ts";',
    '/// <reference types="node" />',
  ].join("\n");
  assert.deepEqual(typeImports(dts), ["@scope/pkg", "elkjs", "zod"]);
});

test("libDependencies: exact pins, lockfile versions for type packages", () => {
  const deps = libDependencies({ typePkgs: ["zod", "typescript", "@types/node"], pluginDeps: plugin.dependencies, lock });
  assert.equal(deps.typescript, plugin.dependencies.typescript);
  assert.equal(deps["@terrastruct/d2"], plugin.dependencies["@terrastruct/d2"]);
  assert.equal(deps.zod, lock.packages["node_modules/zod"].version);
  assert.ok(!("@types/node" in deps));
  assert.throws(() => libDependencies({ typePkgs: ["no-such-pkg"], pluginDeps: plugin.dependencies, lock }), /NPM_PACKAGE_FAILED/);
  assert.throws(() => libDependencies({ typePkgs: [], pluginDeps: { x: "^1.0.0" }, lock }), /NPM_PACKAGE_FAILED/);
});

test("dtsClosure: follows relative specifiers, ignores unreferenced files", () => {
  const d = mkdtempSync(join(tmpdir(), "cw-dts-"));
  mkdirSync(join(d, "dir"));
  writeFileSync(join(d, "lib.d.ts"), 'export * from "./x.ts";\nexport type { T } from "./dir";\n');
  writeFileSync(join(d, "x.d.ts"), 'import type { Y } from "./y.js";\n');
  writeFileSync(join(d, "y.d.ts"), "export type Y = 1;\n");
  writeFileSync(join(d, "dir/index.d.ts"), "export type T = 1;\n");
  writeFileSync(join(d, "unused.d.ts"), "export type U = 1;\n");
  assert.deepEqual(dtsClosure(join(d, "lib.d.ts")).map((f) => f.slice(d.length + 1)), ["dir/index.d.ts", "lib.d.ts", "x.d.ts", "y.d.ts"]);
});

test("packageVersion: --version, a v<semver> tag, else the fallback; a clash or non-semver fails", () => {
  assert.equal(packageVersion(["--version", "1.2.3"], {}, "0.1.0"), "1.2.3");
  assert.equal(packageVersion([], { GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "v0.4.0" }, "0.1.0"), "0.4.0");
  assert.equal(packageVersion(["--version", "0.4.0"], { GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "v0.4.0" }, "0.1.0"), "0.4.0");
  assert.equal(packageVersion([], {}, "0.1.0"), "0.1.0");
  assert.equal(packageVersion([], { GITHUB_REF_TYPE: "branch", GITHUB_REF_NAME: "v9.9.9" }, "0.1.0"), "0.1.0");
  assert.throws(() => packageVersion(["--version", "1.2.3"], { GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "v0.4.0" }, "0.1.0"), /NPM_VERSION_MISMATCH/);
  assert.throws(() => packageVersion(["--version", "1.2"], {}, "0.1.0"), /not semver/);
  assert.throws(() => packageVersion([], { GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "v1.2" }, "0.1.0"), /not semver/);
  assert.throws(() => packageVersion(["--version"], {}, "0.1.0"));
});

test("stamp: semver+commit, the bare semver when too long for the ping's check", () => {
  assert.equal(stamp("0.12.3", "a1b2c3d"), "0.12.3+a1b2c3d");
  assert.equal(stamp("0.12.3", "dev"), "0.12.3+dev");
  assert.equal(stamp("10.200.3000-rc.1.xx", "a1b2c3d"), "10.200.3000-rc.1.xx");
  assert.equal(stamp("10.200.3000-rc.1.beta.longer", "a1b2c3d"), "dev");
});
