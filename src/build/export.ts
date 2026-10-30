import type { Model } from "../model/rollup.ts";
import { edgeLabel, subLines, type BoardLayout } from "./layout.ts";
import { viewerAssets } from "./viewer.ts";
import { boxBody, boxClass, type Box } from "../viewer/shapes.ts";
import { ICONS } from "../viewer/icons.ts";
import { weightClass } from "../viewer/weight.ts";
import { EXPORT_FONTS, THEMES, resolveTokens, type ThemeName } from "../viewer/theme.ts";
import { fileBoxLabel } from "./filelayout.ts";
import { esc } from "../viewer/esc.ts";
import { isStacked } from "./outline.ts";
import { isFileId } from "../model/fileboards.ts";
import { COLL, collLabel, isCollId } from "../model/storeboards.ts";

// Standalone SVG export. It redraws a board the way the viewer does (src/viewer/draw.ts),
// with the viewer's own box shapes (viewer/shapes.ts) and diagram CSS (viewer/board.css), but with
// the theme tokens (viewer/theme.ts) resolved to literal colors and no interactivity, so the file renders on its own: GitHub, docs, slides.

export type Theme = ThemeName;

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const r1 = (n: number) => Math.round(n * 10) / 10;

function roundPath(p: number[], r: number): string {
  let d = `M${p[0]} ${p[1]}`;
  for (let i = 2; i < p.length - 2; i += 2) {
    const [x0, y0, x1, y1, x2, y2] = [p[i - 2], p[i - 1], p[i], p[i + 1], p[i + 2], p[i + 3]];
    const l1 = Math.hypot(x1 - x0, y1 - y0), l2 = Math.hypot(x2 - x1, y2 - y1), k = Math.min(r, l1 / 2, l2 / 2);
    if (!l1 || !l2) continue;
    d += `L${r1(x1 - ((x1 - x0) / l1) * k)} ${r1(y1 - ((y1 - y0) / l1) * k)}Q${x1} ${y1} ${r1(x1 + ((x2 - x1) / l2) * k)} ${r1(y1 + ((y2 - y1) / l2) * k)}`;
  }
  return d + `L${p[p.length - 2]} ${p[p.length - 1]}`;
}
function curvePath(p: number[]): string {
  let d = `M${p[0]} ${p[1]}`;
  for (let i = 2; i + 5 < p.length; i += 6) d += `C${p[i]} ${p[i + 1]} ${p[i + 2]} ${p[i + 3]} ${p[i + 4]} ${p[i + 5]}`;
  return d;
}
function curveLabelAt(p: number[]): [number, number] {
  const segs = Math.floor((p.length - 2) / 6), k = Math.floor(segs / 2) * 6;
  const [x0, y0, x1, y1, x2, y2, x3, y3] = p.slice(k, k + 8);
  return [(x0 + 3 * x1 + 3 * x2 + x3) / 8, (y0 + 3 * y1 + 3 * y2 + y3) / 8];
}
function labelAt(p: number[]): [number, number] {
  let best = 0, at: [number, number] = [p[0], p[1]];
  for (let i = 0; i < p.length - 2; i += 2) {
    const l = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
    if (l > best) { best = l; at = [(p[i] + p[i + 2]) / 2, (p[i + 1] + p[i + 3]) / 2]; }
  }
  return at;
}

/** The breadcrumb title of a board: "repo · Overview › Web › Pages". */
export function boardTitle(model: Model, boardId: string): string {
  // a store board sits under the overview (model/storeboards.ts)
  if (model.stores?.[boardId]) return `${model.repo} · Overview › ${model.services[boardId]}`;
  const names: string[] = [];
  for (let n: string | null = boardId; n; n = model.nodes[n]?.parent ?? null) names.unshift(n === "root" ? "Overview" : model.nodes[n].name);
  return `${model.repo} · ${names.join(" › ")}`;
}

