// The Ask endpoint for `repoladder serve`: runs the user's own signed-in agent CLI (see engines/) headless in the repo (argv array, no shell, read-only tools) and streams the answer as NDJSON. See PRIVACY.md.
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ENGINES, engineById, noAgentMessage, type AgentChoice, type Engine, type EngineId } from "./engines/index.ts";
import type { Failure } from "./engines/types.ts";
import { segments } from "../model/cite.ts";
import { loadCiteContext } from "./facts.ts";
import { starterQuestions } from "../model/starters.ts";
import { stageAgentCommand, type Staged } from "./stage.ts";

export type AskConfig = {
  /** The served repo: the child's working directory. */
  root: string;
  /** The out dir holding facts.json for the one allowed `query` command. */
  out: string;
  /** Entry point the agent's command runs; defaults to this process's script. */
  cli?: string;
  node?: string;
  /** Which agent runs Ask: one engine, or `auto` (the default: engines/ order). */
  agent?: AgentChoice;
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

type Convo = { engine: EngineId; session?: string; lastUsed: number };

export function createAsk(cfg: AskConfig): Ask {
  const staged: Staged | null = stageAgentCommand({ out: cfg.out, root: cfg.root, node: cfg.node ?? process.execPath, cli: cfg.cli ?? process.argv[1] });
  const convos = new Map<string, Convo>();
  const live = new Set<ChildProcess>();
  const choice: AgentChoice = cfg.agent ?? "auto";
  const candidates: Engine[] = choice === "auto" ? ENGINES : [engineById(choice)];
  const binOf = (e: Engine) => process.env[e.binEnv] || e.defaultBin;
  const envOf = (e: Engine) => ({ ...e.env(process.env), ...cfg.extraEnv });
  let active: Engine | undefined;
  let busy = false;
  let status: { at: number; body: Record<string, unknown> } | undefined;

  const NONE_MESSAGE = () => noAgentMessage(candidates);

  /** Runs `<bin> <args>`; resolves the exit code and stdout, or the spawn error code. */
  const run = (e: Engine, args: string[]) => new Promise<{ code?: number | null; out: string; error?: string; timedOut?: boolean }>((resolve) => {
    let out = "", done = false;
    const finish = (r: { code?: number | null; out: string; error?: string; timedOut?: boolean }) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    const c = spawn(binOf(e), args, { cwd: cfg.root, env: envOf(e), stdio: ["ignore", "pipe", "ignore"], shell: false });
    const timer = setTimeout(() => { killChild(c); finish({ out, timedOut: true }); }, 5000);
    c.stdout!.on("data", (d) => (out += d));
    c.on("error", (err) => finish({ out, error: (err as NodeJS.ErrnoException).code ?? "ERROR" }));
    c.on("close", (code) => finish({ code, out }));
  });

  const probeOne = async (e: Engine): Promise<Record<string, unknown>> => {
    const v = await run(e, e.versionArgv);
    if (v.timedOut) return { available: false, code: "AGENT_FAILED", message: `${e.label} did not answer its version check in time.` };
    if (v.error) return { available: false, ...e.explainFailure({ spawnError: v.error }) };
    if (v.code !== 0) return { available: false, ...e.explainFailure({ exitCode: v.code }) };
    if (e.authArgv) {
      const a = await run(e, e.authArgv);
      if (a.timedOut) return { available: false, code: "AGENT_FAILED", message: `${e.label} did not answer its sign-in check in time.` };
      if (a.error || a.code !== 0) return { available: false, ...e.explainFailure({ stderr: "not logged in" }) };
    }
    active = e;
    return { available: true, version: v.out.trim(), agent: { id: e.id, label: e.label } };
  };

  const probe = async (): Promise<Record<string, unknown>> => {
    if (!staged) return { available: false, code: "UNSAFE_PATH", message: UNSAFE_MESSAGE };
    active = undefined;
    let first: Record<string, unknown> | undefined;
    for (const e of candidates) {
      const r = await probeOne(e);
      if (r.available === true) return r;
      first ??= r;
      // auto moves on when an agent is missing or will not start; a working-but-signed-out or too-old one is reported as it is
      if (r.code !== "NO_AGENT" && r.code !== "AGENT_FAILED") return r;
    }
    return candidates.length === 1 ? first! : { available: false, code: "NO_AGENT", message: NONE_MESSAGE() };
  };

  // starters come from the facts on disk each time, so a rebuild is picked up; the probe result itself is cached
  const withStarters = (body: Record<string, unknown>) => {
    if (body.available !== true) return body;
    let starters: string[] = [];
    try { starters = starterQuestions(loadCiteContext(cfg.out)?.facts); } catch { starters = []; }
    return { ...body, starters };
  };
  const statusRoute: Handler = (_req, res) => {
    if (status && Date.now() - status.at < STATUS_TTL_MS) return json(res, 200, withStarters(status.body));
    probe().then((body) => { status = { at: Date.now(), body }; json(res, 200, withStarters(body)); });
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
      if (busy) return bad(res, 429, "ASK_BUSY", "Ask is still answering the last question. Wait for it to finish or stop it.");
      if (active) return begin(body, question);
      // no good probe yet (the browser never asked for status): probe once so Ask works anyway
      probe().then((b) => {
        status = { at: Date.now(), body: b };
        if (b.available !== true) {
          res.writeHead(200, { ...HEAD, "Content-Type": "application/x-ndjson; charset=utf-8" });
          return res.end(JSON.stringify({ type: "error", code: b.code, message: b.message }) + "\n");
        }
        begin(body, question);
      }, () => { if (!res.headersSent) bad(res, 500, "INTERNAL", "Something went wrong inside repoladder serve."); });
    }
    function begin(body: any, question: string) {
      if (busy) return bad(res, 429, "ASK_BUSY", "Ask is still answering the last question. Wait for it to finish or stop it.");
      const engine = active!;
      let id: string, convo: Convo, resume: boolean;
      if (body.conversation !== undefined) {
        const found = convos.get(body.conversation);
        if (!found || found.engine !== engine.id) return bad(res, 400, "UNKNOWN_CONVERSATION", "That conversation is not known; start a new one.");
        [id, convo, resume] = [body.conversation, found, true];
        convo.lastUsed = Date.now();
      } else {
        id = randomBytes(8).toString("hex");
        convo = { engine: engine.id, session: engine.sessions === "assigned" ? randomUUID() : undefined, lastUsed: Date.now() };
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
      stream(res, engine, question, id, convo, resume);
    }
  };

  function stream(res: ServerResponse, engine: Engine, question: string, id: string, convo: Convo, resume: boolean) {
    const parse = engine.parser();
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
      child = spawn(binOf(engine), engine.argv({ prompt: question, session: convo.session, resume, cmdPrefix: staged!.prefix, guardCmd: staged!.guard }), { cwd: cfg.root, env: envOf(engine), stdio: ["ignore", "pipe", "pipe"], shell: false, detached: POSIX });
    } catch (e) { return fail(engine.explainFailure({ spawnError: (e as NodeJS.ErrnoException).code ?? "ERROR" })); }
    live.add(child);
    timer = setTimeout(() => { timedOut = true; killChild(child, true); }, timeoutMs());
    res.on("close", () => { if (!finished) { finished = true; clearTimeout(timer); release(); killChild(child, true); } });
    const line = (l: string) => {
      for (const ev of parse(l)) {
        if (ev.type !== "result") sessionStarted = true;
        if (ev.type === "session") { convo.session = ev.id; continue; }
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
    child.on("error", (e) => { live.delete(child); fail(engine.explainFailure({ spawnError: (e as NodeJS.ErrnoException).code ?? "ERROR" })); });
    child.on("close", (code) => {
      live.delete(child);
      if (buf.trim()) line(buf);
      if (finished) return;
      if (tooMany) return fail({ code: "TOO_MANY_STEPS", message: `${engine.label} needed too many steps for that question, so it was stopped. Try a narrower question.` });
      if (timedOut) return fail(engine.explainFailure({ timedOut: true }));
      if (result?.ok) {
        const text = result.text || deltas;
        if (!deltas && text) send({ type: "text", text });
        // verified here, from the facts on disk: the browser never supplies or alters segments
        let segs: unknown = null;
        try { const c = loadCiteContext(cfg.out); if (c) segs = segments(text, c.facts, c.boxes); } catch { segs = null; }
        return end({ type: "done", text, segments: segs, conversation: id });
      }
      fail(engine.explainFailure({ exitCode: code, stderr, resultError: result?.error }));
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
