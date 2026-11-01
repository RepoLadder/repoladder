// Classifies a release against the latest version on npm, so publish.yml can send only a major to the
// reviewer-gated environment.
//
//   node scripts/versionbump.ts "<latest or empty>" "<version>"
//
// Prints major, minor, patch, prerelease, first or none; exits 1 on a version that is not semver.
import { pathToFileURL } from "node:url";

export type Bump = "major" | "minor" | "patch" | "prerelease" | "first" | "none";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/;

function parse(v: string, what: string): { n: [number, number, number]; pre: boolean } {
  const m = SEMVER.exec(v);
  if (!m) throw new Error(`${what} version "${v}" is not a semver version`);
  return { n: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] !== undefined };
}

export function bumpKind(latest: string, next: string): Bump {
  const n = parse(next, "next");
  if (latest === "") return "first";
  const l = parse(latest, "latest");
  if (n.pre) return "prerelease";
  if (n.n[0] > l.n[0]) return "major";
  if (n.n[0] < l.n[0]) return "none";
  if (n.n[1] !== l.n[1]) return n.n[1] > l.n[1] ? "minor" : "none";
  return n.n[2] > l.n[2] ? "patch" : "none";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [latest, next, ...rest] = process.argv.slice(2);
  try {
    if (latest === undefined || next === undefined || rest.length) throw new Error('usage: node scripts/versionbump.ts "<latest or empty>" "<version>"');
    console.log(bumpKind(latest, next));
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
