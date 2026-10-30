import { ROUTE_EXPORTS, passesThrough } from "../model/fgraph.ts";
import { readdirSync } from "node:fs";
import { basename, resolve as resolvePath } from "node:path";
import type { Call, Endpoint, External, Facts, Import, Service, ServiceUse, SourceFile, Unresolved } from "../model/schema.ts";
import { matchCalls, matchTrpcCalls, packageRelation } from "./calls.ts";
import { githubSource, gitOwns, gitSha, isSourcePath } from "./files.ts";
import { resolveMeta, type AnalyzeOptions } from "./options.ts";
import { diskSource, type FileSource } from "./source.ts";
import { checkPaths, readSources } from "./input.ts";
import type { Limits } from "../build/limits.ts";
import { detectPackages, workspacePackages } from "./packages.ts";
import { detectNext, directiveOf } from "./nextjs.ts";
import { detectPages } from "./pages.ts";
import { detectRemix } from "./remix.ts";
import { parseFile, Resolver, type ParsedFile } from "./resolve.ts";
import { linkRoutes } from "./routes.ts";
import { foldAiModel, servicesOf } from "./services.ts";
import { detectStores } from "./stores.ts";
import { readmeFacts } from "./readmes.ts";
import type { OnProgress, Stage } from "../build/progress.ts";

// Non-code imports (styles, images, fonts, data) aren't architecture.
const ASSET = /\.(css|scss|sass|less|styl|svg|png|jpe?g|gif|webp|avif|ico|bmp|woff2?|ttf|otf|eot|mp4|webm|mp3|wav|json|md|mdx|html|txt|csv|ya?ml|wasm)$/i;


/** `limits` switches on the input checks (empty, shape, size), which throw InputError; without it nothing is checked. */
export function analyze(rootArg: string, opts: AnalyzeOptions = {}, limits?: Limits, onProgress?: OnProgress): Facts {
  const root = resolvePath(rootArg);
  const useGit = opts.git !== "off" && gitOwns(root);
  const meta = resolveMeta(opts, basename(root), useGit ? { sha: () => gitSha(root), github: () => githubSource(root) } : null);
  return analyzeSource(diskSource(root, { useGit, name: meta.repo }), { sha: meta.sha, github: meta.github }, limits, onProgress);
}

