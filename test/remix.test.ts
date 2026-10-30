import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { matchCalls } from "../src/analyze/calls.ts";
import { parseFile } from "../src/analyze/resolve.ts";
import { detectRemix, handListedRoutes, remixRoots, routeId, routeUrl } from "../src/analyze/remix.ts";
import { Facts, type Package } from "../src/model/schema.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import { deriveTours } from "../src/model/derivedtours.ts";

const fixture = fileURLToPath(new URL("./fixtures/remix-app", import.meta.url));
const f = Facts.parse(analyze(fixture));

test("remix: a React Router framework-mode app is a web app", () => {
  assert.deepEqual(f.packages.map((p) => [p.id, p.kind]), [["remix-app", "web"]]);
});

test("remix: flat route modules with a default export are pages", () => {
  assert.deepEqual(f.pages.map((p) => `${p.route} ${p.file}`).sort(), [
    "/ app/routes/_marketing+/_index.tsx", // pathless `_marketing` folder, index route
    "/* app/routes/$.tsx", // splat
    "/login app/routes/_auth+/login.tsx", // a page with an action is still a page (and its action an endpoint)
    "/users app/routes/users+/_index.tsx",
    "/users/:username app/routes/users+/$username.tsx",
    "/users/:username/notes/:noteId/edit app/routes/users+/$username_+/notes.$noteId_.edit.tsx", // trailing _ escapes nesting
  ]);
});

