// Records the README's demo GIF, and per-tour clips: plays tours on the repoladder map in Playwright Chromium
// and encodes the frames as a GIF (gifenc, in the browser, so no ffmpeg is needed) or records a WebM
// (Playwright's own bundled ffmpeg: `npx playwright install ffmpeg`). Re-run it whenever the viewer changes
// how a tour looks or moves (e.g. the up/across/down transition, #194).
//
//   REPOLADDER_BRAND_NAME=RepoLadder npm run gallery -- --only repoladder --title RepoLadder   # builds .gallery/out/repoladder/diagram.html
//   npm run readme-media                                           # writes docs/media/tour.gif
//   npm run readme-media -- --tours lay-out-a-board --theme dark --out /tmp/x.gif --frames /tmp/frames
//   npm run readme-media -- --list          # the map's tours: <id>, <steps>, <title>; writes no file
//   npm run readme-media -- --all-tours --max-seconds 20   # one clip per tour -> .gallery/media/<repo>-<tour>.gif
//   npm run readme-media -- --tours open-a-box --format webm --out /tmp/open-a-box.webm
//
// The gallery build for the recording runs with REPOLADDER_BRAND_NAME=RepoLadder, so the footer says it too.
// Flags: --diagram <diagram.html> --tours <id,id: the grouping's tours, played in turn> --out <file> --theme light|dark (default dark)
// --width/--height <viewport> --gif-width <px: the WebM's width too> --fps <max frames a second; default 15> --step <ms per tour step>
// --video <dir: also write the full-resolution frames and frames.ffconcat for a video encode>
// --forbid <words: fail if any shows on screen, case-insensitive>
// --frames <dir: also keep the raw PNG frames> --poster <png: also save one still> --poster-step <n: the first tour's nth step
// once it has landed; default 1, so the board is shown with its selection highlighted, not the bare overview>.
// --format gif|webm (default gif; --out defaults to docs/media/tour.<format>)
// --max-seconds <n: cap a clip's length; no tour step starts that wouldn't fit, and a GIF is trimmed to it; default none>
// --list (print the tours and stop; only --diagram applies)
// --all-tours (one clip per grouping tour into --out-dir, default .gallery/media; not with --tours/--out/--poster/--frames)
// The website's hero video is made from this same recording by the website repo's media:tour script.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface Options { video: string; forbid: string[]; diagram: string; tours: string[]; out: string; theme: "light" | "dark"; width: number; height: number; gifWidth: number; step: number; fps: number; frames: string; poster: string; posterStep: number; list: boolean; allTours: boolean; outDir: string; format: "gif" | "webm"; maxSeconds: number }

// Pauses (ms) around the tour steps; pinned by test/readme-media.test.ts.
export const INTRO_MS = 2000, BACK_MS = 1400, TOUR_END_MS = 1200, OUTRO_MS = 800;

export function parseArgs(argv: string[], base = root): Options {
  const flag = (name: string, d: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : d; };
  const theme = flag("theme", "dark");
  if (theme !== "light" && theme !== "dark") throw new Error("--theme must be light or dark");
  const posterStepRaw = flag("poster-step", "1");
  const posterStep = Number(posterStepRaw);
  if (!/^\d+$/.test(posterStepRaw) || !Number.isInteger(posterStep) || posterStep < 1) throw new Error("--poster-step must be a positive integer");
  const format = flag("format", "gif");
  if (format !== "gif" && format !== "webm") throw new Error("--format must be gif or webm");
  const maxRaw = flag("max-seconds", "0");
  const maxSeconds = argv.includes("--max-seconds") ? Number(maxRaw) : 0;
  if (argv.includes("--max-seconds") && (!/^\d+(\.\d+)?$/.test(maxRaw) || !(maxSeconds > 0))) throw new Error("--max-seconds must be a positive number");
  const allTours = argv.includes("--all-tours");
  if (allTours && argv.includes("--tours")) throw new Error("--all-tours and --tours can't be combined");
  if (allTours && argv.includes("--out")) throw new Error("--all-tours writes to --out-dir, not --out");
  if (allTours && (argv.includes("--poster") || argv.includes("--frames"))) throw new Error("--poster and --frames need a single recording, not --all-tours");
  if (!allTours && argv.includes("--out-dir")) throw new Error("--out-dir needs --all-tours");
  return {
    diagram: resolve(base, flag("diagram", join(base, ".gallery/out/repoladder/diagram.html"))),
    tours: flag("tours", "map-a-repo,lay-out-a-board").split(","),
    out: resolve(base, flag("out", join(base, `docs/media/tour.${format}`))),
    theme,
    width: Number(flag("width", "1280")),
    height: Number(flag("height", "800")),
    gifWidth: Number(flag("gif-width", "960")),
    step: Number(flag("step", "4200")),
    fps: Number(flag("fps", "15")),
    frames: argv.includes("--frames") ? resolve(base, flag("frames", "")) : "",
    poster: argv.includes("--poster") ? resolve(base, flag("poster", "")) : "",
    posterStep,
    list: argv.includes("--list"),
    allTours,
    outDir: resolve(base, flag("out-dir", join(base, ".gallery/media"))),
    format,
    maxSeconds,
    video: argv.includes("--video") ? resolve(base, flag("video", "")) : "",
    forbid: flag("forbid", "").split(",").map((w) => w.trim()).filter(Boolean),
  };
}

