import type TS from "typescript";
import type { Call, Endpoint } from "../model/schema.ts";
import { sortMethods } from "../model/endpoints.ts";

/**
 * Server route detection. Each detector walks one file's syntax and records routes on *local* router
 * keys plus the mounts between them; `linkRoutes` then joins mounts across files (within a package)
 * to produce full paths. Nothing is inferred from types: a route is only reported when its path is a literal.
 *
 * Covered: Express, Hono (incl. `@hono/zod-openapi`), Koa-router, Fastify (`get`/`route`/`register`), NestJS
 * decorators, tRPC routers.
 */

/** "http" routes join with "/", tRPC procedures with ".". */
export type RouteStyle = "http" | "trpc";

export interface LocalRoute {
  /** Router key in this file (a variable or plugin function); null when the path is already absolute. */
  router: string | null;
  path: string;
  line: number;
  style: RouteStyle;
  /** NestJS: gets the package's `setGlobalPrefix`. */
  nest?: boolean;
  /** HTTP methods, when the code states them (not `.all`). */
  methods?: string[];
}

/** `parent` hands requests under `prefix` to `child`, which is a local key or an import. */
export interface Mount {
  parent: string;
  prefix: string;
  child: { local: string } | { spec: string; name: string };
  style: RouteStyle;
}

export interface FileRoutes {
  routes: LocalRoute[];
  mounts: Mount[];
  /** Router keys with their own prefix: `new Router({ prefix })`, `new Hono().basePath(...)`. */
  ownPrefix: Record<string, string>;
  /** export name -> local key */
  exported: Record<string, string>;
  /** local binding -> where it was imported from */
  imported: Record<string, { spec: string; name: string }>;
  /** NestJS `app.setGlobalPrefix('api')`. */
  globalPrefix: string | null;
  /** tRPC client calls: `trpc.user.byId.useQuery()` -> "user.byId". */
  trpcCalls: { path: string; line: number }[];
  /** Lines whose path literals define routes or prefixes; those strings are never client calls. */
  defLines: number[];
  /** `@hono/zod-openapi`: `const list = createRoute({ path: "/tasks" })`, local binding -> its path and method. */
  openapiDefs: Record<string, OpenapiDef>;
  /** `router.openapi(routes.list, handler)`: the route definition, resolved to a path by `linkRoutes`. */
  openapiRefs: { router: string; ref: OpenapiRef; line: number }[];
  /** `import * as routes from "./tasks.routes"`: namespace binding -> specifier. */
  namespaces: Record<string, string>;
}

/** A `createRoute({ path, method })` definition; `method` upper-cased, absent when not a literal. */
export interface OpenapiDef { path: string; method?: string }

/** A route definition handed to `.openapi()`: inline, a binding (local or imported), or `ns.name` of a namespace import. */
export type OpenapiRef = OpenapiDef | { local: string } | { ns: string; name: string };

export interface RouteDetector {
  name: string;
  visit(n: TS.Node, cx: Ctx): void;
}

interface Ctx {
  ts: typeof TS;
  lineOf: (n: TS.Node) => number;
  out: FileRoutes;
  /** Identifiers bound to a known router/app constructor in this file. */
  routerVars: Set<string>;
  skip: Set<TS.Node>;
}

const ROUTE_METHODS = new Set(["get", "post", "put", "patch", "delete", "all"]);
const ROUTER_OBJ = /^(app|router|api|server|routes|fastify|instance|\w*Router|\w*App)$/i;
const ROUTER_CTORS = new Set(["express", "Router", "Hono", "OpenAPIHono", "Fastify", "fastify", "KoaRouter"]);
const NEST_METHODS = new Set(["Get", "Post", "Put", "Patch", "Delete", "All", "Options", "Head"]);
const TRPC_ROUTER = new Set(["router", "createTRPCRouter"]);
const TRPC_LEAF = new Set(["query", "mutation", "subscription"]);
const TRPC_CLIENT = new Set([
  "useQuery", "useSuspenseQuery", "useInfiniteQuery", "useSuspenseInfiniteQuery", "useMutation", "useSubscription",
  "query", "mutate", "subscribe", "fetch", "prefetch", "queryOptions", "mutationOptions", "infiniteQueryOptions",
]);

