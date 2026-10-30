import type TS from "typescript";
import { createRequire } from "node:module";
import { posix } from "node:path";
import type { Endpoint, Package, Page, RouteFile } from "../model/schema.ts";
import { exportsOf } from "./nextjs.ts";
import { sortMethods } from "../model/endpoints.ts";

/**
 * React Router (framework mode) and Remix file routes under `app/routes/`. A route module with a
 * default export is a page (its `action` also an http POST endpoint, reached only by form posts); one with only a `loader` or `action` is a resource route, an http
 * endpoint; pathless layouts (`_auth.tsx`, `_layout.tsx`) are layout route files.
 *
 * Four file conventions, told apart by `app/routes.ts` (or, for Remix without one, its config and the shape of `routes/`):
 * - "flat" (`@react-router/fs-routes`, Remix v2): dot-delimited files, plus one-level folders whose
 *   `route`/`index` file is the module (`users.$id/route.tsx`).
 * - "hybrid" (`remix-flat-routes`): flat, and a folder ending in `+` adds its name to the file's
 *   (`users+/$username.tsx` is `users.$username`).
 * - "auto" (`react-router-auto-routes`): folders nest like dots, `index` is the folder's index route
 *   and `_layout` its layout.
 * - "nested" (Remix v1, no `routes.ts`): folders nest like dots, `index` is the folder's index route,
 *   `__name.tsx`/`__name/` is a pathless layout, and a parent `name.tsx` beside `name/` is reported as a
 *   page. v1 is told from the folder shape (`nestedShape`) because config and versions aren't visible.
 *   Known ambiguity: an app of plain top-level files gives the same URLs under either rule and is read
 *   as flat (so a v1 root `index.tsx` reads as `/index`).
 * In every convention `+name` folders and files are colocated code, not routes.
 *
 * A `routes.ts` that lists routes by hand (`route`/`index`/`layout`/`prefix` from
 * `@react-router/dev/routes`) is read literally, with the TypeScript AST: each referenced module is
 * classified the same way, wherever it lives under the app directory. Computed routes (`.map`,
 * helper wrappers, non-literal paths) are skipped. When the file also uses `flatRoutes`/`autoRoutes`/
 * the adapter, both are read, and a module the file convention reports isn't reported twice.
 */

let ts: typeof TS;
const loadTs = () => (ts ??= createRequire(import.meta.url)("typescript"));

export type Convention = "flat" | "hybrid" | "auto" | "nested";

export interface RemixContext {
  sourcePaths: string[];
  packages: Package[];
  read(path: string): string;
}

export interface RemixFacts {
  pages: Page[];
  endpoints: Endpoint[];
  routeFiles: RouteFile[];
  /** page modules' actions (#295): also in `endpoints`; only form posts reach them */
  pageActions: Endpoint[];
}

const SCRIPT = /\.[cm]?[jt]sx?$/;
// `routes.ts` that maps files (alone or beside hand-listed routes)
const FILE_ROUTES = /flatRoutes|autoRoutes|remixRoutesOptionAdapter/;

export interface RemixRoot {
  routesDir: string;
  convention: Convention | null;
  /** Repo-relative app directory, no trailing slash. */
  appPath: string;
  routesFile?: string;
}

/**
 * Remix v1's nested route folders (#328), told from the shape of `routes/` alone: neither its config
 * (`remix.config.js` is not app source) nor dependency versions (v1 apps often pin "*") reach us.
 * `rels`: script paths under `routes/`, without their extension.
 */
