# Diagram gallery

`npm run gallery` builds a fixed set of repos and writes `.gallery/index.html`, one page with every diagram embedded and a stats table (files, drawn/total edges, boards, page KB (flagged above the page budget of 90KB viewer + 60KB fonts + 1KB per board (`VIEWER_KB` + `FONT_KB`); hover it, or read each card, for the split between viewer JS/CSS and packed data by section), analyze and build time, digest size in estimated tokens against the 12K budget, the Undrawn column (connections with no arrow on any board, plus tour steps off their board; the run exits 1 when any map has one), the default grouping's score (groups, share of files in the biggest group, one-file groups), grouping warnings, guided tours (the Tours column: the grouping's own plus derived ones, flagged under 2; hover for the derived titles), and whether each diagram is byte-identical to the previous run at the same commit). Use it to judge a change by eye and to compare before/after.

```bash
npm run gallery                          # everything
npm run gallery -- --only zustand,taxonomy   # a subset; other rows keep their last result
npm run gallery -- --jobs 2              # build parallelism (default: half the cores, 2-4)
npm run gallery -- --check               # default-grouping gate: analyze + score only, exit 1 on a violation
```

Output lives in `.gallery/` (gitignored): `repos/<name>` holds the shallow clones, `out/<name>/` holds `facts.json`, `model.json`, `diagram.html` and the analyze/build logs, and `results.json` holds the last run's stats. The script exits non-zero and prints a per-repo reason when any build fails.

## Default-grouping gate

`npm run gallery -- --check` clones the pinned repos, runs analyze and scores the default grouping (groups, share of files in the biggest group, one-file groups). It runs no layout and writes no page, so it takes seconds per repo and leaves `.gallery/results.json` and `index.html` alone (output goes to `.gallery/check/<name>/`). It also counts connections with no arrow on any board at the Default dial (`src/model/coverage.ts`, from the first-pass model, so before the layout-driven splits) and fails a pinned repo with any, a hard zero rather than a threshold. It prints one line per repo (with `connections N undrawn M`), ends with `GALLERY_CHECK_OK` or `GALLERY_CHECK_FAILED <k>/<n>: <names>`, and exits 1 on a violation, a fetch failure or an analyze failure.

`gallery/thresholds.json` holds the limits: a `fallback` row for repos without their own, and one row per `repos.json` entry with `maxLargestShare` (0 to 1), `maxSingleFileGroups` and `minGroups`. A missing limit is not checked. `npm test` checks that every row names a `repos.json` repo and every repo has a row. Repos from `local.json` are scored and printed but never gated.

The `gallery-default` CI job runs the check on ready PRs into `main` (the release PR) and on every push to `main`, and writes the score table with each repo's headroom to the step summary. `npm test` also gates the default grouping of a few checked-in fixtures offline.

File boards draw every connection of their files in the default `full` profile (#449; the `hosted` profile budgets arrows, so the gallery stays on `full`), so a default build splits a leaf whose file board would be over budget; the default-grouping score may move for that reason. `drawingRungs` (`src/model/drawn.ts`) reports per build which connections no board draws (0 on a default build).

Ratchet: when a change improves a score, tighten that row with `npm run gallery -- --check --update-thresholds` (rewrites the checked repos' rows with a margin of +5 points, +2 or 25% one-file groups, and 80% of the groups; `--only` limits it, `--thresholds <file>` reads another file) and commit it. A PR that loosens a row says why in its body. A new repo in `repos.json` gets its row the same way.

## Repos

`repos.json` lists public repos, each pinned to a full commit SHA and chosen for a different shape: a small library, an Express API in plain JS, a Next.js app, a Vite + React + Firebase monorepo, a full-stack Turborepo, and a 500+ file app. To bump one, change its `sha` (and look at the diagram).

## Local repos

Add an untracked `gallery/local.json` to include private repos on your machine. Entries without a `path` that exists are skipped. Relative paths resolve from `gallery/`; `gallery/local/` is gitignored for local groupings.

```json
[{ "name": "myapp", "path": "/abs/path/to/myapp", "grouping": "local/myapp.grouping.json", "shape": "what it is" }]
```

## Hand-written groupings

A repo uses `groupings/<name>.json` when it exists, and the default folder grouping otherwise. To make one, run the `/map` skill's grouping step against the clone:

1. `npm run gallery -- --only <name>` so the clone exists in `.gallery/repos/<name>`.
2. `node src/cli.ts summary .gallery/repos/<name> --out .gallery/out/<name>` and read the digest. On a big repo the digest says `Large repo: two passes.`: write placeholder leaves first, then `node src/cli.ts summary … --out … --part <leaf id>` per big placeholder (SKILL.md §2).
3. Write `gallery/groupings/<name>.json` following section 3 of `plugin/skills/map/SKILL.md` (or ask Claude to do it with that skill).
4. `npm run gallery -- --only <name>` and fix any `INVALID` errors or warnings it prints.

A grouping is validated against the pinned tree, not `develop`, so editing it for newer code can break the build: a file in the tree and in no group is an error, while a pattern that matches no file is only a warning. An entry for a file the pinned tree has but `develop` removed must stay until the SHA is bumped. `test/gallerygrouping.test.ts` guards this for the `repoladder` entry (it skips when the pinned commit is not in local history). Bumping that SHA needs a grouping update and `npm run gallery -- --check`.

## Launch demos

`gallery/demos.json` lists the launch demos (#212): well-known public repos, pinned like `repos.json`, each with a hand-written grouping, story and chain tours in `gallery/demos/<name>.json`, written the way `/map` would. They are kept apart from the main gallery so the default-grouping baseline stays as it is.

```bash
npm run gallery -- --demos --jobs 1          # builds into .gallery/demos/ (gitignored)
npm run gallery -- --demos --only taxonomy   # one of them
```

The pages land in `.gallery/demos/out/<name>/diagram.html`, ready to publish. The owner publishes and shares them.

## Large repos

`npm run stability -- .gallery/out/<repo>` reports layout stability (the share of box pairs that keep their left/right/above/below relation, `src/build/stability.ts`): across window shapes, and between the Overview and root boards. Add `--before <out dir> --after <out dir>` (two builds of the same repo at different commits) for a per-board table of how much a commit moved things. It is report-only and has no threshold.

`gallery/large.json` lists repos of 2,000 files and up, pinned like `repos.json`. They take minutes and the machine's whole CPU, so a plain `npm run gallery` never builds them: they are timing references (#257, #311), not part of the picture comparison.

```bash
npm run gallery -- --large --jobs 1     # builds into .gallery/large/ (gitignored); keep the machine otherwise idle
```

For a cold run delete `.gallery/large/out/documenso/layout-cache.json` first; a second run is the warm one. Run with `REPOLADDER_TIMINGS=1` to get the per-phase `TIMING` lines (analyze, grouping, model/layout/lint/split per pass, render, total) in `.gallery/large/out/<name>/build.log`. `REPOLADDER_VERIFY_LAYOUT=1` makes the build lay out every board for real and fail (`LAYOUT_REUSE_MISMATCH`) when a reused layout differs from a fresh one.
