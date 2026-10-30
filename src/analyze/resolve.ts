import type TS from "typescript";
import { builtinModules, createRequire } from "node:module";
import { dirname, join, posix, relative, sep } from "node:path";
import type { ImportKind } from "../model/schema.ts";
import type { WorkspacePackage } from "./packages.ts";
import { asSource, tsHosts, type FileSource } from "./source.ts";
import { scanRoutes, type FileRoutes } from "./routes.ts";

// Loaded on first use so the CLI starts (and can report a missing install) without it.
let ts: typeof TS;
function loadTs() {
  ts ??= createRequire(import.meta.url)("typescript");
}

export interface RawImport {
  spec: string;
  line: number;
  kind: ImportKind;
  /** Imported binding names; "*" for namespace/side-effect/unknown. */
  names: string[];
}

export interface ReExport {
  spec: string;
  /** [exported name, name in `spec`] pairs ("*" for `export * as ns`); null = `export * from` */
  names: [string, string][] | null;
}

export type EndpointKind = "callable" | "http" | "event";

export interface EndpointDef {
  name: string; // exported function name, or a route path like "/users/:id"
  line: number;
  kind: EndpointKind;
}

/** A string literal that could name an endpoint: `'createUser'`, `` `${base}/createUser` ``, `'/api/users'`. */
export interface StringRef {
  token: string; // last path segment
  path: string | null; // full literal text when it looks like a path
  line: number;
  callee: string | null; // function the literal is passed to, e.g. httpsCallable, fetch
  site: StringSite | null; // see StringSite
  /** Set only when the literal is a form submission target (#295): a form's `action`, a submitter's `formAction`, or the `action` of submit() options. `method` is the submission's method, lower-case: "get" when the code states none (the default), null when it isn't a literal. */
  form?: { method: string | null };
}

/** Where a literal sits, when that can mark it as data rather than a request (#237). */
export type StringSite =
  | { kind: "property"; key: string | null; objectCallee: string | null } // `{ key: "/x" }`; objectCallee = function the object is passed to
  | { kind: "predicate"; method: string } // `s.includes("/x")`, `"/x".startsWith(s)`
  | { kind: "compare" }; // `s === "/x"`

export interface ParsedFile {
  imports: RawImport[];
  exports: Set<string>;
  reexports: ReExport[];
  /** Only re-exports (and imports used to re-export): a pass-through barrel. */
  isBarrel: boolean;
  loc: number;
  endpoints: EndpointDef[];
  strings: StringRef[];
  /** Server routes, mounts and tRPC client calls; joined across files by `linkRoutes`. */
  routes: FileRoutes;
}

const TRIGGERS: Record<string, EndpointKind> = {
  onCall: "callable", onCallGenkit: "callable",
  onRequest: "http",
  onSchedule: "event", schedule: "event", onRun: "event",
  onDocumentCreated: "event", onDocumentUpdated: "event", onDocumentDeleted: "event", onDocumentWritten: "event",
  onCreate: "event", onUpdate: "event", onDelete: "event", onWrite: "event", onFinalize: "event",
  onObjectFinalized: "event", onObjectDeleted: "event", onMessagePublished: "event", onPublish: "event",
  beforeUserCreated: "event", beforeUserSignedIn: "event", beforeCreate: "event", beforeSignIn: "event",
  onTaskDispatched: "event", onValueWritten: "event", onValueCreated: "event",
};

const calleeName = (e: TS.Expression): string | null =>
  ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : null;

/** Trigger kind if the expression is (or wraps) a Cloud Functions trigger call. */
function triggerKind(init: TS.Node): EndpointKind | null {
  let found: EndpointKind | null = null;
  const visit = (n: TS.Node) => {
    if (found) return;
    if (ts.isCallExpression(n)) {
      const name = calleeName(n.expression);
      if (name && Object.hasOwn(TRIGGERS, name)) { found = TRIGGERS[name]; return; }
    }
    if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) return; // don't look inside handler bodies
    ts.forEachChild(n, visit);
  };
  visit(init);
  return found;
}

