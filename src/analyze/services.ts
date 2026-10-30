import type { Category } from "../model/schema.ts";

/** An outside service, with a few plain words for what the code uses it for (drawn under its name). */
export interface ServiceInfo { id: string; name: string; category: Category; does: string }

type Row = [string, string, Category, string];
const svc = ([id, name, category, does]: Row): ServiceInfo => ({ id, name, category, does });

// Shared by several SDKs: Firebase Storage and @google-cloud/storage are the same buckets.
const AUTH: Row = ["firebase-auth", "Firebase Auth", "auth", "sign-in"];
const STORAGE: Row = ["cloud-storage", "Cloud Storage", "storage", "uploaded files"];
const PUSH: Row = ["push", "Notifications", "messaging", "push messages"];
const ANALYTICS: Row = ["analytics", "Product analytics", "analytics", "usage analytics"];
const RTDB: Row = ["realtime-db", "Realtime Database", "database", "live data"];
// Not drawn as a service: rollup.ts merges it into the Firestore store, where the reads and writes are.
const FIRESTORE: Row = ["firestore", "Firestore", "database", "database"];
const GEMINI: Row = ["gemini", "Google Gemini", "ai", "AI model"];
const ANTHROPIC: Row = ["anthropic", "Anthropic", "ai", "AI model"];
const OPENAI: Row = ["openai", "OpenAI", "ai", "AI model"];
const BEDROCK: Row = ["bedrock", "Amazon Bedrock", "ai", "AI model"];
// The Vercel AI SDK when no provider package says which model it is (the core package, its gateway).
const AI_MODEL: Row = ["ai-model", "AI model", "ai", "generates text"];
// The SQL databases a driver package (Drizzle's subpath, a Prisma adapter) names.
const POSTGRES: Row = ["postgres", "PostgreSQL", "database", "database"];
const MYSQL: Row = ["mysql", "MySQL", "database", "database"];
const SQLITE: Row = ["sqlite", "SQLite", "database", "database"];

/**
 * Umbrella SDKs, by import subpath: "Firebase" or "AWS" names a vendor, not a job. `null` means the
 * import draws nothing of its own: setup (firebase/app, app-check), test tooling, or a connection
 * the diagram already draws another way (firebase/functions is the call to the backend).
 * Unlisted subpaths fall through to the vendor-wide row in TABLE.
 */
