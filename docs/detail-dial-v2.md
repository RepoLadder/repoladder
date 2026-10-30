> The dial is behind the launch switch (`src/features.ts`), off by default.

# Detail dial v2: a box budget per stop (draft plan)

This replaces the dial's fixed per-stop rules with a single idea. **The dial sets the most boxes a board may draw. Each board opens its own parts in place until the next opening would go over that number.** Default is unchanged. The number of stops comes from the repo.

## Why (the owner, 2026-10-10)

- Detailed `Web app` is right: it shows about 36 boxes.
- Click into `War room` and Detailed draws the same 5 boxes as Default and Simple.

The cause is that Detailed merges levels 2+3 and 4+5. War room's parts are on level 4, and there is no level 5 under them. Simple only splits leaves over 6 files, and War room's are smaller than that. Rules that work by depth fail exactly where there's less to merge.

The owner's model:
- **Detail is a cap on boxes per board.** Default is the cap they tuned, and it's the right default for any repo.
- **How far the dial goes depends on the repo.** A monorepo gets many stops between Default and Everything; a tiny repo might get Default and Everything only.
- **Depth goes down as detail goes up.**

## Decisions (owner, 2026-10-10)

| question | decision |
|---|---|
| How an opened part looks | **A labeled container** with its parts inside, on every board. Web app at Detailed becomes frames, not today's flat 36 boxes. |
| Stops below Default | **Exactly one Simple**, built from Claude's named splits. It doesn't vary by repo. |
| Labels | **Simple, Default and Everything are named.** The stops between Default and Everything are unnamed dots; hovering one says "up to N boxes per board". |
| Finest unit | **Files.** Keep the design open to symbols later, but don't build it now. |
| Which parts open first | **Evenly, a rung at a time.** All of a board's parts open one rung deeper together if they all fit. If not, the biggest open first, while they fit. |
| Step size | **About 2.5× per stop**, e.g. Default → 30 → 75 → 190 → Everything. |
| Token cost | **Quality first.** Claude names every rung it adds. Nothing gets a mechanical name. |

## The model

### The tree

