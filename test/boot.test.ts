import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { analyze } from "../src/analyze/index.ts";
import { renderHtml } from "../src/build/html.ts";
import { packFonts, packViewer, pageParts, pageViewer } from "../src/build/filepack.ts";
import { FONT_KB, VIEWER_KB } from "../src/build/pagesize.ts";
import { viewerAssets, type ViewerAssets } from "../src/build/viewer.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import { FONT_FACES } from "../src/viewer/theme.ts";

const html = () => {
  const facts = analyze(fileURLToPath(new URL("./fixtures/multi", import.meta.url)));
  const g = defaultGrouping(facts);
  return renderHtml(buildModel(facts, g, assign(g, facts).leafOf), {});
};

interface El { tag: string; textContent?: string; style: { cssText?: string }; children: El[]; setAttribute: () => void; append: (...c: El[]) => void }
const el = (tag: string): El => {
  const e: El = { tag, style: {}, children: [], setAttribute() {}, append: (...c) => void e.children.push(...c) };
  return e;
};

/** Runs the page's boot script against a stub DOM and returns what it did. */
async function runBoot(viewer: string, data: string, fonts?: string, withFontFace = true) {
  const head = el("head"), body = el("body");
  const order: string[] = [], faces: { family: string; bytes: number; desc: Record<string, string> }[] = [];
  class FontFace { constructor(family: string, src: ArrayBuffer, desc: Record<string, string>) { order.push("face"); faces.push({ family, bytes: src.byteLength, desc }); } }
  const ctx: Record<string, unknown> = { TextDecoder, order, document: { head, body, createElement: el, fonts: { add: () => order.push("add") } }, ...(withFontFace ? { FontFace } : {}) };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(viewerAssets().boot, ctx);
  (ctx.repoladderBoot as (v: string, d: string, f?: string) => void)(viewer, data, fonts);
  const startedSync = ctx.started;
  await new Promise((r) => setImmediate(r));
  return { head, body, ctx, startedSync, faces, order };
}

const fake = (js: string): ViewerAssets => ({ css: ".x{color:red}", js, boardCss: "", boot: "", fonts: "" });

test("the page ships the viewer packed, and unpacking it gives the viewer back", () => {
  const page = html(), assets = viewerAssets();
  assert.deepEqual(pageViewer(page), { css: assets.css, js: assets.js });
  assert.equal(pageParts(page).viewer, packViewer(assets));
  assert.ok(!page.includes(assets.js.slice(0, 200)), "the plain viewer is not in the page");
  assert.ok(!assets.css.includes("\0"), "the NUL separator cannot occur in the CSS");
  assert.ok(!/<\/script/i.test(assets.boot) && assets.boot.length < 4000, `the boot script is ${assets.boot.length} bytes`);
  assert.ok(Buffer.byteLength(pageParts(page).fonts!) < FONT_KB * 1024, "the font blob fits its line");
  assert.equal(pageParts(page).fonts, assets.fonts);
  // the viewer is ~74KB packed with the detail dial, its stop list and the cut layout (#144, #145, #147, #172, #171, #185), and the fit-to-window packing (#183), tour links (#199) and the up / across / down move (#194), and the Export button (#355), so the viewer is ~88.5KB and the page sits near 90KB; the cap follows VIEWER_KB + FONT_KB (3KB of data over it)
  assert.ok(Buffer.byteLength(page) < (VIEWER_KB + FONT_KB + 3) * 1024, `the multi fixture page is ${Buffer.byteLength(page)} bytes`);
  assert.equal(html(), page, "deterministic");
});

test("boot adds the stylesheet, runs the viewer and starts it with the page data, synchronously", async () => {
  const { head, body, ctx, startedSync } = await runBoot(packViewer(fake("var repoladder={start:async d=>{globalThis.started=d}}")), "DATA");
  assert.equal(head.children[0].tag, "style");
  assert.equal(head.children[0].textContent, ".x{color:red}");
  assert.equal(startedSync, "DATA", "start is called before boot returns, as the page parses");
  assert.ok(ctx.repoladder, "the viewer stays reachable as window.repoladder");
  assert.equal(body.children.length, 0, "no error box");
});

test("boot shows a readable message, not a blank page, when the viewer cannot start", async () => {
  const cases: [string, string][] = [
    ["!!!not deflate", "corrupt viewer"], ["", "empty viewer"],
    [packViewer(fake("var repoladder={start:async()=>{throw new Error('boom')}}")), "start rejects"],
    [packViewer(fake("syntax error here(")), "viewer does not parse"],
  ];
  for (const [viewer, why] of cases) {
    const { body } = await runBoot(viewer, "DATA");
    assert.equal(body.children.length, 1, why);
    const msg = body.children[0].children[0].textContent!;
    assert.match(msg, /^This diagram could not start: .+\. The page may be cut short or damaged, or the browser too old/, why);
    if (why === "start rejects") assert.match(msg, /boom/);
  }
});

const FONT_BLOB = packFonts(new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6, 7, 8]), "OFL");
const VIEWER = packViewer(fake("var repoladder={start:async d=>{globalThis.order.push('start');globalThis.started=d}}"));

test("boot registers Geist and Geist Mono as variable faces before the viewer starts", async () => {
  const { faces, order, startedSync, body } = await runBoot(VIEWER, "DATA", FONT_BLOB);
  assert.deepEqual(faces.map((f) => [f.family, f.bytes]), [[FONT_FACES.display, 3], [FONT_FACES.mono, 5]]);
  assert.equal(faces[0].desc.weight, "100 900");
  assert.deepEqual(order, ["face", "add", "face", "add", "start"], "faces first, then the viewer");
  assert.equal(startedSync, "DATA");
  assert.equal(body.children.length, 0);
});

test("a corrupt font blob, or no FontFace API, leaves the viewer starting on system fonts", async () => {
  for (const [fonts, ff] of [["!!!not deflate", true], [FONT_BLOB, false], ["", true]] as const) {
    const { body, startedSync, faces } = await runBoot(VIEWER, "DATA", fonts, ff);
    assert.equal(body.children.length, 0, "no error box");
    assert.equal(startedSync, "DATA", "the viewer still starts");
    assert.equal(faces.length, 0);
  }
});

test("boot passes the packed fonts to the viewer's start, for the Export button's PNG", async () => {
  const v = packViewer(fake("var repoladder={start:async (d,_,f)=>{globalThis.started=d;globalThis.fontsArg=f}}"));
  const { ctx } = await runBoot(v, "DATA", FONT_BLOB);
  assert.equal(ctx.fontsArg, FONT_BLOB);
});
