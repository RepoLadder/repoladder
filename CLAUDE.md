# RepoLadder

A Claude Code plugin (`/map`) that turns a TS/JS repo into a drill-down architecture diagram, published as a Claude Artifact. The top level is plain-language; each level you open goes one step more technical.

## How it works
1. `repoladder summary REPO --fresh` analyzes the repo deterministically into `.repoladder/facts.json` (files, imports, runtime calls, services, endpoints) and prints a digest. On a large repo the digest is folder-first, and `summary REPO --part <leaf id>` prints one part's digest.
2. Claude (following `plugin/skills/map/SKILL.md`) writes `.repoladder/grouping.json`: a tree of named groups whose leaves claim files by glob.
3. `repoladder build REPO` validates the grouping (every file exactly once), rolls the facts up into one board per group (`model.json`), lays each board out with D2 (wasm), and writes a self-contained `diagram.html`.
4. The skill publishes the HTML as an Artifact.

**Core rule:** edges are never invented. Every arrow comes from facts and carries file:line evidence. Claude only groups, names and writes summaries.

## Layout
Each file starts with a comment saying what it is for; read it before editing.
- `src/analyze/`: the facts. Parses with the TS compiler API (syntax only), resolves imports, detects packages, external services, runtime call edges, HTTP endpoints, pages and routes (Next.js, React Router/Remix), and database reads and writes. `source.ts` lets the analyzer read from disk or an in-memory file set.
- `src/model/`: `query.ts` (the pure lookups behind `repoladder query`: file:line rows from the facts, bounded and sorted; experimental), `cite.ts` (checks the files, lines, names and boxes an Ask answer cites against the facts; pure), grouping and validation (`grouping.ts`, `depth.ts`), the no-AI default grouping (`budgetsplit.ts`), roll-up into boards (`rollup.ts`, `rollrules.ts`; a leaf's file board draws every connection in the `full` profile, `hosted` budgets arrows as before #449: `profile.ts`), the digest Claude reads (`summary.ts`), and tours and flows (`tours.ts`, `compose.ts`, `derivedtours.ts`, `flows.ts`).
- `src/build/`: D2 layout per board (`layout.ts`, `d2pool.ts`, `layoutsession.ts`, `passes.ts`), the page shell and packing (`html.ts`, `filepack.ts`), the layout lint and the digestibility budget (`lint.ts`, `budget.ts`), and `pipeline.ts`, which ties model, layout and HTML together for `cli.ts` and `lib.ts`.
- `src/viewer/`: the in-page app, a typed TS module that runs in the browser (board drawing, navigation, panels, the tour player, deep links, the detail dial; `ask/` holds the safe answer renderer for the served Ask bar and is not bundled into the page). It may import types from `src/model` and `src/build`, but nothing that pulls Node code into the page. Keep each module under about 200 lines; add a module rather than growing one. `DESIGN.md` explains the visual identity. `npm run build` bakes the viewer into the plugin bundle, so the shipped plugin never needs esbuild.
- `src/cli.ts`: commands `preflight | install | usage | analyze | summary | query | build | export | serve`. `src/usage.ts` is the opt-in usage ping (see PRIVACY.md); `server/ping/` is its Cloudflare Worker.
- `src/serve/`: local server for `repoladder serve` (`ask.ts` runs the user's own `claude` CLI read-only for the Ask endpoint; `claude.ts` pins its arguments); the only code that listens on a port; engine dirs never import it.
- `src/lib.ts`: the library entry `buildFromFiles(files, opts)`: files in, `{ ok: true, html, facts, model, engineVersion, coverage, profile }` or `{ ok: false, code, message }` out; no disk, env, ping or exit. `analyzeFiles(files, opts)` returns `{ ok: true, facts, engineVersion }` or `{ ok: false, code, message }` without grouping, layout or HTML. Input limits live in `src/build/limits.ts`.
- `src/features.ts`: the launch switches (`dial`, `story`), both off by default. `REPOLADDER_DIAL=1` or `--dial` after the repo root builds a page with the detail dial; `REPOLADDER_STORY=1` or `--story` builds the story level (People and systems) and makes `summary` ask for one.
- npm package `repoladder` (`npm run npm:pack`): the CLI bundle plus the library, published only from a `v*` tag on `main` through npm trusted publishing (`.github/workflows/publish.yml`).
- `plugin/`: what ships. `plugin/dist/repoladder.mjs` is the esbuild bundle; `typescript` and `@terrastruct/d2` are pinned in `plugin/package-lock.json`, which Claude Code installs on plugin install. `npm run installcheck` installs the plugin with the real `claude plugin install` and builds a fixture. User-facing install text is `docs/install.md`.
- `test/`: `node --test`, with fixtures in `test/fixtures/`.

## Conventions
- Node 22 runs the `.ts` sources directly (type stripping): use `.ts` import extensions and erasable syntax only (no enums, no parameter properties).
- Output must be deterministic: the same repo gives byte-identical facts, model and HTML. Sort everything.
- Keep the page self-contained and small: under `VIEWER_KB` (90KB) + `FONT_KB` (60KB) + 1KB per board (`budgetKb` in `src/build/pagesize.ts`). It must follow the Artifact page rules:
  - The only external scripts allowed are from cdnjs, jsdelivr or unpkg, pinned to an exact version.
  - Light and dark themes are defined through color tokens (`test/colors.test.ts` keeps colors out of other files).
  - It works at phone width.
  - The only downloads from inside the page are the Export button's, best-effort, each falling back to showing the image to save by hand.
- Comments are sparse and explain *why*.

## Commands
```bash
npm test           # unit + fixture tests
npm run typecheck  # tsc --noEmit
node src/cli.ts query /path/to/repo touches database   # experimental: file:line facts as JSON, after `analyze`
npm run build      # bundle to plugin/dist/repoladder.mjs (viewer included)
node src/cli.ts build /path/to/repo --fresh --default   # diagram without the Claude grouping step
node src/cli.ts build /path/to/repo --default --title "Name"   # the map's name in place of the folder name
node src/cli.ts serve /path/to/repo   # host the built map on localhost
```

## Pull requests
- Every PR passes `npm test` and `npm run typecheck`, and adds tests for new analysis or model behavior. The gallery CI job runs `npm run gallery -- --check` against `gallery/thresholds.json`; a change that makes default groupings worse fails it (`gallery/README.md`).
- Never commit `plugin/dist/`. The `no-dist` job fails any PR that touches it; a bot rebuilds it on `main` after each release and `Verify bundle` checks it. If you ran `npm run build`, run `git checkout plugin/dist` before committing. A bundle built locally (macOS) will not match CI's, so never compare locally.
- Feature PRs target `develop`. The `develop` -> `main` release PR is merged with a merge commit, never squashed. After a release, merge `main` back into `develop` through a PR from `main` into `develop`, merged with a merge commit (the `no-dist` job skips a PR whose head is `main`, so the bot's `plugin/dist` commit is fine there). See CONTRIBUTING.md. CI runs the unit suite as a 3-way shard (`unit tests (i/3)`) behind the single `test, typecheck, build` gate; `npm test` locally runs everything.
- Any PR that changes what a diagram looks like includes before/after screenshots (below), and you look at them yourself first.
- Run the leak guard before pushing: `scripts/leakguard.ts` fails on internal terms, home-directory paths and secret shapes (rules in `scripts/leakguard.config.json`) and runs gitleaks when installed. `npm run leakguard` scans the tree, `-- --text < draft.md` checks a draft, and `npm run hooks` installs the pre-push hook. Owner-only terms go in the gitignored `.leakguard.local.json` (`{ "terms": [...] }`).

## Screenshots
`npm run gallery && npm run shots` builds every gallery diagram and saves `.gallery/shots/<repo>/<board>-<mode>.png` in `desktop-light`, `desktop-dark` (1280×800) and `phone-light` (390×844). For a PR, take the "before" shots on the base branch, move them aside, make the change, then compare:
```bash
npm run gallery && npm run shots && rm -rf .gallery/shots-before && mv .gallery/shots .gallery/shots-before
# ...make the change...
npm run gallery && npm run shots -- --compare .gallery/shots-before
```
`--compare` writes `.gallery/shots/compare.html` and a side-by-side PNG per changed board in `.gallery/shots/compare/`. Attach those to the PR under "How verified", or say nothing changed. Playwright is pinned to an exact version; on a fresh machine run `npx playwright install chromium` once.

`npm run design` does the same for the viewer's panel states (`src/viewer/DESIGN.md`, "Design check"). `npm run shots:phone` is the Mobile Safari check on the iOS simulators.

## Layout lint
`src/build/lint.ts` measures every laid-out board on what the viewer draws. `npm run gallery` prints it per repo; `npm run lint:layout -- .gallery/out/<repo> [--all] [--top N]` prints the worst boards. Run it before and after any change to layout, sizes, shapes or labels, and put the numbers in the PR.

Hard defects, which should be zero (`test/lint.test.ts` asserts it on the fixture builds):
- `overlap`: two boxes' drawn shapes overlap.
- `endpoint`: a wire's start is more than 2px outside its box, or its arrowhead is more than 2px off its target's border.
- `label`: a visible edge label covers a box or another label.
- `through`: a wire crosses a box that is not one of its ends.
- `clipped`: a visible edge label reaches past the board's fitted frame.

Coverage (`src/model/coverage.ts`): a connection is **drawn** when some board has a `major` edge between the boxes holding its ends. `build` prints `CONNECTIONS N connections, M undrawn` and an `UNDRAWN a -> b` line for each (20 at most). These are warnings for `build`, but `npm run lint:layout`, the gallery run and `npm run gallery -- --check` fail on any (in the `full` profile; a `hosted` build lists minor arrows instead of drawing them, so none of these fail it).

Neatness is reported per board: alignment, width variation, crossings, overlapping wires, bends per edge, rendered name size (aim for 11.5px or more at the desktop fit), wasted canvas and hidden labels.

`src/build/stability.ts` scores how much of a board's arrangement survives a change (`npm run stability -- <out dir | fixture:name>`). It is report-only.

## Digestibility budget
`src/build/budget.ts` says whether a laid-out board can be taken in at once: over `BUDGET` (12 drawn boxes, 20 arrows, names 11.5px at the desktop fit, no files hidden in "+N more") it wants another level (a `full`-profile file board draws every connection; `hosted`, selected with `--profile hosted` or `buildFromFiles(files, { profile: "hosted" })`, budgets arrows as before #449 to build large repos within a time limit; see docs/reliability.md). `build` prints one `OVER_BUDGET <board> (<kind>): <reasons>` line per such board before `BUILD_OK` (not an error) and writes `lint.json`.
