import type { Board, Evidence, Model } from "../model/rollup.ts";
import { snippetKey } from "../model/snippets.ts";
import type { BoardLayout } from "./layout.ts";
import { viewerAssets } from "./viewer.ts";
import { FEEDBACK_URL, brandName, madeWithUrl } from "./brand.ts";
import { FAVICON_HREF, HEADER_MARK } from "./mark.ts";
import { FILE, filePath } from "../model/fileboards.ts";
import { packData, packViewer } from "./filepack.ts";
import { esc } from "../viewer/esc.ts";
import { usedIcons } from "../viewer/icons.ts";
import type { CodeData } from "../viewer/codelink.ts";
import { DEFAULT_FEATURES, bakedFeatures, type Features } from "../features.ts";
import { PACKAGE, VERSION } from "../version.ts";
import { STORY, type PageBoard, type PageCollection, type PageEdge, type PageField, type ViewerData } from "../viewer/state.ts";

// Same character class as parseGithubRemote (analyze/files.ts); the code links are dropped when a model carries anything else.
const GH_REPO = /^[\w.-]+\/[\w.-]+$/, GH_SHA = /^[0-9a-f]{7,64}$/i;

export function renderHtml(model: Model, layout: Record<string, BoardLayout>, features: Features = DEFAULT_FEATURES): string {
  // Paths repeat across file lists and evidence; store each once and refer to it by index.
  const paths: string[] = [];
  const index = new Map<string, number>();
  const ref = (p: string) => {
    let i = index.get(p);
    if (i === undefined) { i = paths.length; paths.push(p); index.set(p, i); }
    return i;
  };
  for (const n of Object.values(model.nodes)) n.files.forEach(ref);
  const nodes = Object.fromEntries(Object.entries(model.nodes).map(([id, n]) => [id, { ...n, files: n.files.map(ref) }]));
  // Snippets are keyed by path index too, and only those for evidence on the page are kept.
  const snips: NonNullable<CodeData["snips"]> = {};
  const evRef = ([f, l, t]: Evidence): PageEdge["ev"][number] => {
    const s = model.snippets?.[snippetKey(f, l)];
    if (s) snips[`${ref(f)}:${l}`] = s;
    return [ref(f), l, index.has(t) ? index.get(t)! : t];
  };
  // File boxes are "@<path index>" in the page (see model/fileboards.ts).
  const pid = (id: string) => (id.startsWith(FILE) ? `@${ref(filePath(id))}` : id);
  // The story level travels as one more board (STORY) beside its actors and sentences.
  const all = model.story ? { [STORY]: model.story.board, ...model.boards } : model.boards;
  const pageBoards = (bs: Record<string, Board>): Record<string, PageBoard> => Object.fromEntries(Object.entries(bs).map(([id, b]) => [id, {
    ...b,
    nodes: b.nodes.map(pid), context: b.context.map(pid), hubs: b.hubs.map(pid),
    edges: b.edges.map((e) => ({ ...e, a: pid(e.a), b: pid(e.b), ev: e.ev.map(evRef) })),
    // Stores can list dozens of collections per board, so each is a flat array (see PageCollection).
    collections: b.collections && Object.fromEntries(Object.entries(b.collections).map(([id, cs]) => [id,
      cs.map((c): PageCollection => [c.name, c.reads.map(pid), c.writes.map(pid), ...c.ev.flatMap(([f, l, op]) => [ref(f), op === "write" ? -l : l])])])),
  }]));
  const boards = pageBoards(all);
  const pageLayout = Object.fromEntries(Object.entries(layout).map(([id, l]): [string, BoardLayout] => [id, {
    n: l.n.map(([n, ...r]) => [pid(n), ...r]),
    e: l.e.map(([a, b, ...r]) => [pid(a), pid(b), ...r]),
  }]));
  // every board's walkthrough (viewer/walk.ts) steps through its flows
  const flows = model.flows ? Object.fromEntries(Object.entries(model.flows).map(([id, fs]) => [id, fs.map(({ named: _, ...f }) => ({ ...f, path: f.path.map(pid) }))])) : undefined;
  // chain tours (model/chaintours.ts) can land on a file board, whose boxes are "@<path index>" here
  const pair = (e: [string, string]): [string, string] => [pid(e[0]), pid(e[1])];
  const tours = model.tours?.map((t) => ({ ...t, steps: t.steps.map((s) => s.lit ? { ...s, edge: s.edge && pair(s.edge), lit: { boxes: s.lit.boxes.map(pid), edges: s.lit.edges.map(pair) } } : s) }));
  const files: NonNullable<ViewerData["files"]> = {};
  for (const p of Object.keys(model.files ?? {}).sort()) files[`@${ref(p)}`] = [model.files![p].loc, ...model.files![p].exports];
  // Store boards' collection fields: [name, flags, sites, file, line, how, ...] (see PageField).
  const HOW = { write: "w", query: "q", read: "r", declared: "d" } as const;
  const stores: ViewerData["stores"] = model.stores && Object.fromEntries(Object.entries(model.stores).map(([sid, cs]) => [sid, Object.fromEntries(Object.entries(cs).map(([name, c]) => [name,
    c.fields.map((f): PageField => [f.name, `${f.declared ? "d" : ""}${f.hows.map((h) => HOW[h]).join("")}`, f.sites, ...f.ev.flatMap(([file, l, h]) => [ref(file), l, HOW[h]])])]))]));
  const g = model.github;
  const gh = g && GH_REPO.test(g.repo) && GH_SHA.test(g.sha)
    ? `https://github.com/${g.repo.split("/").map(encodeURIComponent).join("/")}/blob/${g.sha}/${g.dir.split("/").map(encodeURIComponent).join("/")}`
    : undefined;
  const data: ViewerData & CodeData = { repo: model.repo, sha: model.sha, paths, nodes, services: model.services, ...(model.categories ? { categories: model.categories, icons: usedIcons(model.categories) } : {}), boards, layout: pageLayout, files, tours, ...(flows ? { flows } : {}), ...(stores ? { stores } : {}), ...(model.story ? { story: { actors: model.story.actors, narrative: model.story.narrative } } : {}), ...(gh ? { gh } : {}), ...(Object.keys(snips).length ? { snips } : {}) };
  const baked = bakedFeatures(features);
  if (Object.keys(baked).length) data.features = baked;
  if (model.profile) data.profile = model.profile;
  if (model.does) data.does = model.does;
  if (model.names) data.names = Object.fromEntries(Object.entries(model.names).map(([p, n]) => [`@${ref(p)}`, n]));
  if (model.derivedTours) data.derivedTours = model.derivedTours.map((t) => ({ ...t, steps: t.steps.map((s) => ({ ...s, lit: { boxes: s.lit.boxes.map(pid), edges: s.lit.edges.map(([a, b]): [string, string] => [pid(a), pid(b)]) } })) }));
  if (model.fgraph) data.fgraph = model.fgraph.map(([a, b, ...r]) => [ref(a), ref(b), ...r]);
  // the Simple stop, as what differs from Default (model/simple.ts); absent without splits
  if (model.simple) data.simple = { nodes: Object.fromEntries(Object.entries(model.simple.nodes).map(([id, n]) => [id, { ...n, files: n.files.map(ref) }])), boards: pageBoards(model.simple.boards) };
  const assets = viewerAssets();
  // The viewer travels packed like the data, at about a third of its size: the boot script
  // unpacks it, adds the stylesheet and starts it, synchronously, before the page first paints.
  const viewer = inlineJson(packViewer(assets)), packed = inlineJson(packData(data));
  return `<meta charset="utf-8">
<meta name="generator" content="${esc(`${PACKAGE}@${VERSION}`)}">
<title>${esc(model.repo)} architecture</title>
<link rel="icon" type="image/svg+xml" href="${esc(FAVICON_HREF)}">
<!-- Geist and Geist Mono: Copyright 2024 The Geist Project Authors, SIL Open Font License 1.1 (full text packed with the fonts below) -->
<header>
  <a class="brand" href="${esc(madeWithUrl())}" target="_blank" rel="noopener" aria-label="${esc(brandName())}" title="${esc(brandName())}">${HEADER_MARK}</a>
  <h1>${esc(model.repo)}</h1>
  <nav class="crumbs" id="crumbs" aria-label="Diagram depth"></nav>
  <span class="meta" id="meta"></span>
</header>
<main>
  <div class="stage" id="stage">
  <div class="canvas" id="canvas">
    <button id="insp" aria-label="Inspector" title="Inspector (I)" aria-controls="details" aria-expanded="false" aria-pressed="false">${INSPECTOR_ICON}</button>
    <div class="zoom"><button id="zfs" hidden aria-label="Full screen" aria-pressed="false">${FS_ICON}</button><button id="zfit" hidden aria-label="Reframe" title="Reframe">${REFRAME_ICON}</button><button id="zin" aria-label="Zoom in">+</button><button id="zout" aria-label="Zoom out">−</button><button id="zexp" aria-label="Export this view" title="Export this view" aria-haspopup="menu" aria-expanded="false">⤓</button></div>
  </div>
  </div>
  <aside><section id="details" aria-live="polite"></section>${madeWith()}</aside>
</main>
<script>
${assets.boot}
repoladderBoot(${viewer},${packed},${inlineJson(assets.fonts)});
</script>
`;
}

