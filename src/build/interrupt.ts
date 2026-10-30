// Ctrl-C / SIGTERM during `build`: save the layout cache once more, say so, and exit 130 / 143.
// Used by the CLI only; library entry points install no handlers.
export interface InterruptOptions {
  flush: () => number | null;
  write: (line: string) => void;
  exit?: (code: number) => never;
  on?: (sig: NodeJS.Signals, fn: () => void) => void;
  off?: (sig: NodeJS.Signals, fn: () => void) => void;
}

const SIGNALS: [NodeJS.Signals, number][] = [["SIGINT", 130], ["SIGTERM", 143]];

export function installInterrupt(o: InterruptOptions): () => void {
  const exit = o.exit ?? ((c: number) => process.exit(c));
  const on = o.on ?? ((s, f) => { process.on(s, f); });
  const off = o.off ?? ((s, f) => { process.off(s, f); });
  let handling = false;
  const handlers = SIGNALS.map(([sig, code]) => {
    const fn = () => {
      if (handling) return;
      handling = true;
      let n: number | null = null;
      try { n = o.flush(); } catch {}
      o.write(n === null ? "interrupted" : `interrupted; saved layout cache (${n.toLocaleString("en-US")} layouts)`);
      exit(code);
    };
    on(sig, fn);
    return [sig, fn] as const;
  });
  return () => { for (const [sig, fn] of handlers) off(sig, fn); };
}