function nestedShape(rels: string[]): boolean {
  const live = rels.map((r) => r.split("/")).filter((parts) => {
    const name = parts[parts.length - 1];
    return !parts.some((p) => p.startsWith("+") || p.endsWith("+")) && !name.startsWith(".") && !/\.(server|client|test|spec)$/.test(name);
  });
  // v2 only: a folder's `route` module or an `_index` route (v1 would read either as a literal URL segment)
  if (live.some((parts) => parts[parts.length - 1] === "route" || parts.some((s) => s === "_index" || s.endsWith("._index")))) return false;
  const dirs = new Set(live.flatMap((parts) => parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"))));
  return live.some((parts) =>
    dirs.has(parts.join("/")) || // a parent route beside its folder: notes.tsx and notes/
    parts.slice(0, -1).some((d) => d.startsWith("__")) || // a v1 pathless layout folder: __auth/
    parts.length > 2 || // folders nested in folders
    (parts.length === 2 && !/^(index|_layout)$/.test(parts[1]))); // a folder holding routes other than its index
}

/** Where routes live in each React Router / Remix app, and which convention names them (null: hand-listed only). */
export function remixRoots(cx: RemixContext): RemixRoot[] {
  const have = new Set(cx.sourcePaths);
  const out: RemixRoot[] = [];
  for (const pkg of cx.packages) {
    const base = pkg.dir ? `${pkg.dir}/` : "";
    const find = (names: string[]) => names.map((n) => base + n).find((p) => have.has(p));
    const rrConfig = find(["react-router.config.ts", "react-router.config.js"]);
    const appDir = (rrConfig && /appDirectory\s*:\s*["'`]([^"'`]+)/.exec(cx.read(rrConfig))?.[1]?.replace(/^\.\/|\/$/g, "")) || "app";
    const routesFile = find([`${appDir}/routes.ts`, `${appDir}/routes.js`, `${appDir}/routes.mts`]);
    const appPath = `${base}${appDir}`;
    const routesDir = `${appPath}/routes/`;
    let convention: Convention | null;
    if (routesFile) {
      const text = cx.read(routesFile);
      if (!FILE_ROUTES.test(text)) convention = null; // routes listed by hand: no file convention
      else convention = /react-router-auto-routes|autoRoutes/.test(text) ? "auto" : /remix-flat-routes/.test(text) ? "hybrid" : "flat";
    } else {
      // Remix v1 or v2 routes without a routes.ts (React Router 7 needs one): v1's nested folders are told from the folder shape
      if (!pkg.deps.some((d) => d.startsWith("@remix-run/"))) continue;
      const config = find(["vite.config.ts", "vite.config.mts", "vite.config.js", "remix.config.js", "remix.config.cjs", "remix.config.mjs"]);
      const rels = cx.sourcePaths.filter((p) => p.startsWith(routesDir) && SCRIPT.test(p)).map((p) => p.slice(routesDir.length).replace(SCRIPT, ""));
      convention = config && /remix-flat-routes/.test(cx.read(config)) ? "hybrid" : nestedShape(rels) ? "nested" : "flat";
    }
    out.push({ routesDir, convention, appPath, routesFile });
  }
  return out;
}

export interface HandRoute {
  kind: "route" | "index" | "layout";
  /** Full URL in React Router notation. */
  path: string;
  /** The module path as written. */
  file: string;
  line: number;
}

const ROUTE_MODULES = new Set(["@react-router/dev/routes", "@remix-run/route-config"]);

/** Routes a `routes.ts` lists by literal `route`/`index`/`layout`/`prefix` calls. */
export function handListedRoutes(path: string, text: string): HandRoute[] {
  loadTs();
  const kindOf = /\.[cm]?js$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kindOf);
  const names = new Map<string, string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteralLike(st.moduleSpecifier) || !ROUTE_MODULES.has(st.moduleSpecifier.text)) continue;
    const nb = st.importClause?.namedBindings;
    if (!nb || !ts.isNamedImports(nb)) continue;
    for (const el of nb.elements) names.set(el.name.text, (el.propertyName ?? el.name).text);
  }
  if (!names.size) return [];

  const unwrap = (n: TS.Node): TS.Node => {
    while (ts.isParenthesizedExpression(n) || ts.isSatisfiesExpression(n) || ts.isAsExpression(n) || ts.isAwaitExpression(n)) n = n.expression;
    return n;
  };
  const lit = (n: TS.Node | undefined) => (n && ts.isStringLiteralLike(n) ? n.text : null);
  const lineOf = (n: TS.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const callName = (n: TS.Node) => {
    const u = unwrap(n);
    return ts.isCallExpression(u) && ts.isIdentifier(u.expression) ? names.get(u.expression.text) : undefined;
  };

  const root = sf.statements.find((st): st is TS.ExportAssignment => ts.isExportAssignment(st) && !st.isExportEquals);
  if (!root) return [];
  let start = unwrap(root.expression);
  if (ts.isIdentifier(start)) {
    const id = start.text;
    for (const st of sf.statements) {
      if (!ts.isVariableStatement(st)) continue;
      for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.name.text === id && d.initializer) start = unwrap(d.initializer);
    }
  }

  const out: HandRoute[] = [];
  const children = (args: readonly TS.Expression[]) => {
    for (const a of args) {
      const u = unwrap(a);
      if (ts.isArrayLiteralExpression(u) || callName(u)) return u;
    }
    return undefined;
  };
  const walk = (node: TS.Node, parent: string): void => {
    const n = unwrap(node);
    if (ts.isArrayLiteralExpression(n)) {
      for (const el of n.elements) walk(ts.isSpreadElement(el) ? el.expression : el, parent);
      return;
    }
    const name = callName(n);
    if (!name || !ts.isCallExpression(n)) return;
    const [a0, a1, ...rest] = n.arguments;
    if (name === "route") {
      const p = lit(a0), file = lit(a1);
      if (p === null || file === null) return;
      const full = childPath(parent, p);
      out.push({ kind: "route", path: full, file, line: lineOf(n) });
      const kids = children(rest);
      if (kids) walk(kids, full);
    } else if (name === "index") {
      const file = lit(a0);
      if (file !== null) out.push({ kind: "index", path: parent, file, line: lineOf(n) });
    } else if (name === "layout") {
      const file = lit(a0);
      if (file === null) return;
      out.push({ kind: "layout", path: parent, file, line: lineOf(n) });
      const kids = children([a1, ...rest].filter(Boolean));
      if (kids) walk(kids, parent);
    } else if (name === "prefix") {
      const p = lit(a0);
      if (p !== null && a1) walk(a1, childPath(parent, p));
    }
  };
  walk(start, "/");
  return out;
}

function childPath(parent: string, child: string): string {
  if (child.startsWith("/") && parent !== "/" && (child === parent || child.startsWith(`${parent}/`))) return child;
  return `/${[...parent.split("/"), ...child.split("/")].filter(Boolean).join("/")}`;
}

export function detectRemix(cx: RemixContext): RemixFacts {
  const facts: RemixFacts = { pages: [], endpoints: [], routeFiles: [], pageActions: [] };
  const addModule = (m: { route: string; layout: boolean; file: string; from: string; line: number }) => {
    const ex = exportsOf(m.file, cx.read(m.file));
    if (m.layout) facts.routeFiles.push({ route: m.route, file: m.file, role: "layout" });
    else if (ex.some((e) => e.name === "default")) {
      facts.pages.push({ route: m.route, file: m.file, from: m.from, line: m.line });
      // a page's action answers the forms that post to its URL (#295); its loader only feeds the page, so it is no endpoint
      const action = ex.find((e) => e.name === "action");
      if (action && m.route !== "/") {
        const ep: Endpoint = { name: m.route, file: m.file, line: action.line, kind: "http", methods: ["POST"] };
        facts.endpoints.push(ep);
        facts.pageActions.push(ep);
      }
    } else {
      const handler = ex.find((e) => e.name === "loader" || e.name === "action");
      // a bare "/" would suffix-match every URL
      if (handler && m.route !== "/") {
        // a loader answers GET, an action the form posts (POST)
        const methods = sortMethods([...(ex.some((e) => e.name === "loader") ? ["GET"] : []), ...(ex.some((e) => e.name === "action") ? ["POST"] : [])]);
        facts.endpoints.push({ name: m.route, file: m.file, line: handler.line, kind: "http", methods });
      }
    }
  };
  const have = new Set(cx.sourcePaths);
  for (const { routesDir, convention, appPath, routesFile } of remixRoots(cx)) {
    const fromFiles = new Set<string>();
    if (convention) {
      for (const f of cx.sourcePaths) {
        if (!f.startsWith(routesDir) || !SCRIPT.test(f)) continue;
        const id = routeId(f.slice(routesDir.length).replace(SCRIPT, ""), convention);
        if (!id) continue;
        const { route, layout } = routeUrl(id);
        fromFiles.add(f);
        addModule({ route, layout, file: f, from: f, line: 1 });
      }
    }
    if (!routesFile) continue;
    for (const h of handListedRoutes(routesFile, cx.read(routesFile))) {
      const file = posix.normalize(posix.join(appPath, h.file));
      if (!have.has(file) || !SCRIPT.test(file) || fromFiles.has(file)) continue;
      addModule({ route: h.path, layout: h.kind === "layout", file, from: routesFile, line: h.line });
    }
  }
  return facts;
}

/**
 * The route's dot-delimited id (`_auth.login`, `users.$username._index`) from its path under
 * `routes/` without the extension, or null when the file isn't a route module.
 */
export function routeId(rest: string, convention: Convention): string | null {
  const parts = rest.split("/");
  const name = parts.pop()!;
  if (parts.some((p) => p.startsWith("+")) || name.startsWith("+")) return null; // colocated
  if (name.startsWith(".") || (convention !== "nested" && name.startsWith("__")) || /\.(server|client|test|spec)$/.test(name)) return null;
  const segs: string[] = [];
  for (const [i, dir] of parts.entries()) {
    if (convention === "auto" || convention === "nested") segs.push(dir);
    else if (convention === "hybrid" && dir.endsWith("+")) segs.push(dir.slice(0, -1));
    // a route folder: only its own route file is the module, and nothing nests inside it
    else if (i === parts.length - 1 && /^(route|index|_index|_layout)$/.test(name)) {
      return [...segs, dir, ...(name === "_index" ? ["_index"] : name === "_layout" ? ["_layout"] : [])].join(".");
    } else return null;
  }
  if (name === "_layout" && convention !== "flat") return [...segs, "_layout"].join(".");
  if (name === "index" && (convention === "auto" || convention === "nested")) return [...segs, "_index"].join(".");
  return [...segs, name].join(".");
}

/**
 * URL of a route id in React Router's notation (`/users/:username`, `/*`, `/:lang?`), and whether
 * the id is a layout: pathless (`_auth`) or a folder's `_layout`, which owns no URL of its own.
 */
export function routeUrl(id: string): { route: string; layout: boolean } {
  const segs = id.match(/(?:\[[^\]]*\]|[^.])+/g) ?? [];
  const url: string[] = [];
  for (const s of segs) {
    if (s.startsWith("_")) continue; // _index, pathless layouts, _layout
    let seg = s.replace(/_$/, ""); // `$noteId_.edit`: not nested in $noteId's layout
    const optional = /^\(.*\)$/.test(seg);
    if (optional) seg = seg.slice(1, -1);
    seg = seg === "$" ? "*" : seg.startsWith("$") ? `:${seg.slice(1)}` : seg;
    url.push(seg.replace(/\[([^\]]*)\]/g, "$1") + (optional ? "?" : ""));
  }
  const last = segs[segs.length - 1] ?? "";
  return { route: `/${url.join("/")}`, layout: last.startsWith("_") && last !== "_index" };
}
