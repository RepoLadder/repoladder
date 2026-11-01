// Usage: npm run zoomcheck [-- --page <diagram.html>]
// Checks the floating zoom control in Playwright Chromium on test/fixtures/tourapp (built offline unless --page is given),
// at 1280x800 and 390x844: the +, - and F keys match the buttons, do nothing with Ctrl or Meta held, while typing in search,
// or (F) at the fit or during a tour; and the strip sits bottom right on a wide window and top right on a phone.
// Prints ZOOMCHECK_OK <n> checks or ZOOMCHECK_FAILED <why> (exit 1).
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type Page = import("playwright").Page;

const vbw = (p: Page) => p.evaluate(() => Number(document.querySelector("svg.board")!.getAttribute("viewBox")!.split(/\s+/)[2]));
const frame = (p: Page) => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const hidden = (p: Page) => p.evaluate(() => document.getElementById("zfit")!.hidden);

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const i = process.argv.indexOf("--page");
  let page = i > 0 ? resolve(process.argv[i + 1]) : "", tmp = "";
  if (!page) {
    tmp = mkdtempSync(join(tmpdir(), "zoomcheck-"));
    execFileSync("node", [join(root, "src", "cli.ts"), "build", join(root, "test", "fixtures", "tourapp"), "--default", "--out", tmp], { stdio: "inherit" });
    page = join(tmp, "diagram.html");
  }
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  let n = 0;
  const fails: string[] = [];
  const ok = (cond: boolean, why: string) => { n++; if (!cond) fails.push(why); };
  const close = (a: number, b: number) => Math.abs(a - b) < 0.01 * Math.max(a, b);
  const open = async (width: number, height: number) => {
    const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
    const p = await ctx.newPage();
    await p.goto(pathToFileURL(page).href);
    await p.waitForFunction(() => (window as any).__repoladder, null, { timeout: 5000 });
    await frame(p);
    return p;
  };
  try {
    const p = await open(1280, 800);
    const fit = await vbw(p);
    ok(await hidden(p), "Reframe is hidden at the fit");
    await p.keyboard.press("F"); await frame(p);
    ok(close(await vbw(p), fit), "F at the fit changed the view");
    await p.keyboard.press("+"); await frame(p);
    const zin = await vbw(p);
    ok(close(zin, fit / 1.25), `+ gave ${zin}, wanted ${fit / 1.25}`);
    await p.keyboard.press("-"); await frame(p);
    ok(close(await vbw(p), fit), "- did not undo +");
    await p.click("#zin"); await frame(p);
    ok(close(await vbw(p), zin), "the button and + differ");
    await p.keyboard.press("-"); await p.keyboard.press("-"); await frame(p);
    const out = await vbw(p);
    ok(out > fit * 0.99, "- twice did not zoom out");
    await p.keyboard.press("+"); await frame(p);
    await p.keyboard.press("F"); await frame(p);
    ok(close(await vbw(p), fit) && await hidden(p), "F did not restore the fit");
    const before = await vbw(p);
    for (const mod of ["Control", "Meta"]) {
      await p.keyboard.down(mod); await p.keyboard.press("+"); await p.keyboard.press("-"); await p.keyboard.up(mod);
    }
    await frame(p);
    ok(close(await vbw(p), before), "Ctrl or Meta + key zoomed");
    await p.keyboard.press("/"); await p.keyboard.type("f+-"); await frame(p);
    ok(close(await vbw(p), before) && (await p.inputValue(".search input")) === "f+-", "typing in search zoomed or lost text");
    await p.keyboard.press("Escape");
    const z = await p.evaluate(() => { const r = document.querySelector(".zoom")!.getBoundingClientRect(), c = document.getElementById("canvas")!.getBoundingClientRect(); return { r, c }; });
    ok(z.r.top > z.c.top + z.c.height / 2 && z.r.right <= z.c.right, "the strip is not at the lower right on a wide window");
    const side = await p.evaluate(() => { const a = document.querySelector("main > aside")!.getBoundingClientRect(), r = document.querySelector(".zoom")!.getBoundingClientRect(); return a.width > 0 && getComputedStyle(document.querySelector("main > aside")!).display !== "none" ? r.right <= a.left + 1 : true; });
    ok(side, "the strip sits under the inspector");
    await p.click("#zexp"); await frame(p);
    const m = await p.evaluate(() => { const r = document.querySelector(".xmenu")!.getBoundingClientRect(), b = document.getElementById("zexp")!.getBoundingClientRect(); return r.top >= b.bottom - 1 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1 && r.left >= 0; });
    ok(m, "the export menu does not hang under the top-bar button inside the window");
    await p.keyboard.press("Escape");
    const tour = await p.evaluate(() => { const t = document.querySelector<HTMLElement>("[data-tour]"); if (t) (window as any).__repoladder.tour(t.dataset.tour, 0); return !!t; });
    if (tour && await p.waitForSelector(".walk-card", { timeout: 3000 }).then(() => true, () => false)) {
      await frame(p);
      const w = await vbw(p);
      await p.keyboard.press("F"); await frame(p);
      ok(close(await vbw(p), w), "F acted during a tour");
      await p.keyboard.press("+"); await frame(p);
      ok((await vbw(p)) < w * 0.99, "+ did not zoom during a tour");
      const s = await p.evaluate(() => { const r = document.querySelector(".zoom")!.getBoundingClientRect(), k = document.querySelector(".walk-card")!.getBoundingClientRect(); return r.bottom <= k.top + 1; });
      ok(s, "the strip overlaps the tour card");
    }
    await p.context().close();

    const ph = await open(390, 844);
    const r = await ph.evaluate(() => { const r = document.querySelector(".zoom")!.getBoundingClientRect(); return { top: r.top, right: r.right, h: innerHeight, w: innerWidth }; });
    ok(r.top < r.h / 3 && r.right <= r.w, "the strip is not at the top right on a phone");
    await ph.context().close();
  } finally {
    await browser.close();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
  process.stdout.write(fails.length ? `ZOOMCHECK_FAILED ${fails.join("; ")}\n` : `ZOOMCHECK_OK ${n} checks\n`);
  if (fails.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
