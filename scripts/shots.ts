// Screenshots every board of every gallery diagram, in three modes, and writes a contact sheet.
// Usage: npm run shots [-- --repo name,name] [-- --compare <earlier shots dir>] [-- --out <dir>] [-- --demos] [-- --work <gallery dir>] [-- --tours] [-- --embed]
//   --demos shoots the launch demos (.gallery/demos); --work reads the gallery from another directory (a base
//   worktree's, for "before"); --tours plays every tour on a phone instead, a shot per step (tours.html).
// Phone board shots print `COVERED <repo> <board> <n>` for boxes under the zoom buttons, the dial or Back/Forward.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Baseline, stepState } from "./tourcheck.ts";
import { shellTokens } from "./shellstyle.ts";

export const MODES = [
  { id: "desktop-light", label: "Desktop light", width: 1280, height: 800, scheme: "light", scale: 1 },
  { id: "desktop-dark", label: "Desktop dark", width: 1280, height: 800, scheme: "dark", scale: 1 },
  { id: "phone-light", label: "Phone light", width: 390, height: 844, scheme: "light", scale: 2 },
] as const;
export type ModeId = (typeof MODES)[number]["id"];

export interface ShotBoard { id: string; label: string; slug: string; /** Phone: the boxes (data-hit) under a corner button. */ covered?: string[] }
export interface ShotRepo { name: string; boards: ShotBoard[]; warning?: string }
export interface Manifest { repoladderSha: string; repos: ShotRepo[] }

export const shotFile = (repo: string, slug: string, mode: string) => `${repo}/${slug}-${mode}.png`;

/** File-safe, unique names for board ids (ids are group paths and can hold any character). */
export function slugs(ids: string[]): string[] {
  const used = new Set<string>();
  return ids.map((id) => {
    const base = id.replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "board";
    let s = base;
    for (let i = 2; used.has(s); i++) s = `${base}-${i}`;
    used.add(s);
    return s;
  });
}

export type Change = "changed" | "added" | "removed" | "same";
export interface CompareRow { repo: string; board: ShotBoard; mode: ModeId; change: Change }