const strArg = (ts: typeof TS, e: TS.Node | undefined): string | null => (e && ts.isStringLiteralLike(e) ? e.text : null);
const propName = (ts: typeof TS, n: TS.PropertyName): string | null =>
  ts.isIdentifier(n) || ts.isStringLiteralLike(n) ? n.text : null;
function objProp(ts: typeof TS, o: TS.Node | undefined, key: string): TS.Expression | undefined {
  if (!o || !ts.isObjectLiteralExpression(o)) return undefined;
  for (const p of o.properties) if (ts.isPropertyAssignment(p) && propName(ts, p.name) === key) return p.initializer;
  return undefined;
}

/** Root of a call/property chain: `app.route('/x').get(...)` -> the `app` identifier and the `.route('/x')` path. */
function chainRoot(ts: typeof TS, e: TS.Expression): { id: TS.Identifier | null; routePath: string | null } {
  let routePath: string | null = null;
  while (true) {
    if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression)) {
      const m = e.expression.name.text;
      if (m === "route" && e.arguments.length === 1) routePath ??= strArg(ts, e.arguments[0]);
      else if (!ROUTE_METHODS.has(m) && m !== "basePath") return { id: null, routePath };
      e = e.expression.expression;
    } else if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e)) e = e.expression;
    else return { id: ts.isIdentifier(e) ? e : null, routePath };
  }
}

function funcKey(ts: typeof TS, fn: TS.Node): string {
  if (ts.isFunctionDeclaration(fn) && fn.name) return fn.name.text;
  if (ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name)) return fn.parent.name.text;
  return `__fn@${fn.pos}`;
}

/** Router key for an identifier: the enclosing function when it's that function's parameter (Fastify plugins). */
function keyFor(ts: typeof TS, id: TS.Identifier): string {
  for (let p: TS.Node | undefined = id.parent; p; p = p.parent) {
    if (ts.isFunctionLike(p) && p.parameters.some((q) => ts.isIdentifier(q.name) && q.name.text === id.text)) return funcKey(ts, p);
  }
  return id.text;
}

/** `x.register(async (sub) => { sub.get(...) })`: `sub` is a router whatever it's called. */
function isInlinePluginParam(ts: typeof TS, id: TS.Identifier): boolean {
  for (let p: TS.Node | undefined = id.parent; p; p = p.parent) {
    if (!ts.isFunctionLike(p) || !p.parameters.some((q) => ts.isIdentifier(q.name) && q.name.text === id.text)) continue;
    const c = p.parent;
    return !!c && ts.isCallExpression(c) && c.arguments[0] === p && ts.isPropertyAccessExpression(c.expression) && c.expression.name.text === "register";
  }
  return false;
}

/** Local key or import an exported/mounted expression refers to. */
function refOf(ts: typeof TS, e: TS.Expression | undefined, depth = 0): Mount["child"] | null {
  if (!e || depth > 4) return null;
  if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isAwaitExpression(e)) return refOf(ts, e.expression, depth + 1);
  if (ts.isIdentifier(e)) return { local: e.text };
  if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) return { local: funcKey(ts, e) };
  if (ts.isPropertyAccessExpression(e) && e.name.text === "default") return refOf(ts, e.expression, depth + 1);
  if (ts.isCallExpression(e)) {
    const spec = strArg(ts, e.arguments[0]);
    if (spec !== null && (e.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(e.expression) && e.expression.text === "require"))) return { spec, name: "default" };
    // koa `sub.routes()`, wrappers like fastify-plugin's `fp(plugin)`
    if (ts.isPropertyAccessExpression(e.expression) && /^(routes|middleware)$/.test(e.expression.name.text)) return refOf(ts, e.expression.expression, depth + 1);
    if (ts.isIdentifier(e.expression) && e.arguments.length) return refOf(ts, e.arguments[0], depth + 1);
  }
  return null;
}

/** Marks the path literals in route/mount arguments (directly, in arrays, or as `url`/`path`/`prefix` options). */
function markDefs(cx: Ctx, nodes: readonly TS.Node[]) {
  const { ts, lineOf, out } = cx;
  for (const a of nodes) {
    if (ts.isStringLiteralLike(a)) out.defLines.push(lineOf(a));
    else if (ts.isArrayLiteralExpression(a)) markDefs(cx, a.elements);
    else if (ts.isObjectLiteralExpression(a)) markDefs(cx, ["url", "path", "prefix"].map((k) => objProp(ts, a, k)).filter((x) => !!x) as TS.Node[]);
    else if (ts.isNewExpression(a) || ts.isCallExpression(a)) {
      markDefs(cx, a.arguments ?? []);
      if (ts.isPropertyAccessExpression(a.expression)) markDefs(cx, [a.expression.expression]);
    }
  }
}

