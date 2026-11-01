// Starter questions for the served Ask bar, derived from the code facts: each is offered only when the facts support it.
// Pure and deterministic (fixed priority, ties broken by name), at most MAX.
import type { Facts } from "./schema.ts";

export const MAX_STARTERS = 4;

export function starterQuestions(facts: Facts | null | undefined): string[] {
  if (!facts) return [];
  const out: string[] = [];
  const dbIds = new Set(facts.services.filter((s) => s.category === "database").map((s) => s.id));
  if (facts.storeUses.length || facts.serviceUses.some((u) => dbIds.has(u.service))) out.push("What touches the database?");
  const calls = new Map<string, number>();
  for (const c of facts.calls) calls.set(c.endpoint, (calls.get(c.endpoint) ?? 0) + 1);
  const top = [...calls].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))[0];
  if (top) out.push(`Who calls \`${top[0]}\`?`);
  if (facts.pages.length) out.push("Which files make up the screens users see?");
  if (facts.services.length) out.push("Which outside services does this use, and where?");
  out.push("Where should I start reading this codebase?");
  // the last-resort question only fills a free slot
  return out.slice(0, MAX_STARTERS);
}
