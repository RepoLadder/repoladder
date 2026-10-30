// Usage: npm run exportcheck -- --only name,name [--work <gallery dir>]
// Checks the viewer's Export button (#355) in Playwright Chromium on built demos (`npm run gallery -- --demos`), in desktop
// light, desktop dark and phone light: the menu, the saved SVG (and that it matches the live board), the PNG (size, fonts),
// Copy PNG, the blocked fallback inside a sandboxed iframe, and an export taken mid-transition.
// Prints EXPORTCHECK_MISMATCH lines, then EXPORTCHECK_OK <n> checks or EXPORTCHECK_FAILED <reason> (exit 1).
// Files for inspection land in .gallery/exportcheck/<demo>-<mode>.{svg,png}.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pngScale } from "../src/viewer/exportsvg.ts";
import { THEMES } from "../src/viewer/theme.ts";
import { pngSize } from "./pngsize.ts";

export { pngSize };

export const MODES = [
  { id: "desktop-light", width: 1280, height: 800, scheme: "light", scale: 1, phone: false },
  { id: "desktop-dark", width: 1280, height: 800, scheme: "dark", scale: 1, phone: false },
  { id: "phone-light", width: 390, height: 844, scheme: "light", scale: 2, phone: true },
] as const;

export interface Args { only?: string[]; work?: string }

