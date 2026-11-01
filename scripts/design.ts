// Design check: one sheet with every panel state of the viewer on offline sample maps, to look at while
// redesigning the viewer and to compare a base build against a PR build.
// Usage: npm run design [-- --out <dir>] [-- --compare <earlier design dir>]
//   Builds test/fixtures/tourapp and test/fixtures/checkin to a temp dir (no network, no Claude), drives the
//   viewer into each state through its existing hooks, and writes <out>/index.html (default .gallery/design/).
//   --compare reads the earlier run's manifest.json and writes compare.html plus a side-by-side PNG per
//   changed state and mode under <out>/compare/. --demos is reserved (needs network); it exits 2.
// Prints DESIGN_SKIP <state> <reason> for a state the fixtures cannot produce, DESIGN_OK, and with --compare DESIGN_COMPARE.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { THEMES, type ThemeName } from "@repoladder/brand";
import { esc } from "../src/viewer/esc.ts";
import { ELEVATION, SHAPE, SPACE, THEMES as VIEWER } from "../src/viewer/theme.ts";
import { MODES, planCompare, renderCompare, shotFile, type CompareRow, type Manifest, type ModeId, type ShotBoard, type ShotRepo } from "./shots.ts";
import { shellTokens } from "./shellstyle.ts";

type Page = import("playwright").Page;

/** Every DOM selector this script uses, so a rename in the viewer breaks in one place. */
export const SEL = {
  board: "svg.board",
  hit: "svg.board g[data-hit]",
  searchOpen: "button.sbtn",
  search: "div.search[role=dialog]",
  searchInput: "div.search input[type=search]",
  sheet: "aside[data-sheet]",
  grip: "aside .grip",
  walkCard: ".walk-card",
  inspectorToggle: "#insp",
  zoom: ".zoom",
  dial: ".dial",
  copyRow: "p.idrow",
  filterBar: "#fbar",
  legendToggle: "button.lgt[data-filter]",
  filterReset: "#fbar [data-freset]",
} as const;

export const DESIGN_MODES = ["desktop", "phone", "all"] as const;
export type DesignMode = (typeof DESIGN_MODES)[number];

export interface Fixture { id: string; dir: string; grouping?: string; query: string }
export const FIXTURES: Fixture[] = [
  { id: "tourapp", dir: "tourapp", query: "fire" },
  { id: "checkin", dir: "checkin", grouping: "grouping.json", query: "check" },
];

/** What a state's `run` gets: the page, which kind of device it is, and what the built page offers. */
export interface Ctx { page: Page; phone: boolean; hits: string[]; boards: string[]; tours: string[]; fixture: Fixture }
/** A state's `run` drives the page into it, or returns the reason it cannot be reached on this fixture. */
export interface State { id: string; label: string; mode: DesignMode; fixture: string; run: (c: Ctx) => Promise<string | void> }