export function parseFile(path: string, text: string): ParsedFile {
  loadTs();
  const kind = /\.[cm]?tsx$|\.jsx$/.test(path) ? ts.ScriptKind.TSX : /\.[cm]?ts$/.test(path) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
  const lineOf = (n: TS.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const imports: RawImport[] = [];
  const exports = new Set<string>();
  const reexports: ReExport[] = [];
  let barrelish = true;
  const endpoints: EndpointDef[] = [];
  const strings: StringRef[] = [];

  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      const c = st.importClause;
      const names: string[] = [];
      if (c?.name) names.push("default");
      if (c?.namedBindings) {
        if (ts.isNamespaceImport(c.namedBindings)) names.push("*");
        else for (const el of c.namedBindings.elements) names.push((el.propertyName ?? el.name).text);
      }
      const typeOnly = !!c?.isTypeOnly || (!!c?.namedBindings && ts.isNamedImports(c.namedBindings) && !c.name && c.namedBindings.elements.length > 0 && c.namedBindings.elements.every((e) => e.isTypeOnly));
      imports.push({ spec: st.moduleSpecifier.text, line: lineOf(st), kind: typeOnly ? "type" : "static", names: names.length ? names : ["*"] });
      continue;
    }
    if (ts.isExportDeclaration(st)) {
      if (st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) {
        const spec = st.moduleSpecifier.text;
        let names: [string, string][] | null = null;
        if (st.exportClause && ts.isNamedExports(st.exportClause)) {
          names = st.exportClause.elements.map((e) => [e.name.text, (e.propertyName ?? e.name).text]);
          for (const e of st.exportClause.elements) exports.add(e.name.text);
        } else if (st.exportClause && ts.isNamespaceExport(st.exportClause)) {
          names = [[st.exportClause.name.text, "*"]];
          exports.add(st.exportClause.name.text);
        }
        reexports.push({ spec, names });
        imports.push({ spec, line: lineOf(st), kind: st.isTypeOnly ? "type" : "reexport", names: names?.map((n) => n[1]) ?? ["*"] });
      } else {
        barrelish = false;
        if (st.exportClause && ts.isNamedExports(st.exportClause)) for (const e of st.exportClause.elements) exports.add(e.name.text);
      }
      continue;
    }
    barrelish = false;
    if (ts.isExportAssignment(st)) exports.add("default");
    const mods = ts.canHaveModifiers(st) ? ts.getModifiers(st) : undefined;
    if (mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      if (mods.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) exports.add("default");
      else if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) exports.add(d.name.text);
      } else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isEnumDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)) && st.name) {
        exports.add(st.name.text);
      }
    }
  }

  // top-level `const x = onCall(...)`, exported directly or via `export { x }`
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || !d.initializer || !exports.has(d.name.text)) continue;
      const k = triggerKind(d.initializer);
      if (k) endpoints.push({ name: d.name.text, line: lineOf(d), kind: k });
    }
  }

  // names that submit a form programmatically: `submit`/`fetcher.submit` by callee name, plus `const go = useSubmit()`
  const submitters = new Set(["submit"]);
  const findSubmitters = (n: TS.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isCallExpression(n.initializer) && calleeName(n.initializer.expression) === "useSubmit") submitters.add(n.name.text);
    ts.forEachChild(n, findSubmitters);
  };
  findSubmitters(sf);

  // require(), import(), import x = require(), exports.x = trigger and strings anywhere in the file
  const visit = (n: TS.Node) => {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(n.left)) {
      const obj = n.left.expression;
      const isExports = (ts.isIdentifier(obj) && obj.text === "exports") || (ts.isPropertyAccessExpression(obj) && obj.name.text === "exports");
      const k = isExports ? triggerKind(n.right) : null;
      if (k) endpoints.push({ name: n.left.name.text, line: lineOf(n), kind: k });
    }
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) {
      const ref = stringRef(n, lineOf, submitters);
      if (ref) strings.push(ref);
    }
    if (ts.isCallExpression(n) && n.arguments.length >= 1) {
      const arg = n.arguments[0];
      const lit = ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg) ? arg.text : null;
      if (lit !== null) {
        if (n.expression.kind === ts.SyntaxKind.ImportKeyword) imports.push({ spec: lit, line: lineOf(n), kind: "lazy", names: ["*"] });
        else if (ts.isIdentifier(n.expression) && n.expression.text === "require") imports.push({ spec: lit, line: lineOf(n), kind: "require", names: ["*"] });
      }
    } else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference) && ts.isStringLiteral(n.moduleReference.expression)) {
      imports.push({ spec: n.moduleReference.expression.text, line: lineOf(n), kind: "require", names: ["*"] });
      return;
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(sf, visit);

  imports.sort((a, b) => a.line - b.line || a.spec.localeCompare(b.spec));
  const loc = text.split("\n").filter((l) => l.trim()).length;
  const routes = scanRoutes(ts, sf, lineOf);
  return { imports, exports, reexports, isBarrel: barrelish && reexports.length > 0, loc, endpoints, strings, routes };
}

