// The launch switches: viewer features that are built into a page or left out of it. Pure, no DOM and
// no node: imports, so the viewer bundle can import it (esbuild drops the build-side helpers).
// Defaults are the launch state. Only the keys that differ from the defaults are baked into a page
// (ViewerData.features), so a default page grows by nothing and older data reads as launch defaults.

export interface Features {
  /** The detail dial and its stops. Off: every map shows only the Default stop (docs/detail-dial-v2.md). */
  dial: boolean;
  /** The story (Overview) level. Defined here so its own switch needs no new plumbing; nothing reads it yet. */
  story: boolean;
}

/** Launch state: both switches off. */
export const DEFAULT_FEATURES: Features = { dial: false, story: false };

const ENV: Record<keyof Features, string> = { dial: "REPOLADDER_DIAL", story: "REPOLADDER_STORY" };

/** Explicit option first, then the env var (only `1` turns a switch on, `0` turns it off), then the default. */
export function resolveFeatures(env: Record<string, string | undefined>, on: Partial<Features> = {}): Features {
  const out = { ...DEFAULT_FEATURES };
  for (const k of Object.keys(ENV) as (keyof Features)[]) {
    const v = env[ENV[k]];
    out[k] = on[k] ?? (v === "1" ? true : v === "0" ? false : DEFAULT_FEATURES[k]);
  }
  return out;
}

/** The switches a page was built with (viewer side). */
export const featuresOf = (d: { features?: Partial<Features> }): Features => ({ ...DEFAULT_FEATURES, ...d.features });

/** Only the switches that differ from the defaults, which is what a page carries. */
export function bakedFeatures(f: Features): Partial<Features> {
  const out: Partial<Features> = {};
  for (const k of Object.keys(DEFAULT_FEATURES) as (keyof Features)[]) if (f[k] !== DEFAULT_FEATURES[k]) out[k] = f[k];
  return out;
}

/** The stops the dial offers: all of them with the dial on, else only Default. */
export const stopsShown = <T extends { key: string }>(defs: T[], f: Features): T[] => (f.dial ? defs : defs.filter((d) => d.key === "default"));
