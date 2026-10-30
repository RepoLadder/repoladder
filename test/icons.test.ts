import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { serviceFor } from "../src/analyze/services.ts";
import { boardSvg } from "../src/build/export.ts";
import { pageData } from "../src/build/filepack.ts";
import { renderHtml } from "../src/build/html.ts";
import { baseSize, type BoardLayout } from "../src/build/layout.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";
import { CATEGORIES, Facts } from "../src/model/schema.ts";
import { ICONS, usedIcons } from "../src/viewer/icons.ts";
import { ICON_ROOM, boxBody } from "../src/viewer/shapes.ts";

test("icons: SDK imports map to a category", () => {
  const cat = (spec: string) => serviceFor(spec)?.category;
  assert.equal(cat("stripe"), "payments");
  assert.equal(cat("@stripe/stripe-js"), "payments");
  assert.equal(cat("@anthropic-ai/sdk"), "ai");
  assert.equal(cat("openai"), "ai");
  assert.equal(cat("@google/genai"), "ai");
  assert.equal(cat("@google-cloud/storage"), "storage");
  assert.equal(cat("@google-cloud/logging"), "monitoring");
  assert.equal(cat("@google-cloud/translate"), "cloud");
  assert.equal(cat("firebase/auth"), "auth");
  assert.equal(cat("@aws-sdk/client-s3"), "storage");
  assert.equal(cat("@aws-sdk/client-ec2"), "cloud");
  assert.equal(cat("mongoose"), "database");
  assert.equal(cat("@prisma/client"), "database");
  assert.equal(cat("ioredis"), "database");
  assert.equal(cat("nodemailer"), "email");
  assert.equal(cat("resend"), "email");
  assert.equal(cat("twilio"), "sms");
  assert.equal(cat("next-auth"), "auth");
  assert.equal(cat("@vercel/blob"), "storage");
  assert.equal(cat("posthog-js"), "analytics");
  assert.equal(cat("@sentry/node"), "monitoring");
  assert.equal(cat("algoliasearch"), "search");
  assert.equal(cat("@slack/web-api"), "messaging");
  assert.equal(cat("@octokit/rest"), "other");
});

test("icons: every category has a glyph, and only used ones are emitted", () => {
  assert.deepEqual(Object.keys(ICONS).sort(), [...CATEGORIES].sort());
  // the whole set stays small: it is an upper bound on what a page can carry
  assert.ok(Object.values(ICONS).join("").length < 1200);
  assert.deepEqual(usedIcons({ "svc-a": "ai", "svc-b": "ai", "store-x": "database" }), { ai: ICONS.ai, database: ICONS.database });
  assert.deepEqual(usedIcons({ "svc-a": "ai", "svc-b": "email" }, ["svc-b"]), { email: ICONS.email });
});

test("icons: facts carry categories, and the model gives every service and store one", () => {
  const facts = analyze(fileURLToPath(new URL("./fixtures/stores", import.meta.url)));
  assert.deepEqual(facts.services.map((s) => [s.id, s.category]), [["firestore", "database"], ["postgres", "database"], ["supabase", "database"]]);
  const grouping = defaultGrouping(facts);
  const model = buildModel(facts, grouping, assign(grouping, facts).leafOf);
  assert.deepEqual(model.categories, { "store-firestore": "database", "store-prisma": "database", "store-supabase": "database" });
  for (const id of Object.keys(model.services)) assert.ok(model.categories![id], id);

  // the page carries the categories and only the glyphs they use
  const html = renderHtml(model, {});
  const data = pageData(html);
  assert.deepEqual(Object.keys(data.icons), ["database"]);
  assert.equal(data.categories["store-firestore"], "database");

  // a cylinder with a glyph is taller, so the glyph has room above the name
  const root = model.boards.root, store = root.nodes.find((id) => id.startsWith("store-"))!;
  const noCat = { ...model, categories: undefined };
  assert.equal(baseSize(model, "root", store)[1] - baseSize(noCat, "root", store)[1], ICON_ROOM);

  // the SVG export draws the glyph in the cylinder
  const n: BoardLayout["n"] = root.nodes.map((id, i) => [id, i * 200, 0, 160, 100, model.services[id] ? 1 : 0]);
  const svg = boardSvg(model, "root", { n, e: [] });
  assert.ok(svg.includes(`d="${ICONS.database}"`));
  assert.ok(svg.includes(".node .ico"));
});

test("icons: old facts without categories still parse and draw no glyph", () => {
  const facts = Facts.parse({ ...analyze(fileURLToPath(new URL("./fixtures/stores", import.meta.url))), services: [{ id: "stripe", name: "Stripe" }] });
  assert.equal(facts.services[0].category, undefined);
  assert.ok(!boxBody({ x: 0, y: 0, w: 100, h: 80, name: "Stripe", subs: ["service"], svc: true }).includes('class="ico"'));
  assert.ok(boxBody({ x: 0, y: 0, w: 100, h: 104, name: "Stripe", subs: ["service"], svc: true, icon: ICONS.payments }).includes('class="ico"'));
});
