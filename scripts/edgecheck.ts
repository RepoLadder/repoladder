// Usage: npm run edgecheck
// Checks the phone edge cue (src/viewer/edgecue.ts) in Playwright Chromium at 390x844: builds the offline
// fixtures, shows every board, and requires that each canvas side a box is clipped on (4px or more) shows the cue.
// Also checks the cue never takes pointer events, is not in the exported SVG, and is off at 1280x800.
// Prints UNCUED / CUED lines, then EDGECHECK_OK <n> boards or EDGECHECK_FAILED <n> (exit 1).
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type Page = import("playwright").Page;

const settle = async (p: Page) => {
  let last = "", same = 0;
  for (let i = 0; i < 60 && same < 2; i++) {
    await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const vb = await p.evaluate(() => document.querySelector("svg.board")?.getAttribute("viewBox") ?? "");
    same = vb === last ? same + 1 : 0;
    last = vb;
  }
};

/** Sides (l r t b) where a box runs 4px or more past the canvas. */
const clipped = (p: Page) => p.evaluate(() => {
  const c = document.getElementById("canvas")!.getBoundingClientRect();
  let s = "";
  const rs = [...document.querySelectorAll("svg.board g[data-hit^='n:']")].map((g) => g.getBoundingClientRect());
  if (rs.some((r) => r.left < c.left - 4)) s += "l";
  if (rs.some((r) => r.right > c.right + 4)) s += "r";
  if (rs.some((r) => r.top < c.top - 4)) s += "t";
  if (rs.some((r) => r.bottom > c.bottom + 4)) s += "b";
  return s;
});

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const tmp = mkdtempSync(join(tmpdir(), "edgecheck-"));
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const bad: string[] = [];
  let n = 0;
  try {
    for (const fx of ["tourapp", "checkin", "mono", "deep"]) {
      const out = join(tmp, fx);
      execFileSync("node", [join(root, "src", "cli.ts"), "build", join(root, "test", "fixtures", fx), "--default", "--out", out], { stdio: "inherit" });
      const url = pathToFileURL(join(out, "diagram.html")).href;
      for (const [w, h] of [[390, 844], [1280, 800]]) {
        const ctx = await browser.newContext({ viewport: { width: w, height: h } });
        const p = await ctx.newPage();
        await p.goto(url);
        await p.waitForFunction(() => (window as any).__repoladder, null, { timeout: 5000 });
        const ids: string[] = await p.evaluate(() => (window as any).__repoladder.boards);
        for (const id of ids) {
          await p.evaluate((id) => (window as any).__repoladder.show(id), id);
          await settle(p);
          const need = await clipped(p);
          const info = await p.evaluate(() => {
            const e = document.getElementById("edgecue");
            return { sides: e?.getAttribute("data-sides") ?? "", pe: e ? [...e.querySelectorAll("span"), e].map((x) => getComputedStyle(x).pointerEvents) : ["none"] };
          });
          if (w === 390) {
            n++;
            const miss = [...need].filter((c) => !info.sides.includes(c)).join("");
            if (miss) { bad.push(`${fx} ${id} ${miss}`); console.log(`UNCUED ${fx} ${id} ${miss}`); }
            else console.log(`CUED ${fx} ${id} ${need || "-"}`);
          } else if (info.sides) { bad.push(`${fx} ${id} wide`); console.log(`WIDECUE ${fx} ${id} ${info.sides}`); }
          if (info.pe.some((x) => x !== "none")) bad.push(`${fx} ${id} pointer-events`);
        }
        if (w === 390) {
          const svg: Blob = await p.evaluate(async () => (await (window as any).__repoladder.exportView("svg")).text());
          if (String(svg).includes("edgecue")) bad.push(`${fx} export has edgecue`);
        }
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log(bad.length ? `EDGECHECK_FAILED ${bad.length}` : `EDGECHECK_OK ${n} boards`);
  if (bad.length) process.exit(1);
}
main();