/** Pairs before/after shots by repo, board id and mode. `same` says whether two existing PNGs match. */
export function planCompare(before: Manifest, after: Manifest, same: (beforeFile: string, afterFile: string) => boolean, only?: string[]): CompareRow[] {
  const rows: CompareRow[] = [];
  const names = [...new Set([...after.repos.map((r) => r.name), ...before.repos.map((r) => r.name)])].filter((n) => !only || only.includes(n));
  for (const name of names) {
    const a = after.repos.find((r) => r.name === name), b = before.repos.find((r) => r.name === name);
    const ids = [...new Set([...(a?.boards ?? []).map((x) => x.id), ...(b?.boards ?? []).map((x) => x.id)])];
    for (const id of ids) {
      const ab = a?.boards.find((x) => x.id === id), bb = b?.boards.find((x) => x.id === id);
      for (const m of MODES) {
        const change: Change = !bb ? "added" : !ab ? "removed" : same(shotFile(name, bb.slug, m.id), shotFile(name, ab.slug, m.id)) ? "same" : "changed";
        rows.push({ repo: name, board: (ab ?? bb)!, mode: m.id, change });
      }
    }
  }
  return rows;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const SHEET_CSS = `
${shellTokens()}
body{margin:0;background:var(--ground);color:var(--ink);font:14px/1.45 var(--font-ui);padding:16px;box-sizing:border-box}
a{color:var(--accent)}h1{font-size:18px;margin:0 0 4px}h2{font-size:15px;margin:24px 0 8px}.muted,.sub{color:var(--muted)}.sub{margin:0 0 12px;font-size:13px}
nav{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:13px}
.board{background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:10px 12px;margin-bottom:12px}
.board h3{font-size:13px;margin:0 0 8px;font-weight:600}.board h3 code{font-weight:400;color:var(--muted);font-size:12px}
.row{display:grid;grid-template-columns:1fr 1fr .3fr;gap:10px;align-items:start}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:start}.pair.phone{grid-template-columns:minmax(0,220px) minmax(0,220px)}
figure{margin:0;min-width:0}figcaption{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:3px}
img{width:100%;height:auto;display:block;border:1px solid var(--line);border-radius:4px}
.missing{border:1px dashed var(--line);border-radius:4px;padding:24px 8px;text-align:center;color:var(--muted);font-size:12px}
.tag{font-size:11px;border-radius:3px;padding:0 5px;border:1px solid currentColor}.changed{color:var(--warn)}.added{color:var(--good)}.removed{color:var(--bad)}
.warn{color:var(--warn)}
@media (max-width:760px){.row,.pair,.pair.phone{grid-template-columns:1fr}}
`;

const page = (title: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${SHEET_CSS.trim()}</style></head><body>
${body}
</body></html>
`;

const img = (src: string, alt: string) => `<a href="${esc(src)}"><img loading="lazy" src="${esc(src)}" alt="${esc(alt)}"></a>`;

export function renderSheet(m: Manifest): string {
  const total = m.repos.reduce((n, r) => n + r.boards.length, 0);
  const nav = m.repos.map((r) => `<a href="#${esc(r.name)}">${esc(r.name)} <span class="muted">${r.boards.length}</span></a>`).join("");
  const repos = m.repos.map((r) => `<h2 id="${esc(r.name)}">${esc(r.name)}</h2>${r.warning ? `<p class="warn">${esc(r.warning)}</p>` : ""}
${r.boards.map((b) => `<section class="board"><h3>${esc(b.label)} <code>${esc(b.id)}</code></h3><div class="row">${MODES.map((md) => `<figure><figcaption>${md.label}</figcaption>${img(shotFile(r.name, b.slug, md.id), `${r.name} ${b.label} ${md.label}`)}</figure>`).join("")}</div></section>`).join("\n")}`).join("\n");
  return page("RepoLadder Shots", `<h1>RepoLadder shots</h1>
<p class="sub">${total} boards × ${MODES.length} modes · repoladder ${esc(m.repoladderSha.slice(0, 7))} · desktop 1280×800, phone 390×844</p>
<nav>${nav}</nav>
${repos}`);
}

export function renderCompare(rows: CompareRow[], beforeRel: string, meta: { before: string; after: string }): string {
  const shown = rows.filter((r) => r.change !== "same");
  const counts = (["changed", "added", "removed", "same"] as const).map((c) => `${rows.filter((r) => r.change === c).length} ${c}`).join(" · ");
  const fig = (label: string, src: string | null) => `<figure><figcaption>${label}</figcaption>${src ? img(src, label) : `<div class="missing">none</div>`}</figure>`;
  const body = shown.map((r) => {
    const f = shotFile(r.repo, r.board.slug, r.mode);
    const mode = MODES.find((m) => m.id === r.mode)!;
    return `<section class="board"><h3>${esc(r.repo)} · ${esc(r.board.label)} · ${mode.label} <span class="tag ${r.change}">${r.change}</span> <a href="${esc(`compare/${f}`)}">side-by-side png</a></h3>
<div class="pair${r.mode.startsWith("phone") ? " phone" : ""}">${fig("Before", r.change === "added" ? null : `${beforeRel}/${f}`)}${fig("After", r.change === "removed" ? null : f)}</div></section>`;
  }).join("\n");
  return page("Shots Compare", `<h1>Before / after</h1>
<p class="sub">${counts} · before ${esc(meta.before.slice(0, 7))} → after ${esc(meta.after.slice(0, 7))}</p>
${shown.length ? body : `<p>No board looks different.</p>`}`);
}

export interface TourRow { repo: string; tour: string; step: string; file: string; covered: string[] }

/** The tours sheet: a shot per step, the steps with a lit box under a corner button flagged; with `beforeRel`, before/after pairs by file name. */
export function renderTours(rows: TourRow[], beforeRel?: string): string {
  const covered = rows.filter((r) => r.covered.length).length;
  const fig = (label: string, src: string) => `<figure><figcaption>${label}</figcaption>${img(src, label)}</figure>`;
  const body = rows.map((r) => `<section class="board"><h3>${esc(r.repo)} · ${esc(r.tour)} · step ${esc(r.step)}${r.covered.length ? ` <span class="tag removed">covered: ${esc(r.covered.join(", "))}</span>` : ""}</h3>
<div class="pair phone">${beforeRel !== undefined ? fig("Before", `${beforeRel}/${r.file}`) : ""}${fig(beforeRel !== undefined ? "After" : "Phone", r.file)}</div></section>`).join("\n");
  return page("Tour Shots", `<h1>Tours on a phone</h1>
<p class="sub">${rows.length} steps · ${covered} with a lit box under a corner button · 390×844</p>
${body || "<p>No tours.</p>"}`);
}

type Page = import("playwright").Page;
const frames = (p: Page) => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
/** The floating controls a box must not sit under on a phone: zoom, dial, Back/Forward, the top bar and the dock. (Not the sheet: a board cropped at the readable zoom runs on under it by design, a pan away.) */
export const FLOATING = ".zoom, .dial, .canvas > .hist, header.topbar, .dock > *";
/** The data-hits of the boxes (`sel`) whose client rects meet a floating control (FLOATING). */
const underButtons = (p: Page, sel: string): Promise<string[]> => p.evaluate(([sel, floating]) => {
  const bs = [...document.querySelectorAll(floating)].map((e) => e.getBoundingClientRect()).filter((b) => b.width);
  return [...document.querySelectorAll<SVGGElement>(sel)].filter((g) => {
    const r = g.getBoundingClientRect();
    return bs.some((b) => r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top);
  }).map((g) => g.dataset.hit!);
}, [sel, FLOATING] as const);

/** Plays every tour of one diagram a step at a time, a shot per step and one after Done, and checks Done lands on the board's own fit. */
async function shootTours(p: Page, name: string, outDir: string, rows: TourRow[], base: Baseline): Promise<number> {
  const ids: string[] = await p.evaluate(() => (window as any).__repoladder.boards);
  // the tours each board's panel lists (a board's own, `@<flow>` and `@read`, played on that board), and each board's hash, to tell which board Done lands on
  const tours = new Map<string, { id: string; board?: string }>(), byHash = new Map<string, string>();
  for (const id of ids) {
    const seen = await p.evaluate((id) => {
      (window as any).__repoladder.show(id);
      return { hash: location.hash, tours: [...document.querySelectorAll<HTMLElement>("[data-tour]")].map((e) => e.dataset.tour!) };
    }, id);
    if (!byHash.has(seen.hash)) byHash.set(seen.hash, id);
    for (const t of seen.tours) tours.set(t[0] === "@" ? `${id}/${t}` : t, t[0] === "@" ? { id: t, board: id } : { id: t });
  }
  const tslugs = slugs([...tours.keys()]);
  let mismatch = 0;
  for (const [ti, [tour, { id, board: at }]] of [...tours].entries()) {
    await p.evaluate(([id, board]) => {
      if (board) (window as any).__repoladder.show(board);
      (window as any).__repoladder.tour(id, 0);
    }, [id, at] as const);
    if (!(await p.waitForSelector(".walk-card", { timeout: 3000 }).then(() => true, () => false))) { process.stdout.write(`TOUR_NOT_PLAYED ${name} ${tour}\n`); continue; }
    const n = await p.locator(".tour-dots i").count();
    for (let k = 0; k < n; k++) {
      await frames(p);
      const file = `tours/${name}/${tslugs[ti]}-${k + 1}.png`;
      await p.screenshot({ path: join(outDir, file), animations: "disabled", caret: "hide" });
      const covered = await underButtons(p, "svg.board g.wk-now[data-hit^='n:']");
      rows.push({ repo: name, tour, step: String(k + 1), file, covered });
      // #394: a tour lights what the board already draws and adds nothing of its own
      for (const what of await base.breaches(await stepState(p))) process.stdout.write(`TOUR_NEW_ELEMENT ${name} ${tour} ${k + 1} ${what}\n`);
      if (covered.length) process.stdout.write(`TOUR_COVERED ${name} ${tour} ${k + 1} ${covered.join(",")}\n`);
      // a phone hides Back/Next (the card itself is tapped); the click handler goes by the button either way
      await p.evaluate(() => document.querySelector<HTMLElement>('[data-tour-step="1"]')!.click());
    }
    await frames(p);
    await frames(p);
    const file = `tours/${name}/${tslugs[ti]}-done.png`;
    await p.screenshot({ path: join(outDir, file), animations: "disabled", caret: "hide" });
    rows.push({ repo: name, tour, step: "done", file, covered: [] });
    const done = await p.evaluate(() => ({ hash: location.hash, vb: document.querySelector("svg.board")?.getAttribute("viewBox") ?? "" }));
    const board = byHash.get(done.hash);
    if (!board) { process.stdout.write(`DONE_BOARD_UNKNOWN ${name} ${tour} ${done.hash}\n`); continue; }
    // another board first (each settled: the story level resizes the canvas), so this one opens afresh
    for (const b of [ids.find((x) => x !== board && !x.startsWith("_")) ?? board, board]) {
      await p.evaluate((b) => (window as any).__repoladder.show(b), b);
      await frames(p);
    }
    const fresh: string = await p.evaluate(() => document.querySelector("svg.board")?.getAttribute("viewBox") ?? "");
    const a = done.vb.split(" ").map(Number), b = fresh.split(" ").map(Number);
    if (a.length !== 4 || b.length !== 4 || a.some((x, i) => Math.abs(x - b[i]) > 1)) {
      mismatch++;
      process.stdout.write(`DONE_FIT_MISMATCH ${name} ${tour} ${done.vb} vs ${fresh}\n`);
    }
  }
  return mismatch;
}

/** --embed opens each page as the hosted site frames it (`?embed=1`, viewer/embed.ts). */
const pageUrl = (work: string, name: string) => pathToFileURL(join(work, "out", name, "diagram.html")).href + (process.argv.includes("--embed") ? "?embed=1" : "");

async function main() {
  const { chromium } = await import("playwright");
  const { execFileSync } = await import("node:child_process");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const argv = process.argv.slice(2);
  const flag = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  // the same directory rule as scripts/gallery.ts
  const work = flag("work") ? resolve(flag("work")!) : join(root, ".gallery", ...(argv.includes("--demos") ? ["demos"] : []));
  const tours = argv.includes("--tours");
  const only = flag("repo")?.split(",");
  const outDir = resolve(flag("out") ?? join(work, "shots"));
  const compareDir = flag("compare") ? resolve(flag("compare")!) : undefined;
  const prevFile = tours ? "tours.json" : "manifest.json";
  if (compareDir && !existsSync(join(compareDir, prevFile))) throw new Error(`${compareDir}/${prevFile} not found; point --compare at an earlier shots directory`);
  if (compareDir === outDir) throw new Error("--compare must be a different directory from the output (copy the old shots aside first)");

  const resultsFile = join(work, "results.json");
  if (!existsSync(resultsFile)) throw new Error("no gallery yet: run `npm run gallery` first");
  const results: { name: string; status: string }[] = JSON.parse(readFileSync(resultsFile, "utf8"));
  const repos = results.filter((r) => r.status === "ok" && (!only || only.includes(r.name)) && existsSync(join(work, "out", r.name, "diagram.html"))).map((r) => r.name);
  if (only) for (const n of only) if (!repos.includes(n)) throw new Error(`no built gallery diagram for "${n}"`);

  const t0 = performance.now();
  if (tours) return void (await mainTours(chromium, work, repos, outDir, compareDir));
  // A compare sheet from an earlier run would describe shots that no longer exist.
  rmSync(join(outDir, "compare"), { recursive: true, force: true });
  rmSync(join(outDir, "compare.html"), { force: true });
  for (const name of repos) {
    rmSync(join(outDir, name), { recursive: true, force: true });
    mkdirSync(join(outDir, name), { recursive: true });
  }
  const browser = await chromium.launch();
  const shot: Record<string, ShotRepo> = {}, covered = new Map<string, string[]>();
  try {
    await Promise.all(MODES.map(async (mode) => {
      // Not isMobile: diagram.html has no viewport meta (the Artifact host adds one), and mobile
      // emulation would lay it out at 980px and shrink it instead of rendering at phone width.
      const phone = mode.id.startsWith("phone");
      const ctx = await browser.newContext({ viewport: { width: mode.width, height: mode.height }, deviceScaleFactor: mode.scale, colorScheme: mode.scheme, hasTouch: phone });
      let told = false;
      const queue = [...repos];
      await Promise.all([0, 1].map(async () => {
        const p = await ctx.newPage();
        for (let name; (name = queue.shift()); ) {
          await p.goto(pageUrl(work, name));
          if (!told && (told = true)) process.stdout.write(`${mode.id} (pointer: coarse) ${await p.evaluate(() => matchMedia("(pointer: coarse)").matches)}\n`);
          const hooked = await p.waitForFunction(() => (window as any).__repoladder, null, { timeout: 3000 }).then(() => true, () => false);
          // the embedded fonts register as the page boots; shoot only once they are in
          if (hooked) await p.evaluate(() => document.fonts?.ready);
          const ids: string[] = hooked ? await p.evaluate(() => (window as any).__repoladder.boards) : ["root"];
          const boards = slugs(ids).map((slug, i) => ({ id: ids[i], slug, label: "" }));
          for (const b of boards) {
            if (hooked) await p.evaluate((id) => (window as any).__repoladder.show(id), b.id);
            b.label = await p.evaluate(() => [...document.querySelectorAll("#crumbs > :not([aria-hidden])")].map((e) => e.textContent).join(" › "));
            await frames(p);
            await p.screenshot({ path: join(outDir, shotFile(name, b.slug, mode.id)), animations: "disabled", caret: "hide" });
            if (phone) {
              const c = await underButtons(p, "svg.board g[data-hit^='n:']");
              covered.set(`${name}\0${b.id}`, c);
              if (c.length) process.stdout.write(`COVERED ${name} ${b.id} ${c.length}\n`);
            }
          }
          if (mode.id === MODES[0].id) shot[name] = { name, boards, ...(hooked ? {} : { warning: "diagram predates the viewer's __repoladder hook; only the top board was captured" }) };
          process.stdout.write(`${mode.id.padEnd(14)} ${name.padEnd(22)} ${boards.length} boards\n`);
        }
        await p.close();
      }));
      await ctx.close();
    }));

    for (const r of Object.values(shot)) for (const b of r.boards) { const c = covered.get(`${r.name}\0${b.id}`); if (c?.length) b.covered = c; }
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    // Keep earlier shots of repos not taken this run (--repo), so the sheet still covers everything.
    const manifestFile = join(outDir, "manifest.json");
    const prev: Manifest | null = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, "utf8")) : null;
    const order = results.map((r) => r.name);
    const merged = [...Object.values(shot), ...(prev?.repos ?? []).filter((r) => !shot[r.name] && order.includes(r.name))];
    merged.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
    const manifest: Manifest = { repoladderSha: sha, repos: merged };
    writeFileSync(manifestFile, JSON.stringify(manifest, null, 1) + "\n");
    writeFileSync(join(outDir, "index.html"), renderSheet(manifest));
    const count = Object.values(shot).reduce((n, r) => n + r.boards.length, 0);
    process.stdout.write(`\n${join(outDir, "index.html")}\n${count * MODES.length} shots of ${count} boards in ${((performance.now() - t0) / 1000).toFixed(1)}s\n`);

    if (compareDir) {
      const before: Manifest = JSON.parse(readFileSync(join(compareDir, "manifest.json"), "utf8"));
      const bytes = (f: string) => (existsSync(f) ? readFileSync(f) : null);
      const rows = planCompare(before, manifest, (bf, af) => {
        const x = bytes(join(compareDir, bf)), y = bytes(join(outDir, af));
        return !!x && !!y && x.equals(y);
      }, only);
      // One side-by-side PNG per changed board and mode, ready to drop into a PR.
      const p = await browser.newPage({ viewport: { width: 800, height: 400 } });
      const uri = (f: string) => (existsSync(f) ? `data:image/png;base64,${readFileSync(f).toString("base64")}` : null);
      for (const r of rows.filter((x) => x.change !== "same")) {
        const f = shotFile(r.repo, r.board.slug, r.mode);
        const pane = (label: string, src: string | null) => `<div><p>${label}</p>${src ? `<img src="${src}">` : `<div class="none">none</div>`}</div>`;
        const phone = r.mode.startsWith("phone");
        await p.setContent(`<style>body{margin:0;background:#E4E8E5;font:600 15px system-ui,sans-serif;color:#18201D}main{display:flex;gap:16px;padding:12px;width:max-content}p{margin:0 0 6px}img{display:block;border:1px solid #B9C2BC;${phone ? "width:390px" : ""}}.none{width:${phone ? 390 : 1280}px;height:${phone ? 844 : 800}px;display:grid;place-items:center;border:1px dashed #8A9690;color:#5B6660}h1{font-size:14px;margin:12px 12px 0}</style>
<h1>${esc(`${r.repo} · ${r.board.label} · ${r.mode}`)}</h1><main>${pane("Before", r.change === "added" ? null : uri(join(compareDir, f)))}${pane("After", r.change === "removed" ? null : uri(join(outDir, f)))}</main>`);
        mkdirSync(dirname(join(outDir, "compare", f)), { recursive: true });
        await p.screenshot({ path: join(outDir, "compare", f), fullPage: true });
      }
      writeFileSync(join(outDir, "compare.html"), renderCompare(rows, relative(outDir, compareDir), { before: before.repoladderSha, after: sha }));
      const changed = rows.filter((x) => x.change !== "same").length;
      process.stdout.write(`${join(outDir, "compare.html")}\n${changed} of ${rows.length} board shots differ${changed ? `; side-by-side PNGs in ${join(outDir, "compare")}` : ""}\n`);
    }
  } finally {
    await browser.close();
  }
}

/** --tours: every tour of every diagram on a phone (light, touch, reduced motion so glides and travel are instant). */
async function mainTours(chromium: typeof import("playwright").chromium, work: string, repos: string[], outDir: string, compareDir?: string): Promise<void> {
  const browser = await chromium.launch(), rows: TourRow[] = [];
  let mismatch = 0;
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: "light", hasTouch: true, reducedMotion: "reduce" });
    const p = await ctx.newPage();
    for (const [i, name] of repos.entries()) {
      rmSync(join(outDir, "tours", name), { recursive: true, force: true });
      mkdirSync(join(outDir, "tours", name), { recursive: true });
      await p.goto(pageUrl(work, name));
      if (!i) process.stdout.write(`phone-light (pointer: coarse) ${await p.evaluate(() => matchMedia("(pointer: coarse)").matches)}\n`);
      if (!(await p.waitForFunction(() => (window as any).__repoladder, null, { timeout: 3000 }).then(() => true, () => false))) continue;
      await p.evaluate(() => document.fonts?.ready);
      const base = new Baseline(ctx, pageUrl(work, name));
      mismatch += await shootTours(p, name, outDir, rows, base);
      await base.close();
    }
  } finally {
    await browser.close();
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "tours.json"), JSON.stringify(rows, null, 1) + "\n");
  writeFileSync(join(outDir, "tours.html"), renderTours(rows, compareDir ? relative(outDir, compareDir) : undefined));
  process.stdout.write(`${join(outDir, "tours.html")}\nTOURS ${rows.filter((r) => r.step !== "done").length} steps covered=${rows.filter((r) => r.covered.length).length} doneMismatch=${mismatch}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
