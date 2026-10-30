import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze/index.ts";
import { serviceFor, servicesOf } from "../src/analyze/services.ts";
import { renderHtml } from "../src/build/html.ts";
import { pageData } from "../src/build/filepack.ts";
import { subLines } from "../src/build/layout.ts";
import { assign, defaultGrouping } from "../src/model/grouping.ts";
import { buildModel } from "../src/model/rollup.ts";

const id = (spec: string) => serviceFor(spec)?.id ?? null;

test("services: umbrella SDKs are split by import subpath", () => {
  for (const s of ["firebase/auth", "firebase-admin/auth", "@firebase/auth", "react-firebase-hooks/auth", "firebase/compat/auth"]) assert.equal(id(s), "firebase-auth", s);
  for (const s of ["firebase/storage", "firebase-admin/storage", "@google-cloud/storage"]) assert.equal(id(s), "cloud-storage", s);
  assert.equal(id("firebase/messaging"), "push");
  assert.equal(id("firebase-admin/messaging"), "push");
  assert.equal(id("firebase/analytics"), "analytics");
  assert.equal(id("@google-cloud/logging"), "cloud-logging");
  assert.equal(id("@google-cloud/tasks"), "cloud-tasks");
  assert.equal(id("@aws-sdk/client-s3"), "s3");
  assert.equal(id("@aws-sdk/client-sesv2"), "ses");
  // the vendor-wide box is left for subpaths with no job of their own
  assert.equal(id("@google-cloud/translate"), "gcp");
  assert.equal(id("@aws-sdk/client-ec2"), "aws");
  assert.equal(id("firebase/remote-config"), "firebase");
  // packages still match with a subpath
  assert.equal(id("stripe/lib/stripe"), "stripe");
});

test("services: setup, test tooling and connections drawn elsewhere make no box", () => {
  for (const s of ["firebase/app", "firebase/app-check", "firebase-admin/app", "firebase/functions", "firebase-admin/functions", "firebase", "firebase-admin", "@firebase/rules-unit-testing"])
    assert.equal(id(s), null, s);
  // the Firestore SDK is the Firestore store's (rollup merges it there)
  assert.equal(id("firebase/firestore"), "firestore");
  assert.equal(id("firebase-admin/firestore"), "firestore");
});

test("services: a bare firebase-admin import is classified by what its file calls, with that line", () => {
  const text = `import * as admin from "firebase-admin";\nadmin.initializeApp();\nconst user = await admin.auth().getUser(id);\n\nawait admin.storage().bucket().file(p).save(b);\nawait admin.auth().deleteUser(id);\n`;
  assert.deepEqual(servicesOf("firebase-admin", 1, () => text).map((u) => [u.svc.id, u.line]), [["firebase-auth", 3], ["cloud-storage", 5]]);
  assert.deepEqual(servicesOf("firebase-admin", 1, () => "admin.initializeApp();\n"), []);
  assert.deepEqual(servicesOf("firebase/auth", 7, () => "").map((u) => [u.svc.id, u.line]), [["firebase-auth", 7]]);
});

test("services: every service says what it is for, in the model and on the page", () => {
  const facts = analyze(fileURLToPath(new URL("./fixtures/multi", import.meta.url)));
  // firebase/functions (the call edge) and the seed script's bare initializeApp draw nothing
  assert.deepEqual(facts.services.map((s) => [s.id, s.name, s.does]), [["firebase-auth", "Firebase Auth", "sign-in"], ["stripe", "Stripe", "payments"]]);
  assert.deepEqual(facts.serviceUses.filter((u) => u.service === "firebase-auth").map((u) => [u.from, u.line, u.spec]), [["web/src/main.ts", 3, "firebase/auth"]]);
  const g = defaultGrouping(facts);
  const model = buildModel(facts, g, assign(g, facts).leafOf);
  assert.deepEqual(model.does, { "svc-firebase-auth": "sign-in", "svc-stripe": "payments" });
  assert.deepEqual(subLines(model, "svc-firebase-auth", "root"), ["sign-in"]);
  assert.deepEqual(pageData(renderHtml(model, {})).does, model.does);
});

/** A throwaway repo: package.json with these dependencies, plus the given source files. */
function repo(deps: string[], files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "repoladder-svc-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "app", dependencies: Object.fromEntries(deps.map((d) => [d, "1.0.0"])) }));
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), text);
  }
  return dir;
}
const usesOf = (dir: string) => analyze(dir).serviceUses.map((u) => `${u.from}:${u.line} ${u.service}`);

test("services: ClickHouse, Kafka, Socket.IO and the AI SDK's provider packages", () => {
  assert.equal(id("@clickhouse/client"), "clickhouse");
  assert.equal(id("@clickhouse/client-web"), "clickhouse");
  assert.equal(id("kafkajs"), "kafka");
  for (const s of ["socket.io-client", "socket.io", "@socket.io/redis-adapter"]) assert.equal(id(s), "socketio", s);
  assert.equal(serviceFor("socket.io-client")?.category, "messaging");
  assert.equal(id("@ai-sdk/openai"), "openai");
  assert.equal(id("@ai-sdk/anthropic"), "anthropic");
  assert.equal(id("@ai-sdk/google-vertex"), "gemini");
  assert.equal(id("@ai-sdk/google-vertex/anthropic"), "anthropic");
  assert.equal(id("@ai-sdk/google"), "gemini");
  assert.equal(id("@ai-sdk/amazon-bedrock"), "bedrock");
  assert.equal(id("@ai-sdk/gateway"), "ai-model");
  assert.equal(id("@ai-sdk/openai-compatible"), "ai-model");
  assert.equal(serviceFor("ai")?.name, "AI model");
  // the UI hooks call the app's own route; the rest are types, mocks and telemetry
  for (const s of ["@ai-sdk/react", "@ai-sdk/vue", "@ai-sdk/provider", "@ai-sdk/provider-utils", "@ai-sdk/otel", "ai/react", "ai/test"]) assert.equal(id(s), null, s);
});

