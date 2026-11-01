// The board title (#44): the current board's level label, name and summary as plain text at the canvas's top left,
// with a "More" popover for a summary longer than two lines. Owns the h1; the header carries no title.
import { levelsDown } from "./depthbadge.ts";
import { trailIds } from "./crumbs.ts";
import { refitIfAtFit } from "./fit.ts";
import { $, N, S, STORY, esc, home, st } from "./state.ts";

export interface TitleParts { level: string; title: string; summary: string }

/** What the title shows for board `cur`: pure given the data, so node can test it. */
export function titleParts(cur: string, depth: number, repo: string, name: (id: string) => string | undefined, summary: (id: string) => string | undefined, isHome: boolean): TitleParts {
  return { level: levelsDown(depth), title: isHome ? repo : name(cur) ?? cur, summary: summary(cur === STORY ? "root" : cur) ?? "" };
}

const parts = (): TitleParts => titleParts(st.cur, trailIds(st.cur).length - 1, st.data.repo, (id) => S()[id] ?? N()[id]?.name, (id) => N()[id]?.summary, st.cur === home());

let pop: HTMLElement | null = null;
const more = () => document.querySelector<HTMLButtonElement>(".bt-more");

function closePop(focus = false): void {
  if (!pop) return;
  pop.remove();
  pop = null;
  more()?.setAttribute("aria-expanded", "false");
  if (focus) more()?.focus();
}

function openPop(keyboard: boolean): void {
  const btn = more(), box = $("boardtitle");
  if (!btn) return;
  const p = parts();
  pop = document.createElement("div");
  pop.className = "bt-pop";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", `About ${p.title}`);
  pop.tabIndex = -1;
  pop.innerHTML = `<p>${esc(p.summary)}</p>`;
  box.append(pop);
  btn.setAttribute("aria-expanded", "true");
  if (keyboard) pop.focus();
}

/** Shows More when the clamped summary overflows (always on a phone, where the summary is not inline). */
function measure(): void {
  const b = more(), s = document.querySelector<HTMLElement>(".bt-sum");
  if (!b || !s) return;
  const has = !!s.textContent, narrow = matchMedia("(max-width: 760px)").matches;
  b.hidden = !has || !(narrow || s.scrollHeight > s.clientHeight + 1);
  if (b.hidden) closePop();
}

/** Writes the level, name and summary for the current board, touching the DOM only where they changed. */
export function renderBoardTitle(): void {
  const box = document.getElementById("boardtitle");
  if (!box) return;
  const p = parts();
  const set = (sel: string, text: string) => { const e = box.querySelector(sel); if (e && e.textContent !== text) e.textContent = text; };
  const changed = box.querySelector("h1")?.textContent !== p.title || box.querySelector(".bt-sum")?.textContent !== p.summary;
  if (changed) closePop();
  set(".bt-level", p.level);
  set("h1", p.title);
  set(".bt-sum", p.summary);
  measure();
}
export const renderRepoTitle = renderBoardTitle;

export function installBoardTitle(): void {
  document.addEventListener("click", (ev) => {
    const t = ev.target as Element;
    if (t.closest(".bt-more")) { if (pop) closePop(); else openPop((ev as MouseEvent).detail === 0); return; }
    if (pop && !t.closest(".bt-pop")) closePop();
  }, true);
  // capture, so Escape closes the popover before it climbs a level or clears a selection
  document.addEventListener("keydown", (ev) => {
    if (!pop || ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    closePop(true);
  }, true);
  const box = document.getElementById("boardtitle");
  if (box) new ResizeObserver(() => { measure(); refitIfAtFit(); }).observe(box);
  document.fonts?.ready?.then(measure);
  matchMedia("(max-width: 760px)").addEventListener?.("change", measure);
}
