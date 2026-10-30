// Minimal types for the untyped font tools scripts/fonts.ts uses.
declare module "subset-font" {
  export default function subsetFont(font: Uint8Array, text: string, options?: { targetFormat?: "sfnt" | "woff" | "woff2"; variationAxes?: Record<string, { min: number; max: number } | number> }): Promise<Buffer>;
}
declare module "fontverter" {
  export function convert(font: Uint8Array, to: "sfnt" | "woff" | "woff2"): Promise<Buffer>;
}
