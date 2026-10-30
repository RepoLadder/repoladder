import type TS from "typescript";
import { createRequire } from "node:module";
import { posix } from "node:path";
import type { Package, Page } from "../model/schema.ts";
import { appRoute, nextRoots, pagesRoute } from "./nextjs.ts";

let ts: typeof TS;
const loadTs = () => (ts ??= createRequire(import.meta.url)("typescript"));

export interface PageContext {
  sourcePaths: string[];
  packages: Package[];
  read(path: string): string;
  /** Repo-local file a specifier resolves to from a file, or null (external, asset, missing). */
  resolveLocal(spec: string, from: string): string | null;
}

// Cheap text filter so only files that could declare routes get a second parse.
const ROUTER_HINT = /<\w*Route\b|create(Browser|Hash|Memory|Static)Router|useRoutes|createRoutesFromElements|createFileRoute|\bpath\s*:/;

/** Pages users can navigate to: client router declarations plus Next.js file conventions (and `files`, other file-convention pages). */
export function detectPages(cx: PageContext, files: Page[] = []): Page[] {
  const pages: Page[] = [];
  const mods = new Modules(cx);
  for (const p of cx.sourcePaths) {
    if (!/\.[cm]?[jt]sx?$/.test(p)) continue;
    const text = cx.read(p);
    if (!ROUTER_HINT.test(text)) continue;
    pages.push(...routerPages(p, mods));
  }
  pages.push(...nextPages(cx), ...files);
  const seen = new Set<string>();
  return pages
    .filter((pg) => {
      const k = `${pg.route}\0${pg.file}\0${pg.from}`;
      return seen.has(k) ? false : (seen.add(k), true);
    })
    .sort((a, b) => a.from.localeCompare(b.from) || a.line - b.line || a.route.localeCompare(b.route) || a.file.localeCompare(b.file));
}

// ---------------------------------------------------------------- client routers

interface Decl {
  /** `const X = lazy(() => import('./X'))`: the dynamically imported spec. */
  lazySpec?: string;
  /** `const X = '/path'` or an object of string constants. */
  str?: string;
  obj?: Map<string, string>;
}
interface Mod {
  sf: TS.SourceFile;
  decls: Map<string, Decl>;
  /** local name -> where it was imported from */
  imports: Map<string, { spec: string; name: string }>;
  /** exported name -> local name (`export { a as b }`) */
  localExports: Map<string, string>;
  reexports: { spec: string; names: Map<string, string> | null }[];
}

/** Lazily parsed modules, so component and constant lookups can follow imports across files. */
class Modules {
  private cache = new Map<string, Mod>();
  cx: PageContext;
  constructor(cx: PageContext) {
    this.cx = cx;
    loadTs();
  }

