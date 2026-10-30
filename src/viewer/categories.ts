// Service categories outside the diagram: their names, and their glyph as a small inline icon
// for the legend and the side panel (the glyphs come with the page data: see build/html.ts).
import type { Category } from "../model/schema.ts";
import { st } from "./state.ts";

export const CATEGORY_NAMES: Record<Category, string> = {
  database: "Database", payments: "Payments", ai: "AI model", email: "Email", sms: "SMS / phone",
  auth: "Sign-in", storage: "File storage", analytics: "Analytics", monitoring: "Error monitoring",
  search: "Search", cloud: "Cloud platform", messaging: "Chat / messaging", other: "Other service",
};

/** The category's glyph as an inline SVG, colored like a service (or a store with `store`); "" when the page has none. */
export function catIcon(c: Category | undefined, store = false): string {
  const d = c && st.data.icons?.[c];
  return d ? `<svg class="cati${store ? " store" : ""}" viewBox="0 0 16 16" aria-hidden="true"><path d="${d}"/></svg>` : "";
}

/** The distinct categories of these service ids, in a fixed order. */
export function categoriesOf(ids: string[]): Category[] {
  const set = new Set(ids.map((id) => st.data.categories?.[id]).filter((c): c is Category => !!c));
  return (Object.keys(CATEGORY_NAMES) as Category[]).filter((c) => set.has(c));
}
