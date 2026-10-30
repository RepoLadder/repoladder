// Screenshots boards of the detail dial's container layout (docs/detail-dial-v2.md): Everything, or
// any board cut at a box budget, at the 1280×800 fit and zoomed in, light and dark.
// Usage: node scripts/cutshots.ts <diagram.html> --out <dir> everything web-warroom@30 web@75 …
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const html = args.find((a) => a.endsWith(".html"));
const oi = args.indexOf("--out"), out = resolve(oi >= 0 ? args[oi + 1] : ".gallery/cutshots");
const shots = args.filter((a, i) => a !== html && a !== "--out" && i !== oi + 1);
if (!html || !shots.length) throw new Error("usage: node scripts/cutshots.ts <diagram.html> --out <dir> everything board@budget …");
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
for (const scheme of ["light", "dark"] as const) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, colorScheme: scheme });
  for (const s of shots) {
    const p = await ctx.newPage();
    await p.goto(pathToFileURL(resolve(html)).href);
    await p.waitForFunction(() => (window as any).__repoladder, null, { timeout: 5000 });
    if (!(await p.evaluate(() => (window as any).__repoladder.features?.dial))) { console.error("This page was built without the detail dial: build with REPOLADDER_DIAL=1"); process.exit(1); }
    await p.evaluate(() => document.fonts?.ready);
    const [board, budget] = s === "everything" ? ["root", "everything"] : s.split("@");
    const ok = await p.evaluate(([b, n]) => (n === "everything" ? (window as any).__repoladder.stop("everything", "root") : (window as any).__repoladder.cut(b, Number(n))), [board, budget]);
    if (!ok) { console.log(`FAIL ${s}`); await p.close(); continue; }
    await p.waitForTimeout(400);
    const name = s.replace("@", "-at-");
    await p.screenshot({ path: join(out, `${name}-${scheme}.png`) });
    // zoomed in 3× on the middle: are the labels readable?
    await p.mouse.move(640, 400);
    for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, -120); await p.waitForTimeout(40); }
    // off the board, so no hover fades the rest
    await p.mouse.move(1270, 790);
    await p.waitForTimeout(300);
    await p.screenshot({ path: join(out, `${name}-zoom-${scheme}.png`) });
    console.log(`ok   ${s} (${scheme})`);
    await p.close();
  }
  await ctx.close();
}
await browser.close();
console.log(out);
