// Progress for `build`: stage events from the analyzer and the build steps, printed as `[build] …` lines.
// No process, console or env access here: the CLI injects `write` (stderr) and `now`; `buildFromFiles` takes `onProgress`.
export type Stage = "read" | "parse" | "resolve" | "grouping" | "model" | "layout" | "lint" | "split" | "render" | "write";

export interface ProgressEvent {
  stage: Stage;
  kind: "start" | "tick" | "done" | "note";
  /** a "note" event: one line, printed as is */
  message?: string;
  done?: number;
  total?: number;
  unit?: "files" | "boards";
  /** 1-based layout/split pass */
  pass?: number;
  /** the most passes this build can run */
  passes?: number;
}

export type OnProgress = (e: ProgressEvent) => void;

/** Runs `f` between a start and a done event; a throw emits no done. */
export function stepSync<T>(on: OnProgress | undefined, base: Omit<ProgressEvent, "kind">, f: () => T): T {
  if (!on) return f();
  on({ ...base, kind: "start" });
  const r = f();
  on({ ...base, kind: "done" });
  return r;
}

export async function step<T>(on: OnProgress | undefined, base: Omit<ProgressEvent, "kind">, f: () => T | Promise<T>): Promise<T> {
  if (!on) return f();
  on({ ...base, kind: "start" });
  const r = await f();
  on({ ...base, kind: "done" });
  return r;
}

const LABELS: Record<Stage, string> = {
  read: "reading files", parse: "parsing files", resolve: "resolving imports", grouping: "grouping",
  model: "building the model", layout: "layout", lint: "checking the layout", split: "splitting crowded boards",
  render: "rendering the page", write: "writing files",
};

const PCT_STEP = 10, MIN_GAP_MS = 5_000, MAX_GAP_MS = 30_000;

/** 0.4s, 12s, 4m12s, 1h02m */
export function formatDuration(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  if (s < 10) return `${s.toFixed(1)}s`;
  if (s < 60) return `${Math.floor(s)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${String(Math.floor(s % 60)).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
}

const num = (n: number) => n.toLocaleString("en-US");

export function progressPrinter(o: { write: (line: string) => void; now?: () => number; prefix?: string }): OnProgress {
  const now = o.now ?? (() => performance.now());
  const prefix = o.prefix ?? "[build] ";
  const t0 = now();
  const state = new Map<string, { started: number; lastAt: number; lastPct: number }>();
  const label = (e: ProgressEvent) => LABELS[e.stage] + ((e.passes ?? 1) > 1 && e.pass ? ` pass ${e.pass} of up to ${e.passes}` : "");
  return (e) => {
    const t = now(), key = `${e.stage}:${e.pass ?? 0}`, elapsed = formatDuration(t - t0);
    if (e.kind === "note") {
      o.write(`${prefix}${e.message ?? ""} · ${elapsed} elapsed`);
    } else if (e.kind === "start") {
      state.set(key, { started: t, lastAt: t, lastPct: 0 });
      o.write(`${prefix}${label(e)}… · ${elapsed} elapsed`);
    } else if (e.kind === "done") {
      const s = state.get(key);
      o.write(`${prefix}${label(e)} done in ${formatDuration(t - (s?.started ?? t))} · ${elapsed} elapsed`);
      state.delete(key);
    } else {
      if (e.total === undefined || e.done === undefined || e.total <= 0) return;
      let s = state.get(key);
      if (!s) { s = { started: t, lastAt: t, lastPct: 0 }; state.set(key, s); }
      const pct = Math.floor(e.done * 100 / e.total), gap = t - s.lastAt;
      if (!((pct - s.lastPct >= PCT_STEP && gap >= MIN_GAP_MS) || gap >= MAX_GAP_MS)) return;
      s.lastAt = t; s.lastPct = pct;
      o.write(`${prefix}${label(e)}: ${num(e.done)}/${num(e.total)}${e.unit ? ` ${e.unit}` : ""} (${pct}%) · ${elapsed} elapsed`);
    }
  };
}
