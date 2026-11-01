// The Ask bar's client logic: state machine, NDJSON stream reader, feature probe, token and key handling. No DOM needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ask, probe, readToken, splitLines, TOKEN_HEADER, type AskEvent } from "../src/viewer/ask/api.ts";
import { keyAction, type KeyIn } from "../src/viewer/ask/keys.ts";
import { busy, initial, reduce, type Ev, type State } from "../src/viewer/ask/state.ts";
import { dropToken } from "../src/viewer/embed.ts";

const run = (evs: Ev[], from: State = initial()) => evs.reduce(reduce, from);

test("reducer: a question goes loading, streaming, done and keeps its conversation for the follow-up", () => {
  let s = run([{ type: "submit", q: " hi " }]);
  assert.equal(s.phase, "loading");
  assert.equal(s.turns[0].q, "hi");
  s = run([{ type: "start", conversation: "c1" }, { type: "tool", name: "Grep" }], s);
  assert.equal(s.phase, "streaming");
  s = run([{ type: "text", text: "a" }, { type: "text", text: "b" }], s);
  assert.equal(s.turns[0].text, "ab");
  s = run([{ type: "done", text: "ab!", segments: null }], s);
  assert.equal(s.phase, "done");
  assert.equal(s.turns[0].segments, null);
  assert.equal(s.conversation, "c1");
  s = run([{ type: "submit", q: "more" }], s);
  assert.equal(s.conversation, "c1");
  assert.equal(s.turns.length, 2);
});

test("reducer: a submit while busy, empty, or without an agent is ignored", () => {
  const loading = run([{ type: "submit", q: "a" }]);
  assert.equal(reduce(loading, { type: "submit", q: "b" }), loading);
  assert.deepEqual(reduce(initial(), { type: "submit", q: "  " }), initial());
  const none = run([{ type: "unavailable", code: "NO_CLAUDE", message: "m" }]);
  assert.equal(none.phase, "no-agent");
  assert.equal(reduce(none, { type: "submit", q: "x" }), none);
  assert.deepEqual(reduce(initial(), { type: "text", text: "x" }), initial());
});

test("reducer: errors, retry, stop and reset", () => {
  const first = run([{ type: "submit", q: "a" }, { type: "start", conversation: "c" }, { type: "error", code: "AGENT_FAILED", message: "bad" }]);
  assert.equal(first.phase, "error");
  assert.equal(first.conversation, undefined);
  assert.deepEqual(first.error, { code: "AGENT_FAILED", message: "bad" });
  const retried = reduce(first, { type: "retry" });
  assert.equal(retried.phase, "idle");
  assert.equal(retried.turns.length, 0);

  const follow = run([{ type: "submit", q: "a" }, { type: "start", conversation: "c" }, { type: "done", text: "x", segments: [] }, { type: "submit", q: "b" }, { type: "error", code: "TIMEOUT", message: "slow" }]);
  assert.equal(follow.conversation, "c");
  const gone = run([{ type: "submit", q: "c" }, { type: "error", code: "UNKNOWN_CONVERSATION", message: "x" }], run([{ type: "submit", q: "a" }, { type: "start", conversation: "c" }, { type: "done", text: "x", segments: [] }]));
  assert.equal(gone.conversation, undefined);

  const part = run([{ type: "submit", q: "a" }, { type: "text", text: "par" }, { type: "stop" }]);
  assert.equal(part.phase, "stopped");
  assert.equal(part.turns[0].text, "par");
  assert.equal(reduce(part, { type: "text", text: "late" }), part);
  assert.equal(busy(part), false);
  assert.equal(reduce(part, { type: "stop" }), part);
  assert.deepEqual(reduce(part, { type: "reset" }), initial());
  assert.equal(reduce(initial(), { type: "retry" }).phase, "idle");
});

test("splitLines tolerates CRLF, blank lines and a trailing partial line", () => {
  assert.deepEqual(splitLines('{"a":1}\r\n\n{"b"'), { lines: ['{"a":1}'], rest: '{"b"' });
  assert.deepEqual(splitLines("no newline"), { lines: [], rest: "no newline" });
  assert.deepEqual(splitLines("x\ny\n"), { lines: ["x", "y"], rest: "" });
});

const streamOf = (chunks: string[], fail = false) => {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({
    start(c) { for (const x of chunks) c.enqueue(enc.encode(x)); if (fail) c.error(new Error("drop")); else c.close(); },
  }), { status: 200, headers: { "content-type": "application/x-ndjson" } });
};
const collect = async (f: typeof fetch, body = { question: "q" }) => {
  const out: AskEvent[] = [];
  await ask(f, "tok", body, new AbortController().signal, (e) => out.push(e));
  return out;
};

test("ask reads a stream split mid-line and mid-character", async () => {
  const line = (o: unknown) => JSON.stringify(o) + "\n";
  const all = line({ type: "start", conversation: "c" }) + "not json\n" + line({ type: "text", text: "é" }) + line({ type: "tool", name: "Read" }) + line({ type: "done", text: "é", segments: [{ text: "é" }], conversation: "c" });
  const bytes = new TextEncoder().encode(all);
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += 7) chunks.push(bytes.slice(i, i + 7));
  const res = new Response(new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(x)); c.close(); } }), { headers: { "content-type": "application/x-ndjson" } });
  let seen: { url: string; init: RequestInit } | undefined;
  const ev = await collect((async (u: string, i: RequestInit) => { seen = { url: u, init: i }; return res; }) as unknown as typeof fetch, { question: "q" });
  assert.deepEqual(ev.map((e) => e.type), ["start", "text", "tool", "done"]);
  assert.equal(seen!.url, "/api/ask");
  assert.equal((seen!.init.headers as Record<string, string>)[TOKEN_HEADER], "tok");
  assert.ok(!seen!.url.includes("tok"));
});

