// basE91 (Joachim Henke's scheme) over an alphabet that is safe inside a double-quoted string in
// an inline <script>: printable ASCII without `"`, `\` and `<`. About 23% overhead instead of
// base64's 33%, which is most of the remaining fat once the page data is deflated.
const A = Array.from({ length: 94 }, (_, i) => String.fromCharCode(33 + i)).filter((c) => !`"\\<`.includes(c)).join("");

export function encode91(bytes: Uint8Array): string {
  let out = "", b = 0, n = 0;
  for (const byte of bytes) {
    b |= byte << n;
    n += 8;
    if (n > 13) {
      let v = b & 8191;
      if (v > 88) { b >>= 13; n -= 13; } else { v = b & 16383; b >>= 14; n -= 14; }
      out += A[v % 91] + A[(v / 91) | 0];
    }
  }
  if (n) {
    out += A[b % 91];
    if (n > 7 || b > 90) out += A[(b / 91) | 0];
  }
  return out;
}

export function decode91(s: string): Uint8Array<ArrayBuffer> {
  const D = new Uint8Array(128);
  for (let i = 0; i < A.length; i++) D[A.charCodeAt(i)] = i;
  const out = new Uint8Array(Math.ceil((s.length * 14) / 16) + 1);
  let len = 0, v = -1, b = 0, n = 0;
  for (let i = 0; i < s.length; i++) {
    const d = D[s.charCodeAt(i)];
    if (v < 0) { v = d; continue; }
    v += d * 91;
    b |= v << n;
    n += (v & 8191) > 88 ? 13 : 14;
    do { out[len++] = b & 255; b >>= 8; n -= 8; } while (n > 7);
    v = -1;
  }
  if (v >= 0) out[len++] = (b | (v << n)) & 255;
  return out.subarray(0, len);
}
