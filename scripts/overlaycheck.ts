// Usage: npm run overlaycheck
// Checks the `overlay` build option in Playwright Chromium: builds test/fixtures/deep with an overlay (no network, no Claude),
// then checks that marks show on the root board and, drawn lazily, on a board three rungs down; that they survive going back,
// that the Marks toggle hides and shows them, that the parts list jumps to its box, that a 390px phone has no horizontal
// overflow and light and dark both draw the marks. Screenshots go to .gallery/shots/overlay/.
// Prints OVERLAYCHECK_OK <n> checks or OVERLAYCHECK_FAILED <why> (exit 1).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { listAllPaths } from "../src/analyze/files.ts";
import { buildFromFiles } from "../src/lib.ts";

type Page = import("playwright").Page;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OVERLAY = {
  // root board: api, app, svc-stripe
  changed: ["n:api", "n:pdf"],
  added: ["n:svc-stripe", "n:inv-store"],
  addedEdges: ["e:app>svc-stripe", "e:inv-store>pdf"],
  removedEdges: ["e:api>svc-stripe", "e:pdf>inv-store"],
  parts: [{ id: "n:api", files: 1 }, { id: "n:pdf", files: 4 }],
};

const style = (p: Page, hit: string, sel: string, prop: string) => p.evaluate(([hit, sel, prop]) => {
  const g = [...document.querySelectorAll<SVGGElement>("svg.board g[data-hit]")].find((x) => x.dataset.hit === hit);
  const t = g && (sel ? g.querySelector(sel) : g);
  return t ? getComputedStyle(t).getPropertyValue(prop) : null;
}, [hit, sel, prop]);
const cls = (p: Page, hit: string) => p.evaluate((hit) => [...document.querySelectorAll<SVGGElement>("svg.board g[data-hit]")].filter((x) => x.dataset.hit === hit).map((x) => x.getAttribute("class") ?? ""), hit);
const removed = (p: Page) => p.evaluate(() => [...document.querySelectorAll("svg.board path.ov-removed")].map((x) => ({ label: x.getAttribute("aria-label"), dash: getComputedStyle(x).strokeDasharray, shown: getComputedStyle(x).display !== "none" })));
const go = async (p: Page, hash: string) => { await p.evaluate((h) => { location.hash = h; }, hash); await p.waitForTimeout(1200); };

