// The top bar's actions (#41): Tours and Filters as popovers over the same data as the panel's Tours and Key boxes,
// and Export (the zoom strip's button, moved here). Tours and Filters appear only where the board has something to show.
import { closeBarMenu, openBarMenu } from "./barmenu.ts";
import { ICONS } from "./baricons.ts";
import { toggleRows } from "./legend.ts";
import { $, esc, plural } from "./state.ts";
import { tourRows } from "./walk.ts";
import { isEmbed } from "./embed.ts";

export type Action = "tours" | "filters" | "export";

export const actionsFor = (c: { tours: number; toggles: number; embed: boolean }): Action[] => [
  ...(!c.embed && c.tours > 0 ? ["tours" as const] : []),
  ...(!c.embed && c.toggles > 0 ? ["filters" as const] : []),
  "export",
];

export const toursHtml = (rows: { id: string; title: string; steps: number }[]): string =>
  rows.map((t) => `<button role="menuitem" class="item" data-tour="${esc(t.id)}"><span>${esc(t.title)}</span><span class="num">${plural(t.steps, "step")}</span></button>`).join("");

const btn = (id: string, icon: string, label: string) =>
  `<button class="tbact" id="${id}" aria-haspopup="menu" aria-expanded="false" title="${label}">${icon}<span class="lbl">${label}</span></button>`;

export function syncTopActions(): void {
  if (!document.getElementById("tbtours")) return;
  const want = actionsFor({ tours: tourRows().length, toggles: toggleRows() ? 1 : 0, embed: false });
  $("tbtours").hidden = !want.includes("tours");
  $("tbfilters").hidden = !want.includes("filters");
  closeBarMenu();
}

export function installTopActions(): void {
  const exp = $("zexp");
  exp.insertAdjacentHTML("afterbegin", ICONS.export);
  exp.insertAdjacentHTML("beforeend", `<span class="lbl">Export</span>`);
  if (isEmbed(location.search)) return;
  $("actions").insertAdjacentHTML("afterbegin", btn("tbtours", ICONS.tour, "Tours") + btn("tbfilters", ICONS.filter, "Filters"));
  const toggle = (b: HTMLElement, html: () => string, label: string, closeOnPick: boolean) => b.addEventListener("click", () => {
    const wasMine = b.getAttribute("aria-expanded") === "true";
    closeBarMenu();
    if (!wasMine) openBarMenu(b, html(), label, closeOnPick);
  });
  toggle($("tbtours"), () => toursHtml(tourRows()), "Tours", true);
  toggle($("tbfilters"), () => `<ul class="legend">${toggleRows()}</ul>`, "Filters", false);
  syncTopActions();
}