// The strip's icons: inline svgs in the shell (not viewer code), as the tour link's. Fullscreen holds both
// states; styles.css shows the corners out or in by aria-pressed. Reframe is a viewfinder.
const ICON = (d: string) => `<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">${d}</svg>`;
const FS_ICON = ICON('<path class="fs-out" d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/><path class="fs-in" d="M6 2v4H2M14 6h-4V2M10 14v-4h4M2 10h4v4"/>');
const INSPECTOR_ICON = ICON('<rect x="2" y="2.5" width="12" height="11" rx="2"/><path d="M10 2.5v11"/>');
const REFRAME_ICON = ICON('<path d="M2 5V2h3M11 2h3v3M14 11v3h-3M5 14H2v-3"/><circle cx="8" cy="8" r="1.2"/>');

// Plain links in the shell, not viewer code: an Artifact frame blocks window.open, and the
// viewer's size budget stays untouched.
const madeWith = () => `<footer class="made"><a href="${esc(madeWithUrl())}" target="_blank" rel="noopener">Made with ${esc(brandName())}</a> · <a href="${esc(FEEDBACK_URL)}" target="_blank" rel="noopener">Feedback</a></footer>`;

/** JSON for an inline <script>: `<` can't open `</script>` or `<!--`, and U+2028/2029 can't end a line in older JS parsers. Same value once parsed. */
export const inlineJson = (v: unknown) => JSON.stringify(v).replace(/[<\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
