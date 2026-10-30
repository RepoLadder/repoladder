// A collapsible box for the inspector column: a card whose label is its summary. Markup only, no
// DOM or board at import time, so node can test it. `body` is built markup (callers escape their own
// data); only the title is escaped here.
import { esc } from "./state.ts";

export function box(title: string, body: string, o: { open?: boolean; cls?: string } = {}): string {
  return `<details class="panel box${o.cls ? " " + o.cls : ""}"${o.open ? " open" : ""}><summary>${esc(title)}</summary><div class="box-body">${body}</div></details>`;
}