export interface Frame { t: number; png: Buffer }

/** `<outDir>/<repo>-<tour>.<format>`, with anything but letters, digits, `_` and `-` in the names turned into `-`. */
export function clipPath(outDir: string, repo: string, id: string, format: "gif" | "webm"): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "x";
  return join(outDir, `${safe(repo)}-${safe(id)}.${format}`);
}

/** The frames shown before `capMs`, closed by a frame at exactly `capMs`; `capMs <= 0` is no cap. */
export function trimFrames(frames: Frame[], capMs: number): Frame[] {
  if (capMs <= 0) return frames;
  const kept = frames.filter((f, i) => i === 0 || f.t < capMs);
  if (kept.length === frames.length && frames.at(-1)!.t <= capMs) return frames;
  return [...kept, { t: capMs, png: kept.at(-1)!.png }];
}

let opt!: Options;

/** Every line of `text` that contains one of `words`, case-insensitively, trimmed and de-duplicated. */
export function findForbidden(text: string, words: string[]): string[] {
  const ws = words.map((w) => w.toLowerCase()).filter(Boolean);
  const hits = new Set<string>();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line && ws.some((w) => line.toLowerCase().includes(w))) hits.add(line);
  }
  return [...hits];
}

/** ffmpeg concat-demuxer list for frames shown at `ts` (ms); the last frame is repeated so ffmpeg holds it. */
export function ffconcat(ts: number[]): string {
  const keep: number[] = [];
  ts.forEach((t, i) => { if (i === ts.length - 1 || ts[i + 1]! - t >= 1) keep.push(i); });
  const name = (i: number) => `file '${String(i).padStart(5, "0")}.png'`;
  const lines = ["ffconcat version 1.0"];
  keep.forEach((i, k) => {
    lines.push(name(i));
    const next = keep[k + 1];
    if (next !== undefined) lines.push(`duration ${((ts[next]! - ts[i]!) / 1000).toFixed(4)}`);
  });
  if (keep.length) lines.push(name(keep.at(-1)!));
  return lines.join("\n") + "\n";
}

/** The frame rate while the page moves: the median of the gaps under 100 ms, as frames a second (0 when still). */
export function motionFps(ts: number[]): number {
  const gaps = ts.slice(1).map((t, i) => t - ts[i]!).filter((g) => g > 0 && g < 100).sort((a, b) => a - b);
  if (!gaps.length) return 0;
  const mid = gaps.length >> 1, med = gaps.length % 2 ? gaps[mid]! : (gaps[mid - 1]! + gaps[mid]!) / 2;
  return Math.round((10000 / med)) / 10;
}

