// Field names of database collections, read off the code next to each read and write that
// stores.ts finds: keys of the objects written, fields named in queries, and properties read
// off fetched documents when that happens right there. Anything dynamic is skipped.
import type TS from "typescript";
import { createRequire } from "node:module";

let ts: typeof TS;
const load = () => (ts ??= createRequire(import.meta.url)("typescript"));

export type How = "write" | "read" | "query";
export interface FieldHit { name: string; how: How; at: TS.Node }

const unwrapUp = (n: TS.Node): TS.Node => {
  let c = n;
  while (c.parent && (ts.isParenthesizedExpression(c.parent) || ts.isAsExpression(c.parent) || ts.isNonNullExpression(c.parent) || ts.isAwaitExpression(c.parent) || ts.isSatisfiesExpression(c.parent) || ts.isTypeAssertionExpression(c.parent))) c = c.parent;
  return c;
};
const unwrap = (e: TS.Expression): TS.Expression => {
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) || ts.isAwaitExpression(e) || ts.isSatisfiesExpression(e) || ts.isTypeAssertionExpression(e)) e = e.expression;
  return e;
};

/** A field path's top-level field: "address.city" is a write to "address". */
const top = (s: string) => s.split(".")[0];
const ok = (s: string | null | undefined): s is string => !!s && !s.includes("{}") && s.length <= 60 && !/\s/.test(s);
const lit = (e: TS.Node | undefined): string | null => (e && (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) ? e.text : null);

/** The nearest `const/let x = ...` declaration visible from this identifier (same file). */
export function declNodeOf(id: TS.Identifier, constOnly = false): TS.VariableDeclaration | null {
  load();
  const name = id.text;
  for (let n: TS.Node | undefined = id.parent; n; n = n.parent) {
    const stmts = ts.isBlock(n) || ts.isSourceFile(n) || ts.isModuleBlock(n) || ts.isCaseClause(n) || ts.isDefaultClause(n) ? n.statements : null;
    if (!stmts) continue;
    for (const st of stmts) {
      if (!ts.isVariableStatement(st)) continue;
      if (constOnly && !(st.declarationList.flags & ts.NodeFlags.Const)) continue;
      if (st.pos > id.pos && !ts.isSourceFile(n)) continue;
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer && d.name !== id) return d;
      }
    }
  }
  return null;
}

/** Identifiers with the declaration's name in its scope, after it (a parameter's scope is its function). */
export function usagesOf(name: TS.Identifier): TS.Identifier[] {
  load();
  // a declaration is visible in its block; an assignment (`ref = ...` in an if/else) in the whole function
  const assigned = ts.isBinaryExpression(name.parent);
  let scope: TS.Node = name.parent;
  if (ts.isParameter(scope)) scope = scope.parent;
  else while (scope && !(assigned ? ts.isFunctionLike(scope) || ts.isSourceFile(scope) : ts.isBlock(scope) || ts.isSourceFile(scope) || ts.isModuleBlock(scope) || ts.isCaseClause(scope))) scope = scope.parent;
  const out: TS.Identifier[] = [];
  const visit = (n: TS.Node) => {
    if (ts.isIdentifier(n) && n.text === name.text && n !== name && n.pos > name.pos) {
      const p = n.parent;
      // skip property names (`x.name`) and object keys
      if (!(ts.isPropertyAccessExpression(p) && p.name === n) && !(ts.isPropertyAssignment(p) && p.name === n)) out.push(n);
    }
    ts.forEachChild(n, visit);
  };
  visit(scope);
  return out;
}

/** The name of a property key when it is written out: `a`, `"a.b"` (as "a"), `[CONST_LITERAL]`. */
function keyName(k: TS.PropertyName, str: (e: TS.Expression) => string | null): string | null {
  if (ts.isIdentifier(k) || ts.isStringLiteral(k) || ts.isNoSubstitutionTemplateLiteral(k) || ts.isNumericLiteral(k)) return top(k.text);
  if (ts.isComputedPropertyName(k)) { const s = str(k.expression); return s ? top(s) : null; }
  return null;
}