const STORY = "_story";
const nodeHit = (c: Ctx) => c.hits.find((h) => h.startsWith("n:") && !/^n:(svc|store)-/.test(h));
const frames = (p: Page) => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
/** Waits for the hook, the fonts, any running animation and two frames; then until the board holds still. */
export async function settle(p: Page): Promise<void> {
  await p.waitForFunction(() => (window as any).__repoladder, null, { timeout: 30000 });
  await p.evaluate(() => document.fonts?.ready);
  await p.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
  await frames(p);
  // the viewer's glides are script-driven: wait until the board holds still for two samples
  let prev = "";
  for (let i = 0; i < 20; i++) {
    await p.waitForTimeout(300);
    const now = await p.evaluate((s) => [...document.querySelectorAll(s)].map((e) => { const r = e.getBoundingClientRect(); return `${r.x.toFixed(1)},${r.y.toFixed(1)},${r.width.toFixed(1)}`; }).join(";") + document.querySelector("aside")?.getBoundingClientRect().height, SEL.hit);
    if (now === prev) break;
    prev = now;
  }
  await frames(p);
}
/** A screenshot taken again until two in a row are byte-equal, so late raster work cannot make runs differ. */
export async function steadyShot(p: Page): Promise<Buffer> {
  let prev = await p.screenshot({ animations: "disabled", caret: "hide" });
  for (let i = 0; i < 8; i++) {
    await p.waitForTimeout(250);
    const next = await p.screenshot({ animations: "disabled", caret: "hide" });
    if (next.equals(prev)) return next;
    prev = next;
  }
  return prev;
}
/** Clicks a drawn box or arrow by its data-hit (a click on the arrow's geometry would miss thin lines). */
const pick = (p: Page, hit: string) => p.evaluate((h) => {
  const g = [...document.querySelectorAll<SVGGElement>("svg.board g[data-hit]")].find((e) => e.dataset.hit === h);
  g?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  return !!g;
}, hit);
const gripClicks = async (p: Page, n: number) => { for (let i = 0; i < n; i++) { await p.locator(SEL.grip).click(); await p.waitForTimeout(900); await settle(p); } };
const first = (c: Ctx, prefix: string) => c.hits.find((h) => h.startsWith(prefix));

export const STATES: State[] = [
  { id: "overview", label: "Overview (nothing selected)", mode: "all", fixture: "tourapp", run: async () => undefined },
  { id: "inspector-closed", label: "Inspector closed (the default)", mode: "desktop", fixture: "tourapp", run: async () => undefined },
  { id: "inspector-open-overview", label: "Inspector opened by the toggle, nothing selected", mode: "desktop", fixture: "tourapp", run: async (c) => {
    await c.page.locator(SEL.inspectorToggle).click();
    await c.page.waitForTimeout(400);
  } },
  { id: "selected-node", label: "A box selected", mode: "all", fixture: "tourapp", run: async (c) => {
    const h = nodeHit(c); if (!h) return "no part box on the root board";
    await pick(c.page, h);
  } },
  { id: "selected-edge", label: "An arrow selected", mode: "all", fixture: "tourapp", run: async (c) => {
    const h = first(c, "e:"); if (!h) return "no arrow on the root board";
    await pick(c.page, h);
  } },
  { id: "service-panel", label: "A service selected", mode: "all", fixture: "tourapp", run: async (c) => {
    const h = first(c, "n:svc-"); if (!h) return "no service box on the root board";
    await pick(c.page, h);
  } },
  { id: "store-panel", label: "A data store selected", mode: "all", fixture: "tourapp", run: async (c) => {
    const h = first(c, "n:store-"); if (!h) return "no store box on the root board";
    await pick(c.page, h);
  } },
  { id: "deep-board", label: "A nested board with a box selected", mode: "all", fixture: "checkin", run: async (c) => {
    // the board with the most part boxes below the root
    let best = "", most = 0;
    for (const id of c.boards) {
      if (id === "root" || id === STORY || /^(store|svc)-/.test(id)) continue;
      await c.page.evaluate((id) => (window as any).__repoladder.show(id), id);
      const n = await c.page.evaluate((s) => [...document.querySelectorAll<SVGGElement>(s)].filter((g) => g.dataset.hit!.startsWith("n:")).length, SEL.hit);
      if (n > most) { best = id; most = n; }
    }
    if (!best) return "no nested board";
    await c.page.evaluate((id) => (window as any).__repoladder.show(id), best);
    await settle(c.page);
    const h = await c.page.evaluate((s) => [...document.querySelectorAll<SVGGElement>(s)].map((g) => g.dataset.hit!).find((x) => x.startsWith("n:")), SEL.hit);
    if (h) await pick(c.page, h);
  } },
  { id: "tour-step", label: "A tour step with its walk card", mode: "all", fixture: "tourapp", run: async (c) => {
    if (!c.tours.length) return "no tour on this map";
    await c.page.evaluate((id) => (window as any).__repoladder.tour(id, 1), c.tours[0]);
    if (!(await c.page.waitForSelector(SEL.walkCard, { timeout: 3000 }).then(() => true, () => false))) return "the tour did not play";
  } },
  { id: "search-open", label: "Search open with results", mode: "all", fixture: "tourapp", run: async (c) => {
    await c.page.locator(SEL.searchOpen).click();
    await c.page.locator(SEL.searchInput).fill(c.fixture.query);
  } },
  { id: "story-overview", label: "Story board overview", mode: "all", fixture: "checkin", run: async (c) => {
    if (!c.boards.includes(STORY)) return "this map has no story board";
    await c.page.evaluate((id) => (window as any).__repoladder.show(id), STORY);
  } },
  { id: "sheet-peek", label: "Phone sheet: peek", mode: "phone", fixture: "tourapp", run: async (c) => {
    const h = nodeHit(c); if (!h) return "no part box on the root board";
    await pick(c.page, h); await settle(c.page); await gripClicks(c.page, 2);
  } },
  { id: "sheet-half", label: "Phone sheet: half", mode: "phone", fixture: "tourapp", run: async (c) => {
    const h = nodeHit(c); if (!h) return "no part box on the root board";
    await pick(c.page, h);
  } },
  { id: "sheet-full", label: "Phone sheet: full", mode: "phone", fixture: "tourapp", run: async (c) => {
    const h = nodeHit(c); if (!h) return "no part box on the root board";
    await pick(c.page, h); await settle(c.page); await gripClicks(c.page, 1);
  } },
];

