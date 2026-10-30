// The one cluster-naming rule (#283): a file names a cluster only if most of the cluster imports it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GENERIC, clusterBasis, commonDir, dominantFile, folderName } from "../src/model/clustername.ts";

const imp = (pairs: [string, string][]) => pairs.map(([from, to]) => ({ from, to }));
const d = (s: string) => `src/feat/${s}.ts`;

test("dominantFile: a file more than half the others import names the cluster", () => {
  const files = ["a", "b", "c", "d", "e"].map(d);
  // 3 of the 4 others import a
  assert.equal(dominantFile(files, imp([[d("b"), d("a")], [d("c"), d("a")], [d("d"), d("a")]])), d("a"));
  // 2 of 4 is not more than half
  assert.equal(dominantFile(files, imp([[d("b"), d("a")], [d("c"), d("a")], [d("d"), d("e")]])), undefined);
});

test("dominantFile: importers are counted once each, and imports from outside don't count", () => {
  const files = ["a", "b", "c", "d", "e"].map(d);
  const twice: [string, string][] = [[d("b"), d("a")], [d("b"), d("a")], [d("b"), d("a")], [d("c"), d("a")]];
  assert.equal(dominantFile(files, imp(twice)), undefined);
  const outside: [string, string][] = [[d("b"), d("a")], [d("c"), d("a")], ["src/x.ts", d("a")], ["src/y.ts", d("a")], [d("a"), d("a")]];
  assert.equal(dominantFile(files, imp(outside)), undefined);
});

test("dominantFile: a named file beats a generic one, then more importers, then the alphabet", () => {
  const files = ["index", "zeta", "alpha", "beta"].map(d);
  const all = (to: string): [string, string][] => files.filter((f) => f !== to).map((f) => [f, to]);
  // index and zeta both imported by all others: zeta, since index says nothing
  assert.equal(dominantFile(files, imp([...all(d("index")), ...all(d("zeta"))])), d("zeta"));
  // alpha by all 3, zeta by 2 of 3: more importers wins over the alphabet
  assert.equal(dominantFile(files, imp([...all(d("alpha")), [d("index"), d("zeta")], [d("beta"), d("zeta")]])), d("alpha"));
  // a tie: alphabetical
  assert.equal(dominantFile(files, imp([...all(d("zeta")), ...all(d("beta"))])), d("beta"));
});

test("dominantFile: in a two-file cluster, the one the other imports", () => {
  assert.equal(dominantFile([d("a"), d("b")], imp([[d("b"), d("a")]])), d("a"));
  assert.equal(dominantFile([d("a"), d("b")], []), undefined);
});

test("clusterBasis: a dominant generic file says nothing, so the folder names the cluster", () => {
  const files = ["index", "ar", "be", "fr"].map((s) => `src/v4/locales/${s}.ts`);
  const imports = imp(files.slice(1).map((f) => [f, files[0]] as [string, string]));
  assert.equal(dominantFile(files, imports), files[0]);
  assert.deepEqual(clusterBasis(files, imports), { hub: undefined, folder: "Locales" });
  assert.deepEqual(clusterBasis([d("a"), d("b"), d("c")], imp([[d("b"), d("a")], [d("c"), d("a")]])), { hub: d("a"), folder: "Feat" });
});

test("folderName and commonDir: the members' deepest shared folder", () => {
  assert.equal(folderName(["src/v4/locales/ar.ts", "src/v4/locales/be.ts"]), "Locales");
  assert.equal(folderName(["src/v4/locales/ar.ts", "src/v4/core/util.ts"]), "V4");
  assert.equal(folderName(["a.ts", "src/b.ts"]), "");
  assert.equal(commonDir(["src/a/x.ts", "src/a/b/y.ts"]), "src/a");
  assert.ok(GENERIC.test("index") && GENERIC.test("types") && !GENERIC.test("router"));
});
