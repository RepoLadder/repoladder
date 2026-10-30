import type TS from "typescript";
import { createRequire } from "node:module";
import type { Service, StoreField, StoreUse } from "../model/schema.ts";
import { chainFields, constraintFields, declNodeOf, pairKeys, prismaFields, prismaSchema, readFields, supabaseFields, usagesOf, writeKeys, type FieldHit } from "./fields.ts";

let ts: typeof TS;
// per detectStores run
let helperCache = new Map<string, string[] | null>();

type Op = "read" | "write";
/** Which store SDKs the repo imports; detection for a store only runs when its SDK is present. */
export interface StoreKinds { firestore: boolean; prisma: boolean; supabase: boolean }
/** The repo file that defines `name` imported from `spec` in `from` (following barrels), or null. */
export type Definer = (from: string, spec: string, name: string) => string | null;

const STORES: Record<string, string> = { firestore: "Firestore", prisma: "Database (Prisma)", supabase: "Supabase database" };

// Firestore. A "ref" is anything that names a collection: a collection/doc reference or a query on one.
const MODULAR_REF = new Set(["collection", "doc", "collectionGroup"]);
const MEMBER_REF = new Set(["collection", "doc", "collectionGroup"]);
const QUERY_CHAIN = new Set(["where", "orderBy", "limit", "limitToLast", "startAt", "startAfter", "endAt", "endBefore", "offset", "withConverter", "select", "and", "or"]);
const READ_METHOD = new Set(["get", "getAll", "onSnapshot", "stream", "count", "listDocuments", "listCollections", "aggregate"]);
const WRITE_METHOD = new Set(["set", "update", "add", "delete", "create", "recursiveDelete"]);
const READ_FN = new Set(["getDoc", "getDocs", "getDocFromServer", "getDocsFromServer", "getDocFromCache", "getDocsFromCache", "onSnapshot", "getCountFromServer", "getAggregateFromServer", "useDocument", "useDocumentData", "useDocumentOnce", "useDocumentDataOnce", "useCollection", "useCollectionData", "useCollectionOnce", "useCollectionDataOnce", "useFirestoreDocData", "useFirestoreCollectionData"]);
const WRITE_FN = new Set(["setDoc", "addDoc", "updateDoc", "deleteDoc"]);
// receivers that are the database itself rather than a reference inside it
const DB_HANDLE = /^(db|firestore|fs|store|adminDb|firestoreDb|database|getFirestore|getDb|firestoreAdmin)$/i;

const PRISMA_READ = new Set(["findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy"]);
const PRISMA_WRITE = new Set(["create", "createMany", "createManyAndReturn", "update", "updateMany", "upsert", "delete", "deleteMany"]);
const PRISMA_CLIENT = /^(prisma|db|tx|client|prismaClient)$/i;

const SUPA_READ = new Set(["select"]);
const SUPA_WRITE = new Set(["insert", "update", "upsert", "delete"]);

interface FileInfo {
  path: string;
  sf: TS.SourceFile;
  /** local name -> { spec, imported name } */
  imports: Map<string, { spec: string; name: string }>;
  /** top-level functions, by name */
  functions: Map<string, TS.FunctionLikeDeclaration>;
  /** top-level const initializers, by name */
  consts: Map<string, TS.Expression>;
  firestoreModular: boolean;
}

/**
 * Finds which database collections/tables each file reads and writes.
 * Best effort and syntax-only: names come from literals, consts (also imported ones) and small
 * helper functions; a reference whose operation can't be seen is left out rather than guessed.
 */
