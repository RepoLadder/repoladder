// Screenshots of the served Ask bar in every state, for a PR's "How verified".
// Usage: npm run askshots [-- --out <dir>]   (default .gallery/ask-shots/)
//   Builds test/fixtures/checkin to a temp dir, serves it in-process against the fake `claude`
//   (test/helpers/fake-claude), drives the page with Playwright and writes one PNG per state and mode:
//   desktop-light, desktop-dark (1280x800) and phone-light (390x844); also once with the detail dial on.
//   The published diagram.html opened straight from disk is shot too, and must show no Ask bar.
// Prints ASKSHOTS_OK <dir>. Needs Chromium (`npx playwright install chromium`).
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MODES } from "./shots.ts";
import { pageFromFile, startServer } from "../src/serve/index.ts";

type Page = import("playwright").Page;
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const src = join(root, "test/fixtures/checkin");
const fake = join(root, "test/helpers/fake-claude/claude.mjs");
const CITES = "The kiosk pages live in web/src/pages/KioskPage.tsx:1 and call a backend, but not web/src/invented/Ghost.ts.";

const outArg = process.argv.indexOf("--out");
const outDir = resolve(outArg > 0 ? process.argv[outArg + 1] : join(root, ".gallery/ask-shots"));

function build(dir: string, dial: boolean): string {
  execFileSync("node", [join(root, "src/cli.ts"), "build", src, "--quiet", "--out", dir, "--grouping", join(src, "grouping.json"), ...(dial ? ["--dial"] : [])], { stdio: ["ignore", "ignore", "inherit"] });
  return dir;
}

type Scenario = { id: string; env: Record<string, string>; bin?: string; drive: (p: Page, shot: (n: string) => Promise<void>) => Promise<void> };
const ask = async (p: Page, q: string) => { await p.fill("#ask .ask-input", q); await p.press("#ask .ask-input", "Enter"); };

const scenarios: Scenario[] = [
  { id: "idle", env: {}, drive: async (p, shot) => { await p.focus("#ask .ask-input"); await shot("idle"); } },
  { id: "stream", env: { FAKE_CLAUDE_MODE: "stream", FAKE_CLAUDE_DELAY_MS: "700", FAKE_CLAUDE_TEXT: CITES }, drive: async (p, shot) => {
    await ask(p, "Where are the kiosk pages?");
    await p.waitForSelector("#ask[data-phase=loading]");
    await shot("loading");
    await p.waitForSelector("#ask[data-phase=streaming] .ask-a span");
    await p.waitForTimeout(2500);
    await shot("streaming");
    await p.waitForSelector("#ask[data-phase=done]", { timeout: 30000 });
    await shot("stream-done");
  } },
  { id: "cites", env: { FAKE_CLAUDE_MODE: "cites", FAKE_CLAUDE_TEXT: CITES }, drive: async (p, shot) => {
    await ask(p, "Where are the kiosk pages?");
    await p.waitForSelector("#ask[data-phase=done]");
    await shot("done");
    await p.click("#ask .cite-ok");
    await p.waitForTimeout(1500);
    await shot("citation-opened");
  } },
  { id: "error", env: { FAKE_CLAUDE_MODE: "ratelimit" }, drive: async (p, shot) => { await ask(p, "What touches the database?"); await p.waitForSelector("#ask[data-phase=error]"); await shot("error"); } },
  { id: "signedout", env: { FAKE_CLAUDE_MODE: "signedout" }, drive: async (p, shot) => { await ask(p, "What touches the database?"); await p.waitForSelector("#ask[data-phase=error]"); await shot("error-signed-out"); } },
  { id: "noagent", env: {}, bin: "/nonexistent/claude-nope", drive: async (p, shot) => { await p.waitForSelector("#ask[data-phase=no-agent]"); await shot("no-agent"); } },
];

async function main() {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ args: ["--font-render-hinting=none", "--force-color-profile=srgb", "--disable-lcd-text"] });
  const tmp = mkdtempSync(join(tmpdir(), "rl-askshots-"));
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  try {
    const plain = build(join(tmp, "plain"), false), dial = build(join(tmp, "dial"), true);
    const context = (m: (typeof MODES)[number]) => browser.newContext({ viewport: { width: m.width, height: m.height }, deviceScaleFactor: m.scale, colorScheme: m.scheme, hasTouch: m.id === "phone-light", reducedMotion: "reduce" });
    const settle = (p: Page) => p.evaluate(() => document.fonts?.ready).then(() => p.waitForTimeout(400));

    for (const sc of scenarios) {
      process.env.REPOLADDER_CLAUDE_BIN = sc.bin ?? fake;
      for (const [out, dialOn] of [[plain, false], [dial, true]] as const) {
        // the dial variant is only needed once, in the busiest state
        if (dialOn && sc.id !== "cites") continue;
        const s = await startServer({ page: pageFromFile(join(out, "diagram.html")), ask: { root: src, out, extraEnv: sc.env } });
        try {
          for (const m of MODES) {
            if (dialOn && m.id !== "desktop-light") continue;
            const ctx = await context(m), page = await ctx.newPage();
            await page.goto(s.url);
            await page.waitForSelector("#ask", { timeout: 30000 });
            await settle(page);
            await sc.drive(page, async (n) => { await settle(page); await page.screenshot({ path: join(outDir, `${n}${dialOn ? "-dial" : ""}-${m.id}.png`) }); });
            await ctx.close();
          }
        } finally { await s.close(); }
      }
    }
    // the published page, opened straight from disk: no bar, and no request for one
    for (const m of MODES) {
      const ctx = await context(m), page = await ctx.newPage();
      const asks: string[] = [];
      page.on("request", (r) => { if (r.url().includes("/api/ask")) asks.push(r.url()); });
      await page.goto(pathToFileURL(join(plain, "diagram.html")).href);
      await page.waitForFunction(() => (window as any).__repoladder);
      await settle(page);
      if ((await page.$("#ask")) || asks.length) throw new Error(`the published page shows or calls Ask (${m.id})`);
      await page.screenshot({ path: join(outDir, `published-no-ask-${m.id}.png`) });
      await ctx.close();
    }
  } finally {
    await browser.close();
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`ASKSHOTS_OK ${outDir}`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
