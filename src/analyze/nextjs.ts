import type TS from "typescript";
import { createRequire } from "node:module";
import type { Endpoint, Package, RouteFile } from "../model/schema.ts";
import { sortMethods } from "../model/endpoints.ts";

/**
 * Next.js file conventions: route handlers and `pages/api` as http endpoints, server actions,
 * layout/loading/error files and middleware. Pages themselves are detected in pages.ts (`nextPages`),
 * which shares the segment rules below.
 */

let ts: typeof TS;
const loadTs = () => (ts ??= createRequire(import.meta.url)("typescript"));

export interface NextRoot {
  /** Package root, "" or "dir/". */
  base: string;
  /** "app/" or "src/app/", relative to the repo. */
  appDir: string;
  pagesDir: string;
}

/** Where routes can live in each package that depends on `next`. */
export function nextRoots(packages: Package[]): NextRoot[] {
  const out: NextRoot[] = [];
  for (const pkg of packages) {
    if (!pkg.deps.includes("next")) continue;
    const base = pkg.dir ? `${pkg.dir}/` : "";
    for (const src of ["", "src/"]) out.push({ base, appDir: `${base}${src}app/`, pagesDir: `${base}${src}pages/` });
  }
  return out;
}

/**
 * URL of an app-router folder (the path under app/, without the file name), or null when the folder
 * opts out of routing. (groups) and @parallel slots aren't part of the URL.
 */
export function appRoute(dirs: string[]): string | null {
  if (dirs.some((s) => s.startsWith("_"))) return null; // _private folders
  return `/${dirs.filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith("@")).join("/")}`;
}

/** URL of a pages-router file (path under pages/, extension stripped). */
export function pagesRoute(rest: string): string {
  const route = `/${rest.replace(/(^|\/)index$/, "")}`;
  return route.length > 1 ? route.replace(/\/$/, "") : "/";
}

const SCRIPT = /\.[cm]?[jt]sx?$/;
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const SPECIAL = new Set(["layout", "loading", "error", "global-error", "not-found", "template", "default"]);

/** `"use client"` / `"use server"` at the top of a module: the React server/client boundary. */
export function directiveOf(text: string): "client" | "server" | null {
  // one left-to-right pass over whitespace and comments; every step moves the cursor forward, so cost is O(n)
  let i = 0;
  for (;;) {
    if (i >= text.length) return null;
    if (/\s/.test(text[i])) i++;
    else if (text.startsWith("//", i)) {
      const nl = text.indexOf("\n", i + 2);
      if (nl < 0) return null;
      i = nl + 1;
    } else if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      if (end < 0) return null;
      i = end + 2;
    } else break;
  }
  const q = text[i];
  if (q !== "'" && q !== '"') return null;
  if (text.startsWith(`use client${q}`, i + 1)) return "client";
  if (text.startsWith(`use server${q}`, i + 1)) return "server";
  return null;
}

export interface NextContext {
  sourcePaths: string[];
  packages: Package[];
  read(path: string): string;
}

export interface NextFacts {
  /** Route handlers, `pages/api` handlers and server actions. */
  endpoints: Endpoint[];
  routeFiles: RouteFile[];
}

export function detectNext(cx: NextContext): NextFacts {
  loadTs();
  const endpoints: Endpoint[] = [];
  const routeFiles: RouteFile[] = [];
  const roots = nextRoots(cx.packages);
  const handled = new Set<string>();

  for (const { base, appDir, pagesDir } of roots) {
    for (const f of cx.sourcePaths) {
      if (!SCRIPT.test(f) || handled.has(f)) continue;
      if (f.startsWith(appDir)) {
        const parts = f.slice(appDir.length).split("/");
        const name = parts.pop()!.replace(SCRIPT, "");
        const route = appRoute(parts);
        if (route === null) continue;
        if (name === "route") {
          handled.add(f);
          // a bare "/" would suffix-match every URL
          if (route !== "/") {
            const ex = topExports(parse(f, cx.read(f)));
            const methods = sortMethods(ex.map((e) => e.name).filter((n) => HTTP_METHODS.has(n)));
            endpoints.push({ name: route, file: f, line: handlerLineOf(ex), kind: "http", ...(methods.length ? { methods } : {}) });
          }
        } else if (SPECIAL.has(name)) {
          handled.add(f);
          routeFiles.push({ route, file: f, role: name as RouteFile["role"] });
        }
      } else if (f.startsWith(`${pagesDir}api/`)) {
        handled.add(f);
        const route = pagesRoute(f.slice(pagesDir.length).replace(SCRIPT, ""));
        endpoints.push({ name: route, file: f, line: handlerLine(f, cx.read(f)), kind: "http" });
      } else if (/^(src\/)?middleware\.[jt]s$/.test(f.slice(base.length)) && f.startsWith(base)) {
        handled.add(f);
        routeFiles.push({ route: middlewareMatcher(f, cx.read(f)), file: f, role: "middleware" });
      }
    }
  }

  // Server actions work in any React server setup, not only Next.js.
  for (const f of cx.sourcePaths) {
    if (!SCRIPT.test(f)) continue;
    const text = cx.read(f);
    if (!/['"]use server['"]/.test(text)) continue;
    for (const a of serverActions(f, text)) endpoints.push({ name: a.name, file: f, line: a.line, kind: "action" });
  }

  endpoints.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.name.localeCompare(b.name));
  routeFiles.sort((a, b) => a.route.localeCompare(b.route) || a.file.localeCompare(b.file));
  return { endpoints, routeFiles };
}

function parse(path: string, text: string): TS.SourceFile {
  const kind = /\.[cm]?tsx$|\.jsx$/.test(path) ? ts.ScriptKind.TSX : /\.[cm]?ts$/.test(path) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
}
const lineOf = (sf: TS.SourceFile, n: TS.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
const hasMod = (n: TS.Node, k: TS.SyntaxKind) => !!(ts.canHaveModifiers(n) && ts.getModifiers(n)?.some((m) => m.kind === k));

/** Top-level exports with their lines: `export function a`, `export const a`, `export { b as a }`, `export default`. */
function topExports(sf: TS.SourceFile): { name: string; local: string; line: number; node: TS.Node }[] {
  const out: { name: string; local: string; line: number; node: TS.Node }[] = [];
  for (const st of sf.statements) {
    const exp = hasMod(st, ts.SyntaxKind.ExportKeyword);
    const def = hasMod(st, ts.SyntaxKind.DefaultKeyword);
    if (exp && ts.isFunctionDeclaration(st)) {
      out.push({ name: def ? "default" : st.name?.text ?? "default", local: st.name?.text ?? "default", line: lineOf(sf, st), node: st });
    } else if (exp && ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) out.push({ name: d.name.text, local: d.name.text, line: lineOf(sf, d), node: d });
    } else if (ts.isExportDeclaration(st) && !st.moduleSpecifier && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const e of st.exportClause.elements) out.push({ name: e.name.text, local: (e.propertyName ?? e.name).text, line: lineOf(sf, e), node: e });
    } else if (ts.isExportAssignment(st) && !st.isExportEquals) {
      out.push({ name: "default", local: ts.isIdentifier(st.expression) ? st.expression.text : "default", line: lineOf(sf, st), node: st });
    }
  }
  return out;
}