export function detectStores(paths: string[], read: (p: string) => string, kinds: StoreKinds, definer: Definer, prismaSchemas: string[] = []): { stores: Service[]; storeUses: StoreUse[]; storeFields: StoreField[] } {
  if (!kinds.firestore && !kinds.prisma && !kinds.supabase) return { stores: [], storeUses: [], storeFields: [] };
  ts ??= createRequire(import.meta.url)("typescript");
  helperCache = new Map();
  const infos = new Map<string, FileInfo | null>();
  const info = (p: string): FileInfo | null => {
    if (!infos.has(p)) {
      let text: string;
      try { text = read(p); } catch { text = ""; }
      infos.set(p, text ? parseInfo(p, text) : null);
    }
    return infos.get(p)!;
  };

  const uses: StoreUse[] = [];
  const seen = new Set<string>();
  const push = (u: StoreUse) => {
    const k = `${u.store}\0${u.collection}\0${u.op}\0${u.file}\0${u.line}`;
    if (!seen.has(k)) { seen.add(k); uses.push(u); }
  };
  const fields: StoreField[] = [];
  const field = (store: string, collection: string, hits: FieldHit[], fi: FileInfo) => {
    for (const h of hits) fields.push({ store, collection, field: h.name, how: h.how, file: fi.path, line: fi.sf.getLineAndCharacterOfPosition(h.at.getStart(fi.sf)).line + 1 });
  };
  const screen = new RegExp([
    kinds.firestore && "\\b(collection|collectionGroup|doc)\\s*\\(",
    kinds.prisma && "\\.(" + [...PRISMA_READ, ...PRISMA_WRITE].join("|") + ")\\s*\\(",
    kinds.supabase && "\\.from\\s*\\(",
  ].filter(Boolean).join("|"));

  for (const p of paths) {
    let text: string;
    try { text = read(p); } catch { continue; }
    if (!screen.test(text)) continue;
    const fi = info(p)!;
    const ctx = new Ctx(fi, info, definer);
    const lineOf = (n: TS.Node) => fi.sf.getLineAndCharacterOfPosition(n.getStart(fi.sf)).line + 1;
    const visit = (n: TS.Node) => {
      if (ts.isCallExpression(n)) {
        if (kinds.firestore && ctx.isRefCall(n) && !extendsRef(n, ctx)) {
          const chain = ctx.refOf(n);
          if (chain) {
            const ops = ctx.opsOf(n, 0);
            for (const [op, at, hits] of ops) {
              push({ store: "firestore", collection: chain.join("/"), op, file: p, line: lineOf(at) });
              field("firestore", chain.join("/"), hits, fi);
            }
          }
        }
        if (kinds.prisma) {
          const hit = prismaOp(n);
          if (hit) {
            push({ store: "prisma", collection: hit[0], op: hit[1], file: p, line: lineOf(n) });
            field("prisma", hit[0], prismaFields(n.arguments[0], ctx.str), fi);
          }
        }
        if (kinds.supabase) {
          const hit = supabaseOp(n, ctx);
          if (hit) {
            push({ store: "supabase", collection: hit[0], op: hit[1], file: p, line: lineOf(n) });
            field("supabase", hit[0], hit[2], fi);
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(fi.sf);
  }

  // "*/Items" (a sub-collection reached from a reference we couldn't trace, or a collection group):
  // when exactly one known path ends in that name, it's that one.
  const known = [...new Set(uses.filter((u) => !u.collection.startsWith("*/")).map((u) => `${u.store}\0${u.collection}`))];
  for (const u of uses) {
    if (!u.collection.startsWith("*/")) continue;
    const tail = u.collection.slice(1);
    const match = known.filter((k) => k.startsWith(`${u.store}\0`) && k.endsWith(tail) && k.includes("/"));
    if (match.length === 1) {
      const to = match[0].split("\0")[1];
      for (const f of fields) if (f.store === u.store && f.collection === u.collection) f.collection = to;
      u.collection = to;
    }
  }
  const deduped = new Map<string, StoreUse>();
  for (const u of uses) deduped.set(`${u.store}\0${u.collection}\0${u.op}\0${u.file}\0${u.line}`, u);
  const storeUses = [...deduped.values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.store.localeCompare(b.store) || a.collection.localeCompare(b.collection) || a.op.localeCompare(b.op));
  const stores = [...new Set(storeUses.map((u) => u.store))].sort().map((id) => ({ id, name: STORES[id] }));
  // Prisma models are declared: every model and field in the schema, where the code uses Prisma
  if (stores.some((s) => s.id === "prisma")) {
    for (const file of prismaSchemas) {
      let text = "";
      try { text = read(file); } catch {}
      for (const d of prismaSchema(text)) fields.push({ store: "prisma", collection: d.model, field: d.field, how: "declared", file, line: d.line });
    }
  }
  const byKey = new Map<string, StoreField>();
  for (const f of fields) if (stores.some((s) => s.id === f.store) && !f.collection.startsWith("*/")) byKey.set(`${f.store}\0${f.collection}\0${f.field}\0${f.how}\0${f.file}\0${f.line}`, f);
  const storeFields = [...byKey.values()].sort((a, b) => a.store.localeCompare(b.store) || a.collection.localeCompare(b.collection) || a.field.localeCompare(b.field) || a.how.localeCompare(b.how) || a.file.localeCompare(b.file) || a.line - b.line);
  return { stores, storeUses, storeFields };
}

function parseInfo(path: string, text: string): FileInfo {
  const kind = /\.[cm]?tsx$|\.jsx$/.test(path) ? ts.ScriptKind.TSX : /\.[cm]?ts$/.test(path) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
  const imports = new Map<string, { spec: string; name: string }>();
  const functions = new Map<string, TS.FunctionLikeDeclaration>();
  const consts = new Map<string, TS.Expression>();
  let firestoreModular = false;
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      const spec = st.moduleSpecifier.text;
      if (/firestore/.test(spec)) firestoreModular = true;
      const nb = st.importClause?.namedBindings;
      if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) imports.set(el.name.text, { spec, name: (el.propertyName ?? el.name).text });
    } else if (ts.isFunctionDeclaration(st) && st.name && st.body) {
      functions.set(st.name.text, st);
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue;
        const init = unwrap(d.initializer);
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) functions.set(d.name.text, init);
        else if (st.declarationList.flags & ts.NodeFlags.Const) consts.set(d.name.text, init);
      }
    }
  }
  return { path, sf, imports, functions, consts, firestoreModular };
}

