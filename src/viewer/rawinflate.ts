// A small synchronous raw-deflate decoder (after zlib's puff.c), for viewer/boot.ts. The browser's
// DecompressionStream is asynchronous, and a viewer that starts a few frames after the page has
// parsed draws its first board in a different state (web fonts, compositing) from one that
// starts as the page parses, so screenshots stop being repeatable. This keeps the start
// synchronous for about a kilobyte; the page data still uses DecompressionStream (unpack.ts).

interface Huff { count: Uint16Array; symbol: Uint16Array }

function huff(lengths: ArrayLike<number>, from: number, n: number): Huff {
  const count = new Uint16Array(16), offs = new Uint16Array(16), symbol = new Uint16Array(n);
  for (let i = 0; i < n; i++) count[lengths[from + i]]++;
  count[0] = 0;
  for (let len = 1; len < 15; len++) offs[len + 1] = offs[len] + count[len];
  for (let i = 0; i < n; i++) if (lengths[from + i]) symbol[offs[lengths[from + i]]++] = i;
  return { count, symbol };
}

// Length and distance bases and extra bits, built rather than spelled out (RFC 1951 3.2.5).
const LBASE: number[] = [], LEXT: number[] = [], DBASE: number[] = [], DEXT: number[] = [];
for (let i = 0, b = 3; i < 29; i++) { LEXT[i] = i < 8 || i > 27 ? 0 : (i - 4) >> 2; LBASE[i] = i > 27 ? 258 : b; b += 1 << LEXT[i]; }
for (let i = 0, b = 1; i < 30; i++) { DEXT[i] = i < 4 ? 0 : (i - 2) >> 1; DBASE[i] = b; b += 1 << DEXT[i]; }
const ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

export function inflateRaw(src: Uint8Array): Uint8Array {
  let out = new Uint8Array(src.length * 4 + 256), n = 0, pos = 0, buf = 0, cnt = 0;
  const put = (byte: number) => {
    if (n === out.length) { const o = new Uint8Array(n * 2); o.set(out); out = o; }
    out[n++] = byte;
  };
  const bits = (need: number): number => {
    while (cnt < need) {
      if (pos >= src.length) throw new Error("truncated deflate data");
      buf |= src[pos++] << cnt; cnt += 8;
    }
    const v = buf & ((1 << need) - 1);
    buf >>>= need; cnt -= need;
    return v;
  };
  const decode = (h: Huff): number => {
    for (let len = 1, code = 0, first = 0, index = 0; len < 16; len++) {
      code |= bits(1);
      const c = h.count[len];
      if (code - c < first) return h.symbol[index + code - first];
      index += c; first = (first + c) << 1; code <<= 1;
    }
    throw new Error("bad deflate code");
  };
  for (let last = 0; !last; ) {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      buf = cnt = 0;
      const len = src[pos] | (src[pos + 1] << 8);
      pos += 4;
      for (let i = 0; i < len; i++) put(src[pos++]);
      continue;
    }
    let lit: Huff, dist: Huff;
    if (type === 1) {
      const l = new Uint8Array(318);
      l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288); l.fill(5, 288);
      lit = huff(l, 0, 288); dist = huff(l, 288, 30);
    } else if (type === 2) {
      const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4, l = new Uint8Array(320);
      for (let i = 0; i < ncode; i++) l[ORDER[i]] = bits(3);
      const lc = huff(l, 0, 19);
      l.fill(0, 0, 19);
      for (let i = 0; i < nlen + ndist; ) {
        const sym = decode(lc);
        if (sym < 16) { l[i++] = sym; continue; }
        const v = sym === 16 ? l[i - 1] : 0, rep = sym === 16 ? 3 + bits(2) : sym === 17 ? 3 + bits(3) : 11 + bits(7);
        for (let k = 0; k < rep; k++) l[i++] = v;
      }
      lit = huff(l, 0, nlen); dist = huff(l, nlen, ndist);
    } else throw new Error("bad deflate block");
    for (let sym; (sym = decode(lit)) !== 256; ) {
      if (sym < 256) { put(sym); continue; }
      sym -= 257;
      const len = LBASE[sym] + bits(LEXT[sym]), d = decode(dist), back = DBASE[d] + bits(DEXT[d]);
      for (let i = 0; i < len; i++) put(out[n - back]);
    }
  }
  return out.subarray(0, n);
}
