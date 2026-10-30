// The page's one inline script: build/html.ts writes it and then `repoladderBoot("<viewer>", "<data>", "<fonts>")`.
// The viewer's CSS and JS travel deflated and in basE91 like the page data, which takes about
// two thirds off them. This unpacks them, adds the stylesheet, runs the
// viewer and starts it, and shows a message instead of a blank page if any of that fails.
// All of it happens synchronously as the page parses, as when the viewer was inline, so the
// first draw is the same as it was (see rawinflate.ts).
import { decode91 } from "./base91.ts";
import { inflateRaw } from "./rawinflate.ts";
import { FONT_FACES } from "./fontfaces.ts";

declare global {
  // eslint-disable-next-line no-var
  var repoladderBoot: (viewer: string, data: string, fonts?: string) => void;
}

globalThis.repoladderBoot = (viewer, data, fonts) => {
  // Fonts are registered from bytes (no URL is fetched, so no CSP allowance is needed). A failure here must
  // never stop the viewer: the page then uses the system stacks.
  try {
    if (fonts && typeof FontFace === "function" && document.fonts) {
      const b = inflateRaw(decode91(fonts)), n = new DataView(b.buffer, b.byteOffset, b.byteLength);
      const a = n.getUint32(0), m = n.getUint32(4);
      const faces: [string, Uint8Array][] = [[FONT_FACES.display, b.slice(8, 8 + a)], [FONT_FACES.mono, b.slice(8 + a, 8 + a + m)]];
      for (const [family, bytes] of faces) document.fonts.add(new FontFace(family, bytes.buffer as ArrayBuffer, { weight: "100 900", style: "normal", display: "swap" }));
    }
  } catch { /* system fonts */ }
  try {
    const text = new TextDecoder().decode(inflateRaw(decode91(viewer)));
    const cut = text.indexOf("\0");
    const style = document.createElement("style");
    style.textContent = text.slice(0, cut);
    document.head.append(style);
    // The viewer is an IIFE assigning `var repoladder`; returning it keeps its errors inside this try.
    const cw = new Function(`${text.slice(cut + 1)};return repoladder`)() as { start: (d: string, decode: typeof decode91, fonts?: string) => Promise<void> };
    (window as { repoladder?: unknown }).repoladder = cw;
    // the viewer reads its packed data with this script's basE91 decoder rather than carry its own
    cw.start(data, decode91, fonts).catch(fail);
  } catch (e) {
    fail(e);
  }
};

function fail(e: unknown): void {
  const box = document.createElement("div");
  box.setAttribute("role", "alert");
  box.style.cssText = "position:fixed;inset:0;z-index:9;display:grid;place-items:center;padding:16px;background:Canvas;color:CanvasText;font:16px/1.5 system-ui,sans-serif;color-scheme:light dark";
  const p = document.createElement("p");
  p.style.maxWidth = "36em";
  p.textContent = `This diagram could not start: ${e instanceof Error ? e.message : String(e)}. The page may be cut short or damaged, or the browser too old (it needs Chrome 103, Safari 16.4, Firefox 113 or later).`;
  box.append(p);
  document.body.append(box);
}
