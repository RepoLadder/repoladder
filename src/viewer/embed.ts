// Embedded mode (`?embed=1`, set by the hosted site's frame): the title bar and footer are hidden by CSS,
// and the crumbs and Search sit in a toolbar strip above the board. Decided at runtime, never stored in the page.
export const isEmbed = (search: string): boolean => new URLSearchParams(search).get("embed") === "1";

/** A URL without its `embed` param; every other param and the hash stay. Unparseable input is returned as is. */
export function stripEmbed(href: string): string {
  try {
    const u = new URL(href);
    u.searchParams.delete("embed");
    return u.href;
  } catch { return href; }
}

/** A URL without the access token `t` that `repoladder serve` puts in the address; every other param and the hash stay. Unparseable input is returned as is. */
export function dropToken(href: string): string {
  try {
    const u = new URL(href);
    u.searchParams.delete("t");
    return u.href;
  } catch { return href; }
}

/** The bar above the board: the toolbar when embedded, else the header. */
export const chrome = (): HTMLElement => document.querySelector<HTMLElement>(".tbar") ?? document.querySelector("header")!;

/** The bar's bottom edge: what the sheet, story and focus-zoom heights are measured from. */
export const pickTop = (embedded: boolean, header: number, tbar: number): number => embedded ? tbar : header;

export const topEdge = (): number => {
  const t = document.querySelector(".tbar");
  return pickTop(!!t, document.querySelector("header")?.getBoundingClientRect().bottom ?? 0, t?.getBoundingClientRect().bottom ?? 0);
};

/** Call first in `start()`, before the first paint. */
export function installEmbed(): void {
  if (!isEmbed(location.search)) return;
  document.documentElement.classList.add("embed");
  const bar = document.createElement("div");
  bar.className = "tbar";
  document.querySelector("main")!.prepend(bar);
  bar.append(document.getElementById("crumbs")!);
  bar.append(document.getElementById("zexp")!);
}
