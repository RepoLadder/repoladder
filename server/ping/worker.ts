// The usage-ping endpoint (Cloudflare Worker + D1). It only counts: it checks the payload
// against a fixed shape, adds one to a daily tally, and keeps no IP, headers or anything else.
// The payload is made by src/usage.ts `makePing`; PRIVACY.md says what is sent.

/** The slice of Cloudflare's D1 binding this worker uses (no @cloudflare/workers-types needed). */
export type D1 = {
  prepare(sql: string): { bind(...values: unknown[]): unknown };
  batch(statements: unknown[]): Promise<unknown>;
};
export type Env = { DB: D1 };

export type Run = { version: string; ok: boolean; error: string; size: string; seconds: number; mode: string; id: string };

const SIZES = new Set(["0", "1-49", "50-199", "200-999", "1000-4999", "5000+"]);
const MODES = new Set(["ai", "default"]);
export const VERSION_RE = /^[0-9A-Za-z.+-]{1,24}$/;
const KEYS = ["error", "id", "mode", "ok", "seconds", "size", "v", "version"].join();
const MAX_BODY = 512;

/** The ping as sent, or null for anything else: an extra field, a long string or a bad value is rejected whole. */
export function parseRun(body: string): Run | null {
  if (body.length > MAX_BODY) return null;
  let p: Record<string, unknown>;
  try { p = JSON.parse(body); } catch { return null; }
  if (!p || typeof p !== "object" || Array.isArray(p) || Object.keys(p).sort().join() !== KEYS) return null;
  const { v, version, ok, error, size, seconds, mode, id } = p;
  if (v !== 1 || typeof ok !== "boolean") return null;
  if (typeof version !== "string" || !VERSION_RE.test(version)) return null;
  if (ok ? error !== null : typeof error !== "string" || !/^[A-Z_]{1,32}$/.test(error)) return null;
  if (typeof size !== "string" || !SIZES.has(size) || typeof mode !== "string" || !MODES.has(mode)) return null;
  if (!Number.isInteger(seconds) || (seconds as number) < 0 || (seconds as number) > 86400) return null;
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return null;
  return { version, ok, error: (error as string | null) ?? "", size, seconds: seconds as number, mode, id };
}

export async function count(db: D1, r: Run, day: string): Promise<void> {
  await db.batch([
    db.prepare(
      `INSERT INTO runs (day, version, ok, error, size, mode, n, seconds_total) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT (day, version, ok, error, size, mode) DO UPDATE SET n = n + 1, seconds_total = seconds_total + excluded.seconds_total`,
    ).bind(day, r.version, r.ok ? 1 : 0, r.error, r.size, r.mode, r.seconds),
    db.prepare(
      `INSERT INTO installs (id, first_day, last_day, runs) VALUES (?, ?, ?, 1)
       ON CONFLICT (id) DO UPDATE SET last_day = excluded.last_day, runs = runs + 1`,
    ).bind(r.id, day, day),
  ]);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
    const run = parseRun(await req.text());
    if (!run) return new Response(null, { status: 400 });
    await count(env.DB, run, new Date().toISOString().slice(0, 10));
    return new Response(null, { status: 204 });
  },
};