  get(path: string): Mod {
    let m = this.cache.get(path);
    if (m) return m;
    const kind = /\.[cm]?tsx$|\.jsx$/.test(path) ? ts.ScriptKind.TSX : /\.[cm]?ts$/.test(path) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
    const sf = ts.createSourceFile(path, this.cx.read(path), ts.ScriptTarget.Latest, true, kind);
    m = { sf, decls: new Map(), imports: new Map(), localExports: new Map(), reexports: [] };
    for (const st of sf.statements) {
      if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.importClause) {
        const c = st.importClause, spec = st.moduleSpecifier.text;
        if (c.name) m.imports.set(c.name.text, { spec, name: "default" });
        if (c.namedBindings && ts.isNamedImports(c.namedBindings)) {
          for (const el of c.namedBindings.elements) m.imports.set(el.name.text, { spec, name: (el.propertyName ?? el.name).text });
        }
      } else if (ts.isExportDeclaration(st)) {
        const named = st.exportClause && ts.isNamedExports(st.exportClause)
          ? new Map(st.exportClause.elements.map((e) => [e.name.text, (e.propertyName ?? e.name).text]))
          : null;
        if (st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) m.reexports.push({ spec: st.moduleSpecifier.text, names: named });
        else if (named) for (const [exp, local] of named) m.localExports.set(exp, local);
      } else if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          if (!ts.isIdentifier(d.name)) continue;
          m.decls.set(d.name.text, declOf(d.initializer));
          if (isExported(st)) m.localExports.set(d.name.text, d.name.text);
        }
      } else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) {
        m.decls.set(st.name.text, {});
        if (isExported(st)) m.localExports.set(isDefault(st) ? "default" : st.name.text, st.name.text);
      } else if (ts.isExportAssignment(st) && ts.isIdentifier(st.expression)) {
        m.localExports.set("default", st.expression.text);
      }
    }
    this.cache.set(path, m);
    return m;
  }

  /** The module and local name that define `name` as seen from `file`, following imports and re-exports. */
  find(file: string, name: string, depth = 0): { file: string; local: string } | null {
    if (depth > 8) return null;
    const m = this.get(file);
    if (m.decls.has(name)) return { file, local: name };
    const imp = m.imports.get(name);
    if (!imp) return null;
    const target = this.cx.resolveLocal(imp.spec, file);
    return target ? this.findExport(target, imp.name, depth + 1) : null;
  }

  findExport(file: string, exported: string, depth: number): { file: string; local: string } | null {
    if (depth > 8) return null;
    const m = this.get(file);
    const local = m.localExports.get(exported);
    if (local) return this.find(file, local, depth) ?? { file, local };
    if (exported === "default") return { file, local: "default" };
    for (const re of m.reexports) {
      const inner = re.names ? re.names.get(exported) : exported;
      if (!inner) continue;
      const target = this.cx.resolveLocal(re.spec, file);
      const hit = target && this.findExport(target, inner, depth + 1);
      if (hit) return hit;
    }
    return null;
  }

  /** File that holds a component referenced by identifier, following lazy(() => import()) wrappers. */
  componentFile(file: string, name: string): string | null {
    const hit = this.find(file, name);
    if (!hit) return null;
    const d = this.get(hit.file).decls.get(hit.local);
    if (d?.lazySpec) return this.cx.resolveLocal(d.lazySpec, hit.file);
    return hit.file;
  }

  /** A route path written as a literal, a constant, or `PATHS.key`. */
  pathOf(file: string, e: TS.Expression | undefined): string | null {
    if (!e) return null;
    if (ts.isStringLiteralLike(e)) return e.text;
    if (ts.isIdentifier(e)) {
      const hit = this.find(file, e.text);
      return (hit && this.get(hit.file).decls.get(hit.local)?.str) ?? null;
    }
    if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression)) {
      const hit = this.find(file, e.expression.text);
      return (hit && this.get(hit.file).decls.get(hit.local)?.obj?.get(e.name.text)) ?? null;
    }
    return null;
  }
}

const isExported = (st: TS.Statement) => !!ts.getModifiers(st as TS.HasModifiers)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
const isDefault = (st: TS.Statement) => !!ts.getModifiers(st as TS.HasModifiers)?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);

function declOf(init: TS.Expression | undefined): Decl {
  if (!init) return {};
  while (ts.isAsExpression(init) || ts.isSatisfiesExpression(init) || ts.isParenthesizedExpression(init)) init = init.expression;
  if (ts.isStringLiteralLike(init)) return { str: init.text };
  if (ts.isObjectLiteralExpression(init)) {
    const obj = new Map<string, string>();
    for (const p of init.properties) if (ts.isPropertyAssignment(p) && propName(p) && ts.isStringLiteralLike(p.initializer)) obj.set(propName(p)!, p.initializer.text);
    return obj.size ? { obj } : {};
  }
  // lazy(() => import('./X')), lazyWithRetry(...), cond ? lazy(...) : null — any initializer with one dynamic import
  const specs = dynamicImports(init);
  return specs.length === 1 ? { lazySpec: specs[0] } : {};
}

function dynamicImports(n: TS.Node): string[] {
  const out: string[] = [];
  const visit = (x: TS.Node) => {
    if (ts.isCallExpression(x) && x.expression.kind === ts.SyntaxKind.ImportKeyword && x.arguments[0] && ts.isStringLiteralLike(x.arguments[0])) out.push(x.arguments[0].text);
    ts.forEachChild(x, visit);
  };
  visit(n);
  return out;
}

const propName = (p: TS.ObjectLiteralElementLike): string | null =>
  p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null;

/** Joins a child route onto its parent the way React Router does: absolute children stand alone. */
function joinRoute(parent: string, child: string | null): string {
  if (child === null) return parent || "/";
  if (child.startsWith("/")) return child;
  const base = parent.endsWith("/") ? parent : `${parent}/`;
  return posix.normalize(`${base || "/"}${child}`).replace(/(.)\/$/, "$1");
}

