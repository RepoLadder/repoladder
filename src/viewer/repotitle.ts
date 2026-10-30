// The header's repo name: a button back to the overview on any other board, plain text on it.
import { esc, home, st } from "./state.ts";

export const repoTitleHtml = (repo: string, onHome: boolean, homeId: string): string =>
  onHome ? esc(repo) : `<button data-go="${esc(homeId)}" title="Back to the overview">${esc(repo)}</button>`;

export function renderRepoTitle(): void {
  const h = document.querySelector("header h1");
  if (!h) return;
  const html = repoTitleHtml(st.data.repo, st.cur === home(), home());
  // leave it alone when unchanged, so a focused button keeps focus
  if (h.innerHTML !== html) h.innerHTML = html;
}
