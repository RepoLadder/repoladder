// What a file box is called (#251). A box shows its file's basename, but in framework repos a
// leaf can hold six `route.ts` or ten `index.ts`. A file whose basename repeats in its leaf is
// named by the shortest tail of its path that no other file there shares: `chat/route.ts`,
// `Virgil/index.ts`. Pure, so the page could share it; the build ships the result (`names`).

/** Above this length a tail keeps only its first folder and the basename: `a/…/route.ts`. */
const LONG = 24;
/** A Next.js-style route parameter folder: `[id]`, `[...slug]`, `[[...slug]]`. */
const PARAM = /^\[.*\]$/;

const tail = (segs: string[], k: number) => segs.slice(-k).join("/");

/** The files of one leaf whose basename repeats there, each with the shortest tail that tells it apart. */
export function distinctNames(files: string[]): Map<string, string> {
  const byBase = new Map<string, string[]>();
  for (const f of files) {
    const b = f.slice(f.lastIndexOf("/") + 1);
    byBase.set(b, [...(byBase.get(b) ?? []), f]);
  }
  const out = new Map<string, string>();
  for (const same of byBase.values()) {
    if (same.length < 2) continue;
    const segs = new Map(same.map((f) => [f, f.split("/")]));
    const named = new Map<string, string>();
    for (const f of same) {
      const s = segs.get(f)!;
      let k = 2;
      while (k < s.length && same.some((g) => g !== f && tail(segs.get(g)!, k) === tail(s, k))) k++;
      // a route parameter alone says little: `users/[id]/route.ts`, not `[id]/route.ts`
      if (k < s.length && PARAM.test(s[s.length - k])) k++;
      named.set(f, tail(s, k));
    }
    // a tail drops a `src` folder in its middle, and a long one all its middle folders, unless
    // that makes two names alike
    const short = new Map([...named].map(([f, n]) => {
      let s = n.split("/");
      if (s.length < 3) return [f, n];
      s = [s[0], ...s.slice(1, -1).filter((x) => x !== "src"), s[s.length - 1]];
      const m = s.join("/");
      // a route parameter in the middle is the part that tells routes apart, so it stays
      return [f, m.length > LONG && s.length > 2 && !s.slice(1, -1).some((x) => PARAM.test(x)) ? `${s[0]}/…/${s[s.length - 1]}` : m];
    }));
    const clash = new Set([...short.values()]).size < short.size;
    for (const [f, n] of clash ? named : short) out.set(f, n);
  }
  return out;
}

/** Path -> name for every leaf's files whose basename repeats in that leaf; other files go by their basename. */
export function fileNames(leaves: Iterable<{ files: string[]; children: string[] }>): Record<string, string> {
  const out: [string, string][] = [];
  for (const n of leaves) if (!n.children.length && n.files.length > 1) out.push(...distinctNames(n.files));
  return Object.fromEntries(out.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** A file box's name: its distinguishing tail when it has one, else its basename. */
export const boxName = (names: Record<string, string> | undefined, p: string) => names?.[p] ?? p.slice(p.lastIndexOf("/") + 1);
/** The same without the extension, as flow titles and tour captions use it: `chat/route`. */
export const boxStem = (names: Record<string, string> | undefined, p: string) => boxName(names, p).replace(/\.[^./]+$/, "");