/** The script the GIF shows: the overview, then each tour step by step, climbing back to the overview between tours. */
async function act(page: import("playwright").Page, wait: (ms: number) => Promise<void>, tours: string[], onStepShown?: (tour: number, step: number) => void | Promise<void>, elapsed: () => number = () => 0, onCheck?: (where: string) => void | Promise<void>): Promise<void> {
  const cap = opt.maxSeconds * 1000, TAIL = TOUR_END_MS + OUTRO_MS; // the trailing waits
  await wait(INTRO_MS);
  await onCheck?.("intro");
  for (const [k, id] of tours.entries()) {
    if (k && cap > 0 && elapsed() + BACK_MS + opt.step + TAIL > cap) break;
    if (k) {
      // back up to the overview the way a reader would, by its breadcrumb
      const crumb = page.locator("#crumbs button[data-go]").first();
      if (await crumb.isVisible().catch(() => false)) await crumb.click();
      else await page.evaluate(() => (window as any).__repoladder.show("root"));
      await wait(BACK_MS);
    }
    // start it from the Tours list on the overview, when it's there
    const row = page.locator(`[data-tour="${id}"]`).first();
    if (await row.isVisible().catch(() => false)) await row.click();
    else await page.evaluate((t) => (window as any).__repoladder.tour(t, 0), id);
    // the strip shows once the first step's travel lands
    await page.waitForSelector(".walk-card .tour-dots i", { timeout: 10_000 }).catch(() => {});
    const steps: number = await page.evaluate(() => document.querySelectorAll(".walk-card .tour-dots i").length);
    if (!steps) throw new Error(`tour "${id}" did not start; is it in the grouping's tours?`);
    for (let i = 0; i < steps; i++) {
      await wait(opt.step);
      await onStepShown?.(k, i);
      // the next step must fit with the closing pause, else this one is the last shown
      if (i + 1 < steps && cap > 0 && elapsed() + opt.step + TAIL > cap) break;
      // the strip's own button, so the recording is exactly what a click does
      await page.locator(".walk-card [data-tour-step='1']").click();
    }
    await wait(TOUR_END_MS);
  }
  await wait(OUTRO_MS);
  await onCheck?.("end");
}

async function record(tours: string[], video?: string): Promise<{ frames: Frame[]; posterIdx: number }> {
  try {
    return await recordRaw(tours, video);
  } catch (e) {
    if (video && /ffmpeg/i.test(String((e as Error).message))) throw new Error("WebM needs Playwright's ffmpeg: run `npx playwright install ffmpeg`");
    throw e;
  }
}

