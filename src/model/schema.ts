import { z } from "zod";

export const PackageKind = z.enum(["web", "backend", "scripts", "library"]);

export const Package = z.object({
  id: z.string(),
  name: z.string(),
  dir: z.string(), // repo-relative, "" for the repo root
  kind: PackageKind,
  deps: z.array(z.string()),
  /** package.json `description`, one line, at most 300 chars. */
  description: z.string().optional(),
});

/** A README of a folder that holds source: its first H1 and first prose paragraph (one line, at most 300 chars each). */
export const Readme = z.object({ dir: z.string(), title: z.string().optional(), text: z.string().optional() }); // dir: repo-relative, "" for the root

export const SourceFile = z.object({
  path: z.string(), // repo-relative, posix separators
  pkg: z.string(),
  loc: z.number(),
  /** React's module directive: "use client" / "use server". Absent for ordinary (server-by-default or plain) modules. */
  directive: z.enum(["client", "server"]).optional(),
  /** Names this file exports, sorted, without "default". */
  exports: z.array(z.string()).optional(),
});

export const ImportKind = z.enum(["static", "type", "reexport", "lazy", "require"]);

export const Import = z.object({
  from: z.string(),
  to: z.string(),
  line: z.number(),
  kind: ImportKind,
  via: z.string().optional(), // barrel file the import passed through
  runtime: z.literal(true).optional(), // a re-export no importer was routed past: an edge like any import (#256, #450)
});

export const External = z.object({
  from: z.string(),
  spec: z.string(), // bare package name, e.g. "stripe" or "@stripe/stripe-js"
  line: z.number(),
});

export const Unresolved = z.object({
  from: z.string(),
  spec: z.string(),
  line: z.number(),
});

/** What kind of outside service it is; picks the service's icon (viewer/icons.ts). */
export const CATEGORIES = ["database", "payments", "ai", "email", "sms", "auth", "storage", "analytics", "monitoring", "search", "cloud", "messaging", "other"] as const;
export const Category = z.enum(CATEGORIES);
/**
 * `category` is absent in facts written before categories existed, and on stores (always "database").
 * `does`: a few plain words for what the code uses it for ("sign-in", "payments"), drawn under its name.
 */
export const Service = z.object({ id: z.string(), name: z.string(), category: Category.optional(), does: z.string().optional() });

export const ServiceUse = z.object({
  from: z.string(),
  service: z.string(),
  spec: z.string(), // the full specifier, e.g. "firebase/auth"
  line: z.number(),
});

export const EndpointKind = z.enum(["callable", "http", "event", "action"]);

/** A server entry point: a Cloud Function, an HTTP route (incl. Next.js route handlers), or a React server action. */
export const Endpoint = z.object({
  name: z.string(),
  file: z.string(),
  line: z.number(),
  kind: EndpointKind,
  /** HTTP methods it answers ("GET", "POST", …), upper-case, in sortMethods order; absent when the code doesn't say (pages/api, Cloud Functions, Express .all, tRPC, events, actions). */
  methods: z.array(z.string()).optional(),
});

/** Client code reaching an endpoint by name or URL rather than by import. */
export const Call = z.object({
  from: z.string(),
  line: z.number(),
  to: z.string(), // file defining the endpoint
  endpoint: z.string(),
  /** "action": an import of a server action, which the client invokes over the network. */
  kind: z.enum(["callable", "http", "action"]),
});

/** A file that belongs to a route without being its page: a Next.js layout, loading, error, … or middleware, or a React Router layout route. */
export const RouteFile = z.object({
  route: z.string(), // the segment's URL ("/dashboard"); for middleware, its matcher(s)
  file: z.string(),
  role: z.enum(["layout", "loading", "error", "global-error", "not-found", "template", "default", "middleware"]),
});

/** A screen users can navigate to, and the file whose component renders it. */
export const Page = z.object({
  route: z.string(), // "/check-in/:id"; Next.js keeps its own "[id]" notation
  file: z.string(), // the page component's file
  component: z.string().optional(),
  from: z.string(), // where the route is declared (the router file, or the page itself for file conventions)
  line: z.number(),
});

/** A database read or write: `getDocs(collection(db, "Orders"))`, `prisma.user.create(...)`. */
export const StoreUse = z.object({
  store: z.string(), // "firestore" | "prisma" | "supabase"
  collection: z.string(), // collection path ("Companies/Therapists"; "*/x" when the parent is unknown) or table
  op: z.enum(["read", "write"]),
  file: z.string(),
  line: z.number(),
});

