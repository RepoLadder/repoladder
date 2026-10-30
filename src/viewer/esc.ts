// The one HTML escaper (#365): text and double- or single-quoted attribute values, for the viewer, the page shell and the SVG export.
const ENT: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" };
export const esc = (s: unknown) => String(s).replace(/[&<>"'`]/g, (c) => ENT[c]!);
