/** Display order for HTTP methods; any other method sorts after these, alphabetically. */
export const METHOD_ORDER = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

/** Upper-cased, deduped, in `METHOD_ORDER`. */
export function sortMethods(ms: Iterable<string>): string[] {
  const rank = (m: string) => { const i = METHOD_ORDER.indexOf(m); return i < 0 ? METHOD_ORDER.length : i; };
  return [...new Set([...ms].map((m) => m.toUpperCase()))].sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
}

/** What an endpoint is shown as: `GET, POST /tasks`, or the bare name when the methods aren't known. */
export function endpointLabel(e: { name: string; methods?: string[] }): string {
  return e.methods?.length ? `${e.methods.join(", ")} ${e.name}` : e.name;
}