/**
 * A field of a collection or table, with where it shows up: written (a key of the object written),
 * queried (a where/orderBy field), read (a property read off a fetched document, or selected), or
 * declared (a Prisma schema field). Only the first three are inferred from code.
 */
export const StoreField = z.object({
  store: z.string(),
  collection: z.string(),
  field: z.string(), // top-level field; "" for a declared model with no fields seen
  how: z.enum(["write", "read", "query", "declared"]),
  file: z.string(),
  line: z.number(),
});

export const Facts = z.object({
  version: z.literal(1),
  repo: z.string(),
  sha: z.string().nullable(),
  /** The GitHub repo ("owner/name"), full HEAD commit and the analyzed root's dir in it ("" or "apps/web/"), for code links. */
  github: z.object({ repo: z.string(), sha: z.string(), dir: z.string() }).nullable().default(null),
  packages: z.array(Package),
  files: z.array(SourceFile),
  imports: z.array(Import),
  externals: z.array(External),
  unresolved: z.array(Unresolved),
  services: z.array(Service),
  serviceUses: z.array(ServiceUse),
  endpoints: z.array(Endpoint),
  calls: z.array(Call),
  pages: z.array(Page).default([]),
  routeFiles: z.array(RouteFile).default([]),
  stores: z.array(Service).default([]),
  storeUses: z.array(StoreUse).default([]),
  storeFields: z.array(StoreField).default([]),
  /** Folder READMEs, as hints for box descriptions. Optional: absent in older facts and in repos without READMEs. */
  readmes: z.array(Readme).optional(),
});

// ---- grouping: written by Claude (or the default grouper), validated against the facts ----

const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "ids are lowercase slugs: a-z, 0-9 and -");

export interface GroupNode {
  id: string;
  name: string;
  summary: string;
  /** Leaf nodes: repo-relative paths or globs ("web/src/components/billing/**"). */
  files?: string[];
  /** Inner nodes: sub-groups, shown when the node is opened. */
  children?: GroupNode[];
  /**
   * The Simple stop of the detail dial only (model/splits.ts): a finer level under this node, named
   * by Claude, that the Default build ignores. On a leaf, 2-6 named parts that share its files
   * (each with `files`); on a group, 2-6 named buckets of its children (each with `members`).
   */
  split?: SplitPart[];
}

/** One named part of a split: a slice of a leaf's files, or a bucket of a group's children (by id). */
export interface SplitPart {
  id: string;
  name: string;
  summary: string;
  files?: string[];
  members?: string[];
}

export const SplitPart: z.ZodType<SplitPart> = z.object({
  id: Slug,
  name: z.string().min(1).max(40),
  summary: z.string().max(300),
  files: z.array(z.string().min(1)).min(1).optional(),
  members: z.array(Slug).min(1).optional(),
}).refine((p) => !!p.files !== !!p.members, "each split part needs either files (on a leaf) or members (on a group), not both");

export const GroupNode: z.ZodType<GroupNode> = z.lazy(() =>
  z.object({
    id: Slug,
    name: z.string().min(1).max(40),
    summary: z.string().max(300),
    files: z.array(z.string().min(1)).min(1).optional(),
    children: z.array(GroupNode).min(1).optional(),
    split: z.array(SplitPart).min(2).max(6).optional(),
  })
    .refine((n) => !!n.files !== !!n.children, "each node needs either files (a leaf) or children, not both")
    .refine((n) => !n.split || n.split.every((p) => (n.files ? !!p.files : !!p.members)), "a leaf's split parts list files; a group's split parts list members (its children's ids)"),
);

/** Someone or something outside the code that uses the system: a patient, practice staff, a Stripe webhook. */
export const StoryActor = z.object({
  id: Slug,
  name: z.string().min(1).max(40),
  summary: z.string().max(300),
  kind: z.enum(["person", "system"]),
});

/**
 * An actor using a level-1 part. The one relationship Claude declares rather than reads from the
 * facts, so it must cite a real entry point (validated in story.ts).
 */
export const StoryUse = z.object({
  actor: z.string(),
  /** A level-1 group id (a child of the root). */
  part: z.string(),
  /** Short verb phrase: "books appointments". */
  says: z.string().min(1).max(60),
  /** A source file path or an endpoint name from the facts, inside `part`. */
  entry: z.string().min(1),
});

/**
 * The level-0 story: who uses the system and what it does for them. Narrative sentences may
 * reference actors and groups inline as [[id]] or [[id|shown text]].
 */
export const Story = z.object({
  actors: z.array(StoryActor).min(1),
  uses: z.array(StoryUse).min(1),
  narrative: z.array(z.string().min(1).max(300)).min(1).max(6),
});

