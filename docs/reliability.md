# Reliability sweep

15 public TS/JS repos of different shapes, shallow-cloned at the commits below, run with `analyze` + `build --default` (no AI). The sweep reuses the gallery: an untracked `gallery/local.json` pointing at the clones, then `npm run gallery -- --only <names> --jobs 1`.

## Result

- **First try, before fixes: 14/15 built (93%)**. trpc failed: `INVALID grouping: duplicate id "root"`.
- **After this PR's fixes: 15/15 built**, with 0 hard layout defects on every repo.
- Not every diagram was one we'd show. Six distinct problems were fixed here; four stay open (below).

## Results (`build --default`, after the fixes)

Time is analyze + build wall time on a 10-core Mac, laid out cold the first time but measured while the machine was under heavy load from other jobs (load average 25-190), so treat it as an upper bound. A rerun of np alone, unloaded, took 2.2s. KB is the page against its budget (`budgetKb`). Digest is the estimated tokens of `summary`. Defects are boards with hard lint defects; over is boards over the digestibility budget.

| Repo @ commit | Shape | Files | Boards | Time | KB / budget | Digest | Defects | Over | Would we show it? |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| shadcn-ui/taxonomy @ 298a885 | Next.js app router (Prisma, NextAuth, Stripe) | 124 | 32 | 2.9s | 98.9 / 111 | 4.0K | 0 | 1 | Yes; `components/ui` hides 10 files |
| vercel/commerce @ 3761e52 | Next.js storefront | 64 | 24 | 2.4s | 89.9 / 103 | 2.4K | 0 | 0 | Yes, though plain (App, Components, Lib) |
| alan2207/bulletproof-react @ 9506629 | Three SPA reference apps | 336 | 122 | 5.2s | 118.2 / 201 | 10.5K | 0 | 1 | Yes after fixes (were two same-named boxes and 114 invented call arrows) |
| excalidraw/excalidraw @ 4c00f31 | Vite app + library monorepo | 533 | 158 | 10.0s | 176.1 / 237 | 10.6K | 0 | 12 | Overview yes; 12 deep boards crowded |
| gothinkster/node-express-realworld-example-app @ 30b68e1 | Express + Prisma API | 26 | 9 | 2.5s | 85.3 / 88 | 1.3K | 0 | 1 | Yes |
| w3cj/hono-open-api-starter @ 0d5f3bf | Hono OpenAPI + Drizzle API | 15 | 4 | 0.8s | 81.4 / 83 | 0.6K | 0 | 0 | Yes after fixes (database drawn; the 5 task endpoints found, with a derived tour from `tasks.index` to SQLite; methods shown since #244) |
| firebase/friendlyeats-web @ 0120c72 | Firebase + Next.js starters | 84 | 23 | 3.1s | 90.4 / 102 | 3.3K | 0 | 0 | Yes after fixes (was two "Hosting", two "My app") |
| sindresorhus/np @ 591e003 | CLI | 18 | 7 | 2.2s | 83 / 86 | 0.6K | 0 | 0 | Yes after fixes (was a "library" named Source) |
| sindresorhus/ky @ 3541888 | Small library | 31 | 11 | 2.4s | 85.7 / 90 | 0.6K | 0 | 1 | Yes after fixes (was Source + unconnected "Test d") |
| colinhacks/zod @ 284243f | Library monorepo | 306 | 66 | 3.9s | 106.5 / 145 | 5.2K | 0 | 5 | Overview yes; locales board hides 45 files |
| gothinkster/react-redux-realworld-example-app @ ee72eba | Older CRA + Redux app (JS) | 38 | 11 | 0.9s | 84.8 / 90 | 1.7K | 0 | 0 | Yes |
| t3-oss/create-t3-turbo @ 8f945b7 | Turborepo / pnpm monorepo | 60 | 23 | 3.1s | 88.3 / 102 | 2.2K | 0 | 2 | Yes |
| expressjs/express @ a419aa7 | Older plain-JS library + examples | 50 | 8 | 4.4s | 84.5 / 87 | 1.4K | 0 | 1 | Yes after fixes (examples are one "Examples" box; root `index.js` sits with Lib) |
| remix-run/indie-stack @ 56abb93 | Remix app (Prisma) | 22 | 6 | 7.2s | 82.7 / 85 | 0.8K | 0 | 1 | Yes after fixes (was split into 4 fake libraries) |
| trpc/trpc @ 796700d | pnpm monorepo, 1000 files | 459 | 138 | 33.9s | 149.1 / 217 | 10.8K | 0 | 17 | No: 27-part "Examples" board |

## Failures

Fixed in this PR (regression tests in `test/reliability.test.ts`):
- #226 build crash when the root package is named `root` (trpc).
- #227 two packages with the same name get boxes with the same name (friendlyeats-web, bulletproof-react).
- #228 an HTTP client named `api` read as server routes, inventing runtime-call arrows (bulletproof-react).
- #229 a test fixture's `package.json`, or a small tool package beside a root app, splits the app into fake packages (np, indie-stack).
- #230 tsd type tests (`test-d/`) and dotfile configs (`.eslintrc.cjs`) analyzed as source (ky, indie-stack).
- #232 Drizzle databases not drawn; the Drizzle Postgres rule never matched (hono-open-api-starter).
- #233 Hono OpenAPI routes (`.openapi(createRoute({ path }))`) not detected (hono-open-api-starter).
- #225 Express's examples clustered and named "Redis" after a minor file (express).

Fixed after the sweep (the table above was measured before these):
- #222 a repo of many example apps gave an over-budget "Examples" group board (trpc). Fixed in #247: the example apps go one level down together.
- #224 flat folders with no seams stayed over budget, files hidden in "+N more" (zod, taxonomy, excalidraw, express). Fixed in #239: alphabetical ranges for seamless flat folders. Their cuts fall at name-prefix anchors and their ids are keyed by the range's last file name, so a one-file edit changes one range, not every later one.

Nothing from the sweep is open.

## Time and cost per run, by size

From the table: `analyze` + `build --default` stays under about 5s up to ~300 files and about 10s at 500 files on an idle machine (trpc's 34s was measured under load). The page stays inside its budget at every size.

At about 2,000 files (documenso, below) `build --default` took 170-215s cold and 64s warm, on a machine under heavy load; after fixes it is 93-103s cold and 21s warm, still on a loaded machine (see "After #311"). A `/map` run there reads the skill (~6.3K tokens), the folder-first top digest (~10.5K) and up to 12 part digests (~81K in the dry run below), about 97K tokens of input.

A `/map` run adds Claude's part: it reads the skill (~4.8K tokens) and the digest (0.6K tokens for a small library, 2-5K for a typical app, ~11K at 450-550 files, capped by the digest budget), writes `grouping.json` and rebuilds up to 3 times. So the input is roughly 6K tokens for a small repo and 16K for a large one, plus the grouping it writes. ### With a full grouping (the `/map` path)

Groupings for 5 repos were written the way `/map` does, from the skill and the digest only. The repos were run one after another.

| repo | first try | rebuilds | first-try error | still over budget |
|---|---|---|---|---|
| node-express-realworld | INVALID | 2 | narrative used `[[svc-postgresql]]`; the real id is `svc-postgres` | `_story` (names 9.9px) |
| np | INVALID | 2 | a tour hop guessed without file-level imports | `_story` (names 11px) |
| friendlyeats-web | INVALID | 1 | `.ts` written for a `.tsx` file (the digest drops extensions); `store-firestore` in a narrative | none |
| create-t3-turbo | OK | 1 | (2 boards over budget on name size) | none |
| taxonomy | OK | 1 | (6 boards over budget on name size) | `_story` (names 9.7px) |

**Result:** 5 of 5 reach `BUILD_OK` within the 3-rebuild limit. Only 2 of 5 are valid on the first try, and every first-try failure came from the digest or the skill, not from the code. Follow-ups: #235 (digest and skill friction), #236 (story board name size), #237 (a false-positive call; fixed: URL strings used as data no longer count).

**After #235** (the digest lists service and store ids, keeps every extension but the most common one, gives one chain per last hop plus a "Next hops" list; narratives take store ids; errors suggest the id or path meant): fresh first-try groupings, written by a new agent from the skill and digest alone, were valid on the first build for node-express-realworld (twice) and friendlyeats-web, the two repos that failed before. friendlyeats-web had no board over budget. On the second realworld try, written with the revised leaf advice (about 8 boxes per leaf board), 2 boards were over: `_story` and one 7-file leaf at 10.7px names. The digest grew by about 0.6K tokens on realworld and 1.1K on friendlyeats-web.

## Very large repos: two-pass grouping

On documenso @ 38ecb21 the one-pass digest hid 1766 of 2029 file names (10.8K tokens), so Claude couldn't write leaf patterns that cover every file. Now a digest that would hide any name goes folder-first (`Large repo: two passes.`, 10.4K tokens, no names hidden), Claude writes placeholder leaves, and `summary REPO --part <leaf id>` prints each placeholder's own digest with every file name (SKILL.md section 2). Small repos' digests are byte-identical to before. Of the pinned gallery repos, only excalidraw (532 files) goes two-pass: its one-pass digest hid 54 of 532 names, and its top digest drops from 10.5K to 5.8K tokens; the other six are unchanged.

### `build --default` at 2,000 files

| repo | files | packages | services | analyze | build cold | build warm | boards | over budget | KB / budget | load average |
|---|---|---|---|---|---|---|---|---|---|---|
| documenso @ 38ecb21 | 2,029 | 15 | 10 | 5.6s | 215s; 170s on a rerun | 64s | 756 | 73 | 566 / 838 | 270 → 130 (cold), 18 → 88 (cold rerun), 130 → 93 (warm) |

The machine was never idle during this ticket (load averages of 18-310 on a laptop running parallel builds), so treat these as upper bounds. `summary` takes 5.1s before and after this change.

**Where the time goes** (cold rerun, 170s, timers around `runBuild`'s phases in a scratch copy):
- D2 layout: 120.6s on the first pass plus 26.5s on the re-layout after the names split (`runBuild`'s loop), so 87% of the build. It runs in worker threads.
- Model: 3.9s, then 8.8s again in the re-layout pass. `splitOverBudget` on the crowded boards: 5.0s. `defaultGrouping`: 3.5s. Lint and `renderHtml`: under 1s.
- A main-thread CPU profile of the model phases (with no D2 workers; `--cpu-prof` on the whole build hangs, since the workers inherit it) puts the top self time in `boxOf` (fileboards.ts, 14%), `assign` (grouping.ts, 7%), `buildModel`'s roll-up (rollup.ts, 9% together) and `buildFileBoards` (5%). By file: native code 45%, fileboards.ts 21%, grouping.ts 10%, rollup.ts 10%.
- Follow-up: #311, done: see "After #311" below.

#### After #311

`build --default` on documenso @ 38ecb21, measured with `npm run gallery -- --large --jobs 1`. The totals below are `build` alone (the gallery's own analyze step took 3.5-5.7s more), cold (no `layout-cache.json`) and warm (the next run). The machine was never idle (other builds ran alongside), so the load averages (1 / 5 / 15 min at the start of each run) are given; compare the two columns, not the absolute numbers.

| | before (main) | after |
|---|---|---|
| build cold | 161s (load 218 / 858 / 500) | 93s (load 167 / 201 / 210); 103s on a rerun |
| build warm | 127s (load 851 / 868 / 577) | 21s (load 93 / 164 / 195) |
| `diagram.html` | same bytes | same bytes (also for all 8 gallery repos and the 4 demos, cold and warm, and with `REPOLADDER_VERIFY_LAYOUT=1`) |

Per phase after (cold run, `REPOLADDER_TIMINGS=1`, from `build.log`):

| phase | cold | warm |
|---|---|---|
| grouping | 1.1s | 1.2s |
| model, pass 0 / 1 / 2 | 1.7s / 2.0s / 2.0s | 2.0s / 1.8s / 2.1s |
| layout, pass 0 | 72.1s: 667 boards, 11,838 D2 compiles | 7.8s: 0 compiles |
| layout, pass 1 (after the names split) | 10.9s: 743 boards, 526 reused, 1,882 compiles | 2.5s: 0 compiles |
| layout, pass 2 (after the second split) | 0.7s: 747 boards, 739 reused, 61 compiles | 0.4s: 0 compiles |
| lint, split (all passes) | 1.7s | 2.1s |
| render | 0.5s | 0.5s |
| total | 93.2s | 20.9s |

What each change bought:
- One D2 pool per build, saving the union of every pass's cache entries: the warm run drops from 127s to 21s and compiles nothing in any pass. Before, each pass's pool pruned the cache file to its own entries, so only the last pass was cached and every warm run compiled the earlier passes again.
- Per-board reuse across passes: the re-layout lays out 217 of 743 boards instead of all of them, and the third pass 8 of 747. Cold, that is the 26.5s re-layout of the issue falling to 10.9s (most of it the boards the split really changed).
- Skipping the first-pass layout of boards that are provably crowded: the area bound proves no board crowded at 2,000 files (`skipped=0` in every pass), so this was dropped from the PR.
- Model hot spots (`buildFileBoards` indexing facts by leaf, `assign` trying only the patterns that can match, push instead of spread-copy): the model passes take about 2s each, against 3.9s and 8.8s in the issue's profile.

`gallery`'s lint step used to re-lay out the finished model against the build's cache and prune it to that model's entries; it now reads the cache without rewriting it, so a gallery rerun is a true warm run.

Progress output: `build` prints `[build] ` lines on stderr (stdout is unchanged): a start and a done line per stage (reading, parsing, resolving imports, grouping, model, layout, lint, split, render, write), and a count with a percent and the elapsed time while it reads, parses and lays out (`layout pass 1 of up to 3: 340/1,200 boards (28%) · 4m12s elapsed`). Ticks are throttled to one per 10 points and 5 s, with a count-only line after 30 s of silence. `build ./repo --quiet` turns them off; `REPOLADDER_TIMINGS` is independent of it. The library has the same events through `buildFromFiles`'s `onProgress`, unthrottled, with no `write` or `note` events.

Layout cache saves: the cache file is written while the build runs (every 500 new compiles or 60 s, whichever comes first, never pruning, and never costing more than about 10% of the build because the gap before the next save is at least 10 times the last save). The final close still prunes to the layouts the build used. Ctrl-C or SIGTERM during `build` saves it once more, prints `[build] interrupted; saved layout cache (N layouts)` (not with `--quiet`) and exits 130 or 143, so a rerun on the same `--out` starts from those layouts. Every write goes through `layout-cache.json.<pid>.tmp` and a rename, so the file always parses; a killed process leaves at most a stale `.tmp`, which the next run removes. `REPOLADDER_CACHE_SAVE_EVERY` and `REPOLADDER_CACHE_SAVE_MS` override the thresholds (for tests).

To reproduce: `REPOLADDER_TIMINGS=1` prints the `TIMING` lines on stderr, and `REPOLADDER_VERIFY_LAYOUT=1` lays out every board a second time and fails the build (`LAYOUT_REUSE_MISMATCH`) if a reused layout differs from a fresh one.

Every `TIMING` line also ends `rss=<n>MB heap=<n>MB` (process memory when the line printed). The peak is the maximum over the lines; the garbage collector makes a single reading swing, so compare maxima, not neighbours.

#### Layout cost

Layout cost is boards times the candidates tried per board (each spread, direction and lane mode, plus the retries), so this change first measures where the compiles go and removes only work that cannot change the output.

- `REPOLADDER_D2_WORKERS=N` sets the number of D2 workers (an integer 1-16; above 16 it is clamped to 16). It bypasses the `totalmem / 2 GiB` guard, since an explicit setting is your call (each worker holds a ~250MB wasm heap). An empty, `0`, negative, fractional or non-numeric value is ignored and the default applies (`min(6, cpus - 1, totalmem / 2 GiB)`).
- With `REPOLADDER_TIMINGS=1` each `TIMING layout#N` line carries, after `boards= reused= compiles= hits=`: `dir=` / `spread=` / `lane=` (compile requests by direction, spread rung and lane mode, counted before the pool's cache), `clearRetries` (second layouts with long labels dropped), `laneSecond` (second lane compiles), `stopRung=` (boards by the spread rung where the early stop fired) with `fullLadder` (boards that ran every rung), `d2Ms` (cumulative time awaiting D2 across concurrent boards, so not wall time), `jsMs` (cumulative time in the JS around the compiles) and `dupes` (candidates dropped as exact copies of an earlier one). Nothing is counted or timed with the variable unset.
- At most `max(8, workers * 4)` boards are laid out at once. Results are collected by board, so the cap changes memory and progress, never the layout.
- A candidate that is JSON-equal to an earlier one of the same board is dropped before picking: `pickLayout` keeps the first of equals, so the pick is the same, and the lint and name-size work runs once. No compile is skipped.
- `npm run bench:layout -- [--folders N] [--seed N] [--workers N] [--cache-dir DIR]` builds a seeded synthetic repo (default 300 folders, 4-14 files each, 6-10 deep; about 2,700 files and 660 boards) through the default grouping and the passes, offline and cold, and prints the `TIMING` lines, the board count, compile requests, wall time and the stats tokens.

Reading it on excalidraw (`build --default`, pass 0: 157 boards, 1,690 compiles, 273 hits): 36 boards ran the whole spread ladder, 51 stopped at the first rung and most of the rest by the third; 512 of the compiles were second lane compiles; the JS around the compiles (`jsMs` 0.9s) is small next to the compile wait. On the synthetic bench most boards stop at rung 0 (575 of 659), so its cost is mostly the number of boards. Pruning candidates for small boards would change layouts, so it is left for a follow-up once these numbers say where it pays.

| `bench:layout` (default options, this machine, 6 workers) | before (`develop`) | after |
|---|---|---|
| boards / compiles / hits (pass 0) | 659 / 680 / 1,150 | 659 / 680 / 1,150 |
| wall time | 1.7-1.8s | 1.7s |
| gallery `zustand`, `taxonomy`, `excalidraw` `diagram.html` | | byte-identical |

#### Fidelity profiles (#521)

Since #449 a leaf's file board draws every connection, which roughly doubles layout cost on big repos. `--profile hosted` (CLI) or `buildFromFiles(files, { profile: "hosted" })` restores the budgeted file board: at most `max(8, 1.5 * boxes)` file-to-file arrows plus every runtime call, hubs (a file imported by 60% of a 5+ box board's siblings) and services used by more than 3 files listed instead of drawn, and splitting that ignores the file-arrow count. Coverage becomes informational: `coverageFails` is always false, so `lint:layout` exits 0 on a hosted build whose only findings are undrawn connections or off-board tour steps (layout defects still fail). `full` is the default everywhere and unchanged; the profile is written to `model.json` and the page only when it is `hosted`, and `buildFromFiles` always returns `profile`. Use `hosted` only for builds under a time limit.

Measured on thinkrail (`build --default --fresh`, layout pass 0, 4 cores):

| | `full` | `hosted` |
|---|---|---|
| boards | 460 | 352 |
| D2 compiles | 6,522 | 4,204 |
| whole build (final boards) | 37s wall, 220 CPU-s (484 boards) | 24s wall, 135 CPU-s (384 boards) |

That is about 23% fewer boards, 36% fewer compiles and 39% less CPU. The hosted rung is a hand port of the pre-#449 rules, so it will not match the old numbers exactly.

### `/map` dry run (two passes)

An agent followed SKILL.md sections 2-4 by hand on documenso, from the digests alone, and stopped before publishing.

| pass | leaf | files | digest tokens |
|---|---|---|---|
| top | | 2,029 | 10,454 |
| part 1 | trpc | 478 | 10,983 |
| part 2 | remix-app-components | 375 | 10,943 |
| part 3 | lib-server | 300 | 9,553 |
| part 4 | lib-common | 213 | 8,440 |
| part 5 | remix-app-routes | 141 | 9,784 |
| part 6 | ui | 136 | 6,746 |
| part 7 | auth-ee | 99 | 6,315 |
| part 8 | lib-jobs | 79 | 4,896 |
| part 9 | email | 73 | 5,047 |
| part 10 | remix-shell | 56 | 2,912 |
| part 11 | root-more | 51 | 3,717 |
| part 12 | lib-data | 28 | 1,936 |

| first try | rebuilds | `--part` runs | final build | still over budget |
|---|---|---|---|---|
| INVALID: 5 files of a leaf's `split` in no part (the agent's patterns dropped an extension); story and 4 tours valid | 3 | 12 (none "still too big") | `BUILD_OK`, 542 boards, 483KB, about 40-49s per build | 105 of 543 boards (97 leaf boards, 14 of them on box count and the rest on name size; 6 group; the story; the store) |

Level 1: Signing web app, App & public API, Core logic, Shared UI kit, Email templates, Sign-in & enterprise, Docs & public stats. The whole repo was named in 12 part digests, none over budget; a 478-file part still listed every name in 11K tokens.

What the dry run found:
- **Placeholders must be big.** 12 runs only cover the repo with about one placeholder per package or major folder; the skill now says so.
- **Prefixed default ids could collide** (`api` became `trpc-api` beside an existing `trpc-api`). Fixed here: a colliding id gets a numeric suffix.
- **The budget is hard to meet at this size.** 105 boards stayed over after 3 rebuilds, mostly on name size: tRPC procedure names like `get-organisation-analytics-documents-over-time` are long. The root board (7 parts and about 10 services) and the story can't pass whatever the grouping. Turning a leaf's `split` into children also adds leaves over 6 files that want their own split (83 left without one).
- **Prefixed ids are long** (`remix-app-components-remix-general-document-signing-…`), and part digests leave out the default groups' file globs at most levels, so it's hard to tell which files a default id covers.

