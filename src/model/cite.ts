// Citation checking for Ask answers. Pure (no I/O, no DOM): finds the files, names and boxes an answer cites and checks each one
// exactly against the code facts, so the AI names and explains but never invents. Segments hold plain strings only; scanning is linear.
import type { Facts } from "./schema.ts";

export type Candidate = {
  start: number;
  end: number;
  text: string;
  kind: "file" | "name" | "box";
  path?: string;
  line?: number;
  line2?: number;
  name?: string;
};
export type Target = { file: string; line?: number } | { box: string };
export type Segment =
  | { text: string }
  | { ref: string; kind: "file" | "export" | "endpoint" | "box"; verified: boolean; target?: Target; reason?: string };

export const NOT_FOUND = "not found in the code facts";
const MAX_REF = 500;
const PATH_CH = /[\p{L}\p{N}_@.\-/\[\]()+~]/u;
const WORD = /[\p{L}\p{N}_]/u;
const IDENT = /^[A-Za-z_$][\w$]*$/;
// Words that read as code but name nothing in the facts: not worth flagging.
const PLAIN = new Set(["true", "false", "null", "undefined", "string", "number", "boolean", "void", "any", "unknown", "never", "const", "let", "var", "async", "await", "return", "this", "new", "if", "else", "for", "while", "import", "export", "default", "function", "class", "type", "interface"]);
const SRC_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|json|md|mdx|css|scss|html|yml|yaml|sql|prisma|graphql|toml|vue|svelte|py|go|rs|java|sh)$/i;
const LINES = /(?::(\d{1,9})(?:-(\d{1,9}))?|#L(\d{1,9})(?:-L?(\d{1,9}))?)/y;
const SPAN_LINES = /^(.*?)(?::(\d{1,9})(?:-(\d{1,9}))?|#L(\d{1,9})(?:-L?(\d{1,9}))?)$/s;

export type Known = { names?: ReadonlySet<string>; boxes?: ReadonlySet<string> };

const hasExt = (p: string) => /\.[A-Za-z][A-Za-z0-9]{0,9}$/.test(p.slice(p.lastIndexOf("/") + 1)) && p.length - p.lastIndexOf("/") > 2;
const allPathCh = (s: string) => { for (const c of s) if (!PATH_CH.test(c)) return false; return true; };

/** Free-text paths: runs of path characters holding a slash and ending in an extension. */
function pathsIn(text: string, from: number, to: number, out: Candidate[]) {
  let i = from;
  while (i < to) {
    if (!PATH_CH.test(text[i])) { i++; continue; }
    let j = i + 1;
    while (j < to && PATH_CH.test(text[j])) j++;
    const s0 = i;
    i = j;
    if (j - s0 > MAX_REF) continue;
    let s = s0, e = j;
    const tail = () => { let k = e; while (k > s && ".,;:)".includes(text[k - 1])) k--; return k; };
    let k = tail();
    const stripped = k !== e;
    // "(src/a.ts)": drop an opener the run's own closer doesn't balance
    while (s < k && (text[s] === "(" || text[s] === "[")) {
      const body = text.slice(s, k), o = text[s], c = o === "(" ? ")" : "]";
      if (body.split(o).length <= body.split(c).length) break;
      s++;
    }
    e = k;
    if (s >= e) continue;
    const run = text.slice(s, e);
    if (!run.includes("/") || !hasExt(run)) continue;
    if (/^\/\//.test(run) && text[s - 1] === ":") continue;
    if (/^www\./i.test(run) || (s > 0 && text.slice(Math.max(0, s - 3), s) === "://")) continue;
    if (s > 0 && WORD.test(text[s - 1])) continue;
    let end = e, line: number | undefined, line2: number | undefined;
    if (!stripped && end === j) {
      LINES.lastIndex = end;
      const m = LINES.exec(text);
      if (m) {
        line = Number(m[1] ?? m[3]);
        const l2 = m[2] ?? m[4];
        if (l2 !== undefined) line2 = Number(l2);
        end = LINES.lastIndex;
      }
    }
    const c: Candidate = { start: s, end, text: text.slice(s, end), kind: "file", path: run };
    if (line !== undefined) c.line = line;
    if (line2 !== undefined) c.line2 = line2;
    out.push(c);
    i = Math.max(i, end); // a line suffix can swallow digits that would start the next run
  }
}

function spanCandidate(text: string, a: number, b: number, known: Known): Candidate | null {
  const inner = text.slice(a, b).trim();
  if (!inner || inner.length > 300) return null;
  const base = { start: a, end: b, text: "" };
  if (known.names?.has(inner)) return { ...base, kind: "name", name: inner };
  const lm = SPAN_LINES.exec(inner);
  const p = lm ? lm[1] : inner;
  if (p && allPathCh(p) && hasExt(p) && (p.includes("/") || SRC_EXT.test(p))) {
    const c: Candidate = { ...base, kind: "file", path: p };
    if (lm) {
      c.line = Number(lm[2] ?? lm[4]);
      const l2 = lm[3] ?? lm[5];
      if (l2 !== undefined) c.line2 = Number(l2);
    }
    return c;
  }
  if (IDENT.test(inner)) return PLAIN.has(inner) ? null : { ...base, kind: "name", name: inner };
  if (known.boxes?.has(inner)) return { ...base, kind: "box", name: inner };
  return null;
}

function scan(text: string, known: Known): Candidate[] {
  const n = text.length;
  // backtick runs, and a running count of newlines so "no newline inside a span" is O(1)
  const runs: { at: number; len: number }[] = [];
  const nl = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) {
    nl[i + 1] = nl[i] + (text.charCodeAt(i) === 10 ? 1 : 0);
    if (text[i] === "`") {
      let j = i;
      while (j < n && text[j] === "`") j++;
      runs.push({ at: i, len: j - i });
      nl[i + 1] = nl[i];
      for (let k = i + 1; k < j; k++) nl[k + 1] = nl[k];
      i = j - 1;
    }
  }
  const byLen = new Map<number, number[]>();
  runs.forEach((r, k) => { const l = byLen.get(r.len); if (l) l.push(k); else byLen.set(r.len, [k]); });
  const ptr = new Map<number, number>();
  const spans: [number, number, number, number][] = []; // open start, inner start, inner end, close end
  for (let k = 0; k < runs.length; k++) {
    const r = runs[k], list = byLen.get(r.len)!;
    let p = ptr.get(r.len) ?? 0;
    while (list[p] <= k) p++;
    ptr.set(r.len, p);
    if (p >= list.length) continue;
    const c = runs[list[p]];
    const a = r.at + r.len;
    if (nl[c.at] - nl[a] > 0) continue;
    spans.push([r.at, a, c.at, c.at + c.len]);
    k = list[p]; // resume after the closer
  }

  const out: Candidate[] = [];
  // indexOf("**") from a position that only moves forward; remembering the last hit keeps many short gaps linear
  let memo = { from: 0, pos: -2 };
  const nextBold = (i: number) => {
    if (memo.pos === -2 || i < memo.from || (memo.pos >= 0 && memo.pos < i)) memo = { from: i, pos: text.indexOf("**", i) };
    return memo.pos;
  };
  const free = (a: number, b: number) => {
    // bold names first, then paths in the rest
    let i = a;
    while (i < b) {
      const o = known.boxes ? nextBold(i) : -1;
      if (o < 0 || o >= b) { pathsIn(text, i, b, out); return; }
      const cl = text.indexOf("**", o + 2);
      if (cl < 0 || cl + 2 > b) { pathsIn(text, i, b, out); return; }
      const inner = text.slice(o + 2, cl);
      if (!inner.includes("\n") && known.boxes!.has(inner)) {
        pathsIn(text, i, o, out);
        out.push({ start: o, end: cl + 2, text: "", kind: "box", name: inner });
        i = cl + 2;
      } else { pathsIn(text, i, o + 2, out); i = o + 2; }
    }
  };
  let at = 0;
  for (const [o, a, b, e] of spans) {
    free(at, o);
    const c = spanCandidate(text, a, b, known);
    if (c) out.push({ ...c, start: o, end: e });
    at = e;
  }
  free(at, n);
  for (const c of out) c.text = text.slice(c.start, c.end);
  return out;
}

/** Everything the text cites that looks checkable, in order and without overlap. Needs no facts, so a stream can mark them "checking". */
export const candidates = (text: string): Candidate[] => scan(text, {});

type Index = {
  files: Map<string, number>;
  bases: Map<string, string[]>;
  names: Map<string, { file: string; line?: number; kind: "export" | "endpoint" }[]>;
};
const indexes = new WeakMap<Facts, Index>();
function indexOf(facts: Facts): Index {
  let ix = indexes.get(facts);
  if (ix) return ix;
  ix = { files: new Map(), bases: new Map(), names: new Map() };
  const add = (name: string, h: { file: string; line?: number; kind: "export" | "endpoint" }) => { const l = ix!.names.get(name); if (l) l.push(h); else ix!.names.set(name, [h]); };
  for (const f of facts.files) {
    ix.files.set(f.path, f.loc);
    const b = f.path.slice(f.path.lastIndexOf("/") + 1);
    const l = ix.bases.get(b);
    if (l) l.push(f.path); else ix.bases.set(b, [f.path]);
    f.exports?.forEach((x, i) => add(x, { file: f.path, kind: "export", ...(f.exportLines?.[i] !== undefined ? { line: f.exportLines[i] } : {}) }));
  }
  for (const e of facts.endpoints) add(e.name, { file: e.file, line: e.line, kind: "endpoint" });
  for (const l of ix.names.values()) l.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  indexes.set(facts, ix);
  return ix;
}

type Ref = Extract<Segment, { ref: string }>;
const no = (ref: string, kind: Ref["kind"], reason = NOT_FOUND): Ref => ({ ref, kind, verified: false, reason });

function checkFile(c: Candidate, ix: Index): Ref {
  let p = c.path!;
  if (p.startsWith("./")) p = p.slice(2);
  if (p.startsWith("/") || p.startsWith("~") || /^[A-Za-z]:/.test(p) || p.split("/").includes("..")) return no(c.text, "file");
  let file = p;
  if (!ix.files.has(p)) {
    const hit = p.includes("/") ? undefined : ix.bases.get(p);
    if (!hit) return no(c.text, "file");
    if (hit.length > 1) return no(c.text, "file", `matches ${hit.length} files`);
    file = hit[0];
  }
  if (c.line === undefined) return { ref: c.text, kind: "file", verified: true, target: { file } };
  const loc = ix.files.get(file)!;
  for (const l of c.line2 === undefined ? [c.line] : [c.line, c.line2]) {
    if (l < 1) return no(c.text, "file", `line ${l} is not a line`);
    if (l > loc) return no(c.text, "file", `line ${l} is past the end (file has ${loc} lines)`);
  }
  if (c.line2 !== undefined && c.line2 < c.line) return no(c.text, "file", `lines ${c.line}-${c.line2} are out of order`);
  return { ref: c.text, kind: "file", verified: true, target: { file, line: c.line } };
}

function checkBox(c: Candidate, boxes: Record<string, string> | undefined): Ref | null {
  if (!boxes) return null;
  const ids = Object.keys(boxes).filter((id) => boxes[id] === c.name);
  if (ids.length === 1) return { ref: c.text, kind: "box", verified: true, target: { box: ids[0] } };
  return ids.length > 1 ? no(c.text, "box", "ambiguous: more than one box has that name") : null;
}

/** The text split into plain pieces and checked citations. Concatenating every `text` and `ref` gives the input back. */
export function segments(text: string, facts: Facts, boxes?: Record<string, string>): Segment[] {
  const ix = indexOf(facts);
  const known: Known = { names: new Set([...ix.names].filter(([, v]) => v.some((h) => h.kind === "endpoint")).map(([k]) => k)) };
  if (boxes) known.boxes = new Set(Object.values(boxes));
  const out: Segment[] = [];
  let at = 0;
  for (const c of scan(text, known)) {
    if (c.start > at) out.push({ text: text.slice(at, c.start) });
    at = c.end;
    if (c.kind === "file") { out.push(checkFile(c, ix)); continue; }
    if (c.kind === "name") {
      const h = ix.names.get(c.name!)?.[0];
      if (h) { out.push({ ref: c.text, kind: h.kind, verified: true, target: { file: h.file, ...(h.line !== undefined ? { line: h.line } : {}) } }); continue; }
    }
    out.push(checkBox(c, boxes) ?? no(c.text, c.kind === "box" ? "box" : "export"));
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}