/**
 * Keys of the object written: an object literal (spreads of local objects included), or a local
 * variable holding one, plus `x.key = ...` assignments to that variable in its scope.
 */
export function writeKeys(e: TS.Expression | undefined, str: (e: TS.Expression) => string | null, out: FieldHit[] = [], depth = 0): FieldHit[] {
  load();
  if (!e || depth > 4) return out;
  e = unwrap(e);
  if (ts.isObjectLiteralExpression(e)) {
    for (const p of e.properties) {
      if (ts.isSpreadAssignment(p)) { writeKeys(p.expression, str, out, depth + 1); continue; }
      if (!p.name) continue;
      const k = keyName(p.name, str);
      if (ok(k)) out.push({ name: k, how: "write", at: p.name });
    }
  } else if (ts.isArrayLiteralExpression(e)) {
    for (const x of e.elements) writeKeys(x, str, out, depth + 1);
  } else if (ts.isConditionalExpression(e)) {
    writeKeys(e.whenTrue, str, out, depth + 1);
    writeKeys(e.whenFalse, str, out, depth + 1);
  } else if (ts.isIdentifier(e)) {
    const d = declNodeOf(e);
    if (!d || !ts.isIdentifier(d.name)) return out;
    writeKeys(d.initializer, str, out, depth + 1);
    for (const u of usagesOf(d.name)) {
      const p = unwrapUp(u).parent;
      if (!p || !((ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) && p.expression === unwrapUp(u))) continue;
      const set = p.parent;
      if (!(ts.isBinaryExpression(set) && set.left === p && set.operatorToken.kind === ts.SyntaxKind.EqualsToken)) continue;
      const k = ts.isPropertyAccessExpression(p) ? p.name.text : lit(p.argumentExpression);
      if (ok(k)) out.push({ name: top(k), how: "write", at: ts.isPropertyAccessExpression(p) ? p.name : p.argumentExpression });
    }
  }
  return out;
}

/** `update("a", 1, "b.c", 2)`: field/value pairs from `from` on. */
export function pairKeys(args: readonly TS.Expression[], from: number): FieldHit[] {
  load();
  const out: FieldHit[] = [];
  for (let i = from; i < args.length; i += 2) {
    const k = lit(args[i]);
    if (ok(k)) out.push({ name: top(k), how: "write", at: args[i] });
  }
  return out;
}

const FILTER = new Set(["where", "orderBy"]);
/** Fields a Firestore query constraint names: `where("a", ...)`, `orderBy("b")`, `and(where(...), ...)`. */
export function constraintFields(e: TS.Expression, str: (e: TS.Expression) => string | null, depth = 0): FieldHit[] {
  load();
  e = unwrap(e);
  if (!ts.isCallExpression(e) || !ts.isIdentifier(e.expression) || depth > 3) return [];
  const fn = e.expression.text;
  if (fn === "and" || fn === "or") return e.arguments.flatMap((a) => constraintFields(a, str, depth + 1));
  if (!FILTER.has(fn) || !e.arguments[0]) return [];
  const k = str(e.arguments[0]);
  return ok(k) ? [{ name: top(k), how: "query", at: e.arguments[0] }] : [];
}

/** Fields named by a member query step: `.where("a", ...)`, `.orderBy("b")`, `.select("c", "d")`. */
export function chainFields(method: string, call: TS.CallExpression, str: (e: TS.Expression) => string | null): FieldHit[] {
  load();
  const args = method === "select" ? call.arguments : FILTER.has(method) ? call.arguments.slice(0, 1) : [];
  const out: FieldHit[] = [];
  for (const a of args) {
    const k = str(a);
    if (ok(k)) out.push({ name: top(k), how: method === "select" ? "read" : "query", at: a });
  }
  return out;
}

const DOCS_ITER = new Set(["map", "forEach", "filter", "find", "some", "every", "flatMap"]);

/**
 * Fields read off what a read returns, when that happens right there: `snap.data().x`,
 * `const { a } = snap.data()`, `const d = snap.data(); d.b`, `snap.get("c")`, the docs of a query
 * snapshot (`snap.docs.map((d) => d.data().x)`, `for (const d of snap.docs)`), and a listener's
 * snapshot parameter.
 */
