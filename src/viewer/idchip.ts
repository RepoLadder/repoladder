// Stable ids in the side panel, so a comment on the published diagram can name exactly what it is about
// (the triage-feedback skill maps them back to model.json). Node ids are the grouping ids; an edge is `a→b`.
import { copyText, linkBox, shareLink } from "./deeplink.ts";
import { esc } from "./state.ts";

export const edgeId = (a: string, b: string) => `${a}→${b}`;

let installed = false;

/** The id line with a copy button. Installs the copy handler on first use, so the bundle has no load-time DOM work. */
export function idRow(id: string): string {
  if (!installed && typeof document !== "undefined") {
    installed = true;
    document.addEventListener("click", (ev) => {
      const btn = (ev.target as Element).closest?.<HTMLButtonElement>("button[data-copy],button[data-link]");
      if (btn) copy(btn);
    });
  }
  return `<p class="idrow"><code>${esc(id)}</code><button class="copy" data-copy="${esc(id)}" aria-label="Copy id ${esc(id)}">Copy</button><button class="copy" data-link aria-label="Copy a link to this view">Copy link</button></p>`;
}

function copy(btn: HTMLButtonElement): void {
  const link = btn.dataset.copy === undefined, text = link ? shareLink() : btn.dataset.copy!;
  const idle = btn.textContent;
  copyText(text, () => (link ? linkBox(btn.parentElement!, text) : btn.previousElementSibling), (label) => {
    btn.textContent = label;
    setTimeout(() => (btn.textContent = idle), 1200);
  });
}
