// File boards: a leaf group opened into its files. Box drawing and side panels for file boxes.
import { exportLine, linesLabel, moreLabel } from "../model/fileboards.ts";
import { pathLink } from "./codelink.ts";
import { more } from "./box.ts";
import { mono } from "./mono.ts";
import { $, N, board, esc, filePathOf, isFile, nameOf, path, plural, st } from "./state.ts";

/** Files of the current leaf that its board doesn't draw (they sit behind the "+more" box). */
const hidden = () => {
  const shown = new Set(board().nodes.filter((id) => id[0] === "@").map(filePathOf));
  return N()[st.cur].files.map(path).filter((p) => !shown.has(p));
};

/** Lines of a file box, as the layout sized them (build/filelayout.ts). */
function lines(id: string): [string, ...string[]] {
  if (id === "+more") return [moreLabel(hidden().length), "least connected"];
  const [loc, ...ex] = st.data.files?.[id] ?? [0];
  const e = exportLine(ex);
  return e ? [nameOf(id), e, linesLabel(loc)] : [nameOf(id), linesLabel(loc)];
}

export function fileBox(id: string, x: number, y: number, w: number, h: number): string {
  const [name, ...rest] = lines(id), cx = x + w / 2;
  // centre the block of lines: 17px for the name, 15px for each smaller line
  const top = y + h / 2 - (rest.length * 15) / 2 + 5;
  const sub = rest.map((t, i) => `<text class="${i === rest.length - 1 ? "sub" : "ex"}" x="${cx}" y="${top + 15 * (i + 1)}" text-anchor="middle">${esc(t)}</text>`).join("");
  return `<g class="node file${id === "+more" ? " more" : ""}" data-hit="n:${esc(id)}" tabindex="0" role="button" aria-label="${esc(name)}"><rect class="body" x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/><text class="name" x="${cx}" y="${top}" text-anchor="middle">${esc(name)}</text>${sub}</g>`;
}

export function renderFile(id: string, conns: string): void {
  if (id === "+more") {
    const rest = hidden();
    $("details").innerHTML = `<h2>More files</h2><div class="panel"><h3>${esc(plural(rest.length, "more file"))}</h3><p>The least connected files of ${esc(N()[st.cur].name)}, drawn as one box. Their connections are listed below.</p><div class="ev">${rest.map((p) => `<div>${pathLink(p)}</div>`).join("")}</div>${conns}</div>`;
    return;
  }
  const [loc, ...ex] = st.data.files?.[id] ?? [0];
  $("details").innerHTML = `<h2>File</h2><div class="panel"><h3>${esc(nameOf(id))}</h3><div class="ev">${pathLink(filePathOf(id))}</div><p class="num">${esc(linesLabel(loc))}</p>${more(ex.length ? `<h4>Top exports</h4><p class="num">${ex.map((e) => mono(e)).join(", ")}</p>` : "")}${conns}</div>`;
}

/** The file boxes of a leaf board, for the overview list. */
export const fileItems = () => board().nodes.filter(isFile).map((id) => `<li><button class="item" data-sel="n:${esc(id)}"><span>${esc(nameOf(id))}</span><span class="num">${id === "+more" ? hidden().length : st.data.files?.[id]?.[0] ?? ""}</span></button></li>`).join("");
