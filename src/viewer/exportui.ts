// The Export button (#355): a menu on the zoom row to save the current view as SVG or PNG, or copy the PNG.
// Downloads and the clipboard can be blocked inside an Artifact frame, and a blocked download fails silently, so
// every save offers "Show image": the picture to right-click or long-press by hand.
import { anchorFor, place } from "./anchor.ts";
import type { decode91 } from "./base91.ts";
import { boardLabel, boardSlug, fontUrls, pngScale, toPng, viewSvg, type FontUrls } from "./exportsvg.ts";
import { $, esc, st } from "./state.ts";

export type ExportKind = "svg" | "png" | "pngsrc";

export function installExport(decode?: typeof decode91, fonts?: string): (kind: ExportKind) => Promise<Blob> {
  const canvas = $("canvas"), btn = $("zexp");
  let urls: Promise<FontUrls | null> | undefined;
  const blobOf = async (kind: ExportKind): Promise<Blob> => {
    if (kind === "svg") return new Blob([(await viewSvg(null)).text], { type: "image/svg+xml" });
    const v = await viewSvg(await (urls ??= fontUrls(decode, fonts)));
    return kind === "png" ? toPng(v.text, v.w, v.h) : new Blob([v.text], { type: "image/svg+xml" });
  };
  // the menu and note hang under the top-bar button, over the side panel: in the body, which matches the canvas's
  // coordinates on the full-window page; embedded or in full screen (the body is not shown), the canvas is the host
  const host = (cls: string) => cls === "xprev" || document.fullscreenElement || document.documentElement.classList.contains("embed") ? canvas : document.body;
  const el = (tag: string, cls: string, html: string, role: string) => {
    const e = document.createElement(tag);
    e.className = `${cls} exp-ui`;
    e.setAttribute("role", role);
    e.innerHTML = html;
    host(cls).append(e);
    return e;
  };
  let menu: HTMLElement | null = null, note: HTMLElement | null = null, prev: HTMLElement | null = null, prevUrl = "";
  const items = () => [...menu!.querySelectorAll<HTMLElement>("button:not(:disabled)")];
  const closeMenu = (refocus = true) => {
    menu?.remove(); menu = null;
    btn.setAttribute("aria-expanded", "false");
    if (refocus) btn.focus();
  };
  const closePreview = () => { prev?.remove(); prev = null; URL.revokeObjectURL(prevUrl); btn.focus(); };
  const clear = () => { closeMenu(false); note?.remove(); note = null; prev?.remove(); prev = null; };
  const say = (msg: string, blob?: Blob) => {
    note?.remove();
    note = el("p", "xnote", `${esc(msg)}${blob ? ` · <button>Show image</button>` : ""} <button aria-label="Dismiss">✕</button>`, "status");
    note.querySelector<HTMLElement>("[aria-label=Dismiss]")!.onclick = () => { note?.remove(); note = null; };
    if (blob) note.querySelector<HTMLElement>("button:not([aria-label])")!.onclick = () => look(blob, "");
    place(note, anchorFor(btn.getBoundingClientRect(), canvas.getBoundingClientRect()));
  };
  const nope = () => say("Could not build the image.");
  const look = (blob: Blob, msg: string) => {
    clear();
    prevUrl = URL.createObjectURL(blob);
    prev = el("div", "xprev", `<p>${esc(msg)}</p><img alt="${esc(`${st.data.repo} · ${boardLabel()}`)}" src="${prevUrl}"><button aria-label="Close">✕</button>`, "dialog");
    prev.setAttribute("aria-label", "Exported image");
    const x = prev.querySelector("button")!;
    x.onclick = closePreview;
    x.focus();
  };
  const save = async (kind: "svg" | "png") => {
    let blob: Blob;
    try { blob = await blobOf(kind); } catch { return nope(); }
    const name = boardSlug(kind), url = URL.createObjectURL(blob);
    try {
      const a = document.createElement("a");
      a.download = name;
      a.href = url;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 6e4);
      say(`Saved ${name}`, blob);
    } catch { look(blob, "Saving is blocked here: right-click or long-press the image to save it."); }
  };
  // The ClipboardItem takes the PNG as a promise made inside the click: Safari rejects a write that waits first.
  const copy = () => {
    const p = blobOf("png"), by = (b: Blob) => look(b, "Copying is blocked here: right-click or long-press the image to copy it.");
    const hand = () => p.then(by, () => nope());
    try {
      if (!window.ClipboardItem || !navigator.clipboard?.write) return void hand();
      navigator.clipboard.write([new ClipboardItem({ "image/png": p })]).then(() => say("Copied"), hand);
    } catch { void hand(); }
  };
  const open = () => {
    clear();
    const r = st.svgEl.getBoundingClientRect(), big = pngScale(r.width, r.height) < 1, d = big ? " disabled" : "";
    menu = el("div", "xmenu", `<button role="menuitem" data-k="svg">Save SVG</button><button role="menuitem" data-k="png"${d}>Save PNG</button><button role="menuitem" data-k="copy"${d}>Copy PNG</button>${big ? "<p>Too large for a PNG here: save it as SVG.</p>" : ""}`, "menu");
    place(menu, anchorFor(btn.getBoundingClientRect(), canvas.getBoundingClientRect()));
    btn.setAttribute("aria-expanded", "true");
    items()[0].focus();
    menu.onclick = (e) => {
      const k = (e.target as HTMLElement).closest<HTMLElement>("[data-k]")?.dataset.k;
      if (!k) return;
      closeMenu();
      if (k === "copy") copy(); else void save(k as "svg" | "png");
    };
    menu.onkeydown = (e) => {
      if (e.key === "Tab") { e.preventDefault(); e.stopPropagation(); closeMenu(); }
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const l = items(), i = l.indexOf(document.activeElement as HTMLElement);
        l[(i + (e.key === "ArrowDown" ? 1 : l.length - 1)) % l.length].focus();
      }
    };
  };
  // Escape closes the menu or preview wherever focus is, and nothing else hears it: not the board (up a level), not a tour.
  // Registered early (main.ts) so it runs before the tour's own capture handler.
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !(menu || prev)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (prev) closePreview(); else closeMenu();
  }, true);
  btn.addEventListener("click", () => (menu ? closeMenu() : open()));
  document.addEventListener("pointerdown", (e) => { if (menu && !(e.target as Element).closest(".xmenu,#zexp")) closeMenu(false); });
  return blobOf;
}