const ownPrefixOf = (ts: typeof TS, init: TS.Expression): string | null => {
  if (ts.isCallExpression(init) && ts.isPropertyAccessExpression(init.expression) && init.expression.name.text === "basePath") return strArg(ts, init.arguments[0]);
  if ((ts.isNewExpression(init) || ts.isCallExpression(init)) && init.arguments) {
    const p = objProp(ts, init.arguments[0], "prefix");
    return strArg(ts, p);
  }
  return null;
};

const isCtor = (ts: typeof TS, init: TS.Expression): boolean => {
  while (ts.isCallExpression(init) && ts.isPropertyAccessExpression(init.expression) && init.expression.name.text === "basePath") init = init.expression.expression;
  if (!ts.isNewExpression(init) && !ts.isCallExpression(init)) return false;
  const c = init.expression;
  const name = ts.isIdentifier(c) ? c.text : ts.isPropertyAccessExpression(c) ? c.name.text : null;
  return !!name && ROUTER_CTORS.has(name);
};

/**
 * `return api.post('/discussions', data)` is an HTTP client (axios, ky) sending a request, not a server defining a
 * route: the object is only *named* like a router, no handler function is passed, and the call's result is used
 * (returned, awaited, an arrow's body, an argument, or `.then`). Found in bulletproof-react by the reliability sweep.
 */
function looksLikeClientCall(ts: typeof TS, n: TS.CallExpression, id: TS.Identifier, routerVars: Set<string>): boolean {
  // a router made in this file, or handed in as a parameter (`(app) => app.get('/x', h)`), defines routes
  if (routerVars.has(id.text) || keyFor(ts, id) !== id.text) return false;
  if (n.arguments.some((a) => ts.isFunctionLike(a))) return false;
  let e: TS.Node = n;
  while (ts.isParenthesizedExpression(e.parent) || ts.isAsExpression(e.parent) || ts.isNonNullExpression(e.parent)) e = e.parent;
  const p = e.parent;
  return ts.isReturnStatement(p) || ts.isAwaitExpression(p) || (ts.isArrowFunction(p) && p.body === e)
    || (ts.isCallExpression(p) && p.arguments.includes(e as TS.Expression))
    || (ts.isPropertyAccessExpression(p) && /^(then|catch|finally)$/.test(p.name.text));
}

/** Fastify `route({ method })`: a string or an array of string literals; undefined for anything else. */
function fastifyMethods(ts: typeof TS, e: TS.Expression | undefined): string[] | undefined {
  if (!e) return undefined;
  const ms = ts.isStringLiteralLike(e) ? [e.text] : ts.isArrayLiteralExpression(e) ? e.elements.filter(ts.isStringLiteralLike).map((x) => x.text) : [];
  return ms.length ? sortMethods(ms) : undefined;
}

/** Strips parens, `as`, `satisfies` and `!` around an expression. */
function unwrap(ts: typeof TS, e: TS.Expression): TS.Expression {
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isNonNullExpression(e)) e = e.expression;
  return e;
}

/** An array literal, inline or bound once to a variable in the same file; null for anything else. */
function arrayLiteralOf(ts: typeof TS, recv: TS.Expression): TS.ArrayLiteralExpression | null {
  const e = unwrap(ts, recv);
  if (ts.isArrayLiteralExpression(e)) return e;
  if (!ts.isIdentifier(e)) return null;
  const decls: TS.VariableDeclaration[] = [];
  const find = (n: TS.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === e.text) decls.push(n);
    ts.forEachChild(n, find);
  };
  find(e.getSourceFile());
  if (decls.length !== 1 || !decls[0].initializer) return null;
  const init = unwrap(ts, decls[0].initializer);
  return ts.isArrayLiteralExpression(init) ? init : null;
}

/**
 * The elements a loop variable runs over: `c` bound by the callback of `arr.forEach(...)`/`arr.map(...)` or by
 * `for (const c of arr)`, where `arr` is a same-file array literal. Null when `c` isn't such a variable.
 */
