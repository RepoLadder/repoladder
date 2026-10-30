// Mono helpers: wrap only the code-like fragment of a mixed line (a commit, a route, an export) in the mono face.
import { esc } from "./esc.ts";

/** Escaped text in the mono face. */
export const mono = (s: string): string => `<span class="mono">${esc(s)}</span>`;

/** The header meta line: plain text, then the commit (when given) in mono. */
export const metaHtml = (text: string, sha?: string | null): string => `${esc(text)}${sha ? ` · ${mono(sha)}` : ""}`;