test("services: the AI SDK core counts only where it reaches a model", () => {
  const at = (names: string[], kind = "static") => servicesOf("ai", 1, () => "", { names, kind }).map((u) => u.svc.id);
  assert.deepEqual(at(["generateText", "UIMessage"]), ["ai-model"]);
  assert.deepEqual(at(["streamText"]), ["ai-model"]);
  assert.deepEqual(at(["gateway", "customProvider"]), ["ai-model"]);
  assert.deepEqual(at(["*"], "lazy"), ["ai-model"]);
  for (const names of [["tool"], ["generateId"], ["DefaultChatTransport"], ["registerTelemetry"], ["UIMessage"]]) assert.deepEqual(at(names), [], names.join());
  // a barrel's `export * from "ai"` calls nothing itself
  assert.deepEqual(at(["*"], "reexport"), []);
  assert.deepEqual(servicesOf("ai/rsc", 1, () => "", { names: ["streamUI"], kind: "static" }).map((u) => u.svc.id), ["ai-model"]);
});

test("services fixture: AI SDK calls draw an AI model box, named for the one provider package", () => {
  const route = `import { streamText, tool } from "ai";\nexport const POST = () => streamText({ model, tools: { t: tool({}) } });\n`;
  const helper = `import { generateId, tool } from "ai";\nexport const id = generateId();\n`;
  const hook = `import { useChat } from "@ai-sdk/react";\nimport { DefaultChatTransport } from "ai";\nexport const useIt = () => useChat({ transport: new DefaultChatTransport() });\n`;
  const gatewayOnly = repo(["ai", "@ai-sdk/react"], { "src/route.ts": route, "src/helper.ts": helper, "src/hook.ts": hook });
  assert.deepEqual(usesOf(gatewayOnly), ["src/route.ts:1 ai-model"]);
  assert.deepEqual(analyze(gatewayOnly).services.map((s) => [s.id, s.name, s.category]), [["ai-model", "AI model", "ai"]]);
  // one provider package: the core's calls fold into it
  const openai = repo(["ai", "@ai-sdk/openai"], { "src/route.ts": route, "src/model.ts": `import { openai } from "@ai-sdk/openai";\nexport const model = openai("gpt-4o");\n` });
  assert.deepEqual(usesOf(openai), ["src/model.ts:1 openai", "src/route.ts:1 openai"]);
  assert.deepEqual(analyze(openai).services.map((s) => s.id), ["openai"]);
  // two providers: the core's calls can't say which, so they keep the plain AI model box
  const two = repo(["ai", "@ai-sdk/openai", "@ai-sdk/anthropic"], {
    "src/route.ts": route,
    "src/models.ts": `import { openai } from "@ai-sdk/openai";\nimport { anthropic } from "@ai-sdk/anthropic";\nexport const models = [openai("a"), anthropic("b")];\n`,
  });
  assert.deepEqual(analyze(two).services.map((s) => s.id), ["ai-model", "anthropic", "openai"]);
});

test("services fixture: ClickHouse, Kafka and Socket.IO, including a lazy import", () => {
  const dir = repo(["@clickhouse/client", "kafkajs", "socket.io-client"], {
    "src/clickhouse.ts": `import { createClient } from "@clickhouse/client";\nexport const db = createClient();\n`,
    "src/kafka.ts": `import { Kafka } from "kafkajs";\nexport const kafka = new Kafka({ brokers: [] });\n`,
    "src/collab.ts": `export async function connect() {\n  const { default: io } = await import("socket.io-client");\n  return io("/");\n}\n`,
  });
  assert.deepEqual(usesOf(dir), ["src/clickhouse.ts:1 clickhouse", "src/collab.ts:2 socketio", "src/kafka.ts:1 kafka"]);
});

test("services fixture: a type-only import uses no service (#250)", () => {
  const dir = repo(["next-auth", "socket.io-client"], {
    // the ai-chatbot shape: tools only import the Session type
    "src/tool.ts": `import type { Session } from "next-auth";\nexport const run = (s: Session) => s.user;\n`,
    "src/tool2.ts": `import { type Session } from "next-auth";\nexport const run = (s: Session) => s.user;\n`,
    "src/portal.ts": `import type { Socket } from "socket.io-client";\nexport class Portal { socket: Socket | null = null }\n`,
    "src/auth.ts": `import NextAuth, { type Session } from "next-auth";\nexport const auth = NextAuth({});\nexport type S = Session;\n`,
  });
  assert.deepEqual(usesOf(dir), ["src/auth.ts:1 auth-provider"]);
  // handed the client by a file that uses the SDK, a file with only its types is a user too
  const handed = repo(["stripe"], {
    "src/config.ts": `import Stripe from "stripe";\nexport const stripe = new Stripe("k");\n`,
    "src/billing.ts": `import type { Stripe } from "stripe";\nimport { stripe } from "./config";\nexport const go = (p: Stripe.Price) => stripe.checkout.sessions.create({});\n`,
    "src/amounts.ts": `import type { Stripe } from "stripe";\nexport const cents = (p: Stripe.Price) => p.unit_amount;\n`,
  });
  assert.deepEqual(usesOf(handed), ["src/billing.ts:1 stripe", "src/config.ts:1 stripe"]);
});