function stringRef(n: TS.StringLiteral | TS.NoSubstitutionTemplateLiteral | TS.TemplateExpression, lineOf: (n: TS.Node) => number, submitters: ReadonlySet<string>): StringRef | null {
  const p = n.parent;
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isExternalModuleReference(p) || ts.isLiteralTypeNode(p) || ts.isPropertyAssignment(p) && p.name === n) return null;
  if (ts.isCallExpression(p) && (p.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(p.expression) && p.expression.text === "require"))) return null;
  // For templates, a leading substitution is a base URL and later ones are dynamic segments:
  // `${base}/createUser` -> "/createUser", `/api/posts/${id}` -> "/api/posts/:_".
  const text = ts.isTemplateExpression(n)
    ? (n.head.text + n.templateSpans.map((s) => `\0${s.literal.text}`).join("")).replace(/^\0+/, "").replace(/\0/g, ":_")
    : n.text;
  const clean = text.replace(/[?#].*$/, "");
  const last = clean.slice(clean.lastIndexOf("/") + 1);
  const token = /^[A-Za-z_][\w-]{2,}$/.test(last) ? last : "";
  const isPath = clean.startsWith("/") || clean.includes("://");
  if (!token && !isPath) return null;
  const callee = ts.isCallExpression(p) && p.arguments.includes(n as TS.Expression) ? calleeName(p.expression) : null;
  const form = formSink(n, submitters);
  return { token, path: isPath || clean.includes("/") ? clean : null, line: lineOf(n), callee, site: stringSite(n), ...(form ? { form } : {}) };
}

const FORM_TAG = /^(form|Form)$|\.Form$/;

const tagText = (e: TS.Node): string =>
  ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? `${tagText(e.expression)}.${e.name.text}` : "";

const litText = (e: TS.Node | undefined): string | null =>
  e && (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) ? e.text.toLowerCase() : null;

/** The lower-case method an element states in attribute `name`: `fallback` when absent, null when not a literal. */
function attrMethod(el: TS.JsxOpeningElement | TS.JsxSelfClosingElement, name: string, fallback: string | null = "get"): string | null {
  for (const a of el.attributes.properties) {
    if (!ts.isJsxAttribute(a) || !ts.isIdentifier(a.name) || a.name.text !== name) continue;
    const i = a.initializer;
    if (!i) return null;
    return litText(i) ?? (ts.isJsxExpression(i) ? litText(i.expression && unwrapDown(i.expression)) : null);
  }
  return fallback;
}

const unwrapDown = (e: TS.Expression): TS.Expression => {
  let c = e;
  while (ts.isParenthesizedExpression(c) || ts.isAsExpression(c) || ts.isSatisfiesExpression(c) || ts.isNonNullExpression(c)) c = c.expression;
  return c;
};

/** Whether the literal is a form submission target, and the method it submits with (#295). */
function formSink(n: TS.Node, submitters: ReadonlySet<string>): { method: string | null } | null {
  const ctx = unwrapUp(n);
  let a = ctx.parent;
  if (a && ts.isJsxExpression(a)) a = a.parent;
  if (a && ts.isJsxAttribute(a) && ts.isIdentifier(a.name)) {
    const el = a.parent.parent;
    if (!ts.isJsxOpeningElement(el) && !ts.isJsxSelfClosingElement(el)) return null;
    if (a.name.text === "action") return FORM_TAG.test(tagText(el.tagName)) ? { method: attrMethod(el, "method") } : null;
    if (a.name.text === "formAction") {
      let outer = "get" as string | null;
      for (let p: TS.Node | undefined = el.parent; p; p = p.parent) {
        const open = ts.isJsxElement(p) ? p.openingElement : null;
        if (open && FORM_TAG.test(tagText(open.tagName))) { outer = attrMethod(open, "method"); break; }
      }
      return { method: attrMethod(el, "formMethod", outer) };
    }
    return null;
  }
  const q = ctx.parent;
  if (q && ts.isPropertyAssignment(q) && q.initializer === ctx && (ts.isIdentifier(q.name) || ts.isStringLiteral(q.name)) && (q.name.text === "action" || q.name.text === "formAction")) {
    const obj = unwrapUp(q.parent);
    const call = obj.parent;
    if (!ts.isObjectLiteralExpression(obj) || !call || !ts.isCallExpression(call) || !call.arguments.includes(obj as TS.Expression)) return null;
    const callee = calleeName(call.expression);
    if (!callee || !submitters.has(callee)) return null;
    const prop = (k: string) => obj.properties.find((p): p is TS.PropertyAssignment => ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === k);
    const m = prop("method") ?? prop("formMethod");
    return { method: m ? litText(unwrapDown(m.initializer)) : "get" };
  }
  return null;
}

const PREDICATES = new Set(["includes", "startsWith", "endsWith", "indexOf", "match", "test", "replace"]);

/** Steps up through parentheses, `as`, `satisfies`, `<T>x` and `x!`, so `("/x" as const)` sits where `"/x"` would. */
function unwrapUp(n: TS.Node): TS.Node {
  let c = n;
  while (c.parent && (ts.isParenthesizedExpression(c.parent) || ts.isAsExpression(c.parent) || ts.isSatisfiesExpression(c.parent) || ts.isTypeAssertionExpression(c.parent) || ts.isNonNullExpression(c.parent))) c = c.parent;
  return c;
}

/** The literal's data position, if any (#237): an object value, a string-predicate argument or receiver, or one side of an equality. */
function stringSite(n: TS.Node): StringSite | null {
  const ctx = unwrapUp(n);
  const q = ctx.parent;
  if (!q) return null;
  if (ts.isPropertyAssignment(q) && q.initializer === ctx) {
    const name = q.name;
    const key = ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) || ts.isPrivateIdentifier(name) ? name.text : null;
    const o = unwrapUp(q.parent);
    const call = o.parent;
    const objectCallee = call && ts.isCallExpression(call) && call.arguments.includes(o as TS.Expression) ? calleeName(call.expression) : null;
    return { kind: "property", key, objectCallee };
  }
  // `s.includes("/x")`; `replace` only with a replacement (`location.replace("/x")` navigates)
  if (ts.isCallExpression(q) && q.arguments.includes(ctx as TS.Expression) && ts.isPropertyAccessExpression(q.expression) && PREDICATES.has(q.expression.name.text)) {
    const method = q.expression.name.text;
    if (method !== "replace" || q.arguments.length >= 2) return { kind: "predicate", method };
  }
  // `"/x".startsWith(s)`
  if (ts.isPropertyAccessExpression(q) && q.expression === ctx && PREDICATES.has(q.name.text) && q.parent && ts.isCallExpression(q.parent) && q.parent.expression === q) {
    const method = q.name.text;
    if (method !== "replace" || q.parent.arguments.length >= 2) return { kind: "predicate", method };
  }
  if (ts.isBinaryExpression(q)) {
    const k = q.operatorToken.kind;
    if (k === ts.SyntaxKind.EqualsEqualsEqualsToken || k === ts.SyntaxKind.ExclamationEqualsEqualsToken || k === ts.SyntaxKind.EqualsEqualsToken || k === ts.SyntaxKind.ExclamationEqualsToken) return { kind: "compare" };
  }
  return null;
}

