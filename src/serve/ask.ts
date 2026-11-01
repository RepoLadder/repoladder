// The Ask endpoint for `repoladder serve`: runs the user's own signed-in `claude` CLI headless in the repo (argv array, no shell, read-only tools) and streams the answer as NDJSON. See PRIVACY.md.
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { askArgv, childEnv, explainFailure, parseStreamLine, type Failure } from "./claude.ts";
import { stageAgentCommand, type Staged } from "./stage.ts";

export type AskConfig = {
  /** The served repo: the child's working directory. */
  root: string;
  /** The out dir holding facts.json for the one allowed `query` command. */
  out: string;
  /** Entry point the agent's command runs; defaults to this process's script. */
  cli?: string;
  node?: string;
  /** Extra environment for the child, set by code (never read from the parent environment). */
  extraEnv?: Record<string, string>;
};
type Handler = (req: IncomingMessage, res: ServerResponse) => void;
export type Ask = { routes: Record<string, Handler>; close(): void };

const MAX_BODY = 16 * 1024;
const MAX_QUESTION = 2000;
const POSIX = process.platform !== "win32";
const MAX_TOOLS = 25;
const MAX_CONVERSATIONS = 20;
const DEFAULT_TIMEOUT_MS = 120_000;
const STATUS_TTL_MS = 10_000;
const UNSAFE_MESSAGE = "Ask can't run from a folder whose path has spaces or special characters. Move RepoLadder to a plain path and try again.";
const HEAD = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { ...HEAD, "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};
const bad = (res: ServerResponse, status: number, code: string, message: string) => json(res, status, { error: { code, message } });

const timeoutMs = () => {
  const n = Number(process.env.REPOLADDER_ASK_TIMEOUT_MS);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
};

const exited = (c: ChildProcess) => c.exitCode !== null || c.signalCode !== null;
/** Signals the child, or on POSIX its whole process group (the child leads its own group, so a shell or tool it started dies with it). */
const signal = (c: ChildProcess, sig: NodeJS.Signals, group: boolean) => {
  try {
    if (group && POSIX && c.pid) process.kill(-c.pid, sig);
    else c.kill(sig);
  } catch { /* already gone */ }
};
const killChild = (c: ChildProcess, group = false) => {
  if (exited(c) && !group) return;
  signal(c, "SIGTERM", group);
  setTimeout(() => { if (group || !exited(c)) signal(c, "SIGKILL", group); }, 2000).unref();
};

type Convo = { sessionUuid: string; lastUsed: number };

export function createAsk(cfg: AskConfig): Ask {
  const staged: Staged | null = stageAgentCommand({ out: cfg.out, root: cfg.root, node: cfg.node ?? process.execPath, cli: cfg.cli ?? process.argv[1] });
  const convos = new Map<string, Convo>();
  const live = new Set<ChildProcess>();
  const bin = () => process.env.REPOLADDER_CLAUDE_BIN || "claude";
  const env = () => ({ ...childEnv(process.env), ...cfg.extraEnv });
  let busy = false;
  let status: { at: number; body: Record<string, unknown> } | undefined;

  const probe = (): Promise<Record<string, unknown>> => new Promise((resolve) => {
    if (!staged) return resolve({ available: false, code: "UNSAFE_PATH", message: UNSAFE_MESSAGE });
    let out = "", done = false;
    const finish = (b: Record<string, unknown>) => { if (!done) { done = true; clearTimeout(timer); resolve(b); } };
    const c = spawn(bin(), ["--version"], { cwd: cfg.root, env: env(), stdio: ["ignore", "pipe", "ignore"], shell: false });
    const timer = setTimeout(() => { killChild(c); finish({ available: false, code: "AGENT_FAILED", message: "Claude Code did not answer `claude --version` in time." }); }, 5000);
    c.stdout!.on("data", (d) => (out += d));
    c.on("error", (e) => { const f = explainFailure({ spawnError: (e as NodeJS.ErrnoException).code ?? "ERROR" }); finish({ available: false, ...f }); });
    c.on("close", (code) => {
      if (code === 0) finish({ available: true, version: out.trim() });
      else finish({ available: false, ...explainFailure({ exitCode: code }) });
    });
  });

  const statusRoute: Handler = (_req, res) => {
    if (status && Date.now() - status.at < STATUS_TTL_MS) return json(res, 200, status.body);
    probe().then((body) => { status = { at: Date.now(), body }; json(res, 200, body); });
  };

  const readBody = (req: IncomingMessage, res: ServerResponse, then: (raw: string) => void) => {
    const chunks: Buffer[] = [];
    let size = 0, over = false;
    req.on("data", (d: Buffer) => {
      if (over) return;
      size += d.length;
      if (size > MAX_BODY) {
        over = true;
        res.setHeader("Connection", "close");
        res.on("finish", () => req.destroy());
        bad(res, 413, "BODY_TOO_LARGE", "That question is too large.");
        return;
      }
      chunks.push(d);
    });
    req.on("end", () => { if (!over) then(Buffer.concat(chunks).toString("utf8")); });
    req.on("error", () => { if (!res.headersSent) bad(res, 400, "BAD_QUESTION", "The request could not be read."); });
  };

  const askRoute: Handler = (req, res) => {
    if (!/^application\/json\s*(;|$)/i.test(req.headers["content-type"] ?? "")) return bad(res, 415, "BAD_CONTENT_TYPE", "Send the question as application/json.");
    readBody(req, res, (raw) => { try { handle(raw); } catch { if (!res.headersSent) bad(res, 500, "INTERNAL", "Something went wrong inside repoladder serve."); else res.end(); } });
    function handle(raw: string) {
      let body: any;
      try { body = JSON.parse(raw); } catch { return bad(res, 400, "BAD_QUESTION", "The request body is not valid JSON."); }
      const question = typeof body?.question === "string" ? body.question.trim() : "";
      if (!question || question.includes("\0")) return bad(res, 400, "BAD_QUESTION", "Ask a question as a non-empty string.");
      if (question.length > MAX_QUESTION) return bad(res, 400, "QUESTION_TOO_LONG", `That question is too long. Keep it under ${MAX_QUESTION} characters.`);
      if (body.conversation !== undefined && (typeof body.conversation !== "string" || !/^[0-9a-f]{16}$/.test(body.conversation))) return bad(res, 400, "UNKNOWN_CONVERSATION", "That conversation is not known; start a new one.");
      if (busy) return bad(res, 429, "ASK_BUSY", "Claude is still answering the last question. Wait for it to finish or stop it.");
      let id: string, convo: Convo, resume: boolean;
      if (body.conversation !== undefined) {
        const found = convos.get(body.conversation);
        if (!found) return bad(res, 400, "UNKNOWN_CONVERSATION", "That conversation is not known; start a new one.");
        [id, convo, resume] = [body.conversation, found, true];
        convo.lastUsed = Date.now();
      } else {
        id = randomBytes(8).toString("hex");
        convo = { sessionUuid: randomUUID(), lastUsed: Date.now() };
        resume = false;
        convos.set(id, convo);
        while (convos.size > MAX_CONVERSATIONS) {
          const oldest = [...convos.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0][0];
          convos.delete(oldest);
        }
      }
      if (!staged) {
        if (!resume) convos.delete(id);
        return json(res, 200, { available: false, code: "UNSAFE_PATH", message: UNSAFE_MESSAGE });
      }
      stream(res, question, id, convo, resume);
    }
  };

  function stream(res: ServerResponse, question: string, id: string, convo: Convo, resume: boolean) {
    busy = true;
    const release = () => { busy = false; };
    res.writeHead(200, { ...HEAD, "Content-Type": "application/x-ndjson; charset=utf-8" });
    const send = (o: unknown) => { if (!res.writableEnded) res.write(JSON.stringify(o) + "\n"); };
    send({ type: "start", conversation: id });
    let finished = false, timedOut = false, tooMany = false, sessionStarted = false, tools = 0;
    let stderr = "", buf = "", deltas = "";
    let result: { ok: boolean; text: string; error?: string } | undefined;
    let child: ChildProcess;
    let timer: NodeJS.Timeout | undefined;
    const end = (last: unknown) => { if (finished) return; finished = true; clearTimeout(timer); release(); send(last); res.end(); };
    const fail = (f: Failure) => {
      if (!resume && !sessionStarted) convos.delete(id);
      end({ type: "error", code: f.code, message: f.message });
    };
    try {
      child = spawn(bin(), askArgv({ prompt: question, session: convo.sessionUuid, resume, cmdPrefix: staged!.prefix, guardCmd: staged!.guard }), { cwd: cfg.root, env: env(), stdio: ["ignore", "pipe", "pipe"], shell: false, detached: POSIX });
    } catch (e) { return fail(explainFailure({ spawnError: (e as NodeJS.ErrnoException).code ?? "ERROR" })); }
    live.add(child);
    timer = setTimeout(() => { timedOut = true; killChild(child, true); }, timeoutMs());
    res.on("close", () => { if (!finished) { finished = true; clearTimeout(timer); release(); killChild(child, true); } });
    const line = (l: string) => {
      for (const ev of parseStreamLine(l)) {
        if (ev.type !== "result") sessionStarted = true;
        if (ev.type === "text") { deltas += ev.text; send({ type: "text", text: ev.text }); }
        else if (ev.type === "tool") {
          send({ type: "tool", name: ev.name });
          if (++tools > MAX_TOOLS && !tooMany) { tooMany = true; killChild(child, true); }
        } else result = ev;
      }
    };
    child.stdout!.on("data", (d) => {
      buf += d;
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) { line(buf.slice(0, i)); buf = buf.slice(i + 1); }
    });
    child.stderr!.on("data", (d) => { stderr = (stderr + d).slice(-4096); });
    child.on("error", (e) => { live.delete(child); fail(explainFailure({ spawnError: (e as NodeJS.ErrnoException).code ?? "ERROR" })); });
    child.on("close", (code) => {
      live.delete(child);
      if (buf.trim()) line(buf);
      if (finished) return;
      if (tooMany) return fail({ code: "TOO_MANY_STEPS", message: "Claude needed too many steps for that question, so it was stopped. Try a narrower question." });
      if (timedOut) return fail(explainFailure({ timedOut: true }));
      if (result?.ok) {
        const text = result.text || deltas;
        if (!deltas && text) send({ type: "text", text });
        return end({ type: "done", text, conversation: id });
      }
      fail(explainFailure({ exitCode: code, stderr, resultError: result?.error }));
    });
  }

  return {
    routes: { "GET /api/ask/status": statusRoute, "POST /api/ask": askRoute },
    close() {
      for (const c of live) killChild(c, true);
      busy = false;
      staged?.cleanup();
    },
  };
}
