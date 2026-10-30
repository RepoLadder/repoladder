import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { assign } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import { Facts, type Grouping } from "../src/model/schema.ts";
import { summarize } from "../src/model/summary.ts";

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const show = (f: Facts) => f.pages.map((p) => `${p.from}:${p.line} ${p.route} -> ${p.file}${p.component ? ` (${p.component})` : ""}`);
const routes = Facts.parse(analyze(fixture("routes")));

test("pages: React Router JSX routes (nested, index, lazy, constants, barrels, guards)", () => {
  assert.deepEqual(show(routes).filter((s) => s.startsWith("src/App.tsx")), [
    "src/App.tsx:17 / -> src/pages/Home.tsx (Home)", // through the pages/index.ts barrel
    // /old is a <Navigate> redirect: no page
    "src/App.tsx:19 /settings -> src/pages/Settings.tsx (Settings)", // path from an imported constant; Guard wrapper skipped
    "src/App.tsx:20 /me -> src/pages/Profile.tsx (Profile)", // ROUTES.profile
    // /app's Layout is a layout around its index child, not a page
    "src/App.tsx:22 /app -> src/pages/Dashboard.tsx (Dashboard)",
    "src/App.tsx:23 /app/billing -> src/pages/Billing.tsx (Billing)", // lazy() const in another module
    "src/App.tsx:24 /app/billing/:invoiceId -> src/pages/Invoice.tsx", // lazy={() => import()}
    "src/App.tsx:27 /app/inline -> src/App.tsx (Inline)", // pathless layout route passes its parent's path through
    // `/computed/${1}` can't be read statically and is skipped rather than guessed
  ]);
});

test("pages: createBrowserRouter route objects (nested, index, lazy, Component)", () => {
  assert.deepEqual(show(routes).filter((s) => s.startsWith("src/router.tsx")), [
    "src/router.tsx:12 /admin -> src/pages/Dashboard.tsx",
    "src/router.tsx:13 /admin/team -> src/pages/Team.tsx",
    "src/router.tsx:14 /about -> src/pages/NotFound.tsx (NotFound)", // absolute child path
    "src/router.tsx:17 /* -> src/pages/NotFound.tsx (NotFound)",
    // the `nav` menu array has paths but no components: not routes
  ]);
});

test("pages: TanStack file routes", () => {
  // src/routes/api/auth.$.ts is a TanStack Start API route (server handlers, no component): not a page (#235)
  assert.deepEqual(show(routes).filter((s) => s.startsWith("src/routes/")), ["src/routes/about.tsx:3 /about -> src/pages/About.tsx (About)"]);
});

test("pages: Next.js app/ and pages/ conventions", () => {
  const f = analyze(fixture("next-app"));
  assert.deepEqual(f.pages.map((p) => `${p.route} -> ${p.file}`), [
    "/pricing -> app/(marketing)/pricing/page.tsx",
    "/cart -> app/(shop)/cart/page.tsx",
    "/login -> app/@modal/login/page.tsx",
    "/blog/[slug] -> app/blog/[slug]/page.tsx",
    "/dashboard -> app/dashboard/page.tsx",
    "/ -> app/page.tsx",
    "/docs/[...slug] -> pages/docs/[...slug].tsx",
    "/docs -> pages/docs/index.tsx",
    "/ -> pages/index.tsx",
  ]);
});

test("pages: plain folders named pages/ are not Next.js pages", () => {
  assert.deepEqual(analyze(fixture("basic-app")).pages, []);
});

test("pages: leaves list their routes, and the digest includes them", () => {
  const g: Grouping = {
    version: 1,
    summary: "",
    children: [
      { id: "admin", name: "Admin", summary: "", files: ["src/pages/Dashboard.tsx", "src/pages/Team.tsx"] },
      { id: "rest", name: "Rest", summary: "", files: ["**"] },
    ],
  };
  const m = buildModel(routes, g, assign(g, routes).leafOf);
  assert.deepEqual(m.nodes.admin.pages, ["/admin", "/admin/team", "/app"]);
  assert.equal(m.nodes.root.pages, undefined);
  const digest = summarize(routes);
  assert.match(digest, /## Pages users see/);
  assert.match(digest, /src\/pages\/Dashboard\.tsx: \/app, \/admin/);
});
