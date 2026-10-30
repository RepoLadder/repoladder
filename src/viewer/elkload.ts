// elkjs for the detail dial's in-page layouts, loaded on first use only, so the
// Default stop costs nothing. It runs in a Worker started from a blob: URL that importScripts the
// pinned jsdelivr file (an Artifact page may start Workers only from blob: URLs or its own files,
// and a cross-origin script can't be a Worker directly), so pan and zoom never wait on a layout.
// The file is elkjs's own worker build (the same release as `elk.bundled.js`, which the spike timed,
// and the same size: elk.bundled.js only installs its worker side when its API is constructed, and
// that fails inside a Worker). It answers elkjs's worker protocol: {cmd: "layout", id, graph} -> {id, data}.
import type { ElkNode } from "elkjs/lib/elk-api.js";

export const ELK_URL = "https://cdn.jsdelivr.net/npm/elkjs@0.11.0/lib/elk-worker.min.js";
/** What the dial says when the other stops can't be laid out (the fetch failed or was blocked). */
export const ELK_NOTE = "Other detail settings need the layout engine from cdn.jsdelivr.net, which didn't load.";
/** Gives up on a load that hasn't answered by then (a stalled network shouldn't spin forever). */
const LOAD_MS = 20000;

export type ElkState = "idle" | "loading" | "ready" | "failed";

interface Job { id: number; graph: ElkNode; ok: (r: ElkNode) => void; fail: (e: Error) => void }

let state: ElkState = "idle";
let loading: Promise<boolean> | null = null;
let worker: Worker | null = null;
const queue: Job[] = [];
let running: Job | null = null;
let seq = 0;
const watchers: ((s: ElkState) => void)[] = [];

const set = (s: ElkState) => { state = s; for (const w of watchers) w(s); };
export const elkState = (): ElkState => state;
/** Called on every state change (the dial hides its other stops on "failed"). */
export const onElkState = (f: (s: ElkState) => void) => void watchers.push(f);

/** Starts loading elkjs (once) and says whether it is ready. Safe to call again: the first load is shared. */
export function loadElk(): Promise<boolean> {
  return (loading ??= (async () => {
    set("loading");
    const ok = await startWorker();
    set(ok ? "ready" : "failed");
    return ok;
  })());
}

function startWorker(): Promise<boolean> {
  let w: Worker;
  try {
    const src = `try{importScripts(${JSON.stringify(ELK_URL)});postMessage({ready:1})}catch(e){postMessage({fail:String(e)})}`;
    const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    w = new Worker(url);
    URL.revokeObjectURL(url);
  } catch {
    return Promise.resolve(false);
  }
  return new Promise<boolean>((done) => {
    setTimeout(() => { if (!worker) { w.terminate(); done(false); } }, LOAD_MS);
    w.onmessage = (m: MessageEvent) => {
      const d = m.data;
      if (d?.ready) {
        // what elkjs's own API sends first: the algorithms to set up (its answer, id 0, matches no job)
        w.postMessage({ cmd: "register", id: 0, algorithms: ["layered", "rectpacking"] });
        worker = w;
        done(true);
        return next();
      }
      if (d?.fail) { w.terminate(); return done(false); }
      const j = running;
      if (!j || d?.id !== j.id) return;
      running = null;
      if ("error" in d) j.fail(new Error(String(d.error?.message ?? d.error))); else j.ok(d.data);
      next();
    };
    // before "ready": the Worker itself couldn't load; after it: the running layout threw, and elkjs's
    // error object couldn't be posted back, so the job fails here
    w.onerror = (e) => {
      e.preventDefault();
      if (!worker) { w.terminate(); return done(false); }
      const j = running;
      running = null;
      j?.fail(new Error(e.message || "layout failed"));
      next();
    };
  });
}

function next(): void {
  if (running || !queue.length || !worker) return;
  running = queue.shift()!;
  worker.postMessage({ cmd: "layout", id: running.id, graph: running.graph, layoutOptions: {}, options: {} });
}

/** Lays out one ELK graph, after the ones already asked for. Loads elkjs first if needed; rejects if it can't. */
export async function runElk(graph: ElkNode): Promise<ElkNode> {
  if (!(await loadElk())) throw new Error(ELK_NOTE);
  return new Promise((ok, fail) => { queue.push({ id: ++seq, graph, ok, fail }); next(); });
}
