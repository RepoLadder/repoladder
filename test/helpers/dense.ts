// A dense leaf fixture shared by the profile tests: 30 files with a hub, a chain, Stripe and Firestore users, and a `lib` part.
import type { Facts, Grouping } from "../../src/model/schema.ts";

export const p = (leaf: string, i: number) => `${leaf}/f${String(i).padStart(2, "0")}.ts`;

/**
 * "app": 30 files, f00 imported by all (a hub), a chain, a few calls, Firestore used by 6 files
 * (more than the old "used throughout" limit) and a second service; "lib": 3 files that app imports.
 */
export function dense(): { facts: Facts; authored: Grouping } {
  const files = [...Array.from({ length: 30 }, (_, i) => ({ path: p("app", i), pkg: "app", loc: 10 })), ...[0, 1, 2].map((i) => ({ path: p("lib", i), pkg: "app", loc: 5 }))];
  const imp = (from: string, to: string, line = 1) => ({ from, to, line, kind: "static" as const });
  const imports = [
    ...Array.from({ length: 29 }, (_, i) => imp(p("app", i + 1), p("app", 0))),
    ...Array.from({ length: 28 }, (_, i) => imp(p("app", i + 2), p("app", i + 1), 2)),
    imp(p("app", 1), p("lib", 0)), imp(p("app", 29), p("lib", 1)), imp(p("lib", 2), p("app", 3)),
  ];
  const serviceUses = [0, 5, 9, 14, 20, 28].map((i) => ({ from: p("app", i), service: "stripe", spec: "stripe", line: 3 }));
  const storeUses = [1, 2, 3, 4, 25, 29].map((i) => ({ store: "firestore", collection: "Orders", op: "read" as const, file: p("app", i), line: 4 }));
  const facts = {
    version: 1, repo: "dense", sha: null, github: null, packages: [{ id: "app", name: "app", dir: "", kind: "web", deps: [] }], files, imports, externals: [], unresolved: [],
    services: [{ id: "stripe", name: "Stripe" }], serviceUses, stores: [{ id: "firestore", name: "Firestore" }], storeUses, storeFields: [], endpoints: [], calls: [], pages: [], routeFiles: [],
  } as unknown as Facts;
  const authored: Grouping = { version: 1, summary: "", children: [{ id: "app", name: "App", summary: "", files: ["app/**"] }, { id: "lib", name: "Lib", summary: "", files: ["lib/**"] }] };
  return { facts, authored };
}
