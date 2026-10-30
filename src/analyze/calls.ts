import type { Call, Endpoint, Package } from "../model/schema.ts";
import type { ParsedFile, StringSite } from "./resolve.ts";

const HTTP_CALLEES = /^(fetch|get|post|put|patch|delete|request|axios|ky|ofetch|\$fetch|useSWR|useFetch)$/i;
/** Object keys whose string value is a request target (#237). Compared case-insensitively. */
const REQUEST_KEYS = new Set(["url", "href", "action", "formaction", "endpoint", "path", "api"]);

const POSTS = new Set(["post", "put", "patch", "delete"]);

/** A literal used as data (a config value, a string test, a comparison), never a request (#237). */
function isDataSite(site: StringSite | null): boolean {
  if (!site) return false;
  if (site.kind !== "property") return true;
  if (site.key === null || REQUEST_KEYS.has(site.key.toLowerCase())) return false;
  return !(site.objectCallee && HTTP_CALLEES.test(site.objectCallee));
}

/**
 * Matches string literals in client code against server endpoints.
 * Function endpoints match by exact name (`httpsCallable(f, 'createUser')`, `` `${base}/createUser` ``);
 * route endpoints match by path suffix (`fetch('/api/users/42')` → `router.get('/users/:id')`).
 * Page actions (`formOnly`, #295) match only non-GET form posts.
 * Path literals in data positions (object values under non-request keys, string predicates, comparisons) are not calls (#237).
 */
