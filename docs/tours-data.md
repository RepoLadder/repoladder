# Tours data: building a tour from the page data

This is for an AI agent that has a repoladder page's data and has to answer a question like **"walk me through how check-in works"** with a tour. The answer is a list of `TourStep`s that the viewer's tour player plays. You don't lay anything out or draw anything. You only:

1. find the files the question is about,
2. find a chain of real connections between them, and
3. hand the chain to `composeTour`, which picks the boards, the dial stops and what to light.

**Edges are never invented.** Every hop in your chain must be a real edge in `fgraph` (or a real use of a service or store). `composeTour` rejects anything else with a `ChainError`, so you can't produce a tour that lies. Your judgment goes into choosing the chain and writing the captions.

The code is `src/model/compose.ts` (`composeTour`, the types), `src/model/chains.ts` (`findChains`) and `src/model/tourgraph.ts` (`TourGraph`, `ChainError`, the index). They are pure: they run in Node and in the page.

## Where the data is

- **In the page:** the viewer's data, `ViewerData` in `src/viewer/state.ts`, is a valid `TourGraph`, so pass it as is.
- **From a built `diagram.html`:** `pageData(html)` in `src/build/filepack.ts` unpacks it in Node.

`TourGraph` needs only these fields:

```ts
interface TourGraph {
  paths: string[];                       // every file path, once; files are referred to by index into this
  nodes: Record<string, PageNode>;       // the Default group tree
  tree?: Record<string, PageNode>;       // the tree with Simple's split parts (set in the page by unpack.ts)
  boards: Record<string, PageBoard>;     // the Default boards: boxes drawn and edges with evidence
  fgraph?: FileEdge<number>[];           // every file-to-file connection, once per ordered pair
  services?: Record<string, string>;     // service/store id -> display name
}
```

## Ids

| id | what it is | example |
|---|---|---|
| `root` | the whole repo; its board is the top rung | `root` |
| a group slug | a group Claude named in the grouping (or a folder group in `--default` builds). Unique across the tree. | `web`, `web-checkin`, `fn-forms` |
| `_story` | the story board (Overview), only when the grouping has a story and the story switch is on. It is not a group and never holds files. | `_story` |
| `svc-<id>` | an outside service the code uses through an SDK | `svc-stripe`, `svc-firebase-auth` |
| `store-<id>` | a database the code reads and writes | `store-firestore` |
| `@<n>` | a file box on a leaf's board: `paths[n]` | `@231` |
| `+more` | the "+N more" box on a leaf board with more than 16 files. It stands for the files that board doesn't draw; arrows to and from them are drawn from this box. A default build splits a leaf instead of hiding a connected file. | `+more` |
| `c:<path>` | a collection box on a store's own board (`boards["store-firestore"]`) | `c:Companies/Therapists` |

A path index is stable within one page only. Paths themselves are stable across builds of the same commit. **Chains are written in repo paths** (`"web/src/pages/KioskPage.tsx"`). `composeTour` also accepts a path index or `"@<n>"`.

## The tree: names and summaries

`nodes[id]` is a `PageNode`:

| field | meaning |
|---|---|
| `name` | the human name Claude gave the group ("Patient check-in"). Use it in captions. |
| `summary` | one or two sentences on what the group does. **Read these to find the right part for a question.** |
| `parent` | parent id; `null` only on `root`. |
| `children` | child group ids, in the grouping's order. Empty on a leaf. |
| `files` | a leaf's files, as path indexes. Empty on a group with children. |
| `count`, `loc` | files and lines under the node. |
| `kind` | `web`, `backend`, `scripts` or `library`, by the bulk of its code. Absent on `root`. |
| `pages` | on a leaf: routes whose page component lives there (`/kiosk`). |
| `endpoints` | on a leaf: names of the server endpoints defined there (`checkIn`). |

Every file is in exactly one leaf. A node's **rung** is its distance from `root`: the root's children are rung 1.

## `fgraph`: the file graph

```ts
type FileEdge = [from: number, to: number, imports: number, calls: number, line: number, call?: string];
```

There is one row per ordered pair of files, sorted by `from` path and then `to` path. A pair never joins a file to itself. Only files on some board appear.

- **Direction:** `from` is the file that imports or calls; `to` is the file it reaches. A chain follows that direction.
- **Kinds:**
  - **import:** `imports > 0`. A static or dynamic import, not counting a re-export that only passes names through to importers routed past it (consumers point straight at the file that defines what they import). Every other re-export counts: a route's (`export { action } from "./editor.server"`, it is what the route runs), an unimported barrel's and an imported barrel's unused export.
  - **call:** `calls > 0`. A runtime call that crosses a process boundary: `from` has a string that matches an endpoint `to` defines. Examples are `httpsCallable(fns, "checkIn")`, `fetch("/api/plans")`, and a Firebase callable or HTTP function. A URL that is only data, such as a config value (`redirectURI: …`), a string test (`.includes('/x')`) or a comparison, is not a call. **Calls are how a web app reaches its backend.** They are the hops that cross from one top-level part to another.
  - A pair can have both kinds.