function loopElements(ts: typeof TS, c: TS.Expression): TS.Expression[] | null {
  const id = unwrap(ts, c);
  if (!ts.isIdentifier(id)) return null;
  for (let p: TS.Node | undefined = id.parent; p; p = p.parent) {
    let recv: TS.Expression | null = null;
    if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) && p.parameters.some((q) => ts.isIdentifier(q.name) && q.name.text === id.text)) {
      const call = p.parent;
      if (!ts.isCallExpression(call) || call.arguments[0] !== p || !ts.isPropertyAccessExpression(call.expression)) return null;
      const first = p.parameters[0].name;
      if (!/^(forEach|map)$/.test(call.expression.name.text) || !ts.isIdentifier(first) || first.text !== id.text) return null;
      recv = call.expression.expression;
    } else if (ts.isFunctionLike(p) && p.parameters.some((q) => ts.isIdentifier(q.name) && q.name.text === id.text)) {
      return null;
    } else if (ts.isForOfStatement(p) && ts.isVariableDeclarationList(p.initializer) && p.initializer.declarations.length === 1) {
      const d = p.initializer.declarations[0];
      if (!ts.isIdentifier(d.name) || d.name.text !== id.text) continue;
      recv = p.expression;
    } else continue;
    const arr = arrayLiteralOf(ts, recv);
    return arr ? arr.elements.filter((x) => !ts.isSpreadElement(x) && !ts.isOmittedExpression(x)) : null;
  }
  return null;
}

/** Express, Hono, Koa-router, Fastify: `x.get('/p')`, `x.route({ url })`, `x.use('/p', r)`, `x.route('/p', r)`, `x.register(r, { prefix })`. */
const methodRoutes: RouteDetector = {
  name: "method-routes",
  visit(n, cx) {
    const { ts, lineOf, out, routerVars } = cx;
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && isCtor(ts, n.initializer)) {
      routerVars.add(n.name.text);
      const p = ownPrefixOf(ts, n.initializer);
      if (p) { out.ownPrefix[n.name.text] = p; markDefs(cx, [n.initializer]); }
      return;
    }
    if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression)) return;
    const m = n.expression.name.text;
    const { id, routePath } = chainRoot(ts, n.expression.expression);
    if (!id || !(ROUTER_OBJ.test(id.text) || routerVars.has(id.text) || isInlinePluginParam(ts, id))) return;
    const router = keyFor(ts, id);
    const [a0, a1] = n.arguments;
    const before = out.routes.length + out.mounts.length + Object.keys(out.ownPrefix).length + (out.globalPrefix ? 1 : 0);

    if (ROUTE_METHODS.has(m)) {
      if (looksLikeClientCall(ts, n, id, routerVars)) return;
      // koa-router named routes: router.get('name', '/path', ...)
      const path = routePath ?? (strArg(ts, a0)?.startsWith("/") ? strArg(ts, a0) : strArg(ts, a1));
      if (path?.startsWith("/")) out.routes.push({ router, path, line: lineOf(n), style: "http", methods: m === "all" ? undefined : [m.toUpperCase()] });
    } else if (m === "route" && a0 && ts.isObjectLiteralExpression(a0)) {
      const path = strArg(ts, objProp(ts, a0, "url") ?? objProp(ts, a0, "path"));
      if (path?.startsWith("/")) out.routes.push({ router, path, line: lineOf(n), style: "http", methods: fastifyMethods(ts, objProp(ts, a0, "method")) });
    } else if (m === "use" || (m === "route" && n.arguments.length === 2)) {
      const prefix = strArg(ts, a0);
      const children = prefix !== null ? n.arguments.slice(1) : n.arguments;
      if (prefix !== null && !prefix.startsWith("/")) return;
      for (const c of children) {
        // `routes.forEach((r) => app.route("/", r))`: mount each element of a same-file array literal
        const els = loopElements(ts, c);
        for (const el of els ?? [c]) {
          const child = refOf(ts, el);
          if (child) out.mounts.push({ parent: router, prefix: prefix ?? "", child, style: "http" });
        }
      }
    } else if (m === "register") {
      const child = refOf(ts, a0);
      const prefix = strArg(ts, objProp(ts, a1, "prefix")) ?? "";
      if (child) out.mounts.push({ parent: router, prefix, child, style: "http" });
    } else if (m === "prefix" && n.parent && ts.isExpressionStatement(n.parent)) {
      const p = strArg(ts, a0); // koa-router `router.prefix('/api')`
      if (p) out.ownPrefix[router] = p;
    } else if (m === "setGlobalPrefix") {
      out.globalPrefix = strArg(ts, a0);
    }
    if (out.routes.length + out.mounts.length + Object.keys(out.ownPrefix).length + (out.globalPrefix ? 1 : 0) !== before) markDefs(cx, [n]);
  },
};