export const modesOf = (m: DesignMode): ModeId[] => MODES.filter((x) => (m === "all" ? true : m === "phone" ? x.id.startsWith("phone") : !x.id.startsWith("phone"))).map((x) => x.id);

/** A state the sheet shows: a ShotBoard that also says which modes it was shot in. */
export interface DesignBoard extends ShotBoard { modes: ModeId[] }

/** What the viewer's live CSS says, read in the run: shape tokens, the type scale if the viewer has one, and crops of its controls. */
export interface Reference {
  radius: string;
  pill: string;
  /** The viewer's `--text-*` variables; null when it has none yet. */
  textScale: { name: string; value: string }[] | null;
  /** Crops of the viewer's real controls, as paths relative to the output directory. */
  controls: { id: string; label: string; file: string }[];
}

/**
 * Pairs two design runs by state and mode; a mode a state was not shot in on both sides counts as unchanged.
 * Two PNGs that differ in bytes count as the same when `similar` says so (antialiasing noise between runs).
 */
export function compareDesign(before: Manifest, after: Manifest, read: (side: "before" | "after", file: string) => Uint8Array | null, similar?: (a: Uint8Array, b: Uint8Array) => boolean): CompareRow[] {
  return planCompare(before, after, (bf, af) => {
    const x = read("before", bf), y = read("after", af);
    if (!x && !y) return true;
    return !!x && !!y && (Buffer.from(x).equals(Buffer.from(y)) || !!similar?.(x, y));
  });
}

/** Pixels (RGBA, same size) that differ by more than `delta` in some channel, beyond which two shots show different things. */
export const PIXEL_DELTA = 16;
export const PIXEL_SHARE = 0.002;
export function pixelsDiffer(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return true;
  let n = 0;
  for (let i = 0; i < a.length; i += 4) if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > PIXEL_DELTA) n++;
  return n > (a.length / 4) * PIXEL_SHARE;
}

