// What the Ask endpoint checks citations against: facts.json (and box names from model.json) in the out dir, read per answer
// and cached by mtime and size so a rebuild is picked up on the next turn.
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Facts } from "../model/schema.ts";

export type CiteContext = { facts: Facts; boxes?: Record<string, string> };

const cache = new Map<string, { key: string; value: unknown }>();
function cached<T>(file: string, load: (raw: string) => T): T | null {
  try {
    const s = statSync(file);
    const key = `${s.mtimeMs}:${s.size}`;
    const hit = cache.get(file);
    if (hit?.key === key) return hit.value as T;
    const value = load(readFileSync(file, "utf8"));
    cache.set(file, { key, value });
    return value;
  } catch {
    cache.delete(file);
    return null;
  }
}

export function loadCiteContext(out: string): CiteContext | null {
  const facts = cached(join(out, "facts.json"), (raw) => Facts.parse(JSON.parse(raw)));
  if (!facts) return null;
  const boxes = cached(join(out, "model.json"), (raw) => {
    const nodes = (JSON.parse(raw) as { nodes?: Record<string, { name?: unknown }> }).nodes ?? {};
    const m: Record<string, string> = {};
    for (const [id, n] of Object.entries(nodes)) if (typeof n?.name === "string") m[id] = n.name;
    return m;
  });
  return boxes ? { facts, boxes } : { facts };
}