async function recordRaw(tours: string[], video?: string): Promise<{ frames: Frame[]; posterIdx: number }> {
  const tmp = video ? mkdtempSync(join(tmpdir(), "readme-media-")) : "";
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: opt.width, height: opt.height }, deviceScaleFactor: 1, colorScheme: opt.theme, reducedMotion: "no-preference", ...(video ? { recordVideo: { dir: tmp, size: { width: opt.gifWidth, height: Math.round((opt.height * opt.gifWidth) / opt.width) } } } : {}) });
    const page = await ctx.newPage();
    await page.goto(pathToFileURL(opt.diagram).href);
    await page.waitForFunction(() => (window as any).__repoladder, null, { timeout: 10_000 });
    await page.evaluate(async () => { await document.fonts.ready; });
    await page.mouse.move(opt.width - 2, opt.height - 2);
    const frames: Frame[] = [];
    // Chromium's screencast sends a frame whenever the page repaints, with its own timestamp, which
    // becomes the GIF's frame delay; much smoother than a screenshot loop. Captured at the full viewport; the GIF is scaled down in encode().
    const cdp = await ctx.newCDPSession(page);
    let t0 = -1;
    cdp.on("Page.screencastFrame", (f: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
      const t = (f.metadata.timestamp ?? performance.now() / 1000) * 1000;
      if (t0 < 0) t0 = t;
      frames.push({ t: t - t0, png: Buffer.from(f.data, "base64") });
      void cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send("Page.startScreencast", { format: "png", maxWidth: opt.width, maxHeight: opt.height, everyNthFrame: 1 });
    const start = performance.now();
    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    // a still page sends no frames, so the first one is forced by a repaint
    await page.evaluate(() => { document.body.style.outline = "0 solid transparent"; });
    let posterIdx = -1;
    // a still page sends no frames, so the last frame received is what is on screen
    const hits: { where: string; line: string }[] = [];
    // the text a viewer reads: the title, the page text and every visible SVG label (not ids or storage keys)
    const check = async (where: string) => {
      if (!opt.forbid.length) return;
      const text = await page.evaluate(() => [document.title, document.body.innerText,
        ...[...document.querySelectorAll("svg text")].filter((n) => { const b = n.getBoundingClientRect(); return b.width > 0 && b.height > 0; }).map((n) => n.textContent ?? "")].join("\n"));
      for (const line of findForbidden(text, opt.forbid)) hits.push({ where, line });
    };
    await act(page, wait, tours, async (k, i) => {
      if (k === 0 && i + 1 === opt.posterStep) posterIdx = frames.length - 1;
      await check(`tour ${tours[k]} step ${i + 1}`);
    }, () => performance.now() - start, check);
    await cdp.send("Page.stopScreencast");
    if (hits.length) throw new Error(`forbidden text on screen: ${hits.map((h) => `[${h.where}] ${h.line}`).join("; ")}`);
    if (!frames.length) throw new Error("the screencast sent no frames");
    frames.push({ t: Math.max(frames.at(-1)!.t + 100, performance.now() - start), png: frames.at(-1)!.png });
    if (video) {
      const v = page.video();
      await ctx.close();
      mkdirSync(dirname(video), { recursive: true });
      await v!.saveAs(video);
    }
    return { frames, posterIdx };
  } finally {
    await browser.close();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
}

/** Encodes the frames in a blank Chromium page: decode each PNG on a canvas, one shared palette, unchanged pixels transparent. */
async function encode(frames: Frame[]): Promise<Buffer> {
  // at most `fps` frames a second (the screencast sends up to 60, which a GIF can't afford), each
  // showing the latest repaint; identical consecutive frames become one longer frame
  const runs: { png: Buffer; ms: number }[] = [];
  const end = frames.at(-1)!.t, tick = 1000 / opt.fps;
  for (let t = 0, i = 0; t < end; t += tick) {
    while (i + 1 < frames.length && frames[i + 1].t <= t) i++;
    if (runs.length && runs.at(-1)!.png.equals(frames[i].png)) runs.at(-1)!.ms += tick;
    else runs.push({ png: frames[i].png, ms: tick });
  }
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const lib = readFileSync(join(root, "node_modules/gifenc/dist/gifenc.js"), "utf8");
    await page.addScriptTag({ content: `(()=>{var exports={};${lib};window.gifenc=exports})()` });
    const w = opt.gifWidth, h = Math.round((opt.height * w) / opt.width);
    await page.evaluate(({ w, h }) => {
      const g = (window as any).gifenc;
      const c = Object.assign(document.createElement("canvas"), { width: w, height: h });
      const cx = c.getContext("2d", { willReadFrequently: true })!;
      cx.imageSmoothingQuality = "high";
      const s: any = (window as any).enc = { g, cx, gif: g.GIFEncoder(), prev: null as Uint8Array | null, palette: null as number[][] | null, carry: 0 };
      s.rgba = async (b64: string) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        cx.drawImage(img, 0, 0, w, h);
        return cx.getImageData(0, 0, w, h).data;
      };
    }, { w, h });
    // the palette from a sample of frames across the recording; index 255 is kept for "unchanged"
    const sample = [0, 0.25, 0.5, 0.75, 1].map((f) => runs[Math.min(runs.length - 1, Math.floor(f * runs.length))].png.toString("base64"));
    await page.evaluate(async (pngs) => {
      const s = (window as any).enc;
      const parts = await Promise.all(pngs.map((p: string) => s.rgba(p)));
      const all = new Uint8ClampedArray(parts.reduce((n: number, p: Uint8ClampedArray) => n + p.length, 0));
      let o = 0;
      for (const p of parts) { all.set(p, o); o += p.length; }
      s.palette = s.g.quantize(all, 255);
      s.palette.push([255, 0, 255]);
    }, sample);
    for (const [i, r] of runs.entries()) {
      await page.evaluate(async ({ png, ms, first }) => {
        const s = (window as any).enc;
        const idx: Uint8Array = s.g.applyPalette(await s.rgba(png), s.palette);
        const out = idx.slice();
        if (s.prev) for (let k = 0; k < idx.length; k++) if (idx[k] === s.prev[k]) out[k] = 255;
        s.prev = idx;
        // GIF delays are in centiseconds; carry the rounding so the total time stays right
        const exact = ms / 10 + s.carry, cs = Math.max(2, Math.round(exact));
        s.carry = exact - cs;
        s.gif.writeFrame(out, s.cx.canvas.width, s.cx.canvas.height, { palette: first ? s.palette : undefined, delay: cs * 10, transparent: true, transparentIndex: 255, dispose: 1, repeat: 0 });
      }, { png: r.png.toString("base64"), ms: r.ms, first: i === 0 });
    }
    const b64: string = await page.evaluate(() => {
      const s = (window as any).enc;
      s.gif.finish();
      const bytes: Uint8Array = s.gif.bytes();
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    });
    return Buffer.from(b64, "base64");
  } finally {
    await browser.close();
  }
}

