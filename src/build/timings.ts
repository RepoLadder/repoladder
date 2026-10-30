// Opt-in phase timer (REPOLADDER_TIMINGS=1): TIMING lines on stderr, so stdout and unset runs are unchanged.
export const TIMINGS = process.env.REPOLADDER_TIMINGS === "1";

export function timing(label: string, ms: number, extra = ""): void {
  if (!TIMINGS) return;
  const m = process.memoryUsage(), mb = (n: number) => Math.round(n / 2 ** 20);
  console.error(`TIMING ${label} ${(ms / 1000).toFixed(1)}s${extra ? " " + extra : ""} rss=${mb(m.rss)}MB heap=${mb(m.heapUsed)}MB`);
}

export async function timed<T>(label: string, f: () => T | Promise<T>, extra?: (r: T) => string): Promise<T> {
  if (!TIMINGS) return f();
  const t = performance.now(), r = await f();
  timing(label, performance.now() - t, extra?.(r));
  return r;
}

export function timedSync<T>(label: string, f: () => T, extra?: (r: T) => string): T {
  if (!TIMINGS) return f();
  const t = performance.now(), r = f();
  timing(label, performance.now() - t, extra?.(r));
  return r;
}