test("remix: resource routes and page actions are http endpoints", () => {
  assert.deepEqual(f.endpoints.map((e) => `${e.kind} ${e.methods?.join(",")} ${e.name} ${e.file}:${e.line}`), [
    "http POST /login app/routes/_auth+/login.tsx:3", // a page's action (#295); a page's loader is not an endpoint
    "http POST /logout app/routes/_auth+/logout.tsx:1",
    "http GET /resources/healthcheck app/routes/resources+/healthcheck.ts:3",
    "http POST /resources/theme-switch app/routes/resources+/theme-switch.tsx:1", // export { action } from "./x.server"
    "http GET /sitemap.xml app/routes/sitemap[.]xml.ts:1", // [.] escapes the dot
  ]);
  // .server files, tests and +colocated files are never routes
  for (const p of [...f.pages, ...f.endpoints]) assert.doesNotMatch(p.file, /\.server\.|\.test\.|\/\+shared\//);
});

test("remix: forms posting to a resource route are calls to it", () => {
  assert.deepEqual(f.calls.map((c) => `${c.from}:${c.line} -> ${c.endpoint} (${c.to})`), [
    "app/components/login-form.tsx:6 -> /login (app/routes/_auth+/login.tsx)",
    "app/components/theme-form.tsx:2 -> /resources/theme-switch (app/routes/resources+/theme-switch.tsx)",
    "app/routes/users+/$username.tsx:8 -> /logout (app/routes/_auth+/logout.tsx)",
  ]);
});

test("remix: pathless layouts are layout route files", () => {
  assert.deepEqual(f.routeFiles.map((r) => `${r.role} ${r.route} ${r.file}`), ["layout / app/routes/_auth+/_layout.tsx"]);
});

test("remix: derived tours start from file-convention pages, not only endpoints", () => {
  const g = defaultGrouping(f), a = assign(g, f);
  assert.deepEqual(a.errors, []);
  const titles = deriveTours(buildModel(f, g, a.leafOf), f).map((t) => t.title);
  assert.ok(titles.includes("From the /login page to Database (Prisma)"), titles.join("; "));
});

test("remix: route ids per convention", () => {
  assert.equal(routeId("_auth+/login", "hybrid"), "_auth.login");
  assert.equal(routeId("users+/$username", "hybrid"), "users.$username");
  assert.equal(routeId("users+/_layout", "hybrid"), "users._layout");
  assert.equal(routeId("users.$id/route", "flat"), "users.$id"); // a route folder
  assert.equal(routeId("users.$id/avatar", "flat"), null); // colocated in a route folder
  assert.equal(routeId("users/$id/edit", "flat"), null); // flat routes don't nest folders
  assert.equal(routeId("users/$username/notes/index", "auto"), "users.$username.notes._index");
  assert.equal(routeId("auth.$provider/callback", "auto"), "auth.$provider.callback");
  assert.equal(routeId("settings/profile/_layout", "auto"), "settings.profile._layout");
  assert.equal(routeId("notes/+shared/editor", "auto"), null);
  assert.equal(routeId("_auth/login.server", "auto"), null);
  assert.equal(routeId("__note-editor", "flat"), null);
  assert.equal(routeId("__note-editor", "hybrid"), null);
  for (const [rest, id] of [
    ["notes/$noteId", "notes.$noteId"], ["notes/index", "notes._index"], ["index", "_index"], ["notes", "notes"],
    ["__auth", "__auth"], ["__auth/login", "__auth.login"], ["files/$", "files.$"], ["notes/$noteId/edit", "notes.$noteId.edit"],
    ["notes/note.server", null],
  ] as const) assert.equal(routeId(rest, "nested"), id, rest);
});

test("remix: route URLs in React Router notation", () => {
  const url = (id: string) => routeUrl(id).route;
  assert.equal(url("_auth.login"), "/login");
  assert.equal(url("__auth.login"), "/login");
  assert.equal(url("files.$"), "/files/*");
  assert.equal(url("notes._index"), "/notes");
  assert.deepEqual(routeUrl("__auth"), { route: "/", layout: true });
  assert.deepEqual(routeUrl("notes"), { route: "/notes", layout: false });
  assert.equal(url("users.$username.notes._index"), "/users/:username/notes");
  assert.equal(url("users.$username_.notes.$noteId_.edit"), "/users/:username/notes/:noteId/edit");
  assert.equal(url("$"), "/*");
  assert.equal(url("($lang).about"), "/:lang?/about");
  assert.equal(url("robots[.]txt"), "/robots.txt");
  assert.equal(url("_index"), "/");
  assert.deepEqual(routeUrl("settings.profile._layout"), { route: "/settings/profile", layout: true });
  assert.deepEqual(routeUrl("_auth"), { route: "/", layout: true });
  assert.deepEqual(routeUrl("_index"), { route: "/", layout: false });
});

const pkg = (deps: string[]): Package => ({ id: "app", name: "app", dir: "", kind: "web", deps });
const detect = (files: Record<string, string>, deps: string[]) =>
  detectRemix({ sourcePaths: Object.keys(files).sort(), packages: [pkg(deps)], read: (p) => files[p] });
const PAGE = "export default function P() { return null }\n";
const RESOURCE = "export function loader() { return null }\n";

test("remix: react-router-auto-routes nests folders, with index and _layout files", () => {
  const r = detect({
    "app/routes.ts": "import { autoRoutes } from 'react-router-auto-routes'\nexport default autoRoutes()\n",
    "app/routes/_auth/login.tsx": PAGE,
    "app/routes/_auth/auth.$provider/index.ts": RESOURCE,
    "app/routes/users/$username/notes/new.tsx": PAGE,
    "app/routes/users/$username/notes/_layout.tsx": PAGE,
    "app/routes/users/$username/notes/+shared/editor.tsx": PAGE,
  }, ["react-router"]);
  assert.deepEqual(r.pages.map((p) => p.route), ["/login", "/users/:username/notes/new"]);
  assert.deepEqual(r.endpoints.map((e) => e.name), ["/auth/:provider"]);
  assert.deepEqual(r.routeFiles.map((x) => `${x.role} ${x.route}`), ["layout /users/:username/notes"]);
});

test("remix: @react-router/fs-routes flat routes, and Remix v2 with no routes.ts", () => {
  const files = {
    "app/routes/_index.tsx": PAGE,
    "app/routes/users.$id/route.tsx": PAGE,
    "app/routes/users.$id/avatar.tsx": PAGE,
    "app/routes/api.users.ts": RESOURCE,
  };
  const fsRoutes = { ...files, "app/routes.ts": "import { flatRoutes } from '@react-router/fs-routes'\nexport default flatRoutes()\n" };
  for (const r of [detect(fsRoutes, ["react-router"]), detect(files, ["@remix-run/react"])]) {
    assert.deepEqual(r.pages.map((p) => p.route), ["/", "/users/:id"]);
    assert.deepEqual(r.endpoints.map((e) => e.name), ["/api/users"]);
  }
});

test("remix: a hand-listed routes.ts lists pages; a plain React Router SPA has none", () => {
  const files = { "app/routes/home.tsx": PAGE };
  assert.deepEqual(detect({ ...files, "app/routes.ts": "import { index } from '@react-router/dev/routes'\nexport default [index('routes/home.tsx')]\n" }, ["react-router"]).pages, [
    { route: "/", file: "app/routes/home.tsx", from: "app/routes.ts", line: 2 },
  ]);
  assert.deepEqual(detect(files, ["react-router"]).pages, []);
});

const IMP = "import { route, index, layout, prefix } from '@react-router/dev/routes'\n";
const hand = (body: string) => handListedRoutes("app/routes.ts", `${IMP}export default ${body}\n`).map((h) => `${h.kind} ${h.path} ${h.file}`);

test("remix: handListedRoutes resolves nested route, index, layout and prefix paths", () => {
  assert.deepEqual(hand("[route('users/:id', 'u.tsx', { id: 'u' }, [route('edit', 'e.tsx')])]"), ["route /users/:id u.tsx", "route /users/:id/edit e.tsx"]);
  assert.deepEqual(hand("[route('/a', 'a.tsx', [route('/a/b', 'b.tsx')])]"), ["route /a a.tsx", "route /a/b b.tsx"]);
  assert.deepEqual(hand("[...prefix('/api/', [route('/x', 'x.tsx')])]"), ["route /api/x x.tsx"]);
  assert.deepEqual(hand("[route(':lang?/about', 'a.tsx'), route('*', 's.tsx')]"), ["route /:lang?/about a.tsx", "route /* s.tsx"]);
  assert.deepEqual(hand("[layout('l.tsx', prefix('/m', [index('i.tsx')]))]"), ["layout / l.tsx", "index /m i.tsx"]);
  assert.deepEqual(hand("[prefix('/a', [prefix('b', [index('i.tsx')])])]"), ["index /a/b i.tsx"]);
  assert.equal(handListedRoutes("app/routes.ts", "import { route as r } from '@react-router/dev/routes'\nexport default [r('/x', 'x.tsx')]\n")[0].path, "/x");
  assert.deepEqual(handListedRoutes("app/routes.ts", `${IMP}const routes = [index('i.tsx')] satisfies RouteConfig\nexport default routes\n`).map((h) => h.file), ["i.tsx"]);
});

test("remix: handListedRoutes skips computed routes, other imports and comments", () => {
  assert.deepEqual(hand("[...['a', 'b'].map((p) => route(p, `${p}.tsx`)), hydrogenRoutes([route('x', 'x.tsx')]), route(p, 'p.tsx')]"), []);
  assert.deepEqual(handListedRoutes("app/routes.ts", "import { route } from 'express'\nexport default [route('/x', 'x.tsx')]\n"), []);
  assert.deepEqual(hand("[\n// route('/old', 'old.tsx'),\n index('i.tsx')]"), ["index / i.tsx"]);
  assert.equal(handListedRoutes("app/routes.ts", `${IMP}export default [\n\nindex('i.tsx')]\n`)[0].line, 4);
});

test("remix: a routes.ts mixing flatRoutes with literal routes reports both, without duplicates", () => {
  const r = detect({
    "app/routes.ts": "import { flatRoutes } from '@react-router/fs-routes'\nimport { route } from '@react-router/dev/routes'\nexport default [...(await flatRoutes()), route('/extra', 'extra.tsx'), route('/dup', 'routes/_index.tsx')]\n",
    "app/routes/_index.tsx": PAGE,
    "app/extra.tsx": PAGE,
  }, ["react-router"]);
  assert.deepEqual(r.pages.map((p) => p.route).sort(), ["/", "/extra"]);
});

test("remix: hand-listed routes in a monorepo package, missing modules and a resource route at /", () => {
  const files: Record<string, string> = {
    "apps/mail/app/routes.ts": "import { route, index } from '@react-router/dev/routes'\nexport default [index('api.ts'), route('/m', 'routes/m.tsx'), route('/gone', 'routes/gone.tsx')]\n",
    "apps/mail/app/routes/m.tsx": PAGE,
    "apps/mail/app/api.ts": RESOURCE,
  };
  const r = detectRemix({ sourcePaths: Object.keys(files).sort(), packages: [{ id: "mail", name: "mail", dir: "apps/mail", kind: "web", deps: ["react-router"] }], read: (p) => files[p] });
  assert.deepEqual(r.pages, [{ route: "/m", file: "apps/mail/app/routes/m.tsx", from: "apps/mail/app/routes.ts", line: 2 }]);
  assert.deepEqual(r.endpoints, []);
});

test("remix: a React Router app with a hand-listed routes.ts, end to end", () => {
  const g = Facts.parse(analyze(fileURLToPath(new URL("./fixtures/rr-routes", import.meta.url))));
  assert.deepEqual(g.pages.map((p) => `${p.route} ${p.file} ${p.from}`).sort(), [
    "/ app/page.tsx app/routes.ts",
    "/* app/meta-files/not-found.tsx app/routes.ts",
    "/mail app/(routes)/mail/page.tsx app/routes.ts",
    "/mail/:folder app/(routes)/mail/[folder]/page.tsx app/routes.ts",
  ]);
  assert.deepEqual(g.endpoints.map((e) => `${e.kind} ${e.methods?.join(",")} ${e.name} ${e.file}:${e.line}`).sort(), [
    "http GET /api/info app/routes/api/info.ts:2",
    "http GET /api/mailto-handler app/mailto-handler.ts:1",
  ]);
  assert.deepEqual(g.routeFiles.map((x) => `${x.role} ${x.route} ${x.file}`), ["layout / app/(routes)/layout.tsx"]);
});

test("remix: a resource route with a loader and an action answers GET and POST (#244)", () => {
  const r = detect({
    "app/routes/api.items.ts": "export async function action() { return null }\nexport function loader() { return null }\n",
    "app/routes/api.ping.ts": "export function loader() { return null }\n",
  }, ["@remix-run/react"]);
  assert.deepEqual(r.endpoints.map((e) => `${e.name}:${e.line} ${e.methods?.join(",")}`), ["/api/items:1 GET,POST", "/api/ping:1 GET"]);
});

test("remix: a page with only a loader is no endpoint; a page's action answers POST (#295)", () => {
  const r = detect({
    "app/routes/login.tsx": "export async function action() {}\n" + PAGE,
    "app/routes/users.tsx": "export function loader() {}\n" + PAGE,
    "app/routes/_index.tsx": "export async function action() {}\n" + PAGE,
  }, ["@remix-run/react"]);
  assert.deepEqual(r.endpoints.map((e) => `${e.name}:${e.line} ${e.methods?.join(",")}`), ["/login:1 POST"]);
  assert.deepEqual(r.pageActions.map((e) => `${e.name}:${e.line} ${e.methods?.join(",")}`), ["/login:1 POST"]);
  assert.deepEqual(r.pages.map((p) => p.route).sort(), ["/", "/login", "/users"]);
});

test("remix: only form posts reach a page's action; redirects, links and fetches don't (#295)", () => {
  const r = detect({
    "app/routes/login.tsx": "export async function action() {}\n" + PAGE,
    "app/routes/api.ping.ts": RESOURCE,
  }, ["@remix-run/react"]);
  const cases: [string, boolean, boolean][] = [
    // [line, matches /login, matches /api/ping]
    ['const a = <form method="post" action="/login" />;', true, false],
    ['const a = <Form method="POST" action="/login" />;', true, false],
    ['const a = <fetcher.Form method="post" action="/login" />;', true, false],
    ['const a = <Form method="post"><button formAction="/login" /></Form>;', true, false],
    ['const a = <button formAction="/login" formMethod="post" />;', true, false],
    ['fetcher.submit(data, { action: "/login", method: "post" });', true, false],
    ['go(data, { method: "delete", action: "/login" });', true, false],
    ['const a = <Form action="/login" />;', false, false],
    ['const a = <Form method="get" action="/login" />;', false, false],
    ['const a = <Form method={m} action="/login" />;', false, false],
    ['const a = <button formAction="/login" />;', false, false],
    ['const a = <Link to="/login" />;', false, false],
    ['const a = <a href="/login" />;', false, false],
    ['redirect("/login");', false, false],
    ['navigate("/login");', false, false],
    ['fetch("/login", { method: "POST" });', false, false],
    ['useIsPending({ formAction: "/login", formMethod: "POST" });', false, false],
    ['submit(data, { action: "/login" });', false, false],
    ['redirect("/api/ping");', false, true],
    ['const a = <a href="/api/ping" />;', false, true],
  ];
  // one construct per line; `go` is bound by useSubmit() on line 1
  const src = "const go = useSubmit();\n" + cases.map((c) => c[0]).join("\n") + "\n";
  const pf = parseFile("app/components/c.tsx", src);
  const calls = matchCalls(new Map([["app/components/c.tsx", pf]]), () => "app", r.endpoints, undefined, new Set(r.pageActions));
  const got = calls.map((c) => `${c.line - 2} -> ${c.endpoint}`);
  const want = cases.flatMap((c, i) => [...(c[1] ? [`${i} -> /login`] : []), ...(c[2] ? [`${i} -> /api/ping`] : [])]);
  assert.deepEqual(got, want);
});

test("remix: Remix v1 nested folders are told from the routes/ shape (#328)", () => {
  const conv = (files: string[], extra: Record<string, string> = {}, deps = ["@remix-run/react"]) =>
    remixRoots({ sourcePaths: [...files, ...Object.keys(extra)].sort(), packages: [pkg(deps)], read: (p) => extra[p] ?? PAGE })[0]?.convention;
  const r = (...n: string[]) => n.map((x) => `app/routes/${x}`);
  for (const files of [
    r("notes.tsx", "notes/index.tsx"), r("__auth/login.tsx"), r("admin/users.tsx"), r("blog/2024/post.tsx"),
  ]) assert.equal(conv(files), "nested", files.join());
  for (const files of [
    r("_index.tsx", "users.$id/route.tsx", "users.$id/avatar.tsx"),
    r("_index.tsx", "admin/users.tsx"),
    r("_index/route.tsx", "_index/components/hero.tsx"),
    r("index.tsx", "login.tsx"),
    r("users.$id/index.tsx"),
    r("users+/$username.tsx", "_auth+/login.tsx", "users+/+shared/x.tsx"),
    r("__note-editor.tsx", "login.tsx"),
    r("notes/note.server.ts", "notes.tsx"),
  ]) assert.equal(conv(files), "flat", files.join());
  assert.equal(conv(r("notes.tsx", "notes/index.tsx"), { "remix.config.js": "require('remix-flat-routes')" }), "hybrid");
  assert.equal(conv(r("notes.tsx", "notes/index.tsx"), {}, ["react-router"]), undefined);
});

const v1 = Facts.parse(analyze(fileURLToPath(new URL("./fixtures/remix-v1", import.meta.url))));

test("remix: a Remix v1 app with nested route folders (#328)", () => {
  assert.deepEqual(v1.packages.map((p) => [p.id, p.kind]), [["remix-v1", "web"]]);
  assert.deepEqual(v1.pages.map((p) => `${p.route} ${p.file}`).sort(), [
    "/ app/routes/index.tsx",
    "/files/* app/routes/files/$.tsx",
    "/login app/routes/__auth/login.tsx",
    "/notes app/routes/notes.tsx",
    "/notes app/routes/notes/index.tsx",
    "/notes/:noteId app/routes/notes/$noteId.tsx",
    "/notes/new app/routes/notes/new.tsx",
  ]);
  assert.deepEqual(v1.endpoints.map((e) => `${e.kind} ${e.methods?.join(",")} ${e.name} ${e.file}:${e.line}`).sort(), [
    "http GET /healthcheck app/routes/healthcheck.tsx:1",
    "http POST /notes/:noteId app/routes/notes/$noteId.tsx:5",
    "http POST /notes/new app/routes/notes/new.tsx:1",
  ]);
  assert.deepEqual(v1.routeFiles.map((r) => `${r.role} ${r.route} ${r.file}`), ["layout / app/routes/__auth.tsx"]);
});
