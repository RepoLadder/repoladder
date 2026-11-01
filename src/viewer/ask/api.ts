// The Ask calls to the local server: the feature probe, the streamed question, and the token. The token is passed in and
// sent as a header only; nothing here writes it to a URL, cookie or storage.
export const TOKEN_HEADER = "x-repoladder-token";
export type Status = { available: true; starters: string[] } | { available: false; code: string; message: string };
export type AskEvent =
  | { type: "start"; conversation: string }
  | { type: "text"; text: string }
  | { type: "tool"; name: string }
  | { type: "done"; text: string; segments: unknown; conversation?: string }
  | { type: "error"; code: string; message: string };
type Fetch = typeof fetch;

export const LOST = "The connection to RepoLadder stopped. Run `repoladder serve` again if it is not running.";

export function readToken(search: string): string | null {
  const t = new URLSearchParams(search).get("t");
  return t ? t : null;
}

/** null means "draw nothing": any failure, or a body that is not the status shape. */
export async function probe(f: Fetch, token: string): Promise<Status | null> {
  try {
    const r = await f("/api/ask/status", { headers: { [TOKEN_HEADER]: token } });
    if (r.status !== 200) return null;
    const b = await r.json();
    if (!b || typeof b !== "object" || typeof b.available !== "boolean") return null;
    if (b.available) {
      const s = Array.isArray(b.starters) && b.starters.length <= 4 && b.starters.every((x: unknown) => typeof x === "string") ? b.starters : [];
      return { available: true, starters: s };
    }
    return { available: false, code: String(b.code ?? "NO_CLAUDE"), message: String(b.message ?? "Claude Code is not available.") };
  } catch { return null; }
}

/** NDJSON framing: whole lines out, the trailing partial line back as `rest`. CRLF and blank lines are tolerated. */
export function splitLines(buf: string): { lines: string[]; rest: string } {
  const parts = buf.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.map((l) => l.replace(/\r$/, "")).filter((l) => l.trim()), rest };
}

function parseEvent(line: string): AskEvent | null {
  let o: any;
  try { o = JSON.parse(line); } catch { return null; }
  if (!o || typeof o !== "object") return null;
  switch (o.type) {
    case "start": return typeof o.conversation === "string" ? { type: "start", conversation: o.conversation } : null;
    case "text": return typeof o.text === "string" ? { type: "text", text: o.text } : null;
    case "tool": return { type: "tool", name: String(o.name ?? "") };
    case "done": return { type: "done", text: String(o.text ?? ""), segments: Array.isArray(o.segments) ? o.segments : null, conversation: typeof o.conversation === "string" ? o.conversation : undefined };
    case "error": return { type: "error", code: String(o.code ?? "AGENT_FAILED"), message: String(o.message ?? "Something went wrong.") };
    default: return null;
  }
}

export async function ask(f: Fetch, token: string, body: { question: string; conversation?: string }, signal: AbortSignal, onEvent: (e: AskEvent) => void): Promise<void> {
  const lost = () => onEvent({ type: "error", code: "CONNECTION_LOST", message: LOST });
  let settled = false;
  const emit = (e: AskEvent) => { if (e.type === "done" || e.type === "error") settled = true; onEvent(e); };
  try {
    const r = await f("/api/ask", { method: "POST", headers: { [TOKEN_HEADER]: token, "content-type": "application/json" }, body: JSON.stringify(body), signal });
    const type = r.headers.get("content-type") ?? "";
    if (!r.ok || !type.includes("ndjson")) {
      let b: any = null;
      try { b = await r.json(); } catch { /* not JSON */ }
      const e = b?.error ?? (b?.available === false ? b : null);
      return emit({ type: "error", code: String(e?.code ?? "AGENT_FAILED"), message: String(e?.message ?? "RepoLadder could not answer that.") });
    }
    if (!r.body) return lost();
    const reader = r.body.getReader(), dec = new TextDecoder();
    let rest = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const s = splitLines(rest + dec.decode(value, { stream: true }));
      rest = s.rest;
      for (const l of s.lines) { const e = parseEvent(l); if (e) emit(e); }
    }
    for (const l of splitLines(rest + "\n").lines) { const e = parseEvent(l); if (e) emit(e); }
    if (!settled) lost();
  } catch {
    if (!signal.aborted && !settled) lost();
  }
}
