// Captures the README's feature screenshots from the built map of this repo (the one the tour GIF is recorded from).
//
//   REPOLADDER_BRAND_NAME=RepoLadder npm run gallery -- --only repoladder --title RepoLadder   # builds .gallery/out/repoladder/diagram.html
//   npm run readme-shots                    # writes docs/media/*.png and docs/media/export-board.svg
//   npm run readme-shots -- --diagram <diagram.html> --out <dir>
//
// Shots (1280 by 800, scale 1): map-light, map-dark, drill-in, trace-arrow, tour-step; the export block's SVG comes from
// `repoladder export` on the same build. Nothing under .gallery/ is committed.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface Options { diagram: string; out: string }
export const SHOTS = ["map-light.png", "map-dark.png", "drill-in.png", "trace-arrow.png", "tour-step.png"] as const;
export const EXPORT_FILE = "export-board.svg";
export const MAX_KB = 500;

export function parseArgs(argv: string[], base = root): Options {
  const flag = (name: string, d: string) => { const i = argv.indexOf(`--${name}`); if (i < 0) return d; const v = argv[i + 1]; if (!v || v.startsWith("--")) throw new Error(`--${name} needs a value`); return v; };
  return { diagram: resolve(base, flag("diagram", ".gallery/out/repoladder/diagram.html")), out: resolve(base, flag("out", "docs/media")) };
}

/** The first data-hit of a kind: hits look like `n:<id>` (a box) or `e:<a>><b>` (an arrow). */
export function pickHit(hits: string[], kind: "n" | "e"): string | undefined {
  return hits.find((h) => h.startsWith(`${kind}:`));
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  if (!existsSync(opt.diagram)) throw new Error(`${opt.diagram} not found: run \`npm run gallery -- --only repoladder --title RepoLadder\` first, or pass --diagram`);
  mkdirSync(opt.out, { recursive: true });
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const shoot = async (theme: "light" | "dark", name: string, act: (p: import("playwright").Page) => Promise<void>) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, colorScheme: theme, reducedMotion: "no-preference" });
    const page = await ctx.newPage();
    await page.goto(pathToFileURL(opt.diagram).href);
    await page.waitForFunction(() => (window as any).__repoladder, null, { timeout: 10_000 });
    await page.evaluate(async () => { await document.fonts.ready; });
    await page.mouse.move(1278, 798);
    await act(page);
    await wait(2500); // let transitions settle
    writeFileSync(join(opt.out, name), await page.screenshot({ animations: "disabled", caret: "hide" }));
    await ctx.close();
    process.stdout.write(`${join(opt.out, name)}\n`);
  };
  const hits = (p: import("playwright").Page) => p.evaluate(() => [...document.querySelectorAll<SVGGElement>("svg.board g[data-hit]")].map((g) => g.dataset.hit!));
  const fire = (p: import("playwright").Page, hit: string, type: "click" | "dblclick") => p.evaluate(({ hit, type }) => {
    const g = [...document.querySelectorAll<SVGGElement>("svg.board g[data-hit]")].find((e) => e.dataset.hit === hit);
    g?.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
    return !!g;
  }, { hit, type });
  try {
    await shoot("light", "map-light.png", async () => {});
    await shoot("dark", "map-dark.png", async () => {});
    await shoot("light", "drill-in.png", async (p) => {
      const hit = pickHit(await hits(p), "n");
      if (!hit || !(await fire(p, hit, "dblclick"))) throw new Error("no box to open on the top board");
    });
    await shoot("light", "trace-arrow.png", async (p) => {
      const hit = pickHit(await hits(p), "e");
      if (!hit || !(await fire(p, hit, "click"))) throw new Error("no arrow to select on the top board");
    });
    await shoot("light", "tour-step.png", async (p) => {
      const id: string | undefined = await p.evaluate(() => (window as any).__repoladder.tours?.()[0]?.id);
      if (!id) throw new Error("the map has no tours");
      await p.evaluate((t) => (window as any).__repoladder.tour(t, 0), id);
      await p.waitForSelector(".walk-card .tour-dots i", { timeout: 10_000 });
      await p.locator(".walk-card [data-tour-step='1']").click();
    });
  } finally {
    await browser.close();
  }
  const built = dirname(opt.diagram);
  execFileSync(process.execPath, [join(root, "src/cli.ts"), "export", root, "--out", built, "--board", "root", "--theme", "light"], { stdio: "inherit" });
  copyFileSync(join(built, "export", "root-light.svg"), join(opt.out, EXPORT_FILE));
  process.stdout.write(`${join(opt.out, EXPORT_FILE)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