/** The facts of the repo a source holds; `meta` is what a source can't tell (commit, GitHub origin). */
export function analyzeSource(src: FileSource, meta: { sha: string | null; github: { repo: string; sha: string; dir: string } | null }, limits?: Limits, onProgress?: OnProgress): Facts {
  const mark = (stage: Stage, kind: "start" | "done") => onProgress?.({ stage, kind, unit: "files" });
  const tick = (stage: Stage, done: number, of: number) => onProgress?.({ stage, kind: "tick", unit: "files", done, total: of });
  const allPaths = src.list();
  const sourcePaths = allPaths.filter(isSourcePath);
  if (limits) checkPaths(allPaths, sourcePaths, limits, src.kind === "disk" ? src.root : undefined, src.kind === "disk" && allPaths.length === 0 && readdirSync(src.root).length > 0);
  const { packages, owner } = detectPackages(src, allPaths, sourcePaths);
  const readmes = readmeFacts(src, allPaths, sourcePaths);
  const inRepo = new Set(sourcePaths);

  mark("read", "start");
  let texts: Map<string, string>;
  if (limits) {
    texts = readSources(sourcePaths, (p) => src.read(p), limits, (d, n) => tick("read", d, n));
  } else {
    texts = new Map<string, string>();
    let i = 0;
    for (const p of sourcePaths) { texts.set(p, src.read(p)); tick("read", ++i, sourcePaths.length); }
  }
  mark("read", "done");
  mark("parse", "start");
  const parsed = new Map<string, ParsedFile>();
  let parsedN = 0;
  for (const p of sourcePaths) { parsed.set(p, parseFile(p, texts.get(p)!)); tick("parse", ++parsedN, sourcePaths.length); }
  mark("parse", "done");

  const resolver = new Resolver(src, workspacePackages(src, allPaths), inRepo);
  const resolveLocal = (spec: string, from: string) => {
    const r = resolver.resolve(spec, from);
    return r && "file" in r && inRepo.has(r.file) ? r.file : null;
  };

  // Follow a name through re-exports to the file that defines it (#256): through pure barrels and
  // through files that re-export beside code of their own (a package's index.ts). Null when `file`
  // doesn't export `name` as far as we can see.
  const definer = (file: string, name: string, depth = 0): string | null => {
    const f = parsed.get(file);
    if (!f || depth > 8) return null;
    for (const re of f.reexports) {
      const pair = re.names?.find(([as]) => as === name);
      if (!pair) continue;
      const target = resolveLocal(re.spec, file);
      return target && (pair[1] === "*" ? target : definer(target, pair[1], depth + 1) ?? target);
    }
    // a file's own exports shadow its `export *`s, which never carry a default
    if (f.exports.has(name)) return file;
    if (name === "default") return null;
    for (const re of f.reexports) {
      if (re.names) continue;
      const target = resolveLocal(re.spec, file);
      const d = target && definer(target, name, depth + 1);
      if (d) return d;
    }
    return null;
  };

  const next = detectNext({ sourcePaths, packages, read: (p) => texts.get(p)! });
  const remix = detectRemix({ sourcePaths, packages, read: (p) => texts.get(p)! });
  const actionsByFile = new Map<string, Set<string>>();
  for (const ep of next.endpoints) if (ep.kind === "action") actionsByFile.set(ep.file, new Set([...(actionsByFile.get(ep.file) ?? []), ep.name]));
  const actionCalls: Call[] = [];

  const files: SourceFile[] = [];
  const imports: Import[] = [];
  const externals: External[] = [];
  // the full specifier ("firebase/auth"): externals keep only the package, services need the subpath
  const sdkImports: (External & { names: string[]; kind: string })[] = [];
  const unresolved: Unresolved[] = [];

  mark("resolve", "start");
  let resolvedN = 0;
  for (const from of sourcePaths) {
    tick("resolve", ++resolvedN, sourcePaths.length);
    const pf = parsed.get(from)!;
    const directive = directiveOf(texts.get(from)!);
    // Exported names feed the file boxes of a leaf's file board ("default" says nothing on its own).
    const exportNames = [...pf.exports].filter((x) => x !== "default").sort();
    files.push({ path: from, pkg: owner(from), loc: pf.loc, ...(directive ? { directive } : {}), ...(exportNames.length ? { exports: exportNames } : {}) });
    const seen = new Set<string>();
    const push = (imp: Import) => {
      const k = `${imp.to}\0${imp.line}\0${imp.kind}`;
      if (!seen.has(k)) { seen.add(k); imports.push(imp); }
    };
    // Importing a server action and calling it is a network call to the server, not a local one.
    const actionCall = (imp: { line: number; kind: string }, name: string, to: string) => {
      if (imp.kind !== "type" && to !== from && actionsByFile.get(to)?.has(name)) actionCalls.push({ from, line: imp.line, to, endpoint: name, kind: "action" });
    };
    for (const imp of pf.imports) {
      const r = resolver.resolve(imp.spec, from);
      if (!r && ASSET.test(imp.spec.replace(/\?.*$/, ""))) continue;
      if (!r) { unresolved.push({ from, spec: imp.spec, line: imp.line }); continue; }
      if ("external" in r) {
        externals.push({ from, spec: r.external, line: imp.line });
        sdkImports.push({ from, spec: imp.spec, line: imp.line, names: imp.names, kind: imp.kind });
        continue;
      }
      if (!inRepo.has(r.file)) continue; // tests, generated output, json, etc.
      // Named imports go to the file that defines each name; the re-exporting file keeps only the
      // names it defines itself. A namespace import can't be traced, so it stays there.
      if (parsed.get(r.file)!.reexports.length && !pf.isBarrel && !imp.names.includes("*")) {
        const real = imp.names.map((n) => definer(r.file, n) ?? r.file);
        for (const to of new Set(real)) push({ from, to, line: imp.line, kind: imp.kind, ...(to !== r.file ? { via: r.file } : {}) });
        imp.names.forEach((n, i) => actionCall(imp, n, real[i]));
        continue;
      }
      push({ from, to: r.file, line: imp.line, kind: imp.kind });
      for (const n of imp.names) actionCall(imp, n, r.file);
    }
  }

  // A re-export is a pass-through only when an importer was routed past it above (`via`): that
  // importer already points at the defining file, so drawing the re-export too would point the
  // barrel at every module it lists. Every other re-export is a connection and is an edge: a
  // route's (`export { action } from "./editor.server"`), a package entry's or a types index's
  // nothing imports, and an imported barrel's names no importer used.
  const pages = detectPages({ sourcePaths, packages, read: (p) => texts.get(p)!, resolveLocal }, remix.pages);
  const routeFiles = [...next.routeFiles, ...remix.routeFiles].sort((a, b) => a.route.localeCompare(b.route) || a.file.localeCompare(b.file));
  const routed = new Set([...pages, ...routeFiles, ...next.endpoints, ...remix.endpoints].map((r) => r.file));
  const imported = new Set(imports.flatMap((i) => (i.via ? [i.to, i.via] : [i.to])));
  // The re-export pairs some routed import went through: for an import `via` V that reaches D, every
  // re-export pair on a chain V -> ... -> D.
  const rx = imports.filter((i) => i.kind === "reexport");
  const fwd = new Map<string, string[]>(), back = new Map<string, string[]>();
  for (const i of rx) {
    fwd.set(i.from, [...(fwd.get(i.from) ?? []), i.to]);
    back.set(i.to, [...(back.get(i.to) ?? []), i.from]);
  }
  const reach = (start: string, adj: Map<string, string[]>) => {
    const seen = new Set([start]);
    for (const f of seen) for (const n of adj.get(f) ?? []) seen.add(n);
    return seen;
  };
  const covered = new Set<string>();
  for (const i of imports) {
    if (!i.via) continue;
    const down = reach(i.via, fwd), up = reach(i.to, back);
    for (const r of rx) if (down.has(r.from) && up.has(r.to)) covered.add(`${r.from}\0${r.to}`);
  }
  const runs = (i: { from: string; to: string }) => {
    if (routed.has(i.from) || !covered.has(`${i.from}\0${i.to}`)) return true;
    const pf = parsed.get(i.from)!;
    return !imported.has(i.from) && (!pf.isBarrel || pf.reexports.some((re) => re.names?.some(([as]) => ROUTE_EXPORTS.has(as))));
  };
  for (const i of rx) if (runs(i)) i.runtime = true;

  const services = new Map<string, Service>();
  let serviceUses: ServiceUse[] = [];
  const seenUse = new Set<string>();
  const useAll = (list: typeof sdkImports, keep: (from: string, service: string) => boolean) => {
    for (const e of list) for (const { svc, line } of servicesOf(e.spec, e.line, () => texts.get(e.from)!, e)) {
      const k = `${e.from}\0${svc.id}\0${line}`;
      if (seenUse.has(k) || !keep(e.from, svc.id)) continue;
      seenUse.add(k);
      services.set(svc.id, svc);
      serviceUses.push({ from: e.from, service: svc.id, spec: e.spec, line });
    }
  };
  useAll(sdkImports.filter((e) => e.kind !== "type"), () => true);
  // A type-only import runs nothing. It counts only where the file is handed the client at runtime
  // by a file that uses the service (`import type { Stripe } from "stripe"` beside
  // `import { stripe } from "./config"`), not where it only names a type (a Session parameter).
  const runtimeUses = new Map<string, Set<string>>();
  for (const u of serviceUses) runtimeUses.set(u.from, (runtimeUses.get(u.from) ?? new Set()).add(u.service));
  const handed = new Set(imports.filter((i) => i.kind !== "type" && !passesThrough(i)).flatMap((i) => [...(runtimeUses.get(i.to) ?? [])].map((svc) => `${i.from}\0${svc}`)));
  useAll(sdkImports.filter((e) => e.kind === "type"), (from, svc) => handed.has(`${from}\0${svc}`));
  serviceUses = foldAiModel(serviceUses, services);
  serviceUses.sort((a, b) => a.from.localeCompare(b.from) || a.line - b.line || a.service.localeCompare(b.service));

  const endpoints: Endpoint[] = [];
  for (const [file, pf] of parsed) for (const ep of pf.endpoints) endpoints.push({ ...ep, file });
  const routes = linkRoutes(parsed, resolveLocal, owner);
  endpoints.push(...routes.endpoints, ...next.endpoints, ...remix.endpoints);
  endpoints.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  const related = packageRelation(packages, imports.map((i) => [owner(i.from), owner(i.to)]));
  const calls = [...matchCalls(parsed, owner, endpoints, related, new Set(remix.pageActions)), ...matchTrpcCalls(parsed, routes.trpc, owner, related), ...dedupe(actionCalls)]
    .sort((a, b) => a.from.localeCompare(b.from) || a.line - b.line || a.endpoint.localeCompare(b.endpoint));
  endpoints.push(...routes.trpc);
  endpoints.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

  const specs = new Set(externals.map((e) => e.spec));
  const has = (re: RegExp) => [...specs].some((s) => re.test(s));
  const prismaSchemas = allPaths.filter((p) => p.endsWith(".prisma") && !p.includes("node_modules/"));
  const { stores, storeUses, storeFields } = detectStores(sourcePaths, (p) => texts.get(p) ?? src.read(p), {
    firestore: has(/^(firebase|firebase-admin|@google-cloud\/firestore|@firebase\/firestore|react-firebase-hooks|reactfire)$/),
    // Prisma 7 generates the client into the repo (no @prisma/client import), so a schema or a driver adapter / extension import is the sign
    prisma: has(/^@prisma\/client$/) || has(/^@prisma\/(adapter|extension)-/) || prismaSchemas.length > 0,
    supabase: has(/^@supabase\//),
  }, (from, spec, name) => {
    const file = resolveLocal(spec, from);
    return file && (definer(file, name) ?? file);
  }, prismaSchemas);

  const byFromLine = (a: { from: string; line: number }, b: { from: string; line: number }) => a.from.localeCompare(b.from) || a.line - b.line;
  imports.sort((a, b) => byFromLine(a, b) || a.to.localeCompare(b.to));
  externals.sort((a, b) => byFromLine(a, b) || a.spec.localeCompare(b.spec));
  unresolved.sort((a, b) => byFromLine(a, b) || a.spec.localeCompare(b.spec));

  mark("resolve", "done");
  return {
    version: 1, repo: src.name, sha: meta.sha, github: meta.github, packages, files, imports, externals, unresolved,
    services: [...services.values()].sort((a, b) => a.id.localeCompare(b.id)),
    serviceUses, endpoints, calls, pages, routeFiles, stores, storeUses, storeFields,
    ...(readmes.length ? { readmes } : {}),
  };
}

function dedupe(calls: Call[]): Call[] {
  const seen = new Set<string>();
  return calls.filter((c) => {
    const k = `${c.from}\0${c.line}\0${c.to}\0${c.endpoint}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
}