- **Evidence:** `line` is a line in `from`.
  - When the pair has any import, it's the first import.
  - Otherwise it's the first call, and `call` is `"<endpoint> (<to path>)"`, e.g. `"checkIn (functions/src/checkin/checkin.ts)"`.
  - The evidence row is `[from, line, call ?? to]`, the same triple a board edge carries.

**What `fgraph` doesn't hold: services and stores.** A file's use of a service or store is on the boards. Look for a board edge whose `b` is `svc-*` or `store-*`, and read its evidence rows. `tourgraph.ts` `indexOf(g).sinks` gathers them for you: `sink id -> file index -> [line, target]`.
- For a store, the target is `"<Collection path> (read|write)"`, e.g. `"Forms (read)"`.
- For a service, the target is the SDK module, e.g. `"firebase/auth"` or `"@stripe/stripe-js"`.

## Boards

`boards[id]` is what the Default stop draws when group `id` is opened:

| field | meaning |
|---|---|
| `nodes` | the drawn boxes. On a group board, these are its children, then "elsewhere" boxes, then services and stores. On a leaf board, they are its file boxes (`@n`, maybe `+more`), then elsewhere boxes and sinks. |
| `context` | the "elsewhere" boxes: parts outside this group that its children connect to, drawn dashed in a lane. |
| `edges` | every rolled-up connection between the board's boxes (see below). |
| `throughout` | services or stores so widely used here that they are **listed, not drawn**. Firestore is usually `throughout` inside a backend. Its arrow shows only higher up, and a tour lands there. |
| `hubs` | children most siblings import; arrows into them are listed, not drawn, so a tour never lands on them. |
| `throughout` | services or stores so widely used here that they are **listed, not drawn**. Firestore is usually `throughout` inside a backend. Its arrow shows only higher up. Always empty on a leaf board, which draws every service and store its files use. |
| `hubs` | children most siblings import; arrows into them are listed, not drawn. Always empty on a leaf board. |

A board edge (`PageEdge`) has:
- `a`, `b`: box ids on that board.
- the counts `imports`, `calls`, `uses` (SDK imports or database operations), and `reads`/`writes` for stores.
- `major`: drawn on the canvas. A minor edge is only listed in the side panel. Tours land on a board that draws their edges (`drawsEdge` in `model/draws.ts`: major, both ends boxes), so the step card's "not drawn here" note appears only in the listed-only fallback (no board anywhere draws the edge), which the build warns about (`UNDRAWN_TOUR_STEP`; it fails `lint:layout`, the gallery and `gallery --check`). A group-to-group step (or one into a service used throughout) that no board draws as boxes plays on the shallowest board inside the source group that draws an arrow from it to the target; such a step carries `lit` (every drawn arrow there) and no `edge`.
- `ev`: rows `[file, line, target]`. `file` is a path index. `target` is a path index for a file, or text for calls, services and stores. A group board notes up to 6 rows per edge, one per from-file; a file board notes up to 3.

**How an edge rolls up:** a file-to-file connection is drawn on a group's board between the two children that hold its ends. If one end is outside the group, it's drawn between the child and the elsewhere box for the outside part. So **the deepest board that draws a hop as an arrow between two of its own boxes is the lowest common ancestor (LCA) of the two files' leaves.** For two files in the same leaf, that's the leaf's own file board.

## Dial stops

Above Default, the detail dial opens boards in place (`docs/detail-dial-v2.md`). Stop keys go `"default"`, `"+1"`, `"+2"`, … up to `"everything"`. `stopsFor(nodes, paths)` in `viewer/budget.ts` lists this repo's stops, and `cut(nodes, paths, board, budget)` says what a board draws at a stop. At a stop above Default, an opened group is a container, and an arrow is drawn between the two boxes or containers where its ends' paths split (`viewer/cutboard.ts`). Tours never use Simple.

## `composeTour`

```ts
composeTour(g: TourGraph, chain: string[], opts?: { depth?: number; captions?: (string | undefined)[] }): TourStep[]
```

- **The chain** is repo paths, and each consecutive pair must be an `fgraph` edge in that direction. It may **end** with one sink, `svc-*` or `store-*`, when the last file uses it. A sink anywhere else is an error.
- **One step per hop.** For the hop `a → b`:
  - **board:** the LCA board of the two files. The step lights the two boxes there that hold each end, and the arrow between them.
  - **A sink hop** goes on the lowest board, from the file's leaf upward, that draws the arrow from the box holding the file to the sink (`drawsEdge`: major, both ends boxes). Because Firestore is usually `throughout` inside a backend, where it is only listed, its hop often lands on `root`.
  - **stop:** `"default"`, unless the hop can't be drawn there; then it is the first stop up that draws it. That happens when `depth` keeps the hop above its LCA, or when a file hides in `+more`, or when the LCA's Default board only lists the arrow. If no board and stop draws the hop, it falls back to the old listed-only placement and the build warns (`warning: ... no board draws it as an arrow`).