function unwrap(e: TS.Expression): TS.Expression {
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) || ts.isAwaitExpression(e) || ts.isSatisfiesExpression(e) || ts.isTypeAssertionExpression(e)) e = e.expression;
  return e;
}
const isWrapper = (n: TS.Node) => ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n) || ts.isAwaitExpression(n) || ts.isSatisfiesExpression(n) || ts.isTypeAssertionExpression(n);

/** True when this ref is only a step inside a longer reference (`db.collection(x)` in `db.collection(x).doc(id)`). */
function extendsRef(n: TS.Node, ctx: Ctx): boolean {
  let c: TS.Node = n;
  while (isWrapper(c.parent)) c = c.parent;
  const p = c.parent;
  if (ts.isPropertyAccessExpression(p) && p.expression === c && MEMBER_REF.has(p.name.text) && ts.isCallExpression(p.parent) && p.parent.expression === p) return true;
  if (ts.isCallExpression(p) && p.arguments[0] === c && ts.isIdentifier(p.expression) && ctx.fi.firestoreModular && (MODULAR_REF.has(p.expression.text) || p.expression.text === "query")) return true;
  return false;
}

class Ctx {
  fi: FileInfo;
  info: (p: string) => FileInfo | null;
  definer: Definer;
  constructor(fi: FileInfo, info: (p: string) => FileInfo | null, definer: Definer) {
    this.fi = fi; this.info = info; this.definer = definer;
  }

  isRefCall(n: TS.CallExpression): boolean {
    const e = n.expression;
    if (ts.isIdentifier(e)) return (this.fi.firestoreModular && (MODULAR_REF.has(e.text) || e.text === "query")) || this.helperRef(this.fi, e.text, 0) !== null;
    return ts.isPropertyAccessExpression(e) && MEMBER_REF.has(e.name.text) && n.arguments.length <= 1;
  }