const SUBPATHS: [RegExp, Row | null][] = [
  [/^(firebase|firebase-admin|@firebase|react-firebase-hooks|firebase\/compat)\/auth\b/, AUTH],
  [/^(firebase|firebase-admin|@firebase|react-firebase-hooks|firebase\/compat)\/storage\b/, STORAGE],
  [/^(firebase|firebase-admin|@firebase|firebase\/compat)\/messaging\b/, PUSH],
  [/^(firebase|@firebase|firebase\/compat)\/analytics\b/, ANALYTICS],
  [/^(firebase|firebase-admin|@firebase|react-firebase-hooks|firebase\/compat)\/database\b/, RTDB],
  [/^(firebase|firebase-admin|@firebase|react-firebase-hooks|firebase\/compat)\/firestore\b/, FIRESTORE],
  [/^(firebase|@firebase)\/(ai|vertexai)\b/, GEMINI],
  // Drizzle's driver subpath says which database it talks to (TABLE only sees the package name)
  [/^drizzle-orm\/(node-postgres|postgres-js|neon|vercel-postgres|pglite)\b/, POSTGRES],
  [/^drizzle-orm\/(mysql2|planetscale-serverless|tidb-serverless)\b/, MYSQL],
  [/^drizzle-orm\/(libsql|better-sqlite3|bun-sqlite|d1|expo-sqlite|op-sqlite|sql-js)\b/, SQLITE],
  // Prisma 7's driver adapter says which database it talks to, like Drizzle's subpath
  [/^@prisma\/adapter-(pg|pg-worker|neon)(\/|$)/, POSTGRES],
  [/^@prisma\/adapter-(planetscale|mariadb)(\/|$)/, MYSQL],
  [/^@prisma\/adapter-(libsql|better-sqlite3|d1)(\/|$)/, SQLITE],
  // no SQL Server service exists, and extensions (Accelerate, Optimize, …) are not a database of their own
  [/^@prisma\/(adapter-mssql|extension-[\w-]+)(\/|$)/, null],
  [/^(firebase|firebase-admin|@firebase|firebase\/compat)\/(functions|app|app-check|installations|eventarc|extensions)\b/, null],
  // bare namespaces: servicesOf reads which parts the file calls
  [/^(firebase|firebase-admin|firebase\/compat\/app|@firebase\/rules-unit-testing|@firebase\/testing)$/, null],
  [/^@google-cloud\/storage$/, STORAGE],
  [/^@google-cloud\/firestore$/, FIRESTORE],
  [/^@google-cloud\/vertexai$/, GEMINI],
  [/^@google-cloud\/tasks$/, ["cloud-tasks", "Cloud Tasks", "messaging", "task queue"]],
  [/^@google-cloud\/pubsub$/, ["pubsub", "Pub/Sub", "messaging", "event messages"]],
  [/^@google-cloud\/logging(-\w+)?$/, ["cloud-logging", "Cloud Logging", "monitoring", "server logs"]],
  [/^@google-cloud\/secret-manager$/, ["secret-manager", "Secret Manager", "other", "stored secrets"]],
  [/^@google-cloud\/bigquery$/, ["bigquery", "BigQuery", "database", "data warehouse"]],
  [/^@aws-sdk\/(client-s3|lib-storage|s3-request-presigner|s3-presigned-post)$/, ["s3", "S3 storage", "storage", "stored files"]],
  [/^@aws-sdk\/client-sesv?2?$/, ["ses", "Amazon SES", "email", "sends email"]],
  [/^@aws-sdk\/client-sqs$/, ["sqs", "SQS queue", "messaging", "job queue"]],
  [/^@aws-sdk\/client-sns$/, ["sns", "SNS", "messaging", "notifications"]],
  [/^@aws-sdk\/(client-dynamodb|lib-dynamodb|util-dynamodb)$/, ["dynamodb", "DynamoDB", "database", "database"]],
  [/^@aws-sdk\/client-lambda$/, ["lambda", "AWS Lambda", "cloud", "runs functions"]],
  [/^@aws-sdk\/client-bedrock(-runtime)?$/, BEDROCK],
  [/^@aws-sdk\/(credential-providers|types|smithy-client|util-.*)$/, null],
  // Vercel AI SDK: a provider package names the model's vendor. The UI hooks call the app's own
  // route (useChat), and the rest are types, test mocks and telemetry.
  [/^@ai-sdk\/google-vertex\/anthropic(\/|$)/, ANTHROPIC],
  [/^@ai-sdk\/anthropic(\/|$)/, ANTHROPIC],
  [/^@ai-sdk\/openai(\/|$)/, OPENAI],
  [/^@ai-sdk\/azure(\/|$)/, ["azure-openai", "Azure OpenAI", "ai", "AI model"]],
  [/^@ai-sdk\/(google|google-vertex)(\/|$)/, GEMINI],
  [/^@ai-sdk\/amazon-bedrock(\/|$)/, BEDROCK],
  [/^@ai-sdk\/mistral(\/|$)/, ["mistral", "Mistral", "ai", "AI model"]],
  [/^@ai-sdk\/groq(\/|$)/, ["groq", "Groq", "ai", "AI model"]],
  [/^@ai-sdk\/xai(\/|$)/, ["xai", "xAI", "ai", "AI model"]],
  [/^@ai-sdk\/(react|vue|svelte|solid|angular|ui-utils|provider|provider-utils|otel|langchain|llamaindex|valibot)(\/|$)/, null],
  [/^ai\/(react|vue|svelte|solid|test|ui-utils)(\/|$)/, null],
];

// Packages whose import means "this code talks to an outside service", matched on the package name.
// Frameworks/runtimes (firebase-functions, express, react) are deliberately absent.
const TABLE: [RegExp, Row][] = [
  [/^(firebase|firebase-admin|@firebase\/.*|reactfire|react-firebase-hooks)$/, ["firebase", "Firebase", "cloud", "Google app platform"]],
  [/^(stripe|@stripe\/.*)$/, ["stripe", "Stripe", "payments", "payments"]],
  [/^@anthropic-ai\/.*$/, ANTHROPIC],
  [/^(openai|@openai\/.*)$/, OPENAI],
  [/^(ai|@ai-sdk\/.*)$/, AI_MODEL],
  [/^(@google\/genai|@google\/generative-ai)$/, GEMINI],
  [/^@google-cloud\/.*$/, ["gcp", "Google Cloud", "cloud", "cloud services"]],
  [/^(googleapis|google-auth-library)$/, ["google-apis", "Google APIs", "cloud", "Google services"]],
  [/^(@aws-sdk\/.*|aws-sdk)$/, ["aws", "AWS", "cloud", "cloud services"]],
  [/^@supabase\/.*$/, ["supabase", "Supabase", "database", "database"]],
  [/^(@prisma\/client|prisma|pg|postgres|@neondatabase\/.*|kysely)$/, ["postgres", "PostgreSQL", "database", "database"]],
  [/^(mysql2?|@planetscale\/.*)$/, ["mysql", "MySQL", "database", "database"]],
  [/^(better-sqlite3|sqlite3?|@libsql\/.*)$/, ["sqlite", "SQLite", "database", "database"]],
  [/^(mongodb|mongoose)$/, ["mongodb", "MongoDB", "database", "database"]],
  [/^(redis|ioredis|@upstash\/redis|bullmq|bull)$/, ["redis", "Redis", "database", "cache and queues"]],
  [/^@clickhouse\/.*$/, ["clickhouse", "ClickHouse", "database", "analytics data"]],
  [/^(kafkajs|@confluentinc\/kafka-javascript|node-rdkafka)$/, ["kafka", "Kafka", "messaging", "event stream"]],
  [/^(socket\.io|socket\.io-client|@socket\.io\/.*)$/, ["socketio", "Socket.IO", "messaging", "live updates"]],
  [/^(resend|@react-email\/.*)$/, ["resend", "Resend", "email", "sends email"]],
  [/^(@sendgrid\/.*)$/, ["sendgrid", "SendGrid", "email", "sends email"]],
  [/^(mailgun\.js|mailgun-js|nodemailer|postmark)$/, ["email", "Email provider", "email", "sends email"]],
  [/^twilio$/, ["twilio", "Twilio", "sms", "text messages"]],
  [/^@sentry\/.*$/, ["sentry", "Sentry", "monitoring", "error tracking"]],
  [/^(posthog-js|posthog-node|@segment\/.*|mixpanel.*|@amplitude\/.*)$/, ANALYTICS],
  [/^(@clerk\/.*|@auth0\/.*|auth0|next-auth|@auth\/.*)$/, ["auth-provider", "Auth provider", "auth", "sign-in"]],
  [/^(algoliasearch|@algolia\/.*)$/, ["algolia", "Algolia", "search", "search"]],
  [/^(@vercel\/(kv|blob|postgres))$/, ["vercel", "Vercel storage", "storage", "stored data"]],
  [/^(@slack\/.*)$/, ["slack", "Slack", "messaging", "team messages"]],
  [/^(@octokit\/.*|octokit)$/, ["github", "GitHub API", "other", "repos and issues"]],
  [/^(@pinecone-database\/.*)$/, ["pinecone", "Pinecone", "database", "vector search"]],
];

