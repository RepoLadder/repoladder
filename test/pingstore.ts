// A local stand-in for the ping store: runs the real worker and the real schema.sql on node:sqlite,
// so the whole ping path is testable without a Cloudflare account. Never wrangler.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import worker, { type D1 } from "../server/ping/worker.ts";

export function openStore(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../server/ping/schema.sql", import.meta.url), "utf8"));
  return db;
}

/** A D1 look-alike over node:sqlite; batch runs as one transaction, like D1's. */
export function d1(db: DatabaseSync): D1 {
  return {
    prepare: (sql) => ({ bind: (...v) => ({ sql, v }) }),
    batch: async (stmts) => {
      db.exec("BEGIN");
      try {
        for (const s of stmts as { sql: string; v: SQLInputValue[] }[]) db.prepare(s.sql).run(...s.v);
        db.exec("COMMIT");
      } catch (e) { db.exec("ROLLBACK"); throw e; }
    },
  };
}

export async function startPingStore(): Promise<{ url: string; db: DatabaseSync; close(): Promise<void> }> {
  const db = openStore();
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      const r = await worker.fetch(new Request("http://ping.test/", { method: req.method, body: req.method === "POST" ? body : undefined }), { DB: d1(db) });
      res.writeHead(r.status).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  return { url, db, close: () => new Promise<void>((r) => { server.close(() => r()); server.closeAllConnections(); }) };
}