function decoratorArgs(ts: typeof TS, node: TS.Node, names: Set<string>): { name: string; paths: string[]; at: TS.Node } | null {
  for (const d of (ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined) ?? []) {
    if (!ts.isCallExpression(d.expression) || !ts.isIdentifier(d.expression.expression) || !names.has(d.expression.expression.text)) continue;
    const a = d.expression.arguments[0];
    let paths: string[] = [""];
    if (a && ts.isStringLiteralLike(a)) paths = [a.text];
    else if (a && ts.isArrayLiteralExpression(a)) paths = a.elements.filter(ts.isStringLiteralLike).map((e) => e.text);
    else if (a && ts.isObjectLiteralExpression(a)) {
      const p = objProp(ts, a, "path");
      if (p && ts.isStringLiteralLike(p)) paths = [p.text];
      else if (p) paths = [];
    } else if (a) paths = []; // a non-literal path we can't read
    return { name: d.expression.expression.text, paths, at: d };
  }
  return null;
}

/** NestJS: `@Controller('users')` + `@Get(':id')` -> `/users/:id`. */
const nest: RouteDetector = {
  name: "nest",
  visit(n, { ts, lineOf, out }) {
    if (!ts.isClassDeclaration(n)) return;
    const ctrl = decoratorArgs(ts, n, new Set(["Controller"]));
    if (!ctrl) return;
    for (const mem of n.members) {
      if (!ts.isMethodDeclaration(mem)) continue;
      const route = decoratorArgs(ts, mem, NEST_METHODS);
      if (!route) continue;
      out.defLines.push(lineOf(ctrl.at), lineOf(route.at));
      const methods = route.name === "All" ? undefined : [route.name.toUpperCase()];
      for (const c of ctrl.paths) for (const r of route.paths) out.routes.push({ router: null, path: joinPath(c, r), line: lineOf(route.at), style: "http", nest: true, methods });
    }
  },
};

const isProcedure = (ts: typeof TS, e: TS.Expression): boolean => {
  if (!ts.isCallExpression(e) || !ts.isPropertyAccessExpression(e.expression) || !TRPC_LEAF.has(e.expression.name.text)) return false;
  for (let x: TS.Expression = e.expression.expression; ;) {
    if (ts.isCallExpression(x)) x = x.expression;
    else if (ts.isPropertyAccessExpression(x)) {
      if (/procedure/i.test(x.name.text)) return true;
      x = x.expression;
    } else return ts.isIdentifier(x) && /procedure/i.test(x.text);
  }
};

const isTrpcRouterCall = (ts: typeof TS, n: TS.Node): n is TS.CallExpression => {
  if (!ts.isCallExpression(n) || !n.arguments[0] || !ts.isObjectLiteralExpression(n.arguments[0])) return false;
  const c = n.expression;
  const name = ts.isIdentifier(c) ? c.text : ts.isPropertyAccessExpression(c) ? c.name.text : null;
  return !!name && TRPC_ROUTER.has(name);
};

