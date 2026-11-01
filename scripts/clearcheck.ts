// Usage: npm run clearcheck [-- --measure]
// Checks the full-window canvas (src/viewer/canvas.css, dock.ts, region.ts) in Playwright Chromium: builds
// test/fixtures/tourapp and checkin offline; in light and dark, at 1280x800 and 390x844 (and embedded), shows every
// board and, once the fit settles, asserts that the canvas is the window (not embedded), that no box sits under the
// floating header, the side panel or a corner control, and that the saved SVG has no dot grid or dock variable.
// Prints CLEARCHECK_OK <n> or UNCLEAR <fixture> <board> <mode> <element> lines and CLEARCHECK_FAILED (exit 1).
// `--measure` prints every UNCLEAR as KNOWN lines, to list the boards that were already covered before a change.
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Boards that already had a box under a corner control before the full-window canvas (measured on the base): `fixture/board/element`. */
const KNOWN = new Set<string>([]);

const FIXTURES = ["tourapp", "checkin"];
const MODES = [
  { name: "wide", viewport: { width: 1280, height: 800 }, query: "" },
  { name: "phone", viewport: { width: 390, height: 844 }, query: "" },
  { name: "embed", viewport: { width: 1280, height: 800 }, query: "?embed=1" },
];
const OVER = ["header", "main > aside", ".zoom", ".dial", ".canvas > .hist"];

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."), measure = process.argv.includes("--measure");
  const tmp = mkdtempSync(join(tmpdir(), "clearcheck-"));
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const bad: string[] = [];
  let n = 0;
  try {
    for (const fx of FIXTURES) {
      const out = join(tmp, fx);
      execFileSync("node", [join(root, "src", "cli.ts"), "build", join(root, "test", "fixtures", fx), "--default", "--out", out], { stdio: "inherit" });
      for (const scheme of ["light", "dark"] as const) for (const m of MODES) {
        const ctx = await browser.newContext({ viewport: m.viewport, colorScheme: scheme, reducedMotion: "reduce" });
        const p = await ctx.newPage();
        await p.goto(pathToFileURL(join(out, "diagram.html")).href + m.query);
        await p.waitForFunction(() => (window as any).__repoladder, null, { timeout: 5000 });
        const ids: string[] = await p.evaluate(() => (window as any).__repoladder.boards);
        for (const id of ids) {
          await p.evaluate((id) => (window as any).__repoladder.show(id), id);
          // let the fit settle: two animation frames and two equal viewBox reads
          let was = "";
          for (let k = 0; k < 20; k++) {
            await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
            const now = await p.evaluate(() => document.querySelector("svg.board")!.getAttribute("viewBox")!);
            if (now === was) break;
            was = now;
          }
          const mode = `${m.name}-${scheme}`;
          const res = await p.evaluate((over) => {
            const rect = (e: Element) => e.getBoundingClientRect();
            const c = rect(document.getElementById("canvas")!);
            const hits = [...document.querySelectorAll("svg.board g[data-hit^='n:']")].map((g) => rect(g));
            const hit = (e: Element) => { const r = rect(e); return !!r.width && getComputedStyle(e).visibility !== "hidden" && hits.some((b) => b.width && b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top); };
            return { canvas: [c.left, c.top, c.width, c.height], covered: over.filter((s) => { const e = document.querySelector(s); return !!e && hit(e); }), win: [innerWidth, innerHeight] };
          }, OVER);
          if (m.name !== "embed") {
            n++;
            if (res.canvas.join() !== [0, 0, ...res.win].join()) bad.push(`UNCLEAR ${fx} ${id} ${mode} canvas ${res.canvas.join(",")}`);
          }
          // a framed, embedded canvas has no floating panel; its toolbar and corner controls are checked all the same
          for (const el of res.covered) {
            n++;
            const key = `${fx}/${id}/${el}`;
            if (!KNOWN.has(key)) bad.push(`UNCLEAR ${fx} ${id} ${mode} ${el}`);
            else if (measure) bad.push(`KNOWN ${key}`);
          }
          n++;
        }
        if (m.name === "wide" && scheme === "light") {
          const svg = await p.evaluate(async () => (await (window as any).__repoladder.exportView("svg")).text());
          n++;
          if (/radial-gradient|--dock-/.test(svg)) bad.push(`UNCLEAR ${fx} - export svg has the dot grid or a dock variable`);
        }
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
  if (bad.length) { console.log(bad.join("\n")); if (!measure) { console.log("CLEARCHECK_FAILED"); process.exit(1); } }
  else console.log(`CLEARCHECK_OK ${n}`);
}
main().catch((e) => { console.error(e); console.log("CLEARCHECK_FAILED"); process.exit(1); });