- **The rhythm comes from the chain.** Hops inside one part sit deep in it. A call from the web app to the backend sits on the board where both show, often `root`. Then the next hops go back down into the backend. The player's transition (#194) climbs to the LCA, runs along the arrow, and dives.
- **`depth`** caps how far below the chain's top board a step may sit. The top board is the LCA of every file in the chain. A hop whose own board is deeper goes on its ancestor at the cap, opened to the first stop that draws the two ends apart. A board that draws the hop wins over the cap.
  - `depth: 0`: every step is on the top board, at higher stops where needed.
  - omitted: no cap.
- **`captions[i]`** is hop `i`'s caption. Any missing caption is written from the evidence:
  - `"Web app → Cloud backend: kioskHttp.ts calls checkIn in checkin.ts (web/src/utils/kioskHttp.ts:4)"`
  - `"forms.ts uses Firestore: Forms (read) (functions/src/forms/forms.ts:6)"`

  The group names lead the caption only when the lit boxes are groups.
- **Errors** are thrown as a `ChainError`, with `message`, `hop` (`[from, to]`) and `reversed` (whether the edge runs the other way). It is thrown when:
  - a hop isn't an edge: `hop 2: there is no edge A -> B (there is one B -> A; edges point from the file that imports or calls)`
  - a path isn't a file on any board
  - the last file doesn't use the sink
  - the chain has fewer than two entries

  Fix the chain and try again; don't drop a hop silently.

```ts
interface TourStep {
  board: string;                                   // group id (or "_story", only when the story switch is on)
  stop: string;                                    // "default" | "+1" | … | "everything"
  lit: { boxes: string[]; edges: [string, string][] };  // drawn ids at that stop
  caption: string;
  via?: [string, string];                          // the hop: [from path, to path or sink id]
}
interface Tour { id: string; title: string; steps: TourStep[]; source: "claude" | "derived" | "flow" }
```

## `findChains`

```ts
findChains(g: TourGraph, from: string, to?: string, opts?: { max?: number /* 5 */; maxLen?: number /* 6 hops */ }): string[][]
```

- **`from`:** a file path or a group id (meaning any file under it).
- **`to`:** a file path, a group id, a sink id, or omitted for any sink.
  - When `to` is a sink or omitted, each chain ends with the sink id (stores before services), ready for `composeTour`.
- **The search:**
  - It follows `fgraph` edges forward, through imports and calls alike.
  - It stops at the first file that reaches the target, never visits a file twice, and never starts inside `to`.
  - It's bounded by `maxLen` and by a fixed amount of work, and it's deterministic.
- **Ranking:**
  1. Shortest first.
  2. Then chains that avoid routers and barrels as middle steps: a file that imports many others, like a lazy-routes table, joins everything to everything.
  3. Then chains that cross more parts.
  4. Then by path.
- **The shortest chain isn't always the best story.** Read the candidates' files and summaries, and pick the one that answers the question.

## Recipe: "walk me through how check-in works"

1. **Find the start.**
   - Search `nodes` for names and summaries that match the question ("Patient check-in").
   - Search leaves' `pages` and `endpoints` (`/kiosk`, `checkIn`).
   - Search `paths` (`KioskPage.tsx`).

   Start at an entry: a page, a route or a CLI command.
2. **Decide where it should end.** Usually that's where the data lands (`store-firestore`) or the service it reaches. Use a specific group or file when the question names one ("…until the forms are saved": `fn-forms`).
3. **Get candidates.** `findChains(g, "web/src/pages/KioskPage.tsx", "store-firestore", { max: 8 })`. With a group as `from`, you get chains from all its files.
4. **Pick and edit a chain.**
   - You may write your own chain from `fgraph` rows, e.g. to go through the file that really does the work, not the shortest one.
   - Keep it to 3–6 hops. A tour is a story, not a trace.
5. **Compose it.** `composeTour(g, chain, { captions })`.
   - Write one caption per hop in plain language, saying what happens and why. The step already shows the evidence.
   - Use `depth` only if the tour dives too deep for the question. `depth: 1` keeps it near the top.
6. **Handle a `ChainError`.**
   - It names the bad hop. Check `reversed`: you may have the direction backwards.
   - Look at `fgraph` for what that file really imports or calls, and repair the chain.

Worked example on the `test/fixtures/checkin` fixture, a clinic check-in app:

```ts
composeTour(g, ["web/src/pages/KioskPage.tsx", "web/src/utils/kioskHttp.ts",
                "functions/src/checkin/checkin.ts", "functions/src/forms/forms.ts", "store-firestore"]);
// 1. web-checkin @default  checkin-pages → checkin-http   KioskPage.tsx imports kioskHttp.ts
// 2. root        @default  web → functions                 kioskHttp.ts calls checkIn in checkin.ts
// 3. functions   @default  fn-checkin → fn-forms           checkin.ts imports forms.ts
// 4. fn-forms    @default  @<forms.ts> → store-firestore   forms.ts uses Firestore: Forms (read)
```

Rungs 2, 0, 1, 2: inside Patient check-in, up to where the web app meets the backend, then back down into the backend.
