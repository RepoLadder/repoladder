// Request guards for `repoladder serve`: pure, no I/O. authorize() runs before any route lookup.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const TOKEN_HEADER = "x-repoladder-token";

export const newToken = (): string => randomBytes(32).toString("hex");

const sha = (s: string) => createHash("sha256").update(s).digest();

/** Constant-time compare: both sides are hashed first, so the length never leaks. */
export const tokenOk = (supplied: string | undefined, expected: string): boolean =>
  !!supplied && !!expected && timingSafeEqual(sha(supplied), sha(expected));

/** Only `127.0.0.1:<port>` and `localhost:<port>` (any case) are our own name: anything else is a DNS-rebinding attempt. */
export const hostAllowed = (host: string | undefined, port: number): boolean => {
  if (!host) return false;
  const h = host.toLowerCase();
  return h === `127.0.0.1:${port}` || h === `localhost:${port}`;
};

export const remoteAllowed = (addr: string | undefined): boolean =>
  addr === "127.0.0.1" || addr === "::ffff:127.0.0.1" || addr === "::1";

export type Req = {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string | string[] | undefined>;
  remoteAddress: string | undefined;
};
export type Verdict = { ok: true } | { ok: false; status: 401 | 403; message: string };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** A request from a page on another site (or an opaque origin) must never reach a route. `Origin` must be exactly our own origin; `Sec-Fetch-Site` of cross-site or same-site is refused except on the first page load. */
export const originAllowed = (req: Req, port: number): boolean => {
  const origin = first(req.headers.origin);
  if (origin !== undefined && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) return false;
  const site = first(req.headers["sec-fetch-site"])?.toLowerCase();
  const firstLoad = req.method === "GET" && (req.path === "/" || req.path === "/index.html");
  return firstLoad || (site !== "cross-site" && site !== "same-site");
};

/** Order: remote address, Host, Origin, token. The query token counts only on `GET /` (the first page load cannot send headers). */
export function authorize(req: Req, ctx: { port: number; token: string }): Verdict {
  if (!remoteAllowed(req.remoteAddress)) return { ok: false, status: 403, message: "Forbidden: local connections only." };
  if (!hostAllowed(first(req.headers.host), ctx.port)) return { ok: false, status: 403, message: "Forbidden: unexpected Host." };
  if (!originAllowed(req, ctx.port)) return { ok: false, status: 403, message: "Forbidden: cross-origin requests are refused." };
  const fromQuery = req.method === "GET" && req.path === "/" ? req.query.get("t") ?? undefined : undefined;
  if (tokenOk(first(req.headers[TOKEN_HEADER]), ctx.token) || tokenOk(fromQuery, ctx.token)) return { ok: true };
  return { ok: false, status: 401, message: "Open the link `repoladder serve` printed; it carries the access token." };
}