/** tRPC: `router({ user: userRouter, hello: publicProcedure.query(...) })`. */
const trpc: RouteDetector = {
  name: "trpc",
  visit(n, cx) {
    const { ts, lineOf, out, skip } = cx;
    if (isTrpcRouterCall(ts, n) && !skip.has(n)) {
      const key = ts.isVariableDeclaration(n.parent) && ts.isIdentifier(n.parent.name) ? n.parent.name.text : `__trpc@${n.pos}`;
      if (ts.isExportAssignment(n.parent)) out.exported.default = key;
      const walk = (obj: TS.ObjectLiteralExpression, prefix: string) => {
        for (const p of obj.properties) {
          const name = p.name ? propName(ts, p.name) : null;
          if (!name) continue;
          const full = prefix ? `${prefix}.${name}` : name;
          const v = ts.isPropertyAssignment(p) ? p.initializer : ts.isShorthandPropertyAssignment(p) ? p.name : null;
          if (!v) continue;
          if (isProcedure(ts, v)) out.routes.push({ router: key, path: full, line: lineOf(p), style: "trpc" });
          else if (isTrpcRouterCall(ts, v)) { skip.add(v); walk(v.arguments[0] as TS.ObjectLiteralExpression, full); }
          else if (ts.isIdentifier(v)) out.mounts.push({ parent: key, prefix: full, child: { local: v.text }, style: "trpc" });
        }
      };
      walk(n.arguments[0] as TS.ObjectLiteralExpression, "");
      return;
    }
    // client: trpc.a.b.useQuery() / api.a.b.c.mutate()
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && TRPC_CLIENT.has(n.expression.name.text)) {
      const segs: string[] = [];
      let x: TS.Expression = n.expression.expression;
      while (ts.isPropertyAccessExpression(x)) { segs.unshift(x.name.text); x = x.expression; }
      if (segs.length && ts.isIdentifier(x) && /trpc|api|client/i.test(x.text)) out.trpcCalls.push({ path: segs.join("."), line: lineOf(n) });
    }
  },
};

/** `createRoute({ path: "/tasks", method: "get" })` with a literal path; null otherwise. */
function createRouteDef(ts: typeof TS, n: TS.Node): OpenapiDef | null {
  if (!ts.isCallExpression(n)) return null;
  const c = n.expression;
  const name = ts.isIdentifier(c) ? c.text : ts.isPropertyAccessExpression(c) ? c.name.text : null;
  const m = objProp(ts, n.arguments[0], "method");
  if (name !== "createRoute" || !m) return null;
  const path = strArg(ts, objProp(ts, n.arguments[0], "path"));
  if (!path?.startsWith("/")) return null;
  const method = strArg(ts, m)?.toUpperCase();
  return method ? { path, method } : { path };
}

/**
 * Hono OpenAPI (`@hono/zod-openapi`): routes are `createRoute({ path, method })` objects, often in their own file,
 * registered with `router.openapi(route, handler)`. The router is the chain's root identifier, or the variable a
 * factory chain is assigned to (`const router = createRouter().openapi(...)`). Found by the reliability sweep (#233).
 */
const openapi: RouteDetector = {
  name: "openapi",
  visit(n, cx) {
    const { ts, lineOf, out } = cx;
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      const def = createRouteDef(ts, n.initializer);
      if (def) { out.openapiDefs[n.name.text] = def; markDefs(cx, [n.initializer]); }
      return;
    }
    if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression) || n.expression.name.text !== "openapi" || n.arguments.length < 2) return;
    const a0 = n.arguments[0];
    let ref: OpenapiRef | null = null;
    const inline = createRouteDef(ts, a0);
    if (inline) { ref = inline; markDefs(cx, [a0]); }
    else if (ts.isIdentifier(a0)) ref = { local: a0.text };
    else if (ts.isPropertyAccessExpression(a0) && ts.isIdentifier(a0.expression)) ref = { ns: a0.expression.text, name: a0.name.text };
    if (!ref) return;
    let root: TS.Expression = n.expression.expression;
    while (ts.isCallExpression(root) && ts.isPropertyAccessExpression(root.expression)) root = root.expression.expression;
    let router: string | null = ts.isIdentifier(root) ? keyFor(ts, root) : null;
    if (!router) {
      let top: TS.Node = n;
      while (ts.isPropertyAccessExpression(top.parent) && ts.isCallExpression(top.parent.parent) && top.parent.parent.expression === top.parent) top = top.parent.parent;
      while (ts.isParenthesizedExpression(top.parent) || ts.isAsExpression(top.parent)) top = top.parent;
      if (ts.isVariableDeclaration(top.parent) && ts.isIdentifier(top.parent.name)) router = top.parent.name.text;
      else if (ts.isExportAssignment(top.parent)) out.exported.default = router = `__openapi@${top.pos}`;
      else return;
    }
    out.openapiRefs.push({ router, ref, line: lineOf(a0) });
  },
};

export const DETECTORS: RouteDetector[] = [methodRoutes, nest, trpc, openapi];

