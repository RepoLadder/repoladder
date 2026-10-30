// The breadcrumb trail, at any depth. When the whole trail doesn't fit on one line, the middle
// collapses into "…", a menu of the hidden rungs ("Overview › … › Invoices › PDF generation"):
// the first crumb (home) and the board you're on show, and as many of its parents as fit; only when
// even that is too wide does home join the menu.
import { chrome } from "./embed.ts";
import { renderDepth } from "./depthbadge.ts";
import { $, N, S, STORY, esc, home, st } from "./state.ts";
import { currentStop, hasBoardAt } from "./stopview.ts";

export interface Crumb { id: string; label: string }

/** The board ids from home down to `cur`, as the breadcrumbs show them: only boards that exist at this stop (#327), and `cur`. */
export function trailIds(cur: string): string[] {
  // a store board sits right under the overview, whichever board it was opened from
  if (st.data.stores?.[cur]) return [home(), cur];
  if (cur === STORY) return [STORY];
  const p: string[] = [];
  for (let n: string | null = cur; n && N()[n]; n = N()[n].parent) if (n === cur || hasBoardAt(currentStop(), n)) p.unshift(n);
  // With a story, "Overview" is the story level and the bare root board (reached by tours) is "All parts".
  return p.flatMap((id) => (id === "root" && home() === STORY ? (cur === "root" ? [STORY, id] : [STORY]) : [id]));
}

export const crumbLabel = (id: string) => (id === home() ? "Overview" : id === "root" ? "All parts" : S()[id] ?? N()[id]?.name ?? id);

/**
 * Which crumbs to show, by index, with -1 for the collapsed "…". Tries the full trail, then hides
 * the middle one level at a time from the top, keeping the nearest parents; `fits` measures a plan.
 */
export function collapse(n: number, fits: (plan: number[]) => boolean): number[] {
  const all = [...Array(n).keys()];
  if (n <= 2 || fits(all)) return all;
  for (let keep = n - 2; keep > 0; keep--) {
    const plan = [0, -1, ...all.slice(n - keep)];
    if (fits(plan)) return plan;
  }
  // last resort on a narrow phone: home goes into the menu too, before the board name is cut short
  return [-1, n - 1];
}

/** The levels a plan hides behind "…". */
export const hidden = (n: number, plan: number[]): number[] => [...Array(n).keys()].filter((i) => !plan.includes(i));

// the levels a playing tour has passed through (tourtrail.ts), drawn lit
let lit: ReadonlySet<string> = new Set();
const litCls = (id: string) => (lit.has(id) ? ` class="tour-lit"` : "");

/** Lights these boards' crumbs (and "…" when it hides one); an empty set clears them. */
export function lightCrumbs(ids: ReadonlySet<string>): void {
  lit = ids;
  if (trail.length) { closeMenu(); layout(); }
}

function html(trail: Crumb[], plan: number[]): string {
  const sep = `<span aria-hidden="true">›</span>`;
  const gone = hidden(trail.length, plan);
  return plan.map((i) => {
    if (i < 0) return `<button class="more${gone.some((g) => lit.has(trail[g].id)) ? " tour-lit" : ""}"aria-haspopup="menu" aria-expanded="false" aria-label="${gone.length} more rungs" title="${esc(gone.map((g) => trail[g].label).join(" › "))}">…</button>${sep}`;
    const c = trail[i];
    return i === trail.length - 1 ? `<span aria-current="page"${litCls(c.id)}>${esc(c.label)}</span>` : `<button data-go="${esc(c.id)}"${litCls(c.id)}>${esc(c.label)}</button>${sep}`;
  }).join("");
}

let trail: Crumb[] = [];
let menu: HTMLElement | null = null;

/** Fills the breadcrumbs for board `cur`, collapsing the middle until the trail fits its row. */
export function renderTrail(cur: string): void {
  const ids = trailIds(cur);
  trail = ids.map((id) => ({ id, label: crumbLabel(id) }));
  closeMenu();
  renderDepth(ids.length - 1, deepest());
  layout();
}