/** Resolves module specifiers with each package's own tsconfig. */
export class Resolver {
  private optionsByDir = new Map<string, TS.CompilerOptions>();
  private cache = new Map<string, TS.ResolvedModuleFull | undefined>();
  private host: TS.ModuleResolutionHost;
  private configHost: TS.ParseConfigHost;
  private src: FileSource;
  private root: string;
  private workspaces: Map<string, WorkspacePackage>;
  private sources: Set<string>;
  private wsCache = new Map<string, string | null>();
  /** `workspaces` and `sources` (repo-relative source paths) let workspace imports resolve to source files. */
  constructor(srcArg: FileSource | string, workspaces = new Map<string, WorkspacePackage>(), sources = new Set<string>()) {
    loadTs();
    this.src = asSource(srcArg);
    this.root = this.src.root;
    const h = tsHosts(this.src, ts);
    this.host = h.module;
    this.configHost = h.config;
    this.workspaces = workspaces;
    this.sources = sources;
  }

  /**
   * A workspace package import resolved to a source file in the repo, read from the package's own
   * package.json rather than node_modules, so it works on a fresh clone and lands on src/ not dist/.
   */
  private resolveWorkspace(spec: string): string | null {
    const hit = this.wsCache.get(spec);
    if (hit !== undefined) return hit;
    const ws = this.workspaces.get(packageName(spec))!;
    const sub = spec.slice(ws.name.length).replace(/^\//, "");
    const json = ws.json;
    const cands = exportTargets(json.exports, sub ? `./${sub}` : ".");
    if (sub) cands.push(sub, `src/${sub}`);
    else cands.push(...[json.source, json.module, json.main].filter((x): x is string => typeof x === "string"), "src/index", "index");
    const rels = cands.flatMap((c) => sourceVariants(c)).map((v) => posix.normalize(posix.join(ws.dir, v)));
    // A real file that isn't analyzed source (Calendar.d.ts, a test helper) is skipped by the caller
    // like any other non-source local import, rather than reported as unresolved.
    const found = rels.find((r) => this.sources.has(r))
      ?? rels.flatMap((r) => [r, r.replace(/\.[cm]?[jt]sx?$/, ".d.ts")]).find((r) => this.host.fileExists(join(this.root, r)))
      ?? null;
    this.wsCache.set(spec, found);
    return found;
  }

  /** Compiler options from the nearest tsconfig/jsconfig at or above the file, within the repo. */
  private optionsFor(absFile: string): TS.CompilerOptions {
    let dir = dirname(absFile);
    const chain: string[] = [];
    let found: TS.CompilerOptions | undefined;
    while (true) {
      const hit = this.optionsByDir.get(dir);
      if (hit) { found = hit; break; }
      chain.push(dir);
      const cfg = ["tsconfig.json", "jsconfig.json"].map((n) => join(dir, n)).find((p) => this.host.fileExists(p));
      if (cfg) { found = this.load(cfg); break; }
      if (dir === this.root || !dir.startsWith(this.root)) break;
      dir = dirname(dir);
    }
    found ??= { allowJs: true, moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, resolveJsonModule: true };
    for (const d of chain) this.optionsByDir.set(d, found);
    return found;
  }

  private load(cfgPath: string): TS.CompilerOptions {
    const read = ts.readConfigFile(cfgPath, (f) => this.host.readFile(f));
    const parsed = ts.parseJsonConfigFileContent(read.config ?? {}, this.configHost, dirname(cfgPath), undefined, cfgPath);
    const o = { ...parsed.options, allowJs: true, resolveJsonModule: true, noEmit: true };
    // Old "node" resolution can't see package exports maps; it's fine for local files though.
    o.moduleResolution ??= ts.ModuleResolutionKind.Bundler;
    if (o.moduleResolution === ts.ModuleResolutionKind.Bundler && (o.module === undefined || o.module === ts.ModuleKind.CommonJS)) o.module = ts.ModuleKind.ESNext;
    return o;
  }

  /**
   * Returns a repo-relative path for local files, { external } for packages, or null if unresolved.
   */
  resolve(spec: string, fromRel: string): { file: string } | { external: string } | null {
    // a workspace package that can't be traced to source is unresolved, never a third-party external
    if (this.workspaces.has(packageName(spec))) {
      const file = this.resolveWorkspace(spec);
      return file ? { file } : null;
    }
    const abs = join(this.root, fromRel);
    const key = `${dirname(abs)}\0${spec}`;
    let r = this.cache.get(key);
    if (!this.cache.has(key)) {
      r = ts.resolveModuleName(spec, abs, this.optionsFor(abs), this.host).resolvedModule;
      this.cache.set(key, r);
    }
    const bare = !spec.startsWith(".") && !spec.startsWith("/");
    if (r && !r.isExternalLibraryImport && !r.resolvedFileName.includes(`${sep}node_modules${sep}`)) {
      const rel = relative(this.root, r.resolvedFileName).split(sep).join("/");
      if (!rel.startsWith("..")) return { file: rel };
    }
    // Unresolved alias-looking specifiers ("@/x", "~/x", "#x") are local, not packages.
    if (!bare || /^(@\/|~|#)/.test(spec)) return null;
    if (spec.startsWith("node:") || builtinModules.includes(packageName(spec))) return { external: `node:${spec.replace(/^node:/, "")}` };
    return { external: packageName(spec) };
  }
}

// Prefer conditions that point at source; "types" last since it usually names built .d.ts output.
const CONDITIONS = ["source", "development", "import", "module", "default", "node", "browser", "require", "types"];

/** Targets in a package.json `exports` map for a subpath ("." or "./button"), most source-like first. */
export function exportTargets(exp: unknown, subpath: string): string[] {
  if (exp == null) return [];
  const isMap = typeof exp === "object" && !Array.isArray(exp) && Object.keys(exp).some((k) => k.startsWith("."));
  let target: unknown;
  if (!isMap) target = subpath === "." ? exp : undefined;
  else {
    const map = exp as Record<string, unknown>;
    if (subpath in map) target = map[subpath];
    else {
      // longest matching "./*" pattern wins, as in Node
      const pats = Object.keys(map).filter((k) => k.includes("*")).sort((a, b) => b.length - a.length);
      for (const k of pats) {
        const [pre, post] = k.split("*");
        if (subpath.startsWith(pre) && subpath.endsWith(post) && subpath.length >= pre.length + post.length) {
          const star = subpath.slice(pre.length, subpath.length - post.length);
          target = JSON.parse(JSON.stringify(map[k]).replaceAll("*", star));
          break;
        }
      }
    }
  }
  const out: string[] = [];
  const flat = (t: unknown) => {
    if (typeof t === "string") out.push(t);
    else if (Array.isArray(t)) t.forEach(flat);
    else if (t && typeof t === "object") {
      const o = t as Record<string, unknown>;
      const keys = Object.keys(o).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
      for (const k of keys) flat(o[k]);
    }
  };
  const rank = (k: string) => (CONDITIONS.includes(k) ? CONDITIONS.indexOf(k) : CONDITIONS.length - 1.5);
  flat(target);
  return [...new Set(out)];
}

const SRC_EXTS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

/** Paths a package entry might have in source: as written, with dist/ -> src/, and with source extensions. */
export function sourceVariants(entry: string): string[] {
  const p = entry.replace(/^\.\//, "");
  const bases = [p];
  const fromBuild = p.replace(/^(dist|build|lib|out|esm|cjs)\//, "src/");
  if (fromBuild !== p) bases.push(fromBuild);
  const out: string[] = [];
  for (const b of bases) {
    out.push(b);
    const stem = b.replace(/\.d\.[cm]?ts$|\.[cm]?[jt]sx?$/, "");
    for (const e of SRC_EXTS) out.push(stem + e);
    for (const e of SRC_EXTS) out.push(`${stem}/index${e}`);
  }
  return [...new Set(out)];
}

export function packageName(spec: string): string {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}