/** Bindings imported into, and exported from, the file: the joints `linkRoutes` follows across files. */
function scanModule(ts: typeof TS, sf: TS.SourceFile, out: FileRoutes) {
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.importClause) {
      const spec = st.moduleSpecifier.text;
      const c = st.importClause;
      if (c.name) out.imported[c.name.text] = { spec, name: "default" };
      if (c.namedBindings && ts.isNamedImports(c.namedBindings)) {
        for (const el of c.namedBindings.elements) out.imported[el.name.text] = { spec, name: (el.propertyName ?? el.name).text };
      } else if (c.namedBindings) {
        out.imported[c.namedBindings.name.text] = { spec, name: "default" };
        out.namespaces[c.namedBindings.name.text] = spec;
      }
    } else if (ts.isVariableStatement(st)) {
      const exp = ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      for (const d of st.declarationList.declarations) {
        if (exp && ts.isIdentifier(d.name)) out.exported[d.name.text] = d.name.text;
        const init = d.initializer;
        const req = init && ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === "require" ? strArg(ts, init.arguments[0]) : null;
        if (req === null) continue;
        if (ts.isIdentifier(d.name)) out.imported[d.name.text] = { spec: req, name: "default" };
        else if (ts.isObjectBindingPattern(d.name)) {
          for (const el of d.name.elements) if (ts.isIdentifier(el.name)) out.imported[el.name.text] = { spec: req, name: el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.text };
        }
      }
    } else if (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) {
      const mods = ts.getModifiers(st);
      if (!mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
      const isDefault = mods.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
      const key = ts.isFunctionDeclaration(st) ? funcKey(ts, st) : st.name?.text;
      if (key) out.exported[isDefault ? "default" : key] = key;
    } else if (ts.isExportAssignment(st)) {
      const r = refOf(ts, st.expression);
      if (r && "local" in r) out.exported.default = r.local;
    } else if (ts.isExportDeclaration(st) && !st.moduleSpecifier && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const e of st.exportClause.elements) out.exported[e.name.text] = (e.propertyName ?? e.name).text;
    } else if (ts.isExpressionStatement(st) && ts.isBinaryExpression(st.expression) && st.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      // module.exports = router; exports.users = router; module.exports.users = router
      const l = st.expression.left;
      const text = l.getText(sf);
      const r = refOf(ts, st.expression.right);
      if (!r || !("local" in r)) continue;
      if (text === "module.exports") out.exported.default = r.local;
      else if (ts.isPropertyAccessExpression(l) && /^(module\.)?exports$/.test(l.expression.getText(sf))) out.exported[l.name.text] = r.local;
    }
  }
}

