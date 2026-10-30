// Service category glyphs: simple, original line drawings on a 16×16 grid (stroked, never brand logos).
// Only build/html.ts and build/export.ts import this, and they pass on just the glyphs a page uses,
// so the viewer bundle never carries the whole set (shapes.ts draws whatever path it is given).
import type { Category } from "../model/schema.ts";

export const ICONS: Record<Category, string> = {
  database: "M3 4a5 2 0 0 0 10 0a5 2 0 0 0-10 0v8a5 2 0 0 0 10 0V4M3 8a5 2 0 0 0 10 0",
  payments: "M2 4h12v8H2zM2 7h12M4.5 10h3",
  ai: "M8 1.5l1.6 4.9L14.5 8l-4.9 1.6L8 14.5l-1.6-4.9L1.5 8l4.9-1.6z",
  email: "M2 4h12v8H2zM2 4.5l6 4.5 6-4.5",
  sms: "M5 1.5h6v13H5zM7 12h2",
  auth: "M4 7.5h8v6.5H4zM5.8 7.5V5.5a2.2 2.2 0 0 1 4.4 0v2M8 10.2v1.4",
  storage: "M2 3h12v3H2zM3 6v7.5h10V6M6.5 9h3",
  analytics: "M3.5 13.5V9M8 13.5V3.5M12.5 13.5V6.5M1.5 13.5h13",
  monitoring: "M1.5 8.5h3l1.8-4.5 3.4 8 1.8-3.5h3",
  search: "M10.2 10.2L14 14M11 7a4 4 0 1 1-8 0a4 4 0 1 1 8 0",
  cloud: "M4.5 12.5a3 3 0 0 1-.3-6a4 4 0 0 1 7.6-1a3.5 3.5 0 0 1 .2 7z",
  messaging: "M2 3h12v8.5H7.5L4.5 14v-2.5H2z",
  other: "M8 2a6 6 0 1 0 0 12A6 6 0 1 0 8 2M2 8h12M8 2c-2.6 3.2-2.6 8.8 0 12M8 2c2.6 3.2 2.6 8.8 0 12",
};

/** The glyphs for the given ids' categories, keyed by category: only what a page draws. */
export function usedIcons(categories: Record<string, Category> | undefined, ids?: Iterable<string>): Partial<Record<Category, string>> {
  const out: Partial<Record<Category, string>> = {};
  const cats = categories ?? {};
  for (const id of ids ?? Object.keys(cats)) if (cats[id]) out[cats[id]] = ICONS[cats[id]];
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}
