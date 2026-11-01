// Pure helpers for scripts/guardbase.ts: the baseline's shape and how a fresh measurement is compared with it.
// Numbers match within half a board unit (the viewer's own `sameView` tolerance); durations and easings exactly.
export const TOL = 0.5;

export interface Anim { duration: number; easing: string }
export interface Timing { in: Anim[]; out: Anim[]; reduced: { in: Anim[]; out: Anim[] } }
export interface Structure {
  version: 1;
  fixture: string;
  /** board id -> "<w>x<h>" -> the svg viewBox [x, y, w, h] */
  fit: Record<string, Record<string, number[]>>;
  /** board id -> wire key ("e:a>b", "#2" appended when repeated) -> path `d` */
  wires: Record<string, Record<string, string>>;
  tour: Record<string, number>;
  timing: Timing;
}

const near = (a: number, b: number) => Math.abs(a - b) <= TOL;

/** Command letters and numbers of an SVG path `d`. */
const tokens = (d: string): string[] => d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];

/** Same token structure, each number within the tolerance. */
export function samePath(a: string, b: string): boolean {
  const x = tokens(a), y = tokens(b);
  if (x.length !== y.length) return false;
  return x.every((t, i) => {
    const u = y[i], tn = Number(t), un = Number(u);
    return Number.isNaN(tn) || Number.isNaN(un) ? t === u : near(tn, un);
  });
}

const sameBox = (a: number[] = [], b: number[] = []) => a.length === b.length && a.every((n, i) => near(n, b[i]));
const anims = (l: Anim[]) => l.map((a) => `${a.duration}ms ${a.easing}`).join(" | ") || "none";

/** One "<area> <board> <detail>" line per difference between the baseline and a fresh measurement. */
export function compare(base: Structure, now: Structure): string[] {
  const out: string[] = [];
  const ids = new Set([...Object.keys(base.fit), ...Object.keys(now.fit)]);
  for (const id of [...ids].sort()) {
    if (!(id in now.fit)) { out.push(`board ${id} removed`); continue; }
    if (!(id in base.fit)) { out.push(`board ${id} added`); continue; }
    const vps = new Set([...Object.keys(base.fit[id]), ...Object.keys(now.fit[id])]);
    for (const vp of [...vps].sort()) {
      if (!sameBox(base.fit[id][vp], now.fit[id][vp])) out.push(`fit ${id} ${vp}: [${base.fit[id][vp]}] became [${now.fit[id][vp]}]`);
    }
    const bw = base.wires[id] ?? {}, nw = now.wires[id] ?? {};
    for (const k of [...new Set([...Object.keys(bw), ...Object.keys(nw)])].sort()) {
      if (!(k in nw)) out.push(`wire ${id} ${k}: removed`);
      else if (!(k in bw)) out.push(`wire ${id} ${k}: added`);
      else if (!samePath(bw[k], nw[k])) out.push(`wire ${id} ${k}: route changed`);
    }
  }
  const pairs: [string, Anim[], Anim[]][] = [
    ["in", base.timing.in, now.timing.in], ["out", base.timing.out, now.timing.out],
    ["reduced.in", base.timing.reduced.in, now.timing.reduced.in], ["reduced.out", base.timing.reduced.out, now.timing.reduced.out],
  ];
  for (const [k, a, b] of pairs) if (anims(a) !== anims(b)) out.push(`timing - ${k}: ${anims(a)} became ${anims(b)}`);
  for (const k of [...new Set([...Object.keys(base.tour), ...Object.keys(now.tour)])].sort()) {
    if (base.tour[k] !== now.tour[k]) out.push(`timing - tour.${k}: ${base.tour[k]} became ${now.tour[k]}`);
  }
  return out;
}

/** Why `--update` must not run, or null. CI never rewrites the baseline. */
export function refuseUpdate(env: Record<string, string | undefined>): string | null {
  return env.CI ? "--update is refused when CI is set: re-record the baseline locally" : null;
}