export function scanRoutes(ts: typeof TS, sf: TS.SourceFile, lineOf: (n: TS.Node) => number): FileRoutes {
  const out: FileRoutes = { routes: [], mounts: [], ownPrefix: {}, exported: {}, imported: {}, globalPrefix: null, trpcCalls: [], defLines: [], openapiDefs: {}, openapiRefs: [], namespaces: {} };
  const cx: Ctx = { ts, lineOf, out, routerVars: new Set(), skip: new Set() };
  scanModule(ts, sf, out);
  const visit = (n: TS.Node) => {
    for (const d of DETECTORS) d.visit(n, cx);
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(sf, visit);
  return out;
}

export function joinPath(...parts: string[]): string {
  const s = "/" + parts.map((p) => p.replace(/^\/+|\/+$/g, "")).filter(Boolean).join("/");
  return s;
}
const joinTrpc = (...parts: string[]) => parts.filter(Boolean).join(".");

/**
 * Turns per-file routes into endpoints, prefixing each with every chain of mounts that reaches its router
 * (followed through imports, within one package). tRPC procedures are returned separately: they're
 * matched to client calls by exact path, never by loose string tokens.
 */
export function linkRoutes(
  files: Map<string, { routes: FileRoutes }>,
  resolveLocal: (spec: string, from: string) => string | null,
  owner: (path: string) => string,
): { endpoints: Endpoint[]; trpc: Endpoint[] } {
  const target = (file: string, child: Mount["child"]): { file: string; key: string } | null => {
    let f = file;
    let local: string;
    if ("spec" in child) {
      const r = resolveLocal(child.spec, file);
      if (!r) return null;
      f = r;
      local = files.get(r)?.routes.exported[child.name] ?? "";
    } else {
      const imp = files.get(file)!.routes.imported[child.local];
      if (!imp) return { file, key: child.local };
      const r = resolveLocal(imp.spec, file);
      if (!r) return null;
      f = r;
      local = files.get(r)?.routes.exported[imp.name] ?? "";
    }
    if (!local || owner(f) !== owner(file)) return null;
    return { file: f, key: local };
  };

  const incoming = new Map<string, { file: string; key: string; prefix: string; style: RouteStyle }[]>();
  const globalPrefix = new Map<string, string>();
  for (const [file, { routes: fr }] of files) {
    if (fr.globalPrefix) globalPrefix.set(owner(file), fr.globalPrefix);
    for (const m of fr.mounts) {
      const t = target(file, m.child);
      if (!t || (t.file === file && t.key === m.parent)) continue;
      const k = `${t.file}\0${t.key}`;
      incoming.set(k, [...(incoming.get(k) ?? []), { file, key: m.parent, prefix: m.prefix, style: m.style }]);
    }
  }

  const prefixes = (file: string, key: string, style: RouteStyle, seen: Set<string>): string[] => {
    const k = `${file}\0${key}`;
    const own = style === "http" ? files.get(file)?.routes.ownPrefix[key] ?? "" : "";
    const parents = (incoming.get(k) ?? []).filter((p) => p.style === style);
    if (!parents.length || seen.has(k)) return [own];
    seen.add(k);
    const join = style === "http" ? joinPath : joinTrpc;
    const out = new Set<string>();
    for (const p of parents) for (const pre of prefixes(p.file, p.key, style, seen)) out.add(join(pre, p.prefix, own));
    seen.delete(k);
    return [...out].sort().slice(0, 20);
  };

  // `.openapi(ref)` -> the `createRoute` definition it names, in this file or across one import
  const defIn = (spec: string, from: string, name: string): OpenapiDef | null => {
    const r = resolveLocal(spec, from);
    const fr = r ? files.get(r)?.routes : undefined;
    const local = fr?.exported[name];
    return local ? fr!.openapiDefs[local] ?? null : null;
  };
  const openapiDef = (file: string, fr: FileRoutes, ref: OpenapiRef): OpenapiDef | null => {
    if ("path" in ref) return ref;
    if ("ns" in ref) return fr.namespaces[ref.ns] ? defIn(fr.namespaces[ref.ns], file, ref.name) : null;
    if (fr.openapiDefs[ref.local]) return fr.openapiDefs[ref.local];
    const imp = fr.imported[ref.local];
    return imp ? defIn(imp.spec, file, imp.name) : null;
  };

  const endpoints: Endpoint[] = [];
  const trpc: Endpoint[] = [];
  for (const [file, { routes: fr }] of files) {
    // one endpoint per path per line: `x.route('/p').get(h).post(h)` is one endpoint answering both
    const seen = new Map<string, Endpoint>();
    const local: LocalRoute[] = [...fr.routes];
    for (const o of fr.openapiRefs) {
      const d = openapiDef(file, fr, o.ref);
      if (d) local.push({ router: o.router, path: d.path, methods: d.method ? [d.method] : undefined, line: o.line, style: "http" });
    }
    for (const r of local) {
      let names: string[];
      if (r.style === "trpc") names = prefixes(file, r.router!, "trpc", new Set()).map((p) => joinTrpc(p, r.path));
      else if (r.nest) names = [joinPath(globalPrefix.get(owner(file)) ?? "", r.path)];
      else names = r.router ? prefixes(file, r.router, "http", new Set()).map((p) => joinPath(p, r.path)) : [joinPath(r.path)];
      for (const name of names.sort()) {
        // a bare "/" would suffix-match every URL
        if (name === "/" || !name) continue;
        const k = `${r.line}\0${name}`;
        const hit = seen.get(k);
        const ms = r.style === "http" && r.methods?.length ? r.methods : null;
        if (hit) {
          if (ms) hit.methods = sortMethods([...(hit.methods ?? []), ...ms]);
          continue;
        }
        const ep: Endpoint = { name, line: r.line, kind: r.style === "trpc" ? "callable" : "http", file, ...(ms ? { methods: sortMethods(ms) } : {}) };
        seen.set(k, ep);
        (r.style === "trpc" ? trpc : endpoints).push(ep);
      }
    }
  }
  return { endpoints, trpc };
}
