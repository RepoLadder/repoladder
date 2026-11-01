// The tour card's markup (tour.ts card()): pure strings, so it is testable without a page. The ids, classes and
// data- attributes here are what sheet.ts, tourlink.ts and the scripts read; change them only with those.
import { esc } from "./esc.ts";

/** One round dot per step: the current one `on`, the passed ones `done`. */
export const dotsHtml = (n: number, i: number): string =>
  `<div class="tour-dots" aria-hidden="true">${Array.from({ length: n }, (_, k) => `<i class="${k === i ? "on" : k < i ? "done" : ""}"></i>`).join("")}</div>`;

/** Skip (the exit control; the last step has Done), Back, Next or Done, in that order. */
export const navHtml = (i: number, n: number): string => {
  const last = i === n - 1;
  return `<div class="tour-nav">${last ? "" : `<button data-tour-exit aria-label="Leave the tour">Skip</button>`}<button data-tour-step="-1"${i === 0 ? " disabled" : ""}>‹ Back</button><button data-tour-step="1" class="primary">${last ? "Done" : "Next ›"}</button></div>`;
};

export interface CardData {
  i: number;
  n: number;
  title: string;
  caption: string;
  notes: [string, string][];
  /** The names of each real edge the board does not draw. */
  undrawn: [string, string][];
}

export const cardHtml = ({ i, n, title, caption, notes, undrawn }: CardData): string => {
  const ns = notes.map(([a, b]) => `<p class="rd-note"><b>${esc(a)}</b> ${esc(b)}</p>`).join("");
  const un = undrawn.map(([a, b]) => `<p class="rd-undrawn"><b>${esc(a)} → ${esc(b)}</b> is a real connection in the code, but this board does not draw it (minor, or into a service used throughout).</p>`).join("");
  // id "tour": sheet.ts reads the step from it; the dial's Alt+↑/↓ turn it and leave the tour
  return `<div id="tour" class="panel tour-card walk-card" aria-live="polite">${dotsHtml(n, i)}<p class="num">Step ${i + 1} of ${n} · ${esc(title)}<span class="rd-tap"> · tap for next</span></p><p class="tour-text">${esc(caption)}</p>${un}${ns}${navHtml(i, n)}</div>`;
};
