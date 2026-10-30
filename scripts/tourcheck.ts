// Usage: npm run tourcheck [-- --page <diagram.html>]
// Checks the rule "a tour only lights what the board already draws" (#394, docs/tours-v2.md) in Playwright
// Chromium: builds test/fixtures/tourapp (no network, no Claude) unless --page is given, plays every step of
// every tour, and after each step asserts that no .tour-tmp element exists and that every arrow and box drawn
// was already on that board, at that dial stop, before the tour began (a second page shows the board untouched).
// Prints TOURCHECK_VIOLATION <tour> <step> <what> per failure, then TOURCHECK_OK <n> steps or TOURCHECK_FAILED (exit 1).
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type Page = import("playwright").Page;
type Context = import("playwright").BrowserContext;

/** What a step left on the board: the drawn hits, the dial stop, the board's hash, and anything tmp. */
export const stepState = (p: Page) => p.evaluate(() => ({
  hash: location.hash,
  stop: document.querySelector<HTMLElement>("button[data-stop][aria-pressed='true']")?.dataset.stop ?? "default",
  hits: [...document.querySelectorAll<SVGGElement>("svg.board g[data-hit]")].map((g) => g.dataset.hit!),
  tmp: document.querySelectorAll(".tour-tmp").length,
  now: [...document.querySelectorAll<SVGGElement>("svg.board g.wk-now[data-hit]")].map((g) => g.dataset.hit!),
}));
export type StepState = Awaited<ReturnType<typeof stepState>>;

/**
 * The same diagram on a page that never plays a tour: what each board draws at each dial stop. A step
 * is clean when what it shows equals what some untouched board draws at that stop (the viewer does not
 * expose the board it shows; the hash is not kept in step with a tour's moves).
 */
export class Baseline {
  private seen = new Map<string, Promise<Set<string>[]>>();
  private page: Promise<Page>;
  private url: string;
  constructor(ctx: Context, url: string) { this.url = url; this.page = ctx.newPage(); }
  private async drawn(stop: string): Promise<Set<string>[]> {
    const p = await this.page;
    await p.goto(this.url);
    await p.waitForFunction(() => (window as any).__repoladder, null, { timeout: 5000 });
    const ids: string[] = await p.evaluate(() => (window as any).__repoladder.boards);
    const out: Set<string>[] = [];
    for (const id of ids) {
      await p.evaluate(([id, stop]) => { (window as any).__repoladder.show(id); return stop === "default" ? true : (window as any).__repoladder.stop(stop, id); }, [id, stop] as const);
      await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      out.push(new Set((await stepState(p)).hits));
    }
    return out;
  }
  /** The step's problems: a .tour-tmp, or drawn elements no untouched board has (the closest board's difference). */
  async breaches(s: StepState): Promise<string[]> {
    if (!this.seen.has(s.stop)) this.seen.set(s.stop, this.drawn(s.stop));
    const boards = await this.seen.get(s.stop)!, mine = new Set(s.hits);
    const diff = (b: Set<string>) => [...mine].filter((h) => !b.has(h));
    const best = boards.map(diff).sort((x, y) => x.length - y.length)[0] ?? [...mine];
    const same = boards.some((b) => b.size === mine.size && !diff(b).length);
    return [
      ...(s.tmp ? [`${s.tmp} .tour-tmp element(s)`] : []),
      ...(same ? [] : best.length ? best.map((h) => `new element ${h}`) : ["board differs from every untouched board"]),
    ];
  }
  async close(): Promise<void> { await (await this.page).close(); }
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const i = process.argv.indexOf("--page");
  let page = i > 0 ? resolve(process.argv[i + 1]) : "", tmp = "";
  if (!page) {
    tmp = mkdtempSync(join(tmpdir(), "tourcheck-"));
    execFileSync("node", [join(root, "src", "cli.ts"), "build", join(root, "test", "fixtures", "tourapp"), "--default", "--out", tmp], { stdio: "inherit" });
    page = join(tmp, "diagram.html");
  }
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  let steps = 0, bad = 0;
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    const p = await ctx.newPage(), url = pathToFileURL(page).href, base = new Baseline(ctx, url);
    await p.goto(url);
    await p.waitForFunction(() => (window as any).__repoladder, null, { timeout: 5000 });
    if (!(await p.evaluate(() => (window as any).__repoladder.features?.dial))) { console.error("This page was built without the detail dial: build with REPOLADDER_DIAL=1"); process.exit(1); }
    const ids: string[] = await p.evaluate(() => (window as any).__repoladder.boards);
    const tours = new Map<string, { id: string; board?: string }>();
    for (const id of ids) {
      const t = await p.evaluate((id) => { (window as any).__repoladder.show(id); return [...document.querySelectorAll<HTMLElement>("[data-tour]")].map((e) => e.dataset.tour!); }, id);
      for (const x of t) tours.set(x[0] === "@" ? `${id}/${x}` : x, x[0] === "@" ? { id: x, board: id } : { id: x });
    }
    for (const [name, { id, board }] of tours) {
      await p.evaluate(([id, board]) => { if (board) (window as any).__repoladder.show(board); (window as any).__repoladder.tour(id, 0); }, [id, board] as const);
      if (!(await p.waitForSelector(".walk-card", { timeout: 3000 }).then(() => true, () => false))) { process.stdout.write(`TOURCHECK_VIOLATION ${name} 0 tour did not play\n`); bad++; continue; }
      const n = await p.locator(".tour-dots i").count();
      for (let k = 0; k < n; k++) {
        await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        steps++;
        for (const what of await base.breaches(await stepState(p))) { bad++; process.stdout.write(`TOURCHECK_VIOLATION ${name} ${k + 1} ${what}\n`); }
        await p.evaluate(() => document.querySelector<HTMLElement>('[data-tour-step="1"]')!.click());
      }
      await p.evaluate(() => (window as any).__repoladder.show((window as any).__repoladder.boards[0]));
    }
    if (!steps) { bad++; process.stdout.write("TOURCHECK_VIOLATION * * no tour played\n"); }
  } finally {
    await browser.close();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
  process.stdout.write(bad ? `TOURCHECK_FAILED ${bad} violation(s)\n` : `TOURCHECK_OK ${steps} steps\n`);
  if (bad) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
