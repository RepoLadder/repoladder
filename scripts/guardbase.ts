// Usage: npm run guardbase [-- --update] [-- --page <diagram.html>]
// Structure guard for the viewer restyle: measures, in Playwright Chromium on test/fixtures/tourapp (no network), every
// board's fit view at two viewports, every wire's route and the drill-in/out animations, and compares them with
// test/baselines/viewer-structure.json. Pixels may change freely; a deliberate change to timing, routing or fit
// is recorded in the same PR with --update (refused under CI). Prints GUARD_DIFF lines, then GUARD_OK or GUARD_FAILED (exit 1).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compare, refuseUpdate, type Anim, type Structure } from "./guardcompare.ts";

type Page = import("playwright").Page;
const VIEWPORTS = [{ width: 1280, height: 800 }, { width: 390, height: 844 }];
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const BASELINE = join(root, "test", "baselines", "viewer-structure.json");

const hook = (p: Page, id: string) => p.evaluate((id) => (window as any).__repoladder.show(id), id);

/** The board's viewBox once two reads 100 ms apart agree (at most 2 s). */
async function settledView(p: Page): Promise<number[]> {
  let last = "";
  for (let i = 0; i < 20; i++) {
    const now = await p.evaluate(() => document.querySelector("svg.board")?.getAttribute("viewBox") ?? "");
    if (now && now === last) break;
    last = now;
    await p.waitForTimeout(100);
  }
  return last.split(" ").map(Number);
}

const wires = (p: Page): Promise<Record<string, string>> => p.evaluate(() => {
  const seen: Record<string, number> = {}, out: Record<string, string> = {};
  const list = [...document.querySelectorAll("svg.board g.wire[data-hit]")].filter((g) => g.querySelector(":scope > path.line")).map((g) => [g.getAttribute("data-hit")!, g.querySelector(":scope > path.line")!.getAttribute("d") ?? ""] as const);
  for (const [k, d] of list.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    seen[k] = (seen[k] ?? 0) + 1;
    out[seen[k] > 1 ? `${k}#${seen[k]}` : k] = d;
  }
  return out;
});

/** Animations still running mid-move: finite iterations, not finished. */
const running = (p: Page): Promise<Anim[]> => p.evaluate(() => document.getAnimations().filter((a) => a.playState !== "finished").map((a) => (a.effect as KeyframeEffect).getTiming()).filter((t) => Number.isFinite(t.iterations as number))
  .map((t) => ({ duration: Number(t.duration), easing: String(t.easing) })));

const uniq = (l: Anim[]) => [...new Map(l.map((a) => [`${a.duration} ${a.easing}`, a])).values()].sort((a, b) => a.duration - b.duration || a.easing.localeCompare(b.easing));

export async function measure(page: string): Promise<Structure> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const s: Structure = { version: 1, fixture: "tourapp", fit: {}, wires: {}, tour: {}, timing: { in: [], out: [], reduced: { in: [], out: [] } } };
  try {
    for (const [vi, viewport] of VIEWPORTS.entries()) {
      const ctx = await browser.newContext({ viewport, colorScheme: "light" });
      const p = await ctx.newPage();
      await p.goto(pathToFileURL(page).href);
      await p.waitForFunction(() => (window as any).__repoladder, null, { timeout: 5000 });
      await p.evaluate(() => document.fonts.ready);
      const ids: string[] = await p.evaluate(() => (window as any).__repoladder.boards);
      for (const id of ids) {
        await hook(p, id);
        (s.fit[id] ??= {})[`${viewport.width}x${viewport.height}`] = await settledView(p);
        if (vi === 0) s.wires[id] = await wires(p);
      }
      if (vi === 0) s.tour = await p.evaluate(() => ({ ...(window as any).__repoladder.travelTiming }));
      await ctx.close();
    }
    for (const reducedMotion of ["no-preference", "reduce"] as const) {
      const ctx = await browser.newContext({ viewport: VIEWPORTS[0], reducedMotion });
      const p = await ctx.newPage();
      await p.goto(pathToFileURL(page).href);
      await p.waitForFunction(() => (window as any).__repoladder, null, { timeout: 5000 });
      const ids: string[] = await p.evaluate(() => (window as any).__repoladder.boards);
      const go = (id: string) => p.evaluate((id) => { location.hash = `${id}~`; }, id);
      const ins: Anim[] = [], outs: Anim[] = [];
      for (const id of ids.filter((i) => i !== "root")) {
        await hook(p, "root"); await p.waitForTimeout(150);
        await go(id); await p.waitForTimeout(60);
        ins.push(...await running(p));
        await p.waitForTimeout(900);
        await go("root"); await p.waitForTimeout(60);
        outs.push(...await running(p));
        await p.waitForTimeout(900);
      }
      const t = reducedMotion === "reduce" ? s.timing.reduced : s.timing;
      t.in = uniq(ins); t.out = uniq(outs);
      await ctx.close();
    }
  } finally { await browser.close(); }
  return s;
}

async function main() {
  const update = process.argv.includes("--update");
  if (update) { const why = refuseUpdate(process.env); if (why) { process.stdout.write(`GUARD_FAILED ${why}\n`); process.exit(1); } }
  const i = process.argv.indexOf("--page");
  let page = i > 0 ? resolve(process.argv[i + 1]) : "", tmp = "";
  if (!page) {
    tmp = mkdtempSync(join(tmpdir(), "guardbase-"));
    execFileSync("node", [join(root, "src", "cli.ts"), "build", join(root, "test", "fixtures", "tourapp"), "--default", "--out", tmp], { stdio: "inherit" });
    page = join(tmp, "diagram.html");
  }
  try {
    const now = await measure(page);
    if (update) {
      let old: Structure | null = null;
      try { old = JSON.parse(readFileSync(BASELINE, "utf8")); } catch { /* first record */ }
      writeFileSync(BASELINE, JSON.stringify(now, null, 2) + "\n");
      const d = old ? compare(old, now) : [];
      process.stdout.write(`GUARD_UPDATED ${BASELINE}\n${d.map((l) => `  changed: ${l}\n`).join("")}`);
      return;
    }
    const diffs = compare(JSON.parse(readFileSync(BASELINE, "utf8")), now);
    for (const d of diffs) process.stdout.write(`GUARD_DIFF ${d}\n`);
    const n = Object.values(now.fit).reduce((a, v) => a + Object.keys(v).length, 0) + Object.values(now.wires).reduce((a, v) => a + Object.keys(v).length, 0) + 4;
    process.stdout.write(diffs.length ? `GUARD_FAILED ${diffs.length} differences\n` : `GUARD_OK ${n} checks\n`);
    if (diffs.length) process.exitCode = 1;
  } finally { if (tmp) rmSync(tmp, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
