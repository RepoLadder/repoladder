// Usage: npm run motioncheck [-- --page <diagram.html>]
// Checks the board-to-board "shuffle" move (#465, src/viewer/transition.ts) in Playwright Chromium: builds
// test/fixtures/tourapp (no network, no Claude) unless --page is given, moves (by link, as the viewer's own navigation does) between boards that share
// boxes and samples the running animations: shared boxes glide (a `transform` animation), everything else
// only fades, nothing is left running or moved afterwards, and under reduced motion no `transform` plays.
// Prints MOTIONCHECK_OK <n> checks or MOTIONCHECK_FAILED <why> (exit 1).
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type Page = import("playwright").Page;
type Snap = { glide: string[]; fade: string[]; moved: string[]; running: number };

/** Mid-move: which boxes have a transform animation, which elements only fade. */
const sample = (p: Page): Promise<Snap> => p.evaluate(() => {
  const props = (a: Animation) => ((a.effect as KeyframeEffect).getKeyframes() as Keyframe[]).flatMap((k) => Object.keys(k)).filter((k) => !["offset", "easing", "composite", "computedOffset"].includes(k));
  const out: Snap = { glide: [], fade: [], moved: [], running: 0 };
  for (const a of document.getAnimations()) {
    const el = (a.effect as KeyframeEffect).target as Element | null, ps = props(a);
    if (!el || a.playState === "finished") continue;
    out.running++;
    const g = el.closest("g[data-hit]")?.getAttribute("data-hit") ?? el.tagName;
    (ps.includes("transform") ? out.glide : out.fade).push(g);
  }
  return out;
});

const settle = (p: Page) => p.evaluate(() => ({
  left: document.getAnimations().length,
  ghosts: document.querySelectorAll("svg.ghost").length,
  odd: [...document.querySelectorAll<SVGGElement>("svg.board > g")].filter((g) => getComputedStyle(g).opacity !== "1" || !["none", "matrix(1, 0, 0, 1, 0, 0)"].includes(getComputedStyle(g).transform)).length,
}));

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const i = process.argv.indexOf("--page");
  let page = i > 0 ? resolve(process.argv[i + 1]) : "", tmp = "";
  if (!page) {
    tmp = mkdtempSync(join(tmpdir(), "motioncheck-"));
    execFileSync("node", [join(root, "src", "cli.ts"), "build", join(root, "test", "fixtures", "tourapp"), "--default", "--out", tmp], { stdio: "inherit" });
    page = join(tmp, "diagram.html");
  }
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const bad: string[] = [];
  let n = 0;
  const ok = (cond: boolean, why: string) => { n++; if (!cond) bad.push(why); };
  try {
    for (const reducedMotion of ["no-preference", "reduce"] as const) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion });
      const p = await ctx.newPage();
      await p.goto(pathToFileURL(page).href);
      await p.waitForFunction(() => (window as any).__repoladder, null, { timeout: 5000 });
      const ids: string[] = await p.evaluate(() => (window as any).__repoladder.boards);
      const hits = (id: string) => p.evaluate((id) => { (window as any).__repoladder.show(id); return [...document.querySelectorAll("svg.board g[data-hit^='n:']")].map((g) => g.getAttribute("data-hit")!); }, id);
      // the hook's show() ends its move at once, so move the way a link does (a hash change) and sample mid-move
      const move = async (a: string, b: string) => {
        await hits(a);
        await p.waitForTimeout(700);
        await p.evaluate((b) => { location.hash = b === "root" ? "~" : `${b}~`; }, b);
      };
      // a pair of boards with shared boxes where neither is below the other: try them all
      let pair: [string, string] | null = null, shared: string[] = [];
      for (const a of ids) for (const b of ids) {
        if (a === b || pair) continue;
        const A = await hits(a), B = await hits(b), s = A.filter((h) => B.includes(h));
        await move(a, b);
        await p.waitForTimeout(100);
        const snap = await sample(p);
        // a zoom (drill in or out) animates the whole svg: not the move under test
        if (reducedMotion === "reduce" ? snap.running > 0 : snap.glide.length && !snap.glide.includes("svg")) { pair = [a, b]; shared = s; }
        await p.waitForTimeout(900);
      }
      ok(!!pair, `${reducedMotion}: no pair of boards moved with a glide`);
      if (pair) {
        const [a, b] = pair;
        await move(a, b);
        await p.waitForTimeout(100);
        const s = await sample(p);
        if (reducedMotion === "reduce") ok(!s.glide.length, `reduced motion: transform animation on ${s.glide.join(",")}`);
        else {
          ok(shared.length > 0 && s.glide.length > 0, `${a} to ${b}: no shared box glides`);
          ok(s.glide.every((g) => g.startsWith("n:")), `a non-box glides: ${s.glide.join(",")}`);
          ok(s.fade.length > 0, "nothing fades");
        }
        await p.waitForTimeout(900);
        const e = await settle(p);
        ok(e.left === 0 && e.ghosts === 0 && e.odd === 0, `${reducedMotion}: left ${JSON.stringify(e)}`);
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
  process.stdout.write(bad.length ? `MOTIONCHECK_FAILED ${bad.join("; ")}\n` : `MOTIONCHECK_OK ${n} checks\n`);
  if (bad.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
