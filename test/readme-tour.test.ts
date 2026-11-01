import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pngSize } from "../scripts/pngsize.ts";
import { parseArgs, pickHit } from "../scripts/readme-shots.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const MAX_BYTES = 500 * 1024;

/** The text of a `##` section, up to the next `##` heading. */
function section(readme: string, heading: string): string | null {
  const start = readme.indexOf(`\n${heading}\n`);
  if (start < 0) return null;
  const rest = readme.slice(start + heading.length + 2);
  const next = rest.search(/^## /m);
  return next < 0 ? rest : rest.slice(0, next);
}

/** Sentences in prose: sentence-ending punctuation followed by a space or the end, outside code spans. */
function sentences(prose: string): number {
  const bare = prose.replace(/`[^`]*`/g, "x");
  return (bare.match(/[.!?](?=\s|$)/g) ?? []).length;
}

/** One message per problem in the README's Why and What you get sections. */
export function tourProblems(readme: string, base = root): string[] {
  const out: string[] = [];
  const iWhy = readme.indexOf("\n## Why RepoLadder\n"), iGet = readme.indexOf("\n## What you get\n");
  const iGif = readme.indexOf("docs/media/tour.gif"), iReal = readme.indexOf("\n## See it on a real repo\n");
  if (iWhy < 0 || iGet < 0) return ["missing the Why RepoLadder or What you get section"];
  if (!(iGif < iWhy && iWhy < iGet && iGet < iReal)) out.push("sections are out of order (GIF, Why, What you get, See it on a real repo)");
  const why = section(readme, "## Why RepoLadder")!, get = section(readme, "## What you get")!;
  for (const [name, text] of [["Why", why], ["What you get", get]] as const) {
    if (/\b(dial|story)\b/i.test(text)) out.push(`${name} mentions the dial or the story overview`);
  }
  const blocks = get.split(/^### /m).slice(1);
  if (blocks.length < 5) out.push(`expected at least 5 feature blocks, found ${blocks.length}`);
  for (const b of blocks) {
    const title = b.split("\n")[0]!;
    const imgs = [...b.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
    if (imgs.length !== 1) out.push(`${title}: expected one image, found ${imgs.length}`);
    for (const img of imgs) {
      const alt = img.match(/alt="([^"]*)"/)?.[1] ?? "";
      if (!alt.trim()) out.push(`${title}: image has no alt text`);
      const src = img.match(/src="([^"]*)"/)?.[1] ?? "";
      if (!src || !existsSync(join(base, src))) out.push(`${title}: image ${src} does not exist`);
    }
    const prose = b.split("\n").slice(1).join("\n").replace(/<picture>[\s\S]*?<\/picture>|<img\b[^>]*>/g, "").trim();
    const n = sentences(prose);
    if (n !== 2) out.push(`${title}: expected two sentences, found ${n}`);
  }
  return out;
}

const readme = readFileSync(join(root, "README.md"), "utf8");

test("the README has the Why and What you get sections, five feature blocks, one image and two sentences each", () => {
  assert.deepEqual(tourProblems(readme), []);
});

test("README screenshots are wide enough and small enough", () => {
  const dir = join(root, "docs/media");
  for (const f of readdirSync(dir)) {
    if (f === "tour.gif") continue;
    assert.ok(statSync(join(dir, f)).size <= MAX_BYTES, `${f} is over 500 KB`);
    if (f.endsWith(".png")) assert.ok((pngSize(readFileSync(join(dir, f)))?.w ?? 0) >= 800, `${f} is under 800 px wide`);
  }
});

test("the map block has a dark variant", () => {
  assert.match(readme, /<source media="\(prefers-color-scheme: dark\)" srcset="docs\/media\/map-dark\.png">/);
});

test("mutations: a missing image, a third sentence and a missing alt each fail", () => {
  assert.match(tourProblems(readme.replace("docs/media/drill-in.png", "docs/media/nope.png")).join("\n"), /does not exist/);
  assert.match(tourProblems(readme.replace("Each board is kept small enough to take in at once.", "Each board is kept small enough to take in at once. Try it.")).join("\n"), /two sentences, found 3/);
  assert.match(tourProblems(readme.replace(/alt="An arrow selected[^"]*"/, 'alt=""')).join("\n"), /no alt text/);
  assert.match(tourProblems(readme.replace("A newcomer", "The dial lets a newcomer")).join("\n"), /dial or the story/);
});

test("readme-shots parses its options and picks hits by kind", () => {
  const d = parseArgs([], "/r");
  assert.equal(d.diagram, "/r/.gallery/out/repoladder/diagram.html");
  assert.equal(d.out, "/r/docs/media");
  assert.equal(parseArgs(["--out", "x"], "/r").out, "/r/x");
  assert.throws(() => parseArgs(["--out"], "/r"), /needs a value/);
  assert.equal(pickHit(["e:a>b", "n:a", "n:b"], "n"), "n:a");
  assert.equal(pickHit(["n:a"], "e"), undefined);
});