  /** The collection chain an expression refers to, e.g. ["Companies", "Therapists"]; "*" for an unknown parent. */
  refOf(e: TS.Expression, depth = 0): string[] | null {
    if (depth > 6) return null;
    e = unwrap(e);
    if (ts.isConditionalExpression(e)) return this.refOf(e.whenTrue, depth + 1) ?? this.refOf(e.whenFalse, depth + 1);
    if (ts.isIdentifier(e)) {
      const init = declOf(e);
      return init ? this.refOf(init, depth + 1) : null;
    }
    if (!ts.isCallExpression(e)) return null;
    const callee = e.expression;
    if (ts.isIdentifier(callee)) {
      const fn = callee.text;
      if (this.fi.firestoreModular && fn === "query" && e.arguments[0]) return this.refOf(e.arguments[0], depth + 1);
      if (this.fi.firestoreModular && MODULAR_REF.has(fn) && e.arguments.length) {
        const [first, ...rest] = e.arguments;
        const parent = this.refOf(first, depth + 1);
        if (!rest.length) return parent; // doc(colRef): a new id in that collection
        const segs = this.segments(rest);
        if (!segs) return null;
        if (fn === "collectionGroup") return segs[0] ? ["*", segs[0]] : null;
        // parent ref is a collection for doc(colRef, id) / a doc for collection(docRef, "sub")
        const start = parent ? (fn === "doc" ? 1 : 0) : 0;
        const cols = segs.filter((_, i) => i >= start && (i - start) % 2 === 0);
        if (cols.some((c) => c === "{}")) return null;
        const chain = [...(parent ?? []), ...cols];
        return chain.length ? chain : null;
      }
      const helper = this.helperRef(this.fi, fn, depth);
      return helper;
    }
    if (ts.isPropertyAccessExpression(callee) && MEMBER_REF.has(callee.name.text)) {
      const method = callee.name.text;
      const base = unwrap(callee.expression);
      const parent = this.refOf(base, depth + 1);
      const arg = e.arguments[0];
      if (method === "doc") {
        if (parent) {
          const segs = arg ? this.segments([arg]) : null;
          // doc("id/Sub/id2") under a collection adds the odd segments
          const extra = segs ? segs.filter((_, i) => i % 2 === 1) : [];
          return extra.includes("{}") ? parent : [...parent, ...extra];
        }
        if (!arg || !this.isDbHandle(base)) return null;
        const segs = this.segments([arg]);
        if (!segs || segs.length < 2) return null;
        const cols = segs.filter((_, i) => i % 2 === 0);
        return cols.includes("{}") ? null : cols;
      }
      if (!arg) return null;
      const segs = this.segments([arg]);
      if (!segs) return null;
      const cols = segs.filter((_, i) => i % 2 === 0);
      if (cols.includes("{}")) return null;
      if (method === "collectionGroup") return ["*", ...cols];
      if (parent) return [...parent, ...cols];
      return this.isDbHandle(base) ? cols : ["*", ...cols];
    }
    return null;
  }

  isDbHandle(e: TS.Expression): boolean {
    e = unwrap(e);
    if (ts.isIdentifier(e)) return DB_HANDLE.test(e.text);
    if (ts.isPropertyAccessExpression(e)) return DB_HANDLE.test(e.name.text);
    if (ts.isCallExpression(e)) {
      const c = e.expression;
      const name = ts.isIdentifier(c) ? c.text : ts.isPropertyAccessExpression(c) ? c.name.text : "";
      return DB_HANDLE.test(name);
    }
    return false;
  }

  /** A function (local or imported) whose result is a reference: `formsCollection(companyId)`. */
  helperRef(fi: FileInfo, name: string, depth: number): string[] | null {
    if (depth > 4) return null;
    const key = `${fi.path}\0${name}`;
    if (helperCache.has(key)) return helperCache.get(key)!;
    helperCache.set(key, null); // guards recursion
    const r = this.helperRefUncached(fi, name, depth);
    helperCache.set(key, r);
    return r;
  }

  private helperRefUncached(fi: FileInfo, name: string, depth: number): string[] | null {
    const fn = fi.functions.get(name);
    if (fn) {
      const body = fn.body;
      if (!body) return null;
      const sub = fi === this.fi ? this : new Ctx(fi, this.info, this.definer);
      if (!ts.isBlock(body)) return sub.refOf(body, depth + 1);
      const ret = body.statements.find((s): s is TS.ReturnStatement => ts.isReturnStatement(s) && !!s.expression);
      return ret ? sub.refOf(ret.expression!, depth + 1) : null;
    }
    const imp = fi.imports.get(name);
    if (!imp) return null;
    const file = this.definer(fi.path, imp.spec, imp.name);
    const target = file ? this.info(file) : null;
    return target ? this.helperRef(target, imp.name, depth + 1) : null;
  }

  /** Path segments from arguments; "{}" for a dynamic id; null if a segment can't be read. */
  segments(args: readonly TS.Expression[]): string[] | null {
    const out: string[] = [];
    for (const a of args) {
      const s = this.stringOf(this.fi, a, 0);
      const parts = s?.split("/").filter(Boolean);
      if (!parts?.length) out.push("{}");
      else out.push(...parts);
    }
    return out.length ? out : null;
  }

