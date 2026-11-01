// `repoladder serve`: hosts the built map on 127.0.0.1 behind a per-run token. The only code that listens on a port.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { authorize, newToken } from "./guard.ts";
import { createAsk, type AskConfig } from "./ask.ts";
import { askAssets } from "../build/viewer.ts";

export type Handler = (req: IncomingMessage, res: ServerResponse) => void;
/** "GET /api/x" -> handler. Looked up only after authorize() passed. */
export type Routes = Record<string, Handler>;

export type ServerOpts = { page: () => Buffer | string; port?: number; routes?: Routes; ask?: AskConfig | false };
export type Running = { url: string; port: number; token: string; close(): Promise<void> };

const HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

const send = (res: ServerResponse, status: number, body: Buffer | string, type = "text/plain; charset=utf-8") => {
  res.writeHead(status, { ...HEADERS, "Content-Type": type });
  res.end(body);
};

/** The style and script `GET /` appends when Ask is on (their `</script`/`</style` are already escaped by askAssets). */
export function askTail(): string {
  const a = askAssets();
  return `\n<style>${a.css}</style>\n<script>${a.js};repoladderAsk.start();</script>\n`;
}

export const pageFromFile = (path: string) => () => readFileSync(path);

export function startServer(opts: ServerOpts): Promise<Running> {
  const token = newToken();
  const ask = opts.ask ? createAsk(opts.ask) : undefined;
  const routes = { ...ask?.routes, ...opts.routes };
  // The Ask bar ships only in the served response: the file on disk and every published page stay free of it.
  const tail = ask ? askTail() : "";
  let port = 0;
  const server = createServer((req, res) => {
    // never URL-parse the target: `//` or `http://` would throw or rewrite the path. Anything but one leading `/` gets a path no route has.
    const raw = req.url ?? "/";
    const target = /^\/(?!\/)/.test(raw) ? raw.split("#")[0] : "/\0invalid";
    const q = target.indexOf("?");
    const url = { pathname: q < 0 ? target : target.slice(0, q), searchParams: new URLSearchParams(q < 0 ? "" : target.slice(q + 1)) };
    const verdict = authorize(
      { method: req.method ?? "GET", path: url.pathname, query: url.searchParams, headers: req.headers, remoteAddress: req.socket.remoteAddress },
      { port, token },
    );
    if (!verdict.ok) return send(res, verdict.status, verdict.message);
    const method = req.method ?? "GET";
    const route = routes[`${method} ${url.pathname}`];
    if (route) return route(req, res);
    if (method !== "GET") return send(res, 405, "Method not allowed");
    if (url.pathname === "/" || url.pathname === "/index.html") {
      try { return send(res, 200, tail ? Buffer.concat([Buffer.from(opts.page()), Buffer.from(tail)]) : opts.page(), "text/html; charset=utf-8"); }
      catch { return send(res, 500, "The map could not be read."); }
    }
    send(res, 404, "Not found");
  });
  return new Promise((resolve, reject) => {
    server.once("error", (e) => { ask?.close(); reject(e); });
    server.listen(opts.port ?? 0, "127.0.0.1", () => {
      port = (server.address() as { port: number }).port;
      resolve({
        url: `http://127.0.0.1:${port}/?t=${token}`,
        port,
        token,
        close: () => new Promise<void>((done) => { ask?.close(); server.close(() => done()); server.closeAllConnections(); }),
      });
    });
  });
}
