// Usage: npm run askcheck
// Checks that the served Ask panel dismisses (src/viewer/ask/view.ts, keys.ts) in Playwright Chromium: builds
// test/fixtures/checkin offline and serves it against the fake `claude` (test/helpers/fake-claude, `cites` mode); at
// 1280x800 and 390x844 it asserts the empty input suggests a tour, a click on empty canvas closes the answer panel and
// focusing the input reopens it, Escape with focus elsewhere closes it without the board also seeing that Escape,
// Escape in Search leaves the panel alone, and clicking a citation inside the panel keeps it open.
// Prints ASKCHECK_OK <n> or ASKCHECK_FAILED <why> (exit 1). Needs Chromium (`npx playwright install chromium`).
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pageFromFile, startServer } from "../src/serve/index.ts";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const src = join(root, "test/fixtures/checkin");
const fake = join(root, "test/helpers/fake-claude/claude.mjs");
const CITES = "The kiosk pages live in web/src/pages/KioskPage.tsx:1 and call a backend.";
const SIZES = [{ w: 1280, h: 800 }, { w: 390, h: 844 }];

let n = 0;
function check(ok: boolean, why: string): void {
  if (!ok) throw new Error(why);
  n++;
}

async function main() {
  const { chromium } = await import("playwright");
  const tmp = mkdtempSync(join(tmpdir(), "rl-askcheck-"));
  const out = join(tmp, "out");
  execFileSync("node", [join(root, "src/cli.ts"), "build", src, "--quiet", "--out", out, "--grouping", join(src, "grouping.json")], { stdio: ["ignore", "ignore", "inherit"] });
  process.env.REPOLADDER_CLAUDE_BIN = fake;
  const browser = await chromium.launch();
  const server = await startServer({ page: pageFromFile(join(out, "diagram.html")), ask: { root: src, out, extraEnv: { FAKE_CLAUDE_MODE: "cites", FAKE_CLAUDE_TEXT: CITES } } });
  try {
    for (const { w, h } of SIZES) {
      const tag = `${w}x${h}`;
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: "reduce" }), p = await ctx.newPage();
      await p.goto(server.url);
      await p.waitForSelector("#ask .ask-input", { timeout: 30000 });
      const hidden = () => p.$eval("#ask .ask-panel", (el) => (el as HTMLElement).hidden);
      const ph = await p.$eval("#ask .ask-input", (el) => (el as HTMLInputElement).placeholder);
      check(ph.startsWith("Give me a tour of"), `${tag}: placeholder is "${ph}"`);

      await p.fill("#ask .ask-input", "Where are the kiosk pages?");
      await p.press("#ask .ask-input", "Enter");
      await p.waitForSelector("#ask[data-phase=done]", { timeout: 30000 });
      check(!(await hidden()), `${tag}: panel not shown after an answer`);

      // a click on empty canvas (top-left corner, away from the bar and panel) closes it; focusing the input reopens it
      await p.mouse.click(4, h - 4);
      check(await hidden(), `${tag}: outside click did not close the panel`);
      await p.focus("#ask .ask-input");
      check(!(await hidden()), `${tag}: focusing the input did not reopen the panel`);

      // Escape with focus off Ask closes the panel, and the board does not see it; the next one reaches the board
      await p.evaluate(() => {
        (window as any).__esc = 0;
        window.addEventListener("keydown", (e) => { if (e.key === "Escape") (window as any).__esc++; });
        (document.activeElement as HTMLElement | null)?.blur();
      });
      await p.keyboard.press("Escape");
      check(await hidden(), `${tag}: Escape did not close the panel`);
      check((await p.evaluate(() => (window as any).__esc)) === 0, `${tag}: the closing Escape also reached the board`);
      await p.keyboard.press("Escape");
      check((await p.evaluate(() => (window as any).__esc)) === 1, `${tag}: the next Escape did not reach the board`);

      // Escape in Search closes Search and leaves the Ask panel as it was
      await p.focus("#ask .ask-input");
      check(!(await hidden()), `${tag}: panel not reopened before the Search check`);
      await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await p.keyboard.press("/");
      await p.keyboard.press("Escape");
      check(!(await hidden()), `${tag}: Escape in Search closed the Ask panel`);

      // a citation inside the panel is not an outside click
      await p.click("#ask .cite-ok");
      await p.waitForTimeout(300);
      check(!(await hidden()), `${tag}: clicking a citation closed the panel`);
      await ctx.close();
    }
  } finally {
    await server.close();
    await browser.close();
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`ASKCHECK_OK ${n}`);
}

main().catch((e) => { console.error(`ASKCHECK_FAILED ${e instanceof Error ? e.message : e}`); process.exit(1); });
