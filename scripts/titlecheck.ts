// Usage: npm run titlecheck
// Playwright check for the header repo name (#499): on a deep board it is a button, a click shows the overview, and
// there it is plain text; a hash jump returns to the deep board with the button again. Needs `npx playwright install chromium`.
// Prints TITLECHECK_OK or TITLECHECK_FAILED <reason> (exit 1).
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "test", "fixtures", "deep");
const tmp = mkdtempSync(join(tmpdir(), "titlecheck-"));
let failed = "";
try {
  execFileSync("node", [join(root, "src", "cli.ts"), "build", src, "--quiet", "--out", tmp, "--grouping", join(src, "grouping.json")], { stdio: ["ignore", "ignore", "inherit"] });
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const p = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" })).newPage();
    const url = pathToFileURL(join(tmp, "diagram.html")).href;
    const ok = async (cond: boolean, what: string) => { if (!cond && !failed) failed = what; };
    await p.goto(`${url}#invoices~`);
    const btn = p.locator("header h1 button");
    await ok((await btn.count()) === 1, "deep board: title is not a button");
    await btn.focus();
    await p.keyboard.press("Enter");
    await p.waitForTimeout(500);
    await ok((await btn.count()) === 0, "overview: title still a button after click");
    await ok(((await p.locator("header h1").textContent()) ?? "").trim().length > 0, "overview: title empty");
    await p.evaluate(() => { location.hash = "#invoices~"; });
    await p.waitForTimeout(500);
    await ok((await btn.count()) === 1, "hash jump: title is not a button on the deep board");
    await p.setViewportSize({ width: 390, height: 844 });
    const over = await p.evaluate(() => {  const h = document.querySelector("h1")!.parentElement!; return h.scrollWidth > h.clientWidth + 1; });
    await ok(!over, "phone width: header overflows");
  } finally { await browser.close(); }
} catch (e) { failed = (e as Error).message.split("\n")[0]; } finally { rmSync(tmp, { recursive: true, force: true }); }
if (failed) { console.log(`TITLECHECK_FAILED ${failed}`); process.exit(1); }
console.log("TITLECHECK_OK");