/**
 * One step of a tour: a connection (`edge: [from, to]`) or a part (`node`), by group or service
 * ("svc-<id>") id. The build finds the board that shows it; `board` pins one when several do.
 * `stop`: the detail-dial stop the step plays at (docs/tours-v2.md), relative to Default as the dial
 * stores it: "default" (when omitted), "simple", "+1", "+2", … or "everything". A repo without that
 * stop plays the step at its nearest one (viewer/dialmap.ts landOn).
 */
export const TourStop = z.string().regex(/^(default|simple|everything|\+[1-9]\d?)$/, 'a dial stop: "default", "simple", "+1", "+2", … or "everything"');
export const TourStep = z.union([
  z.object({ text: z.string().min(1).max(400), edge: z.tuple([z.string().min(1), z.string().min(1)]), board: z.string().optional(), stop: TourStop.optional() }).strict(),
  z.object({ text: z.string().min(1).max(400), node: z.string().min(1), board: z.string().optional(), stop: TourStop.optional() }).strict(),
]);

/** A walk through one flow ("what happens when a patient checks in"), every step on a real edge or part. */
export const StepsTour = z.object({
  id: Slug,
  title: z.string().min(1).max(60),
  steps: z.array(TourStep).min(1).max(20),
});

/**
 * The same walk named as a chain of files (docs/tours-v2.md): every consecutive pair must be a real
 * import or call, pointing from the code that imports or calls; the last entry may be a service or
 * store id ("svc-stripe", "store-firestore") that the last file uses. The build composes the steps
 * (model/compose.ts): each hop plays on the deepest board that holds both files. `captions`: one
 * per hop. `depth`: how many levels below the chain's top board a step may go (composeTour's
 * option). `id` defaults to the title as a slug.
 */
export const ChainTour = z.object({
  id: Slug.optional(),
  title: z.string().min(1).max(60),
  chain: z.array(z.string().min(1)).min(2).max(12),
  captions: z.array(z.string().min(1).max(300)).optional(),
  depth: z.number().int().min(0).max(9).optional(),
}).strict();

export const Tour = z.union([StepsTour, ChainTour]);

/**
 * A named flow on one board: a chain of drawn arrows the viewer can play one at a time (flows.ts).
 * `path` lists the boxes in order by id (group, "svc-<id>", "store-<id>", or on a file board a file
 * path); every consecutive pair must be an arrow on that board. `captions`: one line per arrow.
 */
export const FlowSpec = z.object({
  board: z.string().min(1),
  title: z.string().min(1).max(60),
  path: z.array(z.string().min(1)).min(2).max(8),
  captions: z.array(z.string().min(1).max(120)).optional(),
}).strict();

export const Grouping = z.object({
  version: z.literal(1),
  /** One-paragraph, plain-language description of the whole system. */
  summary: z.string(),
  story: Story.optional(),
  children: z.array(GroupNode).min(1),
  tours: z.array(Tour).optional(),
  flows: z.array(FlowSpec).optional(),
});
export type Tour = z.infer<typeof Tour>;
export type StepsTour = z.infer<typeof StepsTour>;
export type ChainTour = z.infer<typeof ChainTour>;
export type FlowSpec = z.infer<typeof FlowSpec>;
export type TourStep = z.infer<typeof TourStep>;
export type Grouping = z.infer<typeof Grouping>;
export type Story = z.infer<typeof Story>;
export type StoryActor = z.infer<typeof StoryActor>;
export type StoryUse = z.infer<typeof StoryUse>;

export type PackageKind = z.infer<typeof PackageKind>;
export type Package = z.infer<typeof Package>;
export type Readme = z.infer<typeof Readme>;
export type SourceFile = z.infer<typeof SourceFile>;
export type ImportKind = z.infer<typeof ImportKind>;
export type Import = z.infer<typeof Import>;
export type External = z.infer<typeof External>;
export type Unresolved = z.infer<typeof Unresolved>;
export type Category = z.infer<typeof Category>;
export type Service = z.infer<typeof Service>;
export type ServiceUse = z.infer<typeof ServiceUse>;
export type Endpoint = z.infer<typeof Endpoint>;
export type Call = z.infer<typeof Call>;
export type Page = z.infer<typeof Page>;
export type RouteFile = z.infer<typeof RouteFile>;
export type StoreUse = z.infer<typeof StoreUse>;
export type StoreField = z.infer<typeof StoreField>;
export type Facts = z.infer<typeof Facts>;
