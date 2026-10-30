/** Width and height from a PNG's IHDR chunk, or null when the bytes aren't a PNG. */
export function pngSize(b: Uint8Array): { w: number; h: number } | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 24 || sig.some((v, i) => b[i] !== v) || String.fromCharCode(b[12], b[13], b[14], b[15]) !== "IHDR") return null;
  const n = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { w: n.getUint32(16), h: n.getUint32(20) };
}
