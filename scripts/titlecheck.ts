// Usage: npm run titlecheck
// Playwright check for the board title over the canvas (#44): plain text on every board, the level label follows, the Overview crumb goes home, no overflow at 390px
// Needs `npx playwright install chromium`.
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
    const h1 = p.locator(".board-title h1");
    await ok((await p.locator("header h1").count()) === 0 && (await p.locator("h1").count()) === 1, "the page must have one h1, in the board title");
    await ok((await h1.locator("button").count()) === 0, "overview: title is not plain text");
    await ok(((await h1.textContent()) ?? "").trim().length > 0, "overview: title empty");
    await p.evaluate(() => { location.hash = "#invoices~"; });
    await p.waitForTimeout(500);
    await ok((await h1.locator("button").count()) === 0, "deep board: title is not plain text");
    await ok(((await p.locator(".bt-level").textContent()) ?? "").includes("down"), "deep board: no level label");
    await p.locator("#crumbs button").first().click();
    await p.waitForTimeout(500);
    await ok(((await p.locator(".bt-level").textContent()) ?? "") === "Overview", "the Overview crumb does not go home");
    await p.setViewportSize({ width: 390, height: 844 });
    const over = await p.evaluate(() => {  const h = document.querySelector(".board-title")!; return h.scrollWidth > h.clientWidth + 1; });
    await ok(!over, "phone width: board title overflows");
  } finally { await browser.close(); }
} catch (e) { failed = (e as Error).message.split("\n")[0]; } finally { rmSync(tmp, { recursive: true, force: true }); }
if (failed) { console.log(`TITLECHECK_FAILED ${failed}`); process.exit(1); }
console.log("TITLECHECK_OK");