test("ask turns HTTP errors, a dropped stream and an early end into error events", async () => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  let ev = await collect((async () => json(400, { error: { code: "BAD_QUESTION", message: "no" } })) as unknown as typeof fetch);
  assert.deepEqual(ev, [{ type: "error", code: "BAD_QUESTION", message: "no" }]);
  ev = await collect((async () => json(200, { available: false, code: "UNSAFE_PATH", message: "path" })) as unknown as typeof fetch);
  assert.equal(ev[0].type === "error" && ev[0].code, "UNSAFE_PATH");
  ev = await collect((async () => new Response("<html>", { status: 502 })) as unknown as typeof fetch);
  assert.equal(ev[0].type === "error" && ev[0].code, "AGENT_FAILED");
  ev = await collect((async () => streamOf(['{"type":"text","text":"a"}\n'], true)) as unknown as typeof fetch);
  assert.equal(ev.at(-1)!.type === "error" && (ev.at(-1) as { code: string }).code, "CONNECTION_LOST");
  ev = await collect((async () => streamOf(['{"type":"text","text":"a"}\n'])) as unknown as typeof fetch);
  assert.equal((ev.at(-1) as { code: string }).code, "CONNECTION_LOST");
  ev = await collect((async () => { throw new TypeError("network"); }) as unknown as typeof fetch);
  assert.equal((ev[0] as { code: string }).code, "CONNECTION_LOST");
});

test("an aborted ask reports nothing", async () => {
  const c = new AbortController();
  const out: AskEvent[] = [];
  c.abort();
  await ask((async () => { throw new DOMException("aborted", "AbortError"); }) as unknown as typeof fetch, "t", { question: "q" }, c.signal, (e) => out.push(e));
  assert.deepEqual(out, []);
});

test("probe: ok and unavailable mount; every other answer draws nothing", async () => {
  const reply = (status: number, body: string) => (async () => new Response(body, { status })) as unknown as typeof fetch;
  assert.deepEqual(await probe(reply(200, '{"available":true,"starters":["a","b"]}'), "t"), { available: true, starters: ["a", "b"] });
  assert.deepEqual(await probe(reply(200, '{"available":true,"starters":[1]}'), "t"), { available: true, starters: [] });
  assert.deepEqual(await probe(reply(200, '{"available":true,"starters":["1","2","3","4","5"]}'), "t"), { available: true, starters: [] });
  assert.deepEqual(await probe(reply(200, '{"available":false,"code":"NO_CLAUDE","message":"m"}'), "t"), { available: false, code: "NO_CLAUDE", message: "m" });
  for (const f of [reply(401, "{}"), reply(404, "x"), reply(200, "<html>"), reply(200, '{"available":"yes"}'), reply(200, "null"), (async () => { throw new TypeError("x"); }) as unknown as typeof fetch]) {
    assert.equal(await probe(f, "t"), null);
  }
  let seen: { url: string; init: RequestInit } | undefined;
  await probe((async (u: string, i: RequestInit) => { seen = { url: u, init: i }; return new Response("{}"); }) as unknown as typeof fetch, "secret");
  assert.equal(seen!.url, "/api/ask/status");
  assert.equal((seen!.init.headers as Record<string, string>)[TOKEN_HEADER], "secret");
  assert.ok(!seen!.url.includes("secret"));
});

test("token reader and dropToken", () => {
  assert.equal(readToken("?t=abc&x=1"), "abc");
  assert.equal(readToken("?x=1"), null);
  assert.equal(readToken(""), null);
  assert.equal(readToken("?t="), null);
  assert.equal(dropToken("http://127.0.0.1:5/?t=abc&embed=1&x=2#n:a"), "http://127.0.0.1:5/?embed=1&x=2#n:a");
  assert.equal(dropToken("http://127.0.0.1:5/?t=abc#h"), "http://127.0.0.1:5/#h");
  assert.equal(dropToken("not a url"), "not a url");
});

const k = (o: Partial<KeyIn>): KeyIn => ({ key: "", typing: false, inAsk: false, metaKey: false, ctrlKey: false, altKey: false, hasPanelOpen: false, ...o });

test("keyAction: ? focuses, Enter submits, Escape collapses then blurs, / and Cmd+K are never ours", () => {
  assert.equal(keyAction(k({ key: "?" })), "focus");
  assert.equal(keyAction(k({ key: "?", typing: true })), null);
  assert.equal(keyAction(k({ key: "?", ctrlKey: true })), null);
  assert.equal(keyAction(k({ key: "?", blocked: true })), null);
  assert.equal(keyAction(k({ key: "Enter", inAsk: true, typing: true })), "submit");
  assert.equal(keyAction(k({ key: "Enter", inAsk: true, canSubmit: false })), null);
  assert.equal(keyAction(k({ key: "Escape", inAsk: true, hasPanelOpen: true })), "collapse");
  assert.equal(keyAction(k({ key: "Escape", inAsk: true })), "blur");
  assert.equal(keyAction(k({ key: "Escape" })), null);
  for (const key of ["/", "k"]) for (const inAsk of [false, true]) assert.equal(keyAction(k({ key, inAsk, metaKey: key === "k", typing: inAsk })), null);
  assert.equal(keyAction(k({ key: "a", typing: true })), null);
});