function routerPages(file: string, mods: Modules): Page[] {
  const m = mods.get(file);
  const sf = m.sf;
  const out: Page[] = [];
  const lineOf = (n: TS.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  /** The page component inside an element: the innermost local component (wrappers like guards sit outside it). */
  const fromElement = (e: TS.Expression | undefined): { file: string; component?: string } | null => {
    if (!e) return null;
    const tags: { name: string; depth: number }[] = [];
    const visit = (x: TS.Node, depth: number) => {
      if (ts.isJsxElement(x) || ts.isJsxSelfClosingElement(x)) {
        const tag = ts.isJsxElement(x) ? x.openingElement.tagName : x.tagName;
        if (ts.isIdentifier(tag) && /^[A-Z]/.test(tag.text)) tags.push({ name: tag.text, depth });
        depth++;
      }
      ts.forEachChild(x, (c) => visit(c, depth));
    };
    visit(e, 0);
    if (ts.isIdentifier(e)) tags.push({ name: e.text, depth: 0 }); // Component={Page} / component={Page}
    // deepest first; among equals, the first written
    tags.sort((a, b) => b.depth - a.depth);
    for (const t of tags) {
      const f = mods.componentFile(file, t.name);
      if (f) return { file: f, component: t.name };
    }
    return null;
  };
  const fromLazy = (e: TS.Expression | undefined): { file: string } | null => {
    if (!e) return null;
    for (const spec of dynamicImports(e)) {
      const f = mods.cx.resolveLocal(spec, file);
      if (f) return { file: f };
    }
    return null;
  };
  const push = (route: string, target: { file: string; component?: string } | null, at: TS.Node) => {
    if (!target) return;
    out.push({ route, file: target.file, ...(target.component ? { component: target.component } : {}), from: file, line: lineOf(at) });
  };

  // <Route path="x" element={<X/>}> … </Route>, plus v5-style <PrivateRoute path component={X}>
  const jsxAttr = (el: TS.JsxOpeningLikeElement, name: string): TS.JsxAttribute | undefined =>
    el.attributes.properties.find((a): a is TS.JsxAttribute => ts.isJsxAttribute(a) && ts.isIdentifier(a.name) && a.name.text === name);
  const attrExpr = (a: TS.JsxAttribute | undefined): TS.Expression | undefined =>
    !a?.initializer ? undefined : ts.isJsxExpression(a.initializer) ? a.initializer.expression : (a.initializer as TS.Expression);
  const routeEl = (n: TS.Node): TS.JsxOpeningLikeElement | null => {
    if (!ts.isJsxElement(n) && !ts.isJsxSelfClosingElement(n)) return null;
    const el = ts.isJsxElement(n) ? n.openingElement : n;
    const tag = ts.isIdentifier(el.tagName) ? el.tagName.text : "";
    return tag === "Route" || (/Route$/.test(tag) && (jsxAttr(el, "path") || jsxAttr(el, "index"))) ? el : null;
  };
  /** Nested routes directly under a route (possibly inside `{cond && …}`), not their descendants. */
  const childRoutes = (n: TS.Node): TS.JsxOpeningLikeElement[] => {
    const out: TS.JsxOpeningLikeElement[] = [];
    const visit = (x: TS.Node) => {
      const r = routeEl(x);
      if (r) out.push(r);
      else ts.forEachChild(x, visit);
    };
    if (ts.isJsxElement(n)) n.children.forEach(visit);
    return out;
  };
  const visitJsx = (n: TS.Node, parent: string) => {
    const el = routeEl(n);
    if (el) {
      const pathAttr = jsxAttr(el, "path"), index = !!jsxAttr(el, "index");
      const raw = pathAttr ? mods.pathOf(file, attrExpr(pathAttr)) : null;
      if (pathAttr && raw === null) return; // computed path we can't read: don't guess
      const route = joinRoute(parent, raw);
      // A parent whose index child fills its path is a layout around pages, not a page itself.
      const layout = childRoutes(n).some((c) => jsxAttr(c, "index"));
      if ((raw !== null || index) && !layout) {
        const target = fromElement(attrExpr(jsxAttr(el, "element")))
          ?? fromElement(attrExpr(jsxAttr(el, "Component")) ?? attrExpr(jsxAttr(el, "component")))
          ?? fromLazy(attrExpr(jsxAttr(el, "lazy")));
        push(route, target, el);
      }
      if (ts.isJsxElement(n)) for (const c of n.children) visitJsx(c, route);
      return;
    }
    ts.forEachChild(n, (c) => visitJsx(c, parent));
  };

  // [{ path, element | Component | lazy, children }] objects
  const isRouteObject = (o: TS.ObjectLiteralExpression) => {
    const keys = new Set(o.properties.map(propName));
    return (keys.has("path") || keys.has("index")) && (keys.has("element") || keys.has("Component") || keys.has("component") || keys.has("lazy") || keys.has("children"));
  };
  const visitObjects = (arr: TS.ArrayLiteralExpression, parent: string) => {
    for (const el of arr.elements) {
      if (!ts.isObjectLiteralExpression(el) || !isRouteObject(el)) continue;
      const prop = (k: string) => {
        const p = el.properties.find((x) => propName(x) === k);
        return p && ts.isPropertyAssignment(p) ? p.initializer : undefined;
      };
      const pathE = prop("path");
      const raw = pathE ? mods.pathOf(file, pathE) : null;
      if (pathE && raw === null) continue;
      const route = joinRoute(parent, raw);
      const target = fromElement(prop("element")) ?? fromElement(prop("Component") ?? prop("component")) ?? fromLazy(prop("lazy"));
      const kids = prop("children");
      const layout = !!kids && ts.isArrayLiteralExpression(kids) && kids.elements.some((k) => ts.isObjectLiteralExpression(k) && k.properties.some((x) => propName(x) === "index"));
      if ((raw !== null || prop("index")) && !layout) push(route, target, el);
      if (kids && ts.isArrayLiteralExpression(kids)) visitObjects(kids, route);
    }
  };
  // A route array is a root when it isn't some route object's `children`.
  const visitArrays = (n: TS.Node) => {
    if (ts.isArrayLiteralExpression(n) && n.elements.some((e) => ts.isObjectLiteralExpression(e) && isRouteObject(e))) {
      const p = n.parent;
      const isChildren = ts.isPropertyAssignment(p) && propName(p) === "children" && ts.isObjectLiteralExpression(p.parent) && isRouteObject(p.parent);
      if (!isChildren) { visitObjects(n, ""); return; }
    }
    ts.forEachChild(n, visitArrays);
  };

  // TanStack Router: export const Route = createFileRoute('/posts/$id')({ component })
  const visitTanstack = (n: TS.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "createFileRoute" && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0])) {
      const opts = ts.isCallExpression(n.parent) && n.parent.expression === n ? n.parent.arguments[0] : undefined;
      const props = opts && ts.isObjectLiteralExpression(opts) ? opts.properties : undefined;
      const comp = props?.find((x) => propName(x) === "component");
      // TanStack Start API routes ({ server: { handlers } }, no component) answer requests; nobody sees them
      if (!comp && props?.some((x) => propName(x) === "server")) return ts.forEachChild(n, visitTanstack);
      const target = comp && ts.isPropertyAssignment(comp) ? fromElement(comp.initializer) : null;
      push(n.arguments[0].text, target ?? { file }, n);
    }
    ts.forEachChild(n, visitTanstack);
  };

  visitJsx(sf, "");
  visitArrays(sf);
  visitTanstack(sf);
  return out;
}

// ---------------------------------------------------------------- Next.js file conventions
// Only pages here; route handlers, server actions, layouts and middleware are in nextjs.ts.

const PAGE_EXT = /\.(tsx|jsx|ts|js|mdx)$/;

export function nextPages(cx: Pick<PageContext, "sourcePaths" | "packages">): Page[] {
  const out: Page[] = [];
  for (const { appDir, pagesDir } of nextRoots(cx.packages)) {
    for (const f of cx.sourcePaths) {
      if (f.startsWith(appDir)) {
        const rest = f.slice(appDir.length);
        if (!/(^|\/)page\.[jt]sx?$/.test(rest)) continue;
        const route = appRoute(rest.split("/").slice(0, -1));
        if (route !== null) out.push({ route, file: f, from: f, line: 1 });
      } else if (f.startsWith(pagesDir)) {
        const rest = f.slice(pagesDir.length).replace(PAGE_EXT, "");
        if (rest.startsWith("api/") || /^_(app|document|error)$/.test(rest)) continue;
        out.push({ route: pagesRoute(rest), file: f, from: f, line: 1 });
      }
    }
  }
  return out;
}