/** Opens the diagram and reads the grouping's tours from the viewer's hook. */
async function listTours(): Promise<{ repo: string; tours: { id: string; title: string; steps: number }[] }> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext({ viewport: { width: opt.width, height: opt.height } })).newPage();
    await page.goto(pathToFileURL(opt.diagram).href);
    await page.waitForFunction(() => (window as any).__repoladder, null, { timeout: 10_000 });
    const r = await page.evaluate(() => { const h = (window as any).__repoladder; return typeof h.tours === "function" ? { repo: document.title.replace(/ architecture$/, ""), tours: h.tours().map((t: any) => ({ id: t.id, title: t.title, steps: t.steps.length })) } : null; });
    if (!r) throw new Error(`${opt.diagram} predates the tours hook: rebuild it with \`npm run gallery -- --only <repo>\``);
    return r;
  } finally {
    await browser.close();
  }
}

/** Records `tours` and writes the clip to `out` in `opt.format`; returns the summary line. */
async function clip(tours: string[], out: string, check?: (r: { frames: Frame[]; posterIdx: number }) => void): Promise<{ frames: Frame[]; posterIdx: number; summary: string }> {
  const webm = opt.format === "webm";
  const rec = await record(tours, webm ? out : undefined);
  check?.(rec);
  const frames = trimFrames(rec.frames, opt.maxSeconds * 1000);
  const secs = (frames.at(-1)!.t / 1000).toFixed(1);
  if (opt.frames) {
    mkdirSync(opt.frames, { recursive: true });
    frames.forEach((f, i) => writeFileSync(join(opt.frames, `${String(i).padStart(4, "0")}-${Math.round(f.t)}ms.png`), f.png));
  }
  if (webm) return { ...rec, summary: `${out}\n${secs}s → ${(readFileSync(out).length / 1024 / 1024).toFixed(2)}MB WebM at ${opt.gifWidth}px` };
  const gif = await encode(frames);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, gif);
  return { ...rec, summary: `${out}\n${frames.length} screenshots over ${secs}s → ${(gif.length / 1024 / 1024).toFixed(2)}MB GIF at ${opt.gifWidth}px` };
}

async function main() {
  opt = parseArgs(process.argv.slice(2));
  if (!existsSync(opt.diagram)) throw new Error(`${opt.diagram} not found: run \`npm run gallery -- --only repoladder --title RepoLadder\` first, or pass --diagram`);
  if (opt.list) {
    const { tours } = await listTours();
    if (!tours.length) process.stderr.write(`no tours in ${opt.diagram}\n`);
    for (const t of tours) process.stdout.write(`${t.id}\t${t.steps} steps\t${t.title}\n`);
    return;
  }
  if (opt.allTours) {
    const { repo, tours } = await listTours();
    if (!tours.length) throw new Error(`no tours in ${opt.diagram}`);
    let ok = 0;
    for (const t of tours) {
      try {
        const r = await clip([t.id], clipPath(opt.outDir, repo, t.id, opt.format));
        process.stdout.write(`${r.summary}\n`);
        ok++;
      } catch (e) {
        process.stderr.write(`FAILED ${t.id}: ${(e as Error).message}\n`);
        process.exitCode = 1;
      }
    }
    process.stdout.write(`${ok}/${tours.length} clips → ${opt.outDir}\n`);
    return;
  }
  const r = await clip(opt.tours, opt.out, (rec) => { if (opt.poster && rec.posterIdx < 0) throw new Error("--poster-step N is past the first tour's steps"); });
  if (opt.video) {
    mkdirSync(opt.video, { recursive: true });
    for (const f of readdirSync(opt.video)) if (/^\d{5}\.png$/.test(f) || f === "frames.ffconcat") rmSync(join(opt.video, f));
    r.frames.forEach((f, i) => writeFileSync(join(opt.video, `${String(i).padStart(5, "0")}.png`), f.png));
    const ts = r.frames.map((f) => f.t);
    writeFileSync(join(opt.video, "frames.ffconcat"), ffconcat(ts));
    process.stdout.write(`video: ${r.frames.length} frames over ${(r.frames.at(-1)!.t / 1000).toFixed(1)}s, motion ~${motionFps(ts)} fps → ${join(opt.video, "frames.ffconcat")}\n`);
  }
  if (opt.poster) {
    mkdirSync(dirname(opt.poster), { recursive: true });
    writeFileSync(opt.poster, r.frames[r.posterIdx].png);
    process.stdout.write(`${opt.poster}\nposter: frame ${r.posterIdx} at ${(r.frames[r.posterIdx].t / 1000).toFixed(1)}s\n`);
  }
  process.stdout.write(`${r.summary}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