export function matchCalls(parsed: Map<string, ParsedFile>, owner: (p: string) => string, endpoints: Endpoint[], related: Related = samePackage, formOnly: ReadonlySet<Endpoint> = new Set()): Call[] {
  const byName = new Map<string, Endpoint[]>();
  const routes: { ep: Endpoint; re: RegExp; form: boolean }[] = [];
  for (const ep of endpoints) {
    // events aren't called by clients; server actions are reached by import (see index.ts), never by string
    if (ep.kind === "event" || ep.kind === "action") continue;
    if (ep.name.startsWith("/")) {
      const re = routeRegex(ep.name);
      if (re) routes.push({ ep, re, form: formOnly.has(ep) });
    } else if (ep.name.length >= 4) {
      byName.set(ep.name, [...(byName.get(ep.name) ?? []), ep]);
    }
  }

  const calls: Call[] = [];
  const seen = new Set<string>();
  for (const [from, pf] of parsed) {
    const pkg = owner(from);
    const defs = new Set(pf.routes.defLines);
    for (const s of pf.strings) {
      if (defs.has(s.line)) continue; // a route or mount prefix being defined, not called
      const named = (byName.get(s.token) ?? []).filter((ep) => ep.file !== from && owner(ep.file) !== pkg);
      // a name match inside the server's own package is usually just a reference, not a client call
      const posts = !!s.form && POSTS.has(s.form.method ?? "");
      const routed = !isDataSite(s.site) && (s.path?.startsWith("/") || s.path?.includes("://")) ? routes.filter((r) => (!r.form || posts) && r.re.test(s.path!) && r.ep.file !== from).map((r) => r.ep) : [];
      const scoped = inScope(pkg, [...named, ...routed], owner, related);
      const hits = scoped.filter((ep) => !ep.name.startsWith("/") || !scoped.some((o) => o.name.startsWith("/") && moreSpecific(o.name, ep.name)));
      for (const ep of hits) {
        const kind = s.callee === "httpsCallable" ? "callable" : s.path || (s.callee && HTTP_CALLEES.test(s.callee)) ? "http" : ep.kind === "callable" ? "callable" : "http";
        const key = `${from}\0${s.line}\0${ep.file}\0${ep.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        calls.push({ from, line: s.line, to: ep.file, endpoint: ep.name, kind });
      }
    }
  }
  return calls.sort((a, b) => a.from.localeCompare(b.from) || a.line - b.line || a.endpoint.localeCompare(b.endpoint));
}

/**
 * Suffix regex for a route path. Dynamic segments: Express `:id`, OpenAPI `{id}`, Next.js `[id]`, `[...slug]` (one or more)
 * and `[[...slug]]` (zero or more). Null when the route has no literal segment, since it would match any URL.
 */
export function routeRegex(name: string): RegExp | null {
  let body = "";
  let literal = false;
  // A concrete value, or a template substitution (":_"); never another router's parameter syntax
  // (`$id`, `:id`, `[id]`, `{id}`), which marks a route definition rather than a call.
  const value = "/(?::_|[^/:$[\\]{][^/]*)";
  for (const seg of name.replace(/\/$/, "").split("/").slice(1)) {
    if (/^\[\[\.\.\..+\]\]$/.test(seg)) body += `(?:${value}(?:/[^/]+)*)?`;
    else if (/^\[\.\.\..+\]$/.test(seg)) body += `${value}(?:/[^/]+)*`;
    else if (isDynamic(seg)) body += value;
    else { body += "/" + seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); literal = true; }
  }
  return literal ? new RegExp(`${body}/?$`) : null;
}

function isDynamic(seg: string): boolean {
  return seg.startsWith(":") || /^\[.+\]$/.test(seg) || /^\{.+\}$/.test(seg);
}

/** Routers prefer static segments: `/users/stripe` wins over `/users/[id]` for the URL `/users/stripe`. */
function moreSpecific(a: string, b: string): boolean {
  const x = a.split("/"), y = b.split("/");
  if (x.length !== y.length) return false;
  let strict = false;
  for (let i = 0; i < x.length; i++) {
    if (isDynamic(x[i]) && !isDynamic(y[i])) return false;
    if (!isDynamic(x[i]) && isDynamic(y[i])) strict = true;
  }
  return strict;
}

/** tRPC client calls (`trpc.user.byId.useQuery()`) match procedures by exact dotted path, never by loose tokens. */
export function matchTrpcCalls(parsed: Map<string, ParsedFile>, procedures: Endpoint[], owner: (p: string) => string = () => "", related: Related = samePackage): Call[] {
  const byPath = new Map<string, Endpoint[]>();
  for (const ep of procedures) byPath.set(ep.name, [...(byPath.get(ep.name) ?? []), ep]);
  const calls: Call[] = [];
  for (const [from, pf] of parsed) {
    for (const c of pf.routes.trpcCalls) {
      const hits = (byPath.get(c.path) ?? []).filter((ep) => ep.file !== from);
      for (const ep of inScope(owner(from), hits, owner, related)) calls.push({ from, line: c.line, to: ep.file, endpoint: ep.name, kind: "callable" });
    }
  }
  return calls;
}

/** Whether code in package `from` can reach endpoints defined in package `to`. */
export type Related = (from: string, to: string) => boolean;
const samePackage: Related = (a, b) => a === b;

/**
 * A package reaches itself and the in-repo packages it depends on, directly or through another:
 * package.json deps (how workspace links are declared too), or `links`, packages whose files it
 * imports (a client importing `type AppRouter` from its server by relative path).
 */
export function packageRelation(packages: Package[], links: [string, string][] = []): Related {
  const idByName = new Map(packages.map((p) => [p.name, p.id]));
  const direct = new Map(packages.map((p) => [p.id, p.deps.map((d) => idByName.get(d)).filter((id): id is string => !!id)]));
  for (const [a, b] of links) if (a !== b) direct.get(a)?.push(b);
  const reach = new Map<string, Set<string>>();
  const reachOf = (id: string): Set<string> => {
    let r = reach.get(id);
    if (r) return r;
    r = new Set([id]);
    reach.set(id, r);
    for (const todo = [...(direct.get(id) ?? [])]; todo.length; ) {
      const d = todo.pop()!;
      if (r.has(d)) continue;
      r.add(d);
      todo.push(...(direct.get(d) ?? []));
    }
    return r;
  };
  return (from, to) => reachOf(from).has(to);
}

/**
 * Which of a literal's candidate endpoints it can mean (#260). Example apps in one monorepo all
 * define `/api/trpc` or `greeting`, so a literal prefers endpoints in its own package or one it depends on.
 * With none there, a single other package is still a fair match (a web app calling its functions by URL
 * without importing them); several unrelated packages are a guess, so the literal matches nothing.
 */
export function inScope<T extends { file: string }>(pkg: string, hits: T[], owner: (p: string) => string, related: Related): T[] {
  const near = hits.filter((ep) => related(pkg, owner(ep.file)));
  if (near.length) return near;
  return new Set(hits.map((ep) => owner(ep.file))).size <= 1 ? hits : [];
}