export function parseArgs(argv: string[]): Args {
  const a: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i], val = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${f} needs a value`); return v; };
    if (f === "--only") a.only = val().split(",").filter(Boolean);
    else if (f === "--work") a.work = val();
    else throw new Error(`unknown flag "${f}"`);
  }
  return a;
}

/** The properties compared between the live board and the saved SVG, per element. */
export const PROPS = ["fill", "stroke", "stroke-width", "opacity", "display", "visibility", "font-size"] as const;
export type Row = [name: string, ...values: string[]];

/** One line per differing element property: `<tag.class> <prop> <live> <export>`. */
export function mismatches(live: Row[], exp: Row[]): string[] {
  const out: string[] = [];
  if (live.length !== exp.length) out.push(`* count ${live.length} ${exp.length}`);
  for (let i = 0; i < Math.min(live.length, exp.length); i++) {
    if (live[i][0] !== exp[i][0]) { out.push(`${live[i][0]} element ${live[i][0]} ${exp[i][0]}`); break; }
    PROPS.forEach((p, k) => { if (live[i][k + 1] !== exp[i][k + 1]) out.push(`${live[i][0]} ${p} ${live[i][k + 1]} ${exp[i][k + 1]}`); });
  }
  return out;
}

const styleRows = ([props, root]: [readonly string[], string]) => {
  const svg = document.querySelector(root);
  if (!svg) return [];
  return [svg, ...svg.querySelectorAll("*")].map((e) => {
    const c = getComputedStyle(e);
    return [`${e.tagName}.${e.getAttribute("class") ?? ""}`, ...props.map((p) => c.getPropertyValue(p))];
  });
};

async function main() {
  const { chromium } = await import("playwright");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const args = parseArgs(process.argv.slice(2));
  const work = args.work ? resolve(args.work) : join(root, ".gallery", "demos");
  const resultsFile = join(work, "results.json");
  if (!existsSync(resultsFile)) throw new Error("no demo gallery yet: run `npm run gallery -- --demos --jobs 1` first");
  const results: { name: string; status: string }[] = JSON.parse(readFileSync(resultsFile, "utf8"));
  const demos = results.filter((r) => r.status === "ok" && (!args.only || args.only.includes(r.name)) && existsSync(join(work, "out", r.name, "diagram.html"))).map((r) => r.name);
  if (args.only) for (const n of args.only) if (!demos.includes(n)) throw new Error(`no built demo diagram for "${n}"`);
  if (!demos.length) throw new Error("no built demos");
  const outDir = join(root, ".gallery", "exportcheck");
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  // a local http origin: clipboard permissions can't be granted to file://
  const pages = new Map(demos.map((d) => [`/${d}.html`, readFileSync(join(work, "out", d, "diagram.html"), "utf8")]));
  const server = createServer((req, res) => {
    const p = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (pages.has(p)) res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(pages.get(p));
    else if (p === "/blank.html") res.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><body></body>");
    else res.writeHead(404).end();
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  let checks = 0, mism = 0;
  const failures: string[] = [];
  const browser = await chromium.launch();
  try {
    for (const demo of demos) for (const mode of MODES) {
      const tag = `${demo} ${mode.id}`;
      const check = (ok: unknown, why: string) => { checks++; if (!ok) failures.push(`${tag}: ${why}`); };
      const ctx = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, deviceScaleFactor: mode.scale, colorScheme: mode.scheme, hasTouch: mode.phone, acceptDownloads: true });
      await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
      const p = await ctx.newPage();
      p.on("pageerror", (e) => failures.push(`${tag}: page error ${e.message}`));
      await p.goto(`${origin}/${demo}.html`);
      await p.waitForFunction(() => (window as any).__repoladder, null, { timeout: 15000 });
      await p.evaluate(() => document.fonts?.ready);
      const boards: string[] = await p.evaluate(() => (window as any).__repoladder.boards);
      const board = boards.find((b) => b !== "root" && b !== "_story");
      if (board) await p.evaluate((b) => (window as any).__repoladder.show(b), board);
      // a selection, so the focus and selection classes are in the export; then one zoom step
      await p.evaluate(() => document.querySelector<SVGGElement>("svg.board g[data-hit^='n:']")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
      // wait for the selection's focus-zoom glide to end: the view holds still for 300ms
      const settle = () => p.evaluate(() => new Promise<void>((r) => {
        let last = "", since = performance.now();
        const tick = () => { const v = document.querySelector("svg.board")!.getAttribute("viewBox")!; if (v !== last) { last = v; since = performance.now(); } if (performance.now() - since > 300) r(); else requestAnimationFrame(tick); };
        tick();
      }));
      await settle();
      await p.evaluate(() => document.getElementById("zin")!.click());
      await settle();
      check(await p.isVisible("#zfit"), "Reframe shows when zoomed");
      await p.evaluate(() => document.getElementById("zfit")!.click());
      await settle();
      check(!(await p.isVisible("#zfit")) && await p.evaluate(() => document.getElementById("zfit")!.hidden), "Reframe returns to the fit and hides");
      await p.evaluate(() => document.getElementById("zin")!.click());
      await p.mouse.move(0, 0);
      await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const live = await p.evaluate(() => { const r = document.querySelector("svg.board")!.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });

      // the menu, by click and by keyboard
      const crumbs = await p.evaluate(() => document.querySelector("#crumbs")?.textContent ?? "");
      await p.click("#zexp");
      check(await p.getAttribute("#zexp", "aria-expanded") === "true" && await p.locator("[role=menuitem]").count() === 3, "menu opens with three items");
      const covered = () => p.evaluate(() => [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].filter((el) => { const r = el.getBoundingClientRect(), t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !t || !(t === el || el.contains(t)) || !!t.closest(".dial"); }).length);
      check(await covered() === 0, "menu items are not covered by the dial");
      await p.keyboard.press("Escape");
      await p.hover(".dial");
      await p.click("#zexp");
      check(await covered() === 0, "menu items are not covered by the dial (dial hovered)");
      await p.keyboard.press("Escape");
      check(await p.locator(".xmenu").count() === 0 && await p.evaluate(() => document.activeElement?.id) === "zexp", "Escape closes the menu and returns focus to #zexp");
      check(await p.evaluate((c) => (window as any).__repoladder && document.querySelector("svg.board") !== null && document.querySelector("#crumbs")?.textContent === c, crumbs), "Escape in the menu stays on the same board and selection");
      // focus on the body (a click on the menu's own text), then Escape: still closes the menu only
      await p.click("#zexp");
      await p.evaluate(() => (document.activeElement as HTMLElement)?.blur());
      await p.keyboard.press("Escape");
      check(await p.locator(".xmenu").count() === 0 && await p.evaluate((c) => document.querySelector("#crumbs")?.textContent === c, crumbs), "Escape closes the menu with focus on the body, without leaving the board");

      const download = async (label: string) => {
        await p.click("#zexp");
        const [d] = await Promise.all([p.waitForEvent("download"), p.click(`[role=menuitem]:has-text("${label}")`)]);
        const file = await d.path();
        return { name: d.suggestedFilename(), bytes: readFileSync(file!) };
      };

      // Save SVG
      const svg = await download("Save SVG");
      const svgText = svg.bytes.toString("utf8");
      writeFileSync(join(outDir, `${demo}-${mode.id}.svg`), svg.bytes);
      check(/^[\w.-]+-(light|dark)\.svg$/.test(svg.name) && svg.name.includes(mode.scheme), `SVG file name ${svg.name}`);
      for (const bad of ["var(--", "<script", "tabindex", 'role="button"', "Geist"]) check(!svgText.includes(bad), `saved SVG has no ${bad}`);
      check(svgText.includes("ui-sans-serif"), "saved SVG names the system font stack");
      check(svgText.includes(`<rect width="${live.w}" height="${live.h}" fill="${THEMES[mode.scheme].paper}"/>`), "ground rect is the theme's paper at the viewport size");

      // fidelity against the live board
      // the live board's opacity eases for a moment after a show: sample only once every transition has finished
      await p.waitForFunction(() => document.getAnimations().length === 0, null, { timeout: 5000 });
      const liveRows = await p.evaluate(styleRows, [PROPS, "svg.board"] as [readonly string[], string]);
      const q = await ctx.newPage();
      await q.setContent(`<!doctype html><body style="margin:0">${svgText}</body>`);
      const expRows = await q.evaluate(styleRows, [PROPS, "svg svg.board"] as [readonly string[], string]);
      const bad = mismatches(liveRows as Row[], expRows as Row[]);
      for (const m of bad) process.stdout.write(`EXPORTCHECK_MISMATCH ${demo} ${mode.id} ${m}\n`);
      mism += bad.length;
      check(!bad.length, `${bad.length} style mismatches against the live board`);
      await q.close();

      // Save PNG
      const png = await download("Save PNG");
      writeFileSync(join(outDir, `${demo}-${mode.id}.png`), png.bytes);
      const s = pngScale(live.w, live.h), size = pngSize(png.bytes);
      check(size && size.w === Math.round(live.w * s) && size.h === Math.round(live.h * s), `PNG size ${size?.w}x${size?.h}, wanted ${Math.round(live.w * s)}x${Math.round(live.h * s)}`);
      const colors = await p.evaluate(async (b64) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.width; c.height = img.height;
        const x = c.getContext("2d")!;
        x.drawImage(img, 0, 0);
        const d = x.getImageData(0, 0, c.width, c.height).data, seen = new Set<number>();
        for (let i = 0; i < d.length; i += 4 * 37) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
        return seen.size;
      }, png.bytes.toString("base64"));
      check(colors > 10, `PNG has ${colors} distinct colours`);

      // Geist in the PNG: the embedded source rasterizes differently from the same source without its faces
      const differs = await p.evaluate(async () => {
        const src = await (await (window as any).__repoladder.exportView("pngsrc")).text() as string;
        const draw = async (t: string) => {
          const img = new Image();
          img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(t);
          await img.decode();
          await new Promise((f) => requestAnimationFrame(f));
          const c = document.createElement("canvas");
          c.width = img.width; c.height = img.height;
          c.getContext("2d")!.drawImage(img, 0, 0);
          return c.toDataURL();
        };
        return src.includes("@font-face") && (await draw(src)) !== (await draw(src.replace(/@font-face\{[^}]*\}/g, "")));
      });
      check(differs, "the PNG source's embedded Geist changes the pixels");

      // Copy PNG
      await p.click("#zexp");
      await p.click('[role=menuitem]:has-text("Copy PNG")');
      await p.waitForSelector(".xnote, .xprev", { timeout: 15000 });
      const clip = await p.evaluate(async () => { try { return (await navigator.clipboard.read()).flatMap((i) => i.types); } catch (e) { return [String(e)]; } });
      check(clip.includes("image/png"), `clipboard holds ${clip.join(",")}`);

      // blocked: a sandboxed frame without download or clipboard permission
      const b = await ctx.newPage();
      await b.goto(`${origin}/blank.html`);
      await b.evaluate(async (u) => {
        const f = document.createElement("iframe");
        f.style.cssText = "width:100vw;height:100vh;border:0";
        f.setAttribute("sandbox", "allow-scripts");
        f.srcdoc = await (await fetch(u)).text();
        document.body.append(f);
      }, `/${demo}.html`);
      b.on("pageerror", (e) => failures.push(`${tag}: sandboxed page error ${e.message}`));
      const fr = b.frames().find((f) => f !== b.mainFrame())!;
      await fr.waitForFunction(() => (window as any).__repoladder, null, { timeout: 15000 });
      await fr.evaluate(() => document.fonts?.ready);
      const act = async (label: string) => {
        await fr.click("#zexp");
        await fr.click(`[role=menuitem]:has-text("${label}")`);
        await fr.waitForSelector(".xnote, .xprev", { timeout: 15000 });
      };
      await act("Save PNG");
      check(await fr.locator(".xnote").count() === 1, "blocked frame: Save shows a notice");
      await fr.click('.xnote button:has-text("Show image")');
      await fr.waitForSelector(".xprev img");
      check(await fr.evaluate(() => (document.querySelector(".xprev img") as HTMLImageElement).naturalWidth > 0), "blocked frame: the preview image loads");
      await b.keyboard.press("Escape");
      check(await fr.locator(".xprev").count() === 0 && await fr.evaluate(() => document.activeElement?.id) === "zexp", "Escape closes the preview and returns focus");
      await act("Copy PNG");
      check(await fr.locator(".xnote, .xprev").count() > 0, "blocked frame: Copy shows a notice or the preview");
      await b.close();

      // mid-transition: climb a level and export in the same task
      if (board) {
        const out = await p.evaluate(async () => {
          document.querySelector<HTMLElement>("#crumbs [data-go]")?.click();
          return await (await (window as any).__repoladder.exportView("svg")).text() as string;
        });
        check(!/class="ghost/.test(out), "no ghost svg in a mid-transition export");
        check(/<title>[^<]*· Overview<\/title>/.test(out), "a mid-transition export shows the settled new board");
      }
      await ctx.close();
      process.stdout.write(`checked ${tag}\n`);
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) {
    process.stdout.write(`EXPORTCHECK_FAILED ${failures.length} of ${checks} checks: ${failures.slice(0, 12).join(" | ")}\n`);
    process.exitCode = 1;
  } else process.stdout.write(`EXPORTCHECK_OK ${checks} checks (${mism} mismatches)\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); } catch (e) {
    process.stdout.write(`EXPORTCHECK_FAILED ${(e as Error).message}\n`);
    process.exit(1);
  }
}
