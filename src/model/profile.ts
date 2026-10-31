// Fidelity profiles. `full` draws every connection on a leaf's file board (#449) and is the default
// everywhere. `hosted` budgets file-board arrows (arrow budget, hubs, "used throughout" listing) so a
// large repo builds within a time limit. Pure, so the viewer bundle may import it.
export type Profile = "full" | "hosted";
export const PROFILES = ["full", "hosted"] as const;
export const DEFAULT_PROFILE: Profile = "full";

export function resolveProfile(p?: string | null): Profile {
  if (p === undefined || p === null) return DEFAULT_PROFILE;
  if ((PROFILES as readonly string[]).includes(p)) return p as Profile;
  throw new RangeError(`profile must be "full" or "hosted", got ${JSON.stringify(p)}`);
}