let maxAt = "", max = 0;
/** The deepest board's level, over every board that exists at this stop. */
function deepest(): number {
  if (maxAt !== currentStop()) {
    maxAt = currentStop();
    max = Math.max(0, ...Object.keys(st.data.layout).filter((id) => hasBoardAt(maxAt, id)).map((id) => trailIds(id).length - 1));
  }
  return max;
}

function layout(): void {
  const nav = $("crumbs");
  // measured with the current crumb at full width and in fractional pixels: an ellipsis is for
  // when even "Overview › … › here" doesn't fit, never for a rounding error
  nav.classList.add("measuring");
  nav.scrollLeft = 0;
  const fits = (plan: number[]) => {
    nav.innerHTML = html(trail, plan);
    const end = nav.lastElementChild?.getBoundingClientRect().right ?? 0;
    const box = nav.getBoundingClientRect(), pad = parseFloat(getComputedStyle(nav).paddingRight) || 0;
    return end <= box.right - pad + 0.5;
  };
  const plan = collapse(trail.length, fits);
  nav.classList.remove("measuring");
  nav.innerHTML = html(trail, plan);
  nav.dataset.collapsed = String(plan.includes(-1));
  if (nav.scrollWidth > nav.clientWidth) nav.scrollLeft = nav.scrollWidth;
}

function closeMenu(): void {
  if (!menu) return;
  menu.remove();
  menu = null;
  document.querySelector("#crumbs .more")?.setAttribute("aria-expanded", "false");
}

function openMenu(btn: HTMLElement, keyboard: boolean): void {
  const plan = hiddenNow();
  menu = document.createElement("div");
  menu.className = "crumbmenu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Hidden rungs");
  menu.innerHTML = plan.map((i) => `<button role="menuitem" data-go="${esc(trail[i].id)}"${litCls(trail[i].id)} style="--lvl:${i}">${esc(trail[i].label)}</button>`).join("");
  const r = btn.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(r.left - 8, innerWidth - 248))}px`;
  menu.style.top = `${r.bottom + 6}px`;
  document.body.append(menu);
  btn.setAttribute("aria-expanded", "true");
  // from the keyboard, focus goes into the menu; a pointer leaves it where it is
  if (keyboard) menu.querySelector<HTMLElement>("button")?.focus();
}

/** The indices behind "…" in the trail as currently drawn. */
function hiddenNow(): number[] {
  const shown = new Set([...$("crumbs").querySelectorAll<HTMLElement>("[data-go]")].map((b) => b.dataset.go));
  return trail.map((_, i) => i).filter((i) => i < trail.length - 1 && !shown.has(trail[i].id));
}

export function installCrumbs(): void {
  // Clicks on a crumb or a menu item navigate through navigate.ts's [data-go] handler; this only opens and closes the menu.
  document.addEventListener("click", (ev) => {
    const more = (ev.target as Element).closest<HTMLElement>("#crumbs .more");
    if (more) { if (menu) closeMenu(); else openMenu(more, (ev as MouseEvent).detail === 0); return; }
    closeMenu();
  }, true);
  // capture, so Escape closes the menu instead of going up a board
  document.addEventListener("keydown", (ev) => {
    if (!menu) return;
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      const btn = document.querySelector<HTMLElement>("#crumbs .more");
      closeMenu();
      btn?.focus();
    } else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      const items = [...menu.querySelectorAll<HTMLElement>("button")];
      const at = items.indexOf(document.activeElement as HTMLElement);
      items[(at + (ev.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
    }
  }, true);
  let w = 0;
  const again = () => { if (trail.length) { closeMenu(); layout(); } };
  new ResizeObserver(() => {
    const now = chrome().clientWidth;
    if (now !== w) { w = now; again(); }
  }).observe(chrome());
  // the web fonts arrive after the first fit and change every crumb's width
  document.fonts?.addEventListener?.("loadingdone", again);
  document.fonts?.ready?.then(again);
}