const SHEET_CSS = `
${shellTokens()}
${floatTokens()}
body{margin:0;background:var(--ground);color:var(--ink);font:14px/1.45 var(--font-ui);padding:16px;box-sizing:border-box}
a{color:var(--accent)}h1{font-size:18px;margin:0 0 4px}h2{font-size:15px;margin:28px 0 8px}h3{font-size:13px;margin:0 0 8px;font-weight:600}
.muted,.sub{color:var(--muted)}.sub{margin:0 0 12px;font-size:13px}code{font-family:var(--font-mono);font-size:12px}
nav{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:13px}
.state,.ref{background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:10px 12px;margin-bottom:12px}
.state h3 code{font-weight:400;color:var(--muted)}
.modes{display:grid;grid-template-columns:1fr 1fr .3fr;gap:10px;align-items:start}.modes.phone{grid-template-columns:minmax(0,260px)}.modes.desktop{grid-template-columns:1fr 1fr}
figure{margin:0;min-width:0}figcaption{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:3px}
img{max-width:100%;height:auto;display:block;border:1px solid var(--line);border-radius:4px}
.sw{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:6px}.sw div{font:11px var(--font-mono);border:1px solid var(--line);border-radius:4px;overflow:hidden}
.sw i{display:block;height:28px}.sw span{display:block;padding:2px 4px;color:var(--ink)}
.row{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}.ctl{display:flex;flex-direction:column;gap:4px}
.btns{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.b{font:600 13px var(--font-ui);padding:6px 12px;border:1px solid var(--line);background:var(--surface);color:var(--ink)}
.b.primary{background:var(--accent);border-color:var(--accent);color:var(--ground)}.b.ghost{background:transparent}
.skip{color:var(--muted);font-size:12px}
.fl{display:flex;flex-wrap:wrap;gap:var(--space-4);padding:var(--space-5);background:var(--ground);border:1px solid var(--line);border-radius:var(--radius)}
.fl div{min-width:120px;padding:var(--space-4);border:1px solid var(--line);border-radius:var(--radius);color:var(--ink);font:12px var(--font-mono)}
.fl .t1{background:var(--float);box-shadow:var(--shadow-1)}.fl .t2{background:var(--float);box-shadow:var(--shadow-2)}.fl .t3{background:var(--float-raised);box-shadow:var(--shadow-3)}
.fl .t1.r{background:var(--float-raised)}.fl .in{display:block;margin-top:var(--space-2);padding:var(--space-2);border-radius:var(--radius-sm);background:var(--line)}
.ruler{display:flex;flex-direction:column;gap:var(--space-2);margin-top:var(--space-4)}.ruler span{display:flex;align-items:center;gap:var(--space-3);font:12px var(--font-mono)}.ruler i{display:block;height:var(--space-3);background:var(--accent)}
@media (max-width:760px){.modes,.modes.desktop{grid-template-columns:1fr}}
`;

/** The viewer's floating-chrome tokens (not in the shell tokens), so the "Floating surfaces" specimen uses the real values. */
function floatTokens(): string {
  const c = (t: ThemeName) => `--shadow:${VIEWER[t].shadow};--float:${VIEWER[t].float};--float-raised:${VIEWER[t]["float-raised"]};`;
  const kv = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `--${k}:${v};`).join("");
  return `:root{${kv(SHAPE)}${kv(SPACE)}${kv(ELEVATION)}${c("light")}}\n`
    + `@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${c("dark")}}}\n:root[data-theme="dark"]{${c("dark")}}`;
}

const themeSwatches = (t: ThemeName) => `<div class="sw">${Object.entries(THEMES[t]).map(([k, v]) => `<div><i style="background:${esc(v)}"></i><span>${esc(k)}</span></div>`).join("")}</div>`;