async function main() {
  const d = join(root, "test", "fixtures", "deep");
  const files = new Map(listAllPaths(d).filter((f) => existsSync(join(d, f))).map((f) => [f, readFileSync(join(d, f), "utf8")] as [string, string]));
  const built = await buildFromFiles(files, { grouping: JSON.parse(files.get("grouping.json")!), overlay: OVERLAY });
  if (!built.ok) throw new Error(built.message);
  const tmp = mkdtempSync(join(tmpdir(), "overlaycheck-"));
  const page = join(tmp, "diagram.html");
  writeFileSync(page, built.html);
  const shots = join(root, ".gallery", "shots", "overlay");
  mkdirSync(shots, { recursive: true });
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const bad: string[] = [];
  let n = 0;
  const ok = (cond: boolean, why: string) => { n++; if (!cond) bad.push(why); };
  try {
    for (const scheme of ["light", "dark"] as const) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: scheme });
      const p = await ctx.newPage();
      const errors: string[] = [];
      p.on("pageerror", (e) => errors.push(String(e)));
      await p.goto(pathToFileURL(page).href);
      await p.waitForFunction(() => (window as any).__repoladder, null, { timeout: 5000 });
      await p.waitForTimeout(600);

      // the root board
      const plain = await style(p, "n:app", ".body", "stroke-width");
      ok((await cls(p, "n:api"))[0]?.includes("ov-changed") === true, `${scheme}: api is not marked changed`);
      ok(parseFloat((await style(p, "n:api", ".body", "stroke-width"))!) > parseFloat(plain!), `${scheme}: a changed box is not heavier than a plain one`);
      ok((await style(p, "n:api", ".body", "stroke")) !== (await style(p, "n:app", ".body", "stroke")), `${scheme}: a changed box keeps the default stroke`);
      ok((await cls(p, "n:svc-stripe"))[0]?.includes("ov-new") === true, `${scheme}: svc-stripe is not marked new`);
      ok(await p.evaluate(() => [...document.querySelectorAll("svg.board text.ov-tag")].some((t) => t.textContent === "New")), `${scheme}: no New badge`);
      const added = await cls(p, "e:app>svc-stripe");
      ok(added.length > 0 && added.every((c) => c.includes("ov-added")), `${scheme}: the added connection is not marked on every part`);
      ok(parseFloat((await style(p, "e:app>svc-stripe", ".line", "stroke-width"))!) > parseFloat((await style(p, "e:app>api", ".line", "stroke-width"))!), `${scheme}: an added connection is not heavier`);
      const r = await removed(p);
      ok(r.length === 1 && /^Removed connection from API server to /.test(r[0].label ?? "") && r[0].dash !== "none" && r[0].shown, `${scheme}: removed connection on the root board: ${JSON.stringify(r)}`);
      await p.screenshot({ path: join(shots, `desktop-${scheme}.png`) });

      // a board three rungs down is drawn lazily
      await go(p, "invoices~");
      ok(await p.evaluate(() => document.querySelector("svg.board g[data-hit='n:inv-store']") !== null), `${scheme}: did not reach the invoices board`);
      ok((await cls(p, "n:pdf"))[0]?.includes("ov-changed") === true && (await cls(p, "n:inv-store"))[0]?.includes("ov-new") === true, `${scheme}: child board boxes are not marked`);
      ok((await cls(p, "e:inv-store>pdf")).some((c) => c.includes("ov-added")), `${scheme}: child board connection is not marked`);
      ok((await removed(p)).length === 1, `${scheme}: child board has no removed connection`);
      if (scheme === "light") await p.screenshot({ path: join(shots, "child-light.png") });

      // and back
      await go(p, "root~");
      ok((await cls(p, "n:api"))[0]?.includes("ov-changed") === true && (await removed(p)).length === 1, `${scheme}: marks are gone after going back`);

      // the toggle
      await p.click(".ov-toggle");
      ok(await p.evaluate(() => document.getElementById("stage")!.classList.contains("ov-off") && document.querySelector(".ov-toggle")!.getAttribute("aria-pressed") === "false"), `${scheme}: the toggle does not switch the marks off`);
      ok((await style(p, "n:api", ".body", "stroke-width")) === plain && (await removed(p)).every((x) => !x.shown), `${scheme}: marks still show when off`);
      await p.click(".ov-toggle");
      ok(parseFloat((await style(p, "n:api", ".body", "stroke-width"))!) > parseFloat(plain!), `${scheme}: marks do not come back`);

      // the parts list
      await p.click(".ov-legend summary");
      ok(await p.evaluate(() => [...document.querySelectorAll(".ov-parts a")].map((a) => `${a.textContent}|${a.getAttribute("href")}`).join() === "API server|#api,PDF generation|#pdf"), `${scheme}: parts list`);
      await p.click(".ov-parts a[href='#api']");
      await p.waitForTimeout(900);
      ok((await cls(p, "n:api")).some((c) => /\bsel\b/.test(c)), `${scheme}: the parts link does not select its box`);
      ok(errors.length === 0, `${scheme}: page errors ${errors.join(" | ")}`);
      await ctx.close();
    }
    // a phone
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const p = await ctx.newPage();
    await p.goto(pathToFileURL(page).href);
    await p.waitForFunction(() => (window as any).__repoladder, null, { timeout: 5000 });
    await p.waitForTimeout(600);
    await p.tap(".ov-legend summary");
    const m = await p.evaluate(() => {
      const l = document.querySelector(".ov-legend")!.getBoundingClientRect(), s = document.querySelector(".ov-legend summary")!.getBoundingClientRect();
      return { overflow: document.documentElement.scrollWidth - window.innerWidth, open: (document.querySelector(".ov-legend") as HTMLDetailsElement).open, left: l.left, right: l.right, tall: s.height };
    });
    ok(m.overflow <= 0, `phone: horizontal overflow ${m.overflow}px`);
    ok(m.open && m.left >= 0 && m.right <= 390, `phone: the legend does not fit (${m.left}..${m.right})`);
    ok(m.tall >= 44, `phone: summary is ${m.tall}px tall`);
    await p.screenshot({ path: join(shots, "phone.png") });
    await ctx.close();
  } finally {
    await browser.close();
    rmSync(tmp, { recursive: true, force: true });
  }
  process.stdout.write(bad.length ? `OVERLAYCHECK_FAILED ${bad.join("; ")}\n` : `OVERLAYCHECK_OK ${n} checks\n`);
  if (bad.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