The tree is the grouping as Claude writes it (unlimited depth, #103), plus the Simple splits as real nodes marked `fine`. Default and the stops above it skip `fine` nodes, and Simple shows them. The upper stops never invent groups; they only open groups that already exist. So the upper range costs Claude **no extra tokens**: every container on the screen is a node Claude already named.

### A board at a stop

Every group node `n` has a board at Default and Simple; at a budget stop only the layers do (superseded by #327, below). The board draws what `cut(n, B)` returns:

1. Start with `n`'s children: the board's frontier. Its "elsewhere" lane and its services count toward the boxes, as they do on Default today.
2. **Evenly:** if opening *every* openable box on the frontier keeps the count at or under `B`, open them all and repeat.
   - An openable box is a group, or a leaf whose files can show.
   - An opened box becomes a container and stops counting; its children count instead.
3. Otherwise, take the openable boxes from biggest to smallest, and open each one that still fits. Then stop.

**Default** opens nothing: its boards are the boards of today, precomputed with D2 and lint-checked. **Simple** is Default with the `fine` nodes shown. The **middle stops** are `B = round(D × 2.5^k)` for k = 1, 2, …, where `D` is 12, Default's own cap.

### How many stops a repo gets

The stops go up until the root's board opens all the way to files. That last stop is **Everything**, the one-board view we already ship (#146): Everything simply becomes the top budget. A stop where no board changes from the stop below it is dropped. Estimates:

| repo | files | stops |
|---|---|---|
| a large app | 477 | Simple · Default · 30 · 75 · 190 · Everything |
| repoladder | 115 | Simple · Default · 30 · 75 · Everything |
| a 20-file repo | 20 | Default · Everything (Simple only if Claude wrote splits) |
| a 5,000-file monorepo | 5,000 | about 6 dots between Default and Everything |

### Depth goes down by itself

A board at a higher budget absorbs its children's boards into containers, so it takes fewer clicks to reach a file. Every group still keeps its own board, so you can always open a part (superseded by #327, below). **Opening `War room` at stop 30 shows War room's board at budget 30**, with its parts opened to their files. That's exactly the screenshot the owner expected.

### Moving around

- **Opening a part:**
  - A closed box opens its board, as it does today.
  - A container opens its board on a double-click, or from its name band (superseded by #327: it turns the dial down, below).
- **Turning the dial** (superseded by #327, below) keeps you on the same group's board, because every group has a board at every stop. The selection is kept if it's still drawn; otherwise its container or closed ancestor is selected instead. This replaces the per-stop holder maps (`dialmap.ts`) with one rule: the drawn box that contains the id.
- **Remembered stop:** it's stored relative to Default (`default`, `simple`, `+1`, `+2`, `everything`), because the number of stops changes from repo to repo. `+3` on a repo that only has 2 middle stops lands on the closest one.
- **Deep links, Back and tours:**
  - Deep links and Back keep using group ids, as today, and need no stop.
  - Tours still run on Default.

## Data: what changes in the page

Less than today:

- **Kept as is:**
  - the Default boards and their D2 layouts
  - the file graph (`fgraph`)
  - the group tree
  - the Simple extras
- **New:** nothing the build has to ship. `cut()` and the list of stops are pure functions of the tree, its file counts and the file graph, run in the browser.
- **Removed:**
  - Detailed's level-merge rules (`stoptree.ts` `detailed`)
  - the per-stop holder maps
  - Everything's special-casing, which becomes the top stop

## Layout

Every board that opens a container is laid out the way Everything is today (`everylayout.ts`):
- leaves layered, with their arrows
- containers packed with ELK rectpacking
- arrows routed along the gutters (`gutters.ts`)

Fitting the window (#183; owner feedback: fitting the board to the window and cutting wasted space matters most, and the lane is never in the middle). After ELK, `everyfit.ts` packs every container of containers again with `skyline.ts` (each box at the lowest spot it fits, so a short part tucks in beside a tall one), trying a few orders, widths and inner aspect ratios, and keeps the layout whose boxes cover the most of the canvas at the fit: their area over the bounding box, times the share of the canvas that box covers. Among the packings that keep the board's reading order (the container's children in order, read row by row; skyline and shelf packings in the given order), it takes the best unless that covers more than `ORDER_SLACK` (10%) less than the best in any order, so a window of another shape changes where rows wrap, not which box is first (#463). The arrangement is chosen when a board is laid out, not on resize: a resize only re-zooms the camera. The lane ("elsewhere" boxes and services) is never packed: it sits at the board's right edge, or its bottom when the canvas is taller than wide. The canvas's shape is bucketed (`aspectBucket`) and is part of the layout's cache key.

Stability of that fit (#462): `npm run stability` scores how many box pairs keep their left/right/above/below relation (box centers, 2px counts as the same band, both axes) between two layouts. Its window-shape table lays the board's Everything cut out at aspects 0.46, 1, 1.6 and 2.2 (the `aspectBucket` shapes) and adds a pair just either side of `LANE_TALL`, where the lane flips side. It is report-only.

The roll-up rules are the same as today (`model/rollrules.ts`, via `stops.ts`): an arrow is drawn once, between the two boxes where its ends split.

Layout runs in the Worker and is cached per (board, stop). A large app's Everything (477 boxes) takes about 0.3s, so a 75–190 box board should take well under that. A board that comes out the same as Default reuses its D2 layout (`stoplayout.ts` already does this).

## Risks / open questions

- **A middle stop can be unreadable at fit**, like Everything, in proportion to its budget. That's accepted; it's the point of turning the dial up. Zoom stays the way to read it, and the hard lint (overlaps, lines through boxes) still applies.
- **"Evenly" can stall:** if a single huge part doesn't fit, nothing opens beside it. Step 3 (biggest first, while it fits) handles this. A part that can never fit stays closed until a bigger stop.
- **Containers count zero boxes.** If boards come out too busy, a container can count as half a box. Tune this by eye.

## Build order (each is one issue)

1. **`viewer/budget.ts`: `cut(n, B)`, the list of stops, and the containing-box lookup.**
   - Pure functions, with tests on the `deep` fixture and on a large app's tree shape.
   - Covered: War room at stop 30 opens to files; Default gives today's boards exactly; a tiny repo gets only Default and Everything.
2. **Container layout for any board:** generalize `everylayout.ts` from "the root, opened fully" to "any `cut()`". Everything becomes `cut(root, ∞)`.
3. **The dial with a stop count per repo:**
   - The dots, with ends named and the middle stops showing "up to N boxes per board" on hover.
   - The remembered stop, stored relative to Default.
   - Alt+↑/↓ steps through the stops this repo actually has.
4. **Moving around:**
   - A container opens its own board.
   - Turning the dial keeps you on the same group, using the containing-box rule.
   - Remove Detailed's merge rules and `dialmap.ts`'s holder maps.
5. **Simple folded into the tree:** splits become `fine` nodes when the page is unpacked. The schema and the skill don't change.
6. **Review round:** A/B renders on a large app for:
   - `War room` and `Web app` at stop 30, compared with Default
   - containers counting 0 boxes vs ½ a box
   - 2.5× steps vs 2× steps

## Contract between the issues (so they can be built in parallel)

```ts
// src/viewer/budget.ts (issue: cut)
/** A stop of this repo's dial, bottom-up order is not implied: stopsFor returns top (Everything) to bottom (Simple). */
export interface StopDef { key: "everything" | `+${number}` | "default" | "simple"; budget: number /* Infinity for everything, 0 for default/simple */; label: string /* "Everything" | "up to 30 boxes per board" | "Default" | "Simple" */ }
export function stopsFor(nodes: Record<string, PageNode>, paths: string[]): StopDef[];

/** What board `board` draws at `budget`. Ids: group ids, and "@<path index>" for files. */
export interface Cut {
  board: string;
  budget: number;
  /** Every opened group (the board itself included) -> what it holds, in tree order. */
  open: Record<string, string[]>;
  /** The closed boxes drawn (leaves of `open`). */
  boxes: string[];
}
export function cut(nodes: Record<string, PageNode>, paths: string[], board: string, budget: number): Cut;
/** The drawn box or container that holds `id` on this cut (itself, or its nearest drawn ancestor); null if not on the board. */
export function drawnHolder(c: Cut, nodes: Record<string, PageNode>, paths: string[], id: string): string | null;
```

Until the cut issue merges, other issues may stub these with the same signatures in their own branch (and delete the stub when merging main).

## Shipped: the stops wired into the viewer (#173)

- **Showing a stop** (`viewer/stopview.ts`): Default is the page as built and Simple is unchanged. Every other stop, Everything included, shows each group's board as `cut(tree, paths, group, budget, { extra })`, where `extra` is the board's lane and services on Default. The board is laid out by `cutLayout` when it is first shown, and a cut that opens nothing is the Default board with its D2 layout. The boards that the shown board's closed boxes open are laid out next, in the background.
- **Everything is the top budget on every board** (superseded by #327, below). It is no longer a single board you zoom around. Turning to it keeps you on your board, opened all the way to files, and the story level and the tours list stay.
- **Opening:** a closed box opens its board, as before. A container opens its board on a double-click on its frame or its name band, or with Enter on a selected name band (superseded by #327: it turns the dial down, below). A single click on the name band selects it.
- **Turning** keeps the board (superseded by #327, below). The selection becomes the drawn box or container that holds it: `dialmap.ts` `mapHit` reads the board as drawn as a `Cut` and calls `drawnHolder`. A place in Back/Forward that was seen at another stop opens on the same board.
- **Removed:** Detailed's merge rules (`stoptree.ts` now only indexes a tree for Simple's roll-up), the per-stop holder maps (`StopData.holder`, `holderOf`, `merges`), `stopsOf`/`canView`, and Everything's zoom-to-container (`everyHere`, `zoomTo`).
- `__repoladder.stop(key, at?)` takes a stop key (`everything`, `+k`, `default`, `simple`; the old `detailed` reads as `+1`). A key the repo lacks lands on its nearest stop, and `at` = `"_story"` on a page without a story level opens the root.
- **The story level (Overview) turns too** (`viewer/storycut.ts`, #184). The story board is not a group, so `cut()` never saw it and every stop drew it as built; the turn itself was fine. At a budget stop it is now the root's cut, its actors and services counted as `extra`, with the root container renamed to the story and the actors set in a column on its left, as on Default: each actor's arrow leaves straight right with room for its pill, then runs along the gutters. Story parts are level-1 groups, so they never overlap. Simple draws the story as Default does: splits never change a level-1 part.

## Shipped: "Detail", More and Less (#265)

The owner's call (2026-10-10): no numbers anywhere on the dial.

```
 Detail
  More     ○
           ○
           ○
  Default  ●
  Less     ○
```

- **Names.** The title "Detail" and the names of the ends and Default show only on hover, keyboard focus or a phone tap. At rest the dial is dots only. The top stop (Everything) is called **More** and the bottom one (Simple) **Less**. The keys don't change (`everything`, `+k`, `default`, `simple`), so remembered stops and `__repoladder.stop` keep working. The dial sits a title's height lower than before, so the open panel fits between it and the zoom buttons.
- **Middle stops** are unnamed dots with no text, even on hover or focus (#325). #265's quiet 'opens …' hint widened the names panel, so it was removed, and the panel is now only as wide as the fixed names. A screen reader names each one 'Between Default and More, k of N', counted up from Default (`+1` is 1).
- **Home.** Default's dot keeps a small notch on its left at every stop, so Default is visible at rest. A double-click anywhere on the dial goes back to Default.
- **Keys.** `[` steps down (toward Less) and `]` steps up (toward More). Alt+↓/↑ still work.
- **Less on every build.** Less used to show only when Claude wrote splits, so `build --default` pages (most of the gallery) had Default at the bottom. Without Claude, the build now writes the splits itself (`model/autosplits.ts`): one more round of the no-AI grouping's own splitting (`budgetsplit.ts`) at `LESS_BOXES` = 8 boxes per board, keeping each split leaf's new level as that leaf's `split`. The level guard (`simpleTree`) then drops any that wouldn't earn its click, as it does for Claude's. The names are the no-AI mode's (subfolders, shared prefixes, import hubs, alphabetical ranges). A grouping Claude wrote is never split mechanically: its Less comes from its own named splits, and a grouping with none still has no Less.

## Layers (#327)

The dial sets how many layers the whole map has. More detail means fewer layers, and the top stop is a single layer: the whole repo on one board.

- **Existence.** At a budget stop a group has its own board only while a board that exists draws it as a closed box. A group opened in place as a container has none there. The tops (the Overview and root) always exist, and so do store boards. `budget.ts` `layersAt` walks from the tops, cutting each board that exists at the budget; `layers.ts` caches it per page and offers `hasLayer`, `layerOf` and `holdOn`.
- **Default and Simple** keep every board, as before. On a story page both top boards count, so a first-rung part has a board if either the Overview or All parts draws it closed.
- **Landing.** A turn that removes your board lands on its nearest surviving ancestor (a first-rung part's is the Overview on a story page, else root), with the box you had selected, or else the box or container now holding where you were, selected and in view (`dialmap.ts` `landTurn`, `mapHit`).
- **Turning back down** returns to the board you were on before the jump once it exists again, with its selection, and its view when you turn back to the stop it was saved at. The memory survives successive turns and is cleared by any move that isn't a turn, and once restored.
- **Opening a container** (double-click on its frame or name band, Enter, or the panel's Open) turns the dial down to the highest stop where it has a board (`dial.ts` `openDown`) and shows it. It is one Back step, to where you opened it.
- **Back/Forward.** Turns and the jumps they cause add no step. A history place whose board has no layer at the current stop opens its nearest layer. Every route to a board goes through `navigate.ts` `show`, which redirects (search, Go to, jumps, deep links, Escape, crumbs, `__repoladder.show` and `.stop`).
- **Crumbs and depth badge** list only boards that exist at the current stop, plus the board on screen.
- **Tours** are mapped at play time: a step whose board has no layer at its stop plays on the nearest one that does, with its lit boxes and arrows mapped to the drawn holders (`dialmap.ts` `mapStep`). The build-time placement (`compose.ts`) is unchanged.
- **Modules:** `budget.ts` `layersAt`, `layers.ts`, `dialmap.ts` `landTurn` and `mapStep`, `stopview.ts` `boardAtStop`, `hasBoardAt`.