export function readFields(call: TS.Node): FieldHit[] {
  load();
  const out: FieldHit[] = [];
  if (ts.isCallExpression(call)) {
    const cb = call.arguments.map(unwrap).find((a): a is TS.ArrowFunction | TS.FunctionExpression => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
    const p = cb?.parameters[0]?.name;
    if (p && ts.isIdentifier(p)) usagesOf(p).forEach((u) => snapExpr(u, out, 1));
  }
  snapExpr(call, out, 0);
  return out;
}

function fnParam(e: TS.Expression | undefined): TS.Identifier | null {
  if (!e) return null;
  e = unwrap(e);
  const p = (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) ? e.parameters[0]?.name : undefined;
  return p && ts.isIdentifier(p) ? p : null;
}

/** A document or query snapshot expression. */
function snapExpr(n: TS.Node, out: FieldHit[], depth: number): void {
  if (depth > 4) return;
  const c = unwrapUp(n), p = c.parent;
  if (!p) return;
  if (ts.isVariableDeclaration(p) && p.initializer === c && ts.isIdentifier(p.name)) {
    for (const u of usagesOf(p.name)) snapExpr(u, out, depth + 1);
    return;
  }
  if (!ts.isPropertyAccessExpression(p) || p.expression !== c) return;
  const m = p.name.text, call = ts.isCallExpression(p.parent) && p.parent.expression === p ? p.parent : null;
  if (m === "data" && call) return dataExpr(call, out, depth);
  if (m === "get" && call) { const k = lit(call.arguments[0]); if (ok(k)) out.push({ name: top(k), how: "read", at: call.arguments[0] }); return; }
  if (m === "docs") return docsExpr(p, out, depth + 1);
  if (m === "forEach" && call) { const d = fnParam(call.arguments[0]); if (d) usagesOf(d).forEach((u) => snapExpr(u, out, depth + 1)); }
}

/** A list of document snapshots (`snap.docs`). */
function docsExpr(n: TS.Node, out: FieldHit[], depth: number): void {
  if (depth > 5) return;
  const c = unwrapUp(n), p = c.parent;
  if (!p) return;
  if (ts.isPropertyAccessExpression(p) && p.expression === c && DOCS_ITER.has(p.name.text) && ts.isCallExpression(p.parent) && p.parent.expression === p) {
    const d = fnParam(p.parent.arguments[0]);
    if (d) usagesOf(d).forEach((u) => snapExpr(u, out, depth + 1));
  } else if (ts.isElementAccessExpression(p) && p.expression === c) {
    snapExpr(p, out, depth + 1);
  } else if (ts.isVariableDeclaration(p) && p.initializer === c && ts.isIdentifier(p.name)) {
    for (const u of usagesOf(p.name)) docsExpr(u, out, depth + 1);
  } else if (ts.isForOfStatement(p) && p.expression === c && ts.isVariableDeclarationList(p.initializer)) {
    const d = p.initializer.declarations[0]?.name;
    if (d && ts.isIdentifier(d)) usagesOf(d).forEach((u) => snapExpr(u, out, depth + 1));
  }
}

/** A document's data (`snap.data()`): the properties read off it. */
function dataExpr(n: TS.Node, out: FieldHit[], depth: number): void {
  let c = unwrapUp(n);
  // `snap.data() || {}`, `snap.data() ?? {}`
  while (c.parent && ts.isBinaryExpression(c.parent) && c.parent.left === c && (c.parent.operatorToken.kind === ts.SyntaxKind.BarBarToken || c.parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) c = unwrapUp(c.parent);
  const p = c.parent;
  if (!p) return;
  if (ts.isPropertyAccessExpression(p) && p.expression === c) { out.push({ name: p.name.text, how: "read", at: p.name }); return; }
  if (ts.isElementAccessExpression(p) && p.expression === c) { const k = lit(p.argumentExpression); if (ok(k)) out.push({ name: top(k), how: "read", at: p.argumentExpression }); return; }
  if (!ts.isVariableDeclaration(p) || p.initializer !== c) return;
  if (ts.isObjectBindingPattern(p.name)) return bindingFields(p.name, out);
  if (!ts.isIdentifier(p.name) || depth > 5) return;
  for (const u of usagesOf(p.name)) dataExpr(u, out, depth + 1);
}

function bindingFields(b: TS.ObjectBindingPattern, out: FieldHit[]): void {
  for (const el of b.elements) {
    if (el.dotDotDotToken) continue;
    const k = el.propertyName ?? el.name;
    const name = ts.isIdentifier(k) || ts.isStringLiteral(k) ? k.text : null;
    if (ok(name)) out.push({ name, how: "read", at: k });
  }
}

/** Prisma call arguments: `data` keys are written, `where`/`orderBy` keys queried, `select`/`include` keys read. */
export function prismaFields(arg: TS.Expression | undefined, str: (e: TS.Expression) => string | null): FieldHit[] {
  load();
  const out: FieldHit[] = [];
  if (!arg) return out;
  const e = unwrap(arg);
  if (!ts.isObjectLiteralExpression(e)) return out;
  for (const p of e.properties) {
    if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) continue;
    const k = p.name.text;
    if (k === "data" || k === "create" || k === "update") writeKeys(p.initializer, str, out);
    else if (k === "where" || k === "orderBy") queryKeys(p.initializer, out, 0);
    else if (k === "select" || k === "include") for (const h of writeKeys(p.initializer, str)) out.push({ ...h, how: "read" });
  }
  return out;
}

const LOGIC = new Set(["AND", "OR", "NOT"]);
function queryKeys(e: TS.Expression, out: FieldHit[], depth: number): void {
  e = unwrap(e);
  if (depth > 3) return;
  if (ts.isArrayLiteralExpression(e)) return e.elements.forEach((x) => queryKeys(x, out, depth + 1));
  if (!ts.isObjectLiteralExpression(e)) return;
  for (const p of e.properties) {
    if (!(ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) || !(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) continue;
    if (LOGIC.has(p.name.text)) { if (ts.isPropertyAssignment(p)) queryKeys(p.initializer, out, depth + 1); continue; }
    out.push({ name: p.name.text, how: "query", at: p.name });
  }
}

const SUPA_FILTER = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in", "contains", "containedBy", "order"]);
/** Supabase chain steps: written row keys, filtered and ordered columns, selected columns. */
export function supabaseFields(method: string, call: TS.CallExpression, str: (e: TS.Expression) => string | null): FieldHit[] {
  load();
  if (method === "insert" || method === "update" || method === "upsert") return writeKeys(call.arguments[0], str);
  const a = call.arguments[0];
  if (SUPA_FILTER.has(method)) { const k = a && str(a); return ok(k) ? [{ name: k, how: "query", at: a }] : []; }
  if (method === "select") {
    const s = a && lit(a);
    if (!s) return [];
    // plain column lists only: "id, name"; embedded resources and renames are skipped
    return s.split(",").map((x) => x.trim()).filter((x) => /^[A-Za-z_]\w*$/.test(x)).map((name) => ({ name, how: "read" as const, at: a }));
  }
  return [];
}

/** Models and their fields declared in a Prisma schema, keyed by the client accessor (`User` -> `user`). */
export function prismaSchema(text: string): { model: string; field: string; line: number }[] {
  const out: { model: string; field: string; line: number }[] = [];
  let model: string | null = null;
  text.split("\n").forEach((raw, i) => {
    const l = raw.replace(/\/\/.*$/, "").trim();
    const open = /^model\s+([A-Za-z_]\w*)\s*\{/.exec(l);
    if (open) { model = open[1][0].toLowerCase() + open[1].slice(1); out.push({ model, field: "", line: i + 1 }); return; }
    if (!model) return;
    if (l.startsWith("}")) { model = null; return; }
    const f = /^([A-Za-z_]\w*)\s+[A-Za-z_][\w.]*(\[\])?\??(\s|$)/.exec(l);
    if (f) out.push({ model, field: f[1], line: i + 1 });
  });
  return out;
}