/** One board as a self-contained SVG document, styled like the viewer in the given theme. */
export function boardSvg(model: Model, boardId: string, layout: BoardLayout, theme: Theme = "light"): string {
  const c = THEMES[theme];
  const board = model.boards[boardId];
  // file boxes (leaf boards) show the name and line count lines of their label
  const fileLine = (id: string, i: 0 | -1) => fileBoxLabel(model, boardId, id).split("\n").at(i)!;
  const nameOf = (id: string) => model.services[id] ?? model.nodes[id]?.name ?? (isFileId(id) ? fileLine(id, 0) : isCollId(id) ? collLabel(id.slice(COLL.length)) : id);
  // the same stacked cards the layout made room for and ends wires on
  const isOpenable = (id: string) => isStacked(model, boardId, id);
  const info = new Map(board.edges.map((e) => [`${e.a}>${e.b}`, e]));
  const out: string[] = [], xs: number[] = [], ys: number[] = [];

  for (const [a, z, curve, ...p] of layout.e) {
    for (let i = 0; i < p.length; i += 2) { xs.push(p[i]); ys.push(p[i + 1]); }
    const e = info.get(`${a}>${z}`);
    const cls = !e ? "" : e.reads || e.writes ? "data" : e.uses ? "svc" : e.imports ? "" : "call", wc = e ? weightClass(e) : "";
    const [lx, ly] = curve ? curveLabelAt(p) : labelAt(p);
    const d = curve ? curvePath(p) : roundPath(p, 10);
    const t = e ? edgeLabel(e) : "";
    const w = t.length * 7 + 12;
    out.push(`<g class="wire ${cls}${wc ? ` ${wc}` : ""}"><title>${esc(nameOf(a))} → ${esc(nameOf(z))}</title><path class="line" d="${d}" marker-end="url(#arw-${cls || "n"})"/>${t ? `<rect class="pill" x="${r1(lx - w / 2)}" y="${r1(ly - 9)}" width="${w}" height="18" rx="9"/><text class="n" x="${r1(lx)}" y="${r1(ly + 4)}" text-anchor="middle">${esc(t)}</text>` : ""}</g>`);
  }
  for (const [id, x, y, w, h, cyl] of layout.n) {
    xs.push(x, x + w); ys.push(y, y + h);
    const ctx = !cyl && board.context.includes(id), node = model.nodes[id], store = !!cyl && id.startsWith("store-");
    const b: Box = {
      x, y, w, h, name: nameOf(id), svc: !!cyl, store, icon: cyl && model.categories?.[id] ? ICONS[model.categories[id]] : undefined, ctx, kind: node?.kind, hub: board.hubs.includes(id), openable: isOpenable(id),
      subs: isFileId(id) ? [fileLine(id, -1)] : subLines(model, id, boardId),
    };
    out.push(`<g class="${boxClass(b)}">${boxBody(b)}</g>`);
  }

  const n = model.nodes[boardId] ?? { children: [], count: 0 };
  const title = boardTitle(model, boardId);
  const meta = model.stores?.[boardId] ? plural(Object.keys(model.stores[boardId]).length, "collection") : `${n.children.length ? `${plural(n.children.length, "part")} · ` : ""}${plural(n.count, "file")}${boardId === "root" && model.sha ? ` · ${model.sha}` : ""}`;
  // Room above the drawing for the title line, and wide enough that title and meta never collide
  // (character widths are estimates: no font metrics outside a browser).
  const pad = 24, head = 34;
  const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad - head;
  const W = Math.max(Math.max(...xs) - x0 + pad, Math.ceil(title.length * 8.5 + meta.length * 7.4 + 2 * pad + 24)), H = Math.max(...ys) - y0 + pad;
  const mk = (k: string, cls: string) => `<marker id="arw-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 1L10 5L0 9z" class="arw ${cls}"/></marker>`;
  const css = `.bg{fill:${c.surface}}.title{font:600 15px ${EXPORT_FONTS.display};fill:${c.ink}}.meta{font:12px ${EXPORT_FONTS.mono};fill:${c.muted}}`
    + resolveTokens(viewerAssets().boardCss, theme);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
<style>${css}</style>
<defs>${mk("n", "")}${mk("call", "call")}${mk("svc", "svc")}${mk("data", "data")}</defs>
<rect class="bg" x="${x0}" y="${y0}" width="${W}" height="${H}" rx="8"/>
<text class="title" x="${x0 + pad}" y="${y0 + pad + 6}">${esc(title)}</text><text class="meta" x="${x0 + W - pad}" y="${y0 + pad + 6}" text-anchor="end">${esc(meta)}</text>
${out.join("\n")}
</svg>
`;
}

/** File-safe, unique names for board ids (ids are group paths and can hold any character). */
export function fileNames(ids: string[]): string[] {
  const used = new Set<string>();
  return ids.map((id) => {
    const base = id.replace(/[^a-z0-9._-]+/gi, "_").replace(/^[_.]+|_+$/g, "").slice(0, 80) || "board";
    let s = base;
    for (let i = 2; used.has(s); i++) s = `${base}-${i}`;
    used.add(s);
    return s;
  });
}

/** Renders SVGs to PNGs with Playwright when it is installed; returns false when it isn't. */
export async function svgsToPngs(files: { svg: string; png: string; width: number; height: number }[]): Promise<boolean> {
  // Not a dependency of the shipped plugin: a non-literal specifier keeps esbuild from bundling it.
  const name = "playwright";
  let pw: any;
  try { pw = await import(name); } catch { return false; }
  const { readFileSync, writeFileSync } = await import("node:fs");
  let browser: any;
  try { browser = await pw.chromium.launch(); } catch { return false; }
  try {
    const page = await browser.newPage({ deviceScaleFactor: 2 });
    for (const f of files) {
      await page.setViewportSize({ width: Math.ceil(f.width), height: Math.ceil(f.height) });
      await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>${readFileSync(f.svg, "utf8")}`);
      writeFileSync(f.png, await page.locator("svg").first().screenshot({ omitBackground: true }));
    }
  } finally {
    await browser.close();
  }
  return true;
}