const packageOf = (spec: string) => spec.split("/").slice(0, spec.startsWith("@") ? 2 : 1).join("/");

/** The service an import specifier (full, with its subpath) talks to, or null for none of its own. */
export function serviceFor(spec: string): ServiceInfo | null {
  for (const [re, row] of SUBPATHS) if (re.test(spec)) return row && svc(row);
  const pkg = packageOf(spec);
  for (const [re, row] of TABLE) if (re.test(pkg)) return svc(row);
  return null;
}

// The AI SDK's core is mostly helpers and types (tool(), generateId, message types, the chat transport
// to the app's own route): only these reach a model.
const AI_CORE = /^(ai(\/.*)?|@ai-sdk\/rsc)$/;
const AI_CALLS = new Set([
  "generateText", "streamText", "generateObject", "streamObject", "embed", "embedMany", "rerank", "streamUI",
  "generateImage", "experimental_generateImage", "generateSpeech", "experimental_generateSpeech", "transcribe", "experimental_transcribe",
  "Agent", "Experimental_Agent", "ToolLoopAgent", "gateway", "createGateway",
]);

/**
 * With exactly one AI SDK provider package in the repo, the core's calls go to that provider's model:
 * one "OpenAI" box, not "OpenAI" beside a nameless "AI model".
 */
export function foldAiModel<U extends { service: string; spec: string }>(uses: U[], services: Map<string, unknown>): U[] {
  if (!services.has(AI_MODEL[0])) return uses;
  const providers = new Set(uses.filter((u) => u.spec.startsWith("@ai-sdk/") && u.service !== AI_MODEL[0]).map((u) => u.service));
  if (providers.size !== 1) return uses;
  services.delete(AI_MODEL[0]);
  const [to] = providers;
  return uses.map((u) => (u.service === AI_MODEL[0] ? { ...u, service: to } : u));
}

// What a bare `firebase` / `firebase-admin` namespace reaches: admin.auth(), firebase.storage(), …
const NAMESPACE: Record<string, Row> = { auth: AUTH, storage: STORAGE, messaging: PUSH, analytics: ANALYTICS, database: RTDB, firestore: FIRESTORE };
const BARE = /^(firebase|firebase-admin|firebase\/compat\/app)$/;
const MEMBER = /\.(auth|storage|messaging|analytics|database|firestore)\s*\(/g;

/**
 * The services one import reaches, each with the line that shows it. A bare `firebase-admin` import is
 * one namespace for everything, so its file's `x.auth()` / `x.storage()` calls say which parts it uses
 * (and each call's line is the evidence); with none, it only sets Firebase up and draws nothing.
 */
export function servicesOf(spec: string, line: number, text: () => string, imp: { names: string[]; kind: string } = { names: ["*"], kind: "static" }): { svc: ServiceInfo; line: number }[] {
  if (AI_CORE.test(spec) && !imp.names.some((n) => AI_CALLS.has(n) || (n === "*" && imp.kind !== "reexport"))) return [];
  if (!BARE.test(spec)) {
    const s = serviceFor(spec);
    return s ? [{ svc: s, line }] : [];
  }
  const src = text(), seen = new Map<string, { svc: ServiceInfo; line: number }>();
  for (const m of src.matchAll(MEMBER)) {
    const s = svc(NAMESPACE[m[1]]);
    if (!seen.has(s.id)) seen.set(s.id, { svc: s, line: src.slice(0, m.index).split("\n").length });
  }
  return [...seen.values()];
}
