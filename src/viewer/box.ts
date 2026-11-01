// A collapsible box for the inspector column: a card whose label is its summary. Markup only, no
// DOM or board at import time, so node can test it. `body` is built markup (callers escape their own
// data); only the title is escaped here.
import { esc } from "./state.ts";

export function box(title: string, body: string, o: { open?: boolean; cls?: string } = {}): string {
  return `<details class="panel box${o.cls ? " " + o.cls : ""}"${o.open ? " open" : ""}><summary>${esc(title)}</summary><div class="box-body">${body}</div></details>`;
}

/** The one-line lead of a summary: its first sentence, cut at a word boundary to `max` characters, and the rest. Raw text; callers escape it. */
export function lead(summary?: string, max = 110): { line: string; rest: string } {
  const s = (summary ?? "").trim();
  const m = /^.*?[.!?](?=\s|$)/s.exec(s);
  let line = m ? m[0] : s;
  if (line.length > max) {
    const cut = line.slice(0, max - 1), sp = cut.lastIndexOf(" ");
    line = (sp > max / 2 ? cut.slice(0, sp) : cut).replace(/[\s,;:.]+$/, "") + "…";
    return { line, rest: s };
  }
  return { line, rest: s.slice(line.length).trim() };
}

/** A collapsed "More" disclosure (not remembered: it starts shut on every render), or nothing when `inner` is blank. */
export const more = (inner: string): string => inner.trim() ? `<details class="more"><summary>More</summary><div class="more-body">${inner}</div></details>` : "";
