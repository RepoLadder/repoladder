# Tours v2: multi-depth tours (plan)

Epic for spike #188. A tour walks a flow through the real code. It moves between levels as the flow does: it starts high, drops into a part where the detail is, and comes back up. Every step lands on boxes and arrows the diagram really draws.

## Decisions (owner, 2026-10-10)

| question | decision |
|---|---|
| Tours vs board walkthroughs | **One thing, called Tour.** One player, and only one tour plays at a time. The card is the strip at the bottom of the canvas (#192). |
| The main problem | **Orientation.** Today's tours cut between boards and leave you lost. |
| Moving between parts | **Up, across, down.** The camera climbs only as far as the nearest level where both ends show, the data dot travels the real arrow across, and then it dives into where the arrow lands. Going into or out of a part uses today's zoom. |
| Who writes tours | **Claude, plus derived.** Claude writes the important ones at `/map` time, with captions. The build also derives some from the code's arrows, so `--default` gets tours too. |
| Where you start one | **The Overview list, plus deep links.** |
| How deep a step goes | **Any stop of the dial.** A step can show a board opened to +1 or to files, not only Default. |
| Staying oriented afterwards | **A breadcrumb trail.** The breadcrumb lights the levels the tour passed through, and the strip shows the step's path ("Web app › Cloud backend › Check-in"). |
| Future | **An AI agent should be able to build a tour on the fly** for a flow nobody mapped ("walk me through check-in"), with a hosted site and a side-panel assistant. The data has to make that easy. |

## The key idea: a tour is a path through the file graph

The page already ships the file graph (`fgraph`): every import, call and data edge between files, with evidence, plus the group tree above it. A flow through the code is a chain of files:

```
KioskPage.tsx → kioskHttp.ts → (call) checkin.ts → forms.ts → Firestore
```

**One pure function, `composeTour`, turns such a chain into a multi-depth tour:**

- **The board for each hop** is the deepest group that holds both files: their lowest common ancestor. The hop is drawn there as the arrow between the two child boxes that hold each end.
  - `KioskPage → kioskHttp` are both in Patient check-in, so that hop shows on Patient check-in's board.
  - `kioskHttp → checkin.ts` crosses from Web app to Cloud backend, so that hop shows on the root board, on the arrow Web app → Cloud backend.
- **Consecutive hops inside one part** can be shown one level down. That gives the natural rhythm of high level, drill in, back up. A depth setting chooses how far down the tour goes, which is where dial stops come in.
- **Steps are made only from drawn arrows,** so nothing is ever invented. Every board-to-board move is up to the lowest common ancestor, across, then down, so the transition comes straight from the data.
- **The player draws nothing.** While a tour plays, no arrow and no box appears that the board does not already draw (arrows the filters revealed count as drawn). A tour only lights existing elements. Tours land on a board that draws their edges; a group-to-group step (or one into a service "used throughout") that no board draws as boxes plays on the shallowest board inside the source group that draws an arrow from it to the target, lighting all of those arrows. So this only happens in the listed-only fallback (no board draws the edge; the build warns): a step's real edge that the board does not draw (a minor edge, or one into a service "used throughout") lights its ends if drawn, shows no arrow and runs no dot, and the step card says the connection is real but not drawn here. `auditStep` (`viewer/tourstep.ts`) splits a step's edges into drawn, hidden and invented, forward direction only; `npm run tourcheck` asserts the rule on a built page. A Default-stop step that no board draws (after the dive) is also a build warning (`UNDRAWN_TOUR_STEP`) and a failing check (`lint:layout`, gallery).

**Who uses it:**
- **The build's derived tours:** pick entry files (pages, routes, endpoints), follow real call and data chains to a sink (a store or a service), and compose them.
- **Claude at `/map` time:** Claude names the chain (start, key files, end) and writes captions. The composer works out the boards and stops.
- **A future agent:** reading the page data, it only has to find the chain for a question, which is a graph search over named, summarized nodes, then call `composeTour`. That's why the data contract (below) is documented and stable.

## Data

```ts
// a step of a tour (page data; model/tours.ts + viewer)
interface TourStep {
  board: string;                    // group id, or "_story" (only when the story switch is on)
  stop: string;                     // "default" | "+1" | … | "everything" (relative, as the dial stores it)
  lit: { boxes: string[]; edges: [string, string][] };  // drawn ids: group ids, "svc-*", "store-*", "@<file index>"
  caption: string;
  via?: [string, string];           // the file-level hop this step shows, when it came from a chain
}
interface Tour { id: string; title: string; steps: TourStep[]; source: "claude" | "derived" | "flow" }
```

**The grouping's `tours`** gain a `chain` form: `{ title, chain: ["path/a.ts", "path/b.ts", …], captions?, depth? }`. The old `steps` form still validates. The build composes chains and checks that every step is drawn at its stop.

`docs/tours-data.md` documents the page data a tour is built from (tree, `fgraph`, summaries, evidence) for agents.

## Issues (build order)

1. **#192 One tour player** (in flight): merge tours and board walkthroughs, with the card at the bottom.
2. **`composeTour` and the step model.** A pure function from a file chain plus a depth to steps, in `src/model/compose.ts`, usable from the build and the viewer. Tests on the `deep` fixture and a large app's shape. It also includes `docs/tours-data.md`.
3. **Up / across / down transition.** One `travel(from, to, edge?)` that the player calls for every board change:
   - It climbs to the lowest common ancestor in one move, runs the dot along the real arrow, then dives in.
   - It also handles dial-stop changes.
   - Next pressed mid-move skips to the end, a tour start from the overview glides the boxes both boards draw, and reduced motion gives a short fade.
4. **Steps at any stop.** The player turns the dial for a step that names a stop, and the stop is restored when the tour ends. The tour strip and the dial agree on the stop.
5. **Breadcrumb trail.** During a tour, the breadcrumb lights the levels passed, and the strip shows the step's path.
6. **Derived tours (no AI).** Entry → sink chains from the file graph, composed. A few per repo, deduplicated against Claude's tours, with mechanical captions. `--default` gets them.
7. **Skill: Claude writes chain tours.** Update the `/map` digest and SKILL.md so Claude writes 2–4 tours as chains with captions and a depth. The schema and validation are in the build.
8. **Deep links to a tour step,** e.g. `#tour.patient-check-in.3`. Back/Forward steps through the tour.
9. **Review round.** A/B on real tours: the transition's timing, how deep the derived tours go, and caption style.

Issues 2 and 3 can start now, next to #192. Issues 4–8 build on #192 and #2.

## Contract between the issues (so they can be built in parallel)

```ts
// src/model/compose.ts (#193)
/** The minimal page data a tour is built from: the tree (with fine nodes), file paths and the file graph. */
export interface TourGraph { /* defined by #193: nodes, paths, fgraph */ }
export interface TourStep { board: string; stop: string; lit: { boxes: string[]; edges: [string, string][] }; caption: string; via?: [string, string] }
export interface Tour { id: string; title: string; steps: TourStep[]; source: "claude" | "derived" | "flow" }
/** A file chain (repo paths) -> steps; throws ChainError naming the first missing hop (and whether it exists reversed). */
export function composeTour(g: TourGraph, chain: string[], opts?: { depth?: number; captions?: string[] }): TourStep[];
/** Chains of real runtime edges from `from` (a file path or group id) to `to` (file/group id) or to any sink when omitted; bounded, deterministic. */
export function findChains(g: TourGraph, from: string, to?: string, opts?: { max?: number; maxLen?: number }): string[][];

// src/viewer/travel.ts (#194)
export function travel(from: { board: string; stop: string }, to: { board: string; stop: string }, edge?: [string, string]): Promise<void>;

// the player (#192)
export function playTour(id: string, step?: number): void;   // also accepts derived/flow tours by id
export function onTourStep(f: (tour: Tour | null, step: number) => void): void;  // fires on every step change and on leave (tour null)
```

Until an issue merges, the others may stub these with the same signatures in their own branch, and delete the stub when they merge main.