/** Top-level export names with their lines, for other file conventions (React Router route modules). */
export function exportsOf(path: string, text: string): { name: string; line: number }[] {
  loadTs();
  const sf = parse(path, text);
  const out = topExports(sf).map(({ name, line }) => ({ name, line }));
  // `export { action } from "./x.server"`: the module still exports it
  for (const st of sf.statements) {
    if (!ts.isExportDeclaration(st) || !st.moduleSpecifier || st.isTypeOnly || !st.exportClause || !ts.isNamedExports(st.exportClause)) continue;
    for (const e of st.exportClause.elements) if (!e.isTypeOnly) out.push({ name: e.name.text, line: lineOf(sf, e) });
  }
  return out.sort((a, b) => a.line - b.line);
}

/** Line of the first exported HTTP method (`export async function GET`), else the default export, else 1. */
function handlerLine(path: string, text: string): number {
  return handlerLineOf(topExports(parse(path, text)));
}
function handlerLineOf(ex: { name: string; line: number }[]): number {
  return (ex.find((e) => HTTP_METHODS.has(e.name)) ?? ex.find((e) => e.name === "default"))?.line ?? 1;
}

/** `export const config = { matcher: [...] }`; middleware without one runs on every route. */
function middlewareMatcher(path: string, text: string): string {
  const sf = parse(path, text);
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || d.name.text !== "config" || !d.initializer || !ts.isObjectLiteralExpression(d.initializer)) continue;
      for (const p of d.initializer.properties) {
        if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name) || p.name.text !== "matcher") continue;
        const v = p.initializer;
        const list: readonly TS.Expression[] = ts.isArrayLiteralExpression(v) ? v.elements : [v];
        const lits = list.flatMap((e) => (ts.isStringLiteralLike(e) ? [e.text] : []));
        if (lits.length) return lits.join(", ");
      }
    }
  }
  return "/:path*";
}

const fnBody = (n: TS.Node | undefined): TS.Block | null => {
  if (!n) return null;
  if ((ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n)) && n.body && ts.isBlock(n.body)) return n.body;
  return null;
};
const usesServer = (b: TS.Block | null) =>
  !!b && b.statements.length > 0 && ts.isExpressionStatement(b.statements[0]) && ts.isStringLiteral(b.statements[0].expression) && b.statements[0].expression.text === "use server";

/**
 * Server actions: every exported function of a `"use server"` module, plus named functions whose body
 * starts with `"use server"` (inline actions).
 */
export function serverActions(path: string, text: string): { name: string; line: number }[] {
  loadTs();
  const sf = parse(path, text);
  const out: { name: string; line: number }[] = [];
  if (directiveOf(text) === "server") {
    const locals = new Map<string, TS.Node>();
    for (const st of sf.statements) {
      if (ts.isFunctionDeclaration(st) && st.name) locals.set(st.name.text, st);
      else if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) locals.set(d.name.text, d);
    }
    for (const e of topExports(sf)) {
      const decl = ts.isExportSpecifier(e.node) || ts.isExportAssignment(e.node) ? locals.get(e.local) ?? e.node : e.node;
      let fn: TS.Node | undefined = decl && ts.isVariableDeclaration(decl) ? decl.initializer : decl;
      if (fn && ts.isExportAssignment(fn)) fn = fn.expression;
      // functions, or wrapped ones like `withAuth(async () => …)`; never plain values
      if (fn && (ts.isFunctionDeclaration(fn) || ts.isArrowFunction(fn) || ts.isFunctionExpression(fn) || ts.isCallExpression(fn))) out.push({ name: e.name, line: e.line });
    }
    return out;
  }
  const visit = (n: TS.Node) => {
    if (usesServer(fnBody(n))) {
      const name = ts.isFunctionDeclaration(n) && n.name ? n.name.text
        : ts.isVariableDeclaration(n.parent) && ts.isIdentifier(n.parent.name) ? n.parent.name.text
        : ts.isMethodDeclaration(n) && ts.isIdentifier(n.name) ? n.name.text : null;
      if (name) out.push({ name, line: lineOf(sf, n) });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}