  /** The string value of an expression, when it's a literal, a template or a const (also imported). */
  stringOf(fi: FileInfo, e: TS.Expression, depth: number): string | null {
    if (depth > 5) return null;
    e = unwrap(e);
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
    if (ts.isTemplateExpression(e)) return e.head.text + e.templateSpans.map((s) => `{}${s.literal.text}`).join("");
    if (ts.isIdentifier(e)) {
      if (fi === this.fi) {
        // only consts: a `let` id is usually reassigned before use
        const init = declOf(e, true);
        if (init) return this.stringOf(fi, init, depth + 1);
      }
      return this.constOf(fi, e.text, depth);
    }
    if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression)) {
      const hit = this.objOf(fi, e.expression.text, depth);
      const prop = hit?.obj.properties.find((p): p is TS.PropertyAssignment => ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === e.name.text);
      return prop ? this.stringOf(hit!.fi, prop.initializer, depth + 1) : null;
    }
    return null;
  }

  constOf(fi: FileInfo, name: string, depth: number): string | null {
    const init = fi.consts.get(name);
    if (init) return ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init) ? init.text : null;
    const imp = fi.imports.get(name);
    if (!imp) return null;
    const file = this.definer(fi.path, imp.spec, imp.name);
    const target = file ? this.info(file) : null;
    return target ? this.constOf(target, imp.name, depth + 1) : null;
  }

  objOf(fi: FileInfo, name: string, depth: number): { fi: FileInfo; obj: TS.ObjectLiteralExpression } | null {
    if (depth > 5) return null;
    const init = fi.consts.get(name);
    if (init) return ts.isObjectLiteralExpression(init) ? { fi, obj: init } : null;
    const imp = fi.imports.get(name);
    const file = imp ? this.definer(fi.path, imp.spec, imp.name) : null;
    const target = file ? this.info(file) : null;
    return target && imp ? this.objOf(target, imp.name, depth + 1) : null;
  }

  /** The string value of an expression in this file, for field names. */
  str = (e: TS.Expression) => this.stringOf(this.fi, e, 0);

  /**
   * What is done with a reference: read and/or write, with the node to cite and the fields the
   * code names there (`fields` carries query constraints met on the way up).
   */
  opsOf(n: TS.Node, depth: number, fields: FieldHit[] = []): [Op, TS.Node, FieldHit[]][] {
    if (depth > 3) return [];
    const read = (at: TS.Node): [Op, TS.Node, FieldHit[]] => ["read", at, [...fields, ...readFields(at)]];
    const write = (at: TS.Node, hits: FieldHit[]): [Op, TS.Node, FieldHit[]] => ["write", at, hits];
    // a query (`query(...)`, a collection group) is only ever read
    const callee = ts.isCallExpression(n) ? n.expression : null;
    let queried = !!callee && ((ts.isIdentifier(callee) && this.fi.firestoreModular && (callee.text === "query" || callee.text === "collectionGroup")) || (ts.isPropertyAccessExpression(callee) && callee.name.text === "collectionGroup"));
    if (ts.isCallExpression(n) && callee && ts.isIdentifier(callee) && callee.text === "query" && this.fi.firestoreModular) fields = [...fields, ...n.arguments.slice(1).flatMap((a) => constraintFields(a, this.str))];
    let c: TS.Node = n;
    while (true) {
      const p = c.parent;
      if (!p) return [];
      if (isWrapper(p) || ts.isSpreadElement(p) || (ts.isConditionalExpression(p) && p.condition !== c)) { c = p; continue; }
      // ids.map((id) => db.collection(x).doc(id)) is a list of the same references
      if (ts.isArrowFunction(p) && p.body === c && ts.isCallExpression(p.parent) && p.parent.arguments[0] === p && ts.isPropertyAccessExpression(p.parent.expression) && p.parent.expression.name.text === "map") { c = p.parent; continue; }
      if (ts.isPropertyAccessExpression(p) && p.expression === c) {
        const m = p.name.text;
        if (!ts.isCallExpression(p.parent) || p.parent.expression !== p) return queried ? [read(c)] : [];
        const call = p.parent;
        if (READ_METHOD.has(m)) return [read(call)];
        if (WRITE_METHOD.has(m)) return [write(call, m === "update" && call.arguments.length > 1 && !ts.isObjectLiteralExpression(unwrap(call.arguments[0])) ? pairKeys(call.arguments, 0) : m === "delete" || m === "recursiveDelete" ? [] : writeKeys(call.arguments[0], this.str))];
        if (QUERY_CHAIN.has(m)) { queried = true; fields = [...fields, ...chainFields(m, call, this.str)]; c = call; continue; }
        return queried ? [read(c)] : [];
      }
      if (ts.isCallExpression(p) && p.arguments.includes(c as TS.Expression)) {
        const callee = p.expression;
        const fn = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
        const data = (i: number) => (fn === "updateDoc" || fn === "update") && p.arguments.length > i + 1 ? pairKeys(p.arguments, i) : fn.startsWith("delete") ? [] : writeKeys(p.arguments[i], this.str);
        if (ts.isIdentifier(callee) && this.fi.firestoreModular) {
          if (READ_FN.has(fn)) return [read(p)];
          if (WRITE_FN.has(fn)) return [write(p, data(1))];
          if (fn === "query") { queried = true; fields = [...fields, ...p.arguments.filter((a) => a !== c).flatMap((a) => constraintFields(a, this.str))]; c = p; continue; }
        }
        if (ts.isPropertyAccessExpression(callee) && p.arguments[0] === c) {
          // transaction.get(ref), batch.set(ref, data), db.getAll(ref), bulkWriter.update(ref, data)
          if (fn === "get" || fn === "getAll") return [read(p)];
          if (WRITE_METHOD.has(fn) && fn !== "add") return [write(p, data(1))];
        }
        return queried ? [read(c)] : [];
      }
      const target = ts.isVariableDeclaration(p) && p.initializer === c && ts.isIdentifier(p.name) ? p.name
        : ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && p.right === c && ts.isIdentifier(p.left) ? p.left : null;
      if (target) {
        const out: [Op, TS.Node, FieldHit[]][] = [];
        for (const u of usagesOf(target)) {
          if (ts.isBinaryExpression(u.parent) && u.parent.left === u) continue; // reassigned
          if (refExtends(u)) continue; // `ref.collection("sub")` is its own reference
          out.push(...this.opsOf(u, depth + 1, fields));
        }
        if (!out.length && queried) out.push(read(c));
        return out;
      }
      return queried ? [read(c)] : [];
    }
  }
}