/** The design sheet: a section per state with its modes side by side, then the reference to compare against the site. */
export function renderDesignSheet(m: Manifest, ref: Reference, skipped: string[] = []): string {
  const states = m.repos.flatMap((r) => r.boards.map((b) => ({ repo: r.name, b: b as DesignBoard })));
  const nav = m.repos.map((r) => `<a href="#${esc(r.name)}">${esc(r.name)} <span class="muted">${r.boards.length}</span></a>`).join("");
  const section = ({ repo, b }: { repo: string; b: DesignBoard }) => {
    const ms = MODES.filter((x) => b.modes.includes(x.id));
    const cls = b.modes.every((x) => x.startsWith("phone")) ? "phone" : b.modes.some((x) => x.startsWith("phone")) ? "" : "desktop";
    return `<section class="state" id="${esc(`${repo}-${b.id}`)}"><h3>${esc(b.label)} <code>${esc(b.id)}</code></h3><div class="modes ${cls}">${ms.map((x) => `<figure><figcaption>${esc(x.label)}</figcaption><a href="${esc(shotFile(repo, b.slug, x.id))}"><img loading="lazy" src="${esc(shotFile(repo, b.slug, x.id))}" alt="${esc(`${b.label}, ${x.label}`)}"></a></figure>`).join("")}</div></section>`;
  };
  const byRepo = m.repos.map((r) => `<h2 id="${esc(r.name)}">${esc(r.name)}</h2>\n${states.filter((s) => s.repo === r.name).map(section).join("\n")}`).join("\n");
  const type = ref.textScale
    ? `<h3>Type scale (the viewer's <code>--text-*</code> variables)</h3><div>${ref.textScale.map((t) => `<p style="margin:2px 0;font-size:${esc(t.value)}">${esc(t.name)} <span class="muted">${esc(t.value)}</span> The quick brown fox</p>`).join("")}</div>`
    : `<h3>Type scale</h3><p class="skip">Not shown: the viewer has no <code>--text-*</code> variables yet, and the brand package exports no step sizes.</p>`;
  const controls = ref.controls.length
    ? `<div class="row">${ref.controls.map((c) => `<div class="ctl"><figcaption>${esc(c.label)}</figcaption><img src="${esc(c.file)}" alt="${esc(c.label)}" style="max-width:none"></div>`).join("")}</div>`
    : `<p class="skip">No control crops were captured.</p>`;
  const approx = `<div class="btns" role="img" aria-label="approximation of the site's buttons">${(["primary", "", "ghost"] as const).map((v) => `<span class="b ${v}" style="border-radius:${esc(ref.radius)}">${v || "secondary"}</span>`).join("")}${(["primary", "", "ghost"] as const).map((v) => `<span class="b ${v}" style="border-radius:${esc(ref.pill)}">${v || "secondary"} pill</span>`).join("")}</div>`;
  const reference = `<h2 id="reference">Compare against the site</h2>
<section class="ref"><h3>Theme tokens (${Object.keys(THEMES.light).length} per theme, from <code>@repoladder/brand</code>)</h3>
<p class="sub">Light</p>${themeSwatches("light")}<p class="sub">Dark</p>${themeSwatches("dark")}</section>
<section class="ref"><h3>Shape</h3><div class="btns"><span class="b" style="border-radius:${esc(ref.radius)};padding:18px 28px">--radius ${esc(ref.radius)}</span><span class="b" style="border-radius:${esc(ref.pill)};padding:10px 28px">--pill ${esc(ref.pill)}</span></div></section>
<section class="ref"><h3>Floating surfaces</h3><div class="fl"><div class="t1">--float<br>--shadow-1<span class="in">--radius-sm</span></div><div class="t1 r">--float-raised<br>--shadow-1</div><div class="t2">--float<br>--shadow-2</div><div class="t3">--float-raised<br>--shadow-3</div></div>
<div class="ruler">${[1, 2, 3, 4, 5, 6].map((n) => `<span><i style="width:var(--space-${n})"></i>--space-${n}</span>`).join("")}</div></section>
<section class="ref">${type}</section>
<section class="ref"><h3>The viewer's controls</h3>${controls}<h3 style="margin-top:14px">Plain-HTML approximation of the site's buttons (approximation, not the site)</h3>${approx}
<p class="sub">Built from the brand tokens above. A live side-by-side with the site is deferred to the site redesign tickets.</p></section>`;
  const total = states.reduce((n, s) => n + s.b.modes.length, 0);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RepoLadder Design Check</title><style>${SHEET_CSS.trim()}</style></head><body>
<h1>RepoLadder design check</h1>
<p class="sub">${states.length} states · ${total} shots · repoladder ${esc(m.repoladderSha.slice(0, 7))} · desktop 1280×800, phone 390×844 · <a href="#reference">reference</a></p>
<nav>${nav}</nav>
${skipped.length ? `<p class="skip">Skipped: ${skipped.map(esc).join("; ")}</p>` : ""}
${byRepo}
${reference}
</body></html>
`;
}

/** The `--text-*` custom properties the viewer's CSS declares, in order; null when it has none. */
const readTextScale = (p: Page) => p.evaluate(() => {
  const out: { name: string; value: string }[] = [];
  for (const sheet of [...document.styleSheets]) {
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const r of [...rules]) {
      const s = (r as CSSStyleRule).style;
      if (!s || (r as CSSStyleRule).selectorText !== ":root") continue;
      for (const n of [...s]) if (n.startsWith("--text-") && !out.some((o) => o.name === n)) out.push({ name: n, value: s.getPropertyValue(n).trim() });
    }
  }
  return out.length ? out : null;
});

function usage(msg: string): never { throw new Error(msg); }

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--demos")) {
    process.stdout.write("--demos is reserved (gallery demos, needs network); not built in v1\n");
    process.exit(2);
  }
  const flag = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const outDir = resolve(flag("out") ?? join(root, ".gallery", "design"));
  const compareDir = flag("compare") ? resolve(flag("compare")!) : undefined;
  const rel = (p: string) => relative(process.cwd(), p) || ".";
  if (compareDir && !existsSync(join(compareDir, "manifest.json"))) usage(`${rel(compareDir)}/manifest.json not found; point --compare at an earlier design directory`);
  if (compareDir === outDir) usage("--compare must be a different directory from the output (copy the old run aside first)");

  const { chromium } = await import("playwright");
  const t0 = performance.now();
  const tmp = mkdtempSync(join(tmpdir(), "design-"));
  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  try { browser = await chromium.launch({ args: ["--font-render-hinting=none", "--force-color-profile=srgb", "--disable-lcd-text"] }); } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    throw new Error(`Chromium is not available (${(e as Error).message.split("\n")[0]}); run \`npx playwright install chromium\``);
  }
  const skipped: string[] = [];
  try {
    const pages = new Map<string, string>();
    for (const f of FIXTURES) {
      const out = join(tmp, f.id), src = join(root, "test", "fixtures", f.dir);
      execFileSync("node", [join(root, "src", "cli.ts"), "build", src, "--quiet", "--out", out, ...(f.grouping ? ["--grouping", join(src, f.grouping)] : ["--default"])], { stdio: ["ignore", "ignore", "inherit"] });
      pages.set(f.id, pathToFileURL(join(out, "diagram.html")).href);
    }
    rmSync(join(outDir, "compare"), { recursive: true, force: true });
    rmSync(join(outDir, "compare.html"), { force: true });
    rmSync(join(outDir, "controls"), { recursive: true, force: true });
    for (const f of FIXTURES) { rmSync(join(outDir, f.id), { recursive: true, force: true }); mkdirSync(join(outDir, f.id), { recursive: true }); }

    const boards = new Map<string, DesignBoard[]>(FIXTURES.map((f) => [f.id, []]));
    const ref: Reference = { radius: "", pill: "", textScale: null, controls: [] };
    for (const mode of MODES) {
      const phone = mode.id.startsWith("phone");
      // Not isMobile: diagram.html has no viewport meta, and mobile emulation would lay it out at 980px (as scripts/shots.ts).
      const ctx = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, deviceScaleFactor: mode.scale, colorScheme: mode.scheme, hasTouch: phone, reducedMotion: "reduce" });
      const p = await ctx.newPage();
      for (const st of STATES) {
        if (!modesOf(st.mode).includes(mode.id)) continue;
        const fixture = FIXTURES.find((f) => f.id === st.fixture)!;
        await p.goto(pages.get(fixture.id)!);
        // overlay scrollbars fade in and out on a timer, which would make shots differ run to run
        await p.addStyleTag({ content: "*{scrollbar-width:none!important}" });
        await settle(p);
        const c: Ctx = {
          page: p, phone, fixture,
          hits: await p.evaluate((s) => [...document.querySelectorAll<SVGGElement>(s)].map((g) => g.dataset.hit!), SEL.hit),
          boards: await p.evaluate(() => (window as any).__repoladder.boards),
          tours: (await p.evaluate(() => (window as any).__repoladder.tours())).map((t: { id: string }) => t.id),
        };
        const why = await st.run(c);
        if (why) { const line = `${st.id} ${why}`; if (!skipped.includes(line)) skipped.push(line); continue; }
        // no hover or focus ring left over from the setup clicks
        await p.mouse.move(0, 0);
        await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
        await settle(p);
        await p.waitForTimeout(1000);
        const list = boards.get(fixture.id)!;
        let b = list.find((x) => x.id === st.id);
        if (!b) { b = { id: st.id, label: st.label, slug: st.id, modes: [] }; list.push(b); }
        b.modes.push(mode.id);
        writeFileSync(join(outDir, shotFile(fixture.id, st.id, mode.id)), await steadyShot(p));
      }
      if (mode.id === MODES[0].id) {
        // the reference: shape tokens, type scale and crops of the real controls, from the first fixture on desktop light
        await p.goto(pages.get(FIXTURES[0].id)!);
        await settle(p);
        const shape = await p.evaluate(() => { const s = getComputedStyle(document.documentElement); return { radius: s.getPropertyValue("--radius").trim(), pill: s.getPropertyValue("--pill").trim() }; });
        ref.radius = shape.radius || "12px"; ref.pill = shape.pill || "999px";
        ref.textScale = await readTextScale(p);
        mkdirSync(join(outDir, "controls"), { recursive: true });
        const crops: [string, string, string][] = [["zoom", "Zoom and fit", SEL.zoom], ["dial", "Detail dial", SEL.dial], ["copy", "Copy pills", SEL.copyRow], ["search", "Search button", SEL.searchOpen], ["filters", "Filter chips", SEL.filterBar]];
        // the chips card shows only while a filter is on (remembered in localStorage, so it is reset after the crop)
        // the legend sits in the overview's More, inside the inspector: open both first
        if ((await p.locator(SEL.inspectorToggle).isVisible()) && (await p.locator(SEL.inspectorToggle).getAttribute("aria-pressed")) !== "true") { await p.locator(SEL.inspectorToggle).click(); await p.waitForTimeout(400); }
        await p.evaluate(() => document.querySelectorAll<HTMLDetailsElement>("details.more").forEach((d) => { d.open = true; }));
        const toggle = p.locator(SEL.legendToggle).first();
        if (await toggle.count()) await toggle.click();
        for (const [id, label, sel] of crops) {
          const el = p.locator(sel).first();
          if (!(await el.count()) || !(await el.isVisible())) { skipped.push(`control-${id} not visible on the overview`); continue; }
          const file = `controls/${id}.png`;
          await el.screenshot({ path: join(outDir, file), animations: "disabled", caret: "hide" });
          ref.controls.push({ id, label, file });
        }
        if (await p.locator(SEL.filterReset).count()) await p.locator(SEL.filterReset).click();
      }
      await ctx.close();
    }

    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const repos: ShotRepo[] = FIXTURES.map((f) => ({ name: f.id, boards: boards.get(f.id)! })).filter((r) => r.boards.length);
    const manifest: Manifest = { repoladderSha: sha, repos };
    writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 1) + "\n");
    writeFileSync(join(outDir, "index.html"), renderDesignSheet(manifest, ref, skipped));
    const n = repos.reduce((k, r) => k + r.boards.length, 0);
    process.stdout.write(`${rel(join(outDir, "index.html"))}\n`);

    if (compareDir) {
      const before: Manifest = JSON.parse(readFileSync(join(compareDir, "manifest.json"), "utf8"));
      const bytes = (f: string) => (existsSync(f) ? readFileSync(f) : null);
      const cache = new Map<string, Uint8Array | null>();
      const read = (side: "before" | "after", f: string) => { const k = `${side}:${f}`; if (!cache.has(k)) cache.set(k, bytes(join(side === "before" ? compareDir : outDir, f))); return cache.get(k)!; };
      // PNGs that differ in bytes are decoded in the browser and compared by pixels, so antialiasing noise between runs is not a change
      const pending: [Uint8Array, Uint8Array][] = [];
      compareDesign(before, manifest, read, (x, y) => { pending.push([x, y]); return false; });
      const verdicts = new Map<Uint8Array, boolean>();
      const dp = await browser.newPage();
      for (const [x, y] of pending) {
        const px = (u: Uint8Array) => `data:image/png;base64,${Buffer.from(u).toString("base64")}`;
        const [da, db] = await dp.evaluate(async ([u, v]) => {
          const load = (src: string) => new Promise<HTMLImageElement>((r) => { const i = new Image(); i.onload = () => r(i); i.src = src; });
          const get = (i: HTMLImageElement) => { const k = document.createElement("canvas"); k.width = i.width; k.height = i.height; const t = k.getContext("2d")!; t.drawImage(i, 0, 0); return [...t.getImageData(0, 0, i.width, i.height).data]; };
          return [get(await load(u)), get(await load(v))];
        }, [px(x), px(y)]);
        verdicts.set(x, !pixelsDiffer(Uint8Array.from(da), Uint8Array.from(db)));
      }
      await dp.close();
      const rows = compareDesign(before, manifest, read, (x) => verdicts.get(x) ?? false);
      const shown = rows.filter((x) => x.change !== "same");
      const pg = await browser.newPage({ viewport: { width: 800, height: 400 } });
      const uri = (f: string) => (existsSync(f) ? `data:image/png;base64,${readFileSync(f).toString("base64")}` : null);
      for (const r of shown) {
        const f = shotFile(r.repo, r.board.slug, r.mode);
        const pane = (label: string, src: string | null) => `<div><p>${label}</p>${src ? `<img src="${src}">` : `<div class="none">none</div>`}</div>`;
        const phone = r.mode.startsWith("phone");
        await pg.setContent(`<style>${shellTokens()}body{margin:0;background:var(--ground);font:600 15px system-ui,sans-serif;color:var(--ink)}main{display:flex;gap:16px;padding:12px;width:max-content}p{margin:0 0 6px}img{display:block;border:1px solid var(--line);${phone ? "width:390px" : ""}}.none{width:${phone ? 390 : 1280}px;height:${phone ? 844 : 800}px;display:grid;place-items:center;border:1px dashed var(--line);color:var(--muted)}h1{font-size:14px;margin:12px 12px 0}</style>
<h1>${esc(`${r.repo} · ${r.board.label} · ${r.mode}`)}</h1><main>${pane("Before", r.change === "added" ? null : uri(join(compareDir, f)))}${pane("After", r.change === "removed" ? null : uri(join(outDir, f)))}</main>`);
        mkdirSync(dirname(join(outDir, "compare", f)), { recursive: true });
        await pg.screenshot({ path: join(outDir, "compare", f), fullPage: true });
      }
      writeFileSync(join(outDir, "compare.html"), renderCompare(rows, relative(outDir, compareDir), { before: before.repoladderSha, after: sha }));
      const k = (c: string) => rows.filter((x) => x.change === c).length;
      process.stdout.write(`${rel(join(outDir, "compare.html"))}\nDESIGN_COMPARE changed=${k("changed")} added=${k("added")} removed=${k("removed")}\n`);
    }
    for (const s of skipped) process.stdout.write(`DESIGN_SKIP ${s}\n`);
    process.stdout.write(`DESIGN_OK ${n} states x ${MODES.length} modes in ${((performance.now() - t0) / 1000).toFixed(1)}s\n`);
  } finally {
    await browser.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
