// A deterministic many-small-boards repo for scripts/layoutbench.ts: no clock, no Math.random.
import type { Facts } from "../src/model/schema.ts";

export interface BenchOpts { folders?: number; minFiles?: number; maxFiles?: number; minDepth?: number; maxDepth?: number; seed?: number }

/** mulberry32: a small seeded PRNG. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Facts for one package `app` of `folders` folders nested `minDepth`-`maxDepth` deep, each with a few files. */
export function syntheticFacts(o: BenchOpts = {}): Facts {
  const { folders = 300, minFiles = 4, maxFiles = 14, minDepth = 6, maxDepth = 10, seed = 1 } = o;
  const rnd = prng(seed), int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const dirs = new Set<string>(), paths = new Set<string>();
  // shared prefixes make boards with several children, not 300 lone chains
  const pool: string[][] = [];
  for (let i = 0; i < folders; i++) {
    const depth = int(minDepth, maxDepth), parts = ["src"];
    const base = pool.length && rnd() < 0.7 ? pool[int(0, pool.length - 1)] : [];
    for (let d = 1; d < depth; d++) parts.push(base[d] && rnd() < 0.6 ? base[d] : `${"abcdefgh"[int(0, 7)]}${int(1, 9)}`);
    pool.push(parts);
    dirs.add(parts.join("/"));
  }
  for (const dir of [...dirs].sort()) {
    const n = int(minFiles, maxFiles);
    for (let i = 0; i < n; i++) paths.add(`${dir}/f${i}.ts`);
  }
  return {
    version: 1, repo: "bench", sha: null, github: null, stores: [], storeUses: [], storeFields: [],
    packages: [{ id: "app", name: "app", dir: "", kind: "web", deps: [] }],
    files: [...paths].sort().map((path) => ({ path, pkg: "app", loc: 10 })),
    imports: [], externals: [], unresolved: [], services: [], serviceUses: [], endpoints: [], calls: [], pages: [], routeFiles: [],
  };
}