function refExtends(u: TS.Node): boolean {
  let c = u;
  while (isWrapper(c.parent)) c = c.parent;
  const p = c.parent;
  return ts.isPropertyAccessExpression(p) && p.expression === c && MEMBER_REF.has(p.name.text);
}

/** The initializer of the nearest `const/let x = ...` visible from this identifier (same file). */
function declOf(id: TS.Identifier, constOnly = false): TS.Expression | null {
  return declNodeOf(id, constOnly)?.initializer ?? null;
}

/** `prisma.user.findMany(...)`, `tx.post.create(...)` */
function prismaOp(n: TS.CallExpression): [string, Op] | null {
  const c = n.expression;
  if (!ts.isPropertyAccessExpression(c)) return null;
  const op = c.name.text;
  const kind: Op | null = PRISMA_READ.has(op) ? "read" : PRISMA_WRITE.has(op) ? "write" : null;
  if (!kind) return null;
  const model = c.expression;
  if (!ts.isPropertyAccessExpression(model)) return null;
  const client = model.expression;
  const clientName = ts.isIdentifier(client) ? client.text : ts.isPropertyAccessExpression(client) ? client.name.text : "";
  if (!PRISMA_CLIENT.test(clientName)) return null;
  const name = model.name.text;
  if (name.startsWith("$")) return null;
  return [name, kind];
}

/** `supabase.from("orders").select()`; only counted once the chain reaches a read or write. Fields come from the whole chain. */
function supabaseOp(n: TS.CallExpression, ctx: Ctx): [string, Op, FieldHit[]] | null {
  const c = n.expression;
  if (!ts.isPropertyAccessExpression(c) || c.name.text !== "from" || n.arguments.length !== 1) return null;
  // storage buckets use the same `.from()` and aren't tables
  const recv = c.expression;
  if (ts.isPropertyAccessExpression(recv) && recv.name.text === "storage") return null;
  const table = ctx.stringOf(ctx.fi, n.arguments[0], 0);
  if (!table || table.includes("{}")) return null;
  let cur: TS.Node = n, op: Op | null = null;
  const hits: FieldHit[] = [];
  for (let i = 0; i < 12; i++) {
    const p = cur.parent;
    if (!ts.isPropertyAccessExpression(p) || !ts.isCallExpression(p.parent) || p.parent.expression !== p) break;
    const m = p.name.text;
    // `.insert(x).select()` returns the written row: the select is not a separate read
    if (!op && SUPA_READ.has(m)) op = "read";
    if (!op && SUPA_WRITE.has(m)) op = "write";
    hits.push(...supabaseFields(m, p.parent, ctx.str));
    cur = p.parent;
  }
  return op ? [table, op, hits] : null;
}
