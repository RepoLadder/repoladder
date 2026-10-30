# RepoLadder

**Run one command on your TypeScript or JavaScript repo. In a few minutes you get a diagram a newcomer can click through and understand, and every box and arrow comes from the code.**

It starts with the big pieces in plain language. Open any box to go one rung deeper and one step more technical, down to the files. Tours walk a real flow through the code, moving up, across and down the rungs as the flow does.

![A tour on RepoLadder's own map, in the dark theme: it starts on the overview, follows "Reading a repo" down through the rungs, climbs back out, and follows the command line into "Laying out a board"](docs/media/tour.gif)

<sub>A tour on RepoLadder's map of its own code, in the dark theme, recorded from the real viewer.</sub>

## See it on a real repo

Live diagrams you can click through, no install needed:

| Repo | What it is | Diagram |
|---|---|---|
| [Excalidraw](https://github.com/excalidraw/excalidraw) | The open-source whiteboard app and its embeddable editor, in one monorepo. | [Open the diagram](https://repoladder.com/demo/excalidraw/) |
| [Open Agents](https://github.com/vercel-labs/open-agents) | Vercel's open-source background coding agent, with a sandbox, Postgres, Redis and GitHub. | [Open the diagram](https://repoladder.com/demo/open-agents/) |
| [Taxonomy](https://github.com/shadcn-ui/taxonomy) | shadcn's Next.js App Router example app, with Prisma, NextAuth and Stripe. | [Open the diagram](https://repoladder.com/demo/taxonomy/) |
| [Epic Stack](https://github.com/epicweb-dev/epic-stack) | Kent C. Dodds' full-stack React Router starter, with Prisma, Resend and Sentry. | [Open the diagram](https://repoladder.com/demo/epic-stack/) |

[Browse all maps](https://repoladder.com/browse)

<!-- Rows follow gallery/demos.json (order, names, urls), checked by test/readme.test.ts. Titles and blurbs are copied from the website's demo list; keep them in step. -->

## Install

In Claude Code:

```
/plugin marketplace add repoladder/repoladder
/plugin install repoladder@repoladder
```

Then open your repo and run `/map`. You need Node.js 20.6 or newer. Requirements, what gets installed, updating and uninstalling are in [docs/install.md](docs/install.md).

## What it costs

- **Time:** the analysis and layout take under about 5 seconds up to ~300 files, and about 10 seconds at 500 files. Most of a `/map` run is Claude reading the digest and naming the parts.
- **Tokens:** Claude reads the skill (~5K tokens) and a digest of the repo (under 1K tokens for a small library, 2-5K for a typical app, ~11K at 500 files; the digest is capped). Roughly 6K input tokens for a small repo and 16K for a large one, plus the grouping it writes, which counts against your Claude plan like any other Claude Code turn.
- **No AI at all:** `npx repoladder build . --default` groups by folders instead of asking Claude. It costs no tokens and still draws every arrow from the code.

Measured on 15 public repos; the details are in [docs/reliability.md](docs/reliability.md).

## Why you can trust the arrows

Every box and arrow is traced to the code: imports, runtime calls by function name or URL (for example `httpsCallable('createUser')` or `` fetch(`${base}/createUser`) ``), database reads and writes, and SDK imports of external services. Click an arrow to see the file and line evidence.

Claude only names and groups. Arrows always come from the facts, so a grouping can't invent a connection. The build rejects a grouping that leaves a file out or assigns one ambiguously, and Claude fixes it and retries.

## How it works

```
/map
  repoladder summary   analyze the repo (files, imports, calls, services, endpoints) and print a digest
  Claude             groups the files into named parts and writes tours → .repoladder/grouping.json
  repoladder build     validate the grouping against the facts, roll edges up to every rung,
                     lay out each rung with D2, write .repoladder/diagram.html
  Artifact           publish the page (private until you share it)
```

Commit `.repoladder/grouping.json` to keep the same boxes across runs and teammates. Ignore the rest of `.repoladder/`.

Everything runs on your machine, and the website only ever reads public repos. Usage stats are off unless you say yes; see [where things run](PRIVACY.md#where-things-run) in PRIVACY.md.

## Export images

The viewer's Export button saves or copies the current view (SVG, PNG). A published Artifact may block downloads, in which case it shows the image to save by hand. The CLI still exports whole boards for READMEs, docs and slides, after a build:

```bash
npx repoladder export REPO [--board id] [--format svg|png] [--theme light|dark]
```

It writes one standalone SVG per board (or just `--board id`) to `REPO/.repoladder/export/<board>-<theme>.svg`, drawn like the viewer and readable as a plain `<img>` (GitHub renders it). `--format png` also writes PNGs at 2x when Playwright with Chromium is installed; otherwise it says so and writes SVG only.

## Develop

```bash
npm install
npm test               # analyzer, grouping and rollup tests against test/fixtures
npm run typecheck      # tsc --noEmit
npm run build          # bundle src/ into plugin/dist/repoladder.mjs
npm run npm:pack       # generate the npm package into .npm-package/
node src/cli.ts build ../some-repo --default   # folder-based diagram, no Claude step
node src/cli.ts build ../some-repo --default --title "My App"   # --title names the map (page title, header, overview) instead of the folder
```

**Launch switches** (`src/features.ts`): the detail dial is off for launch, so every map shows only the Default stop. `REPOLADDER_DIAL=1` or `--dial` after the repo root (`build ../some-repo --dial`) builds a page with the dial; `REPOLADDER_STORY=1` / `--story` builds the page with the story level (People and systems) and makes `summary` ask for one; with it off, `buildDiagram` ignores any `story` in the grouping and every map opens on the overview.

CI runs the tests, typecheck and build on pull requests into `main` and on every push to `main`; feature work lands on `develop` first and is tested locally. Don't commit `plugin/dist/` (a CI check rejects it; `git checkout plugin/dist` after a local build). After each release to `main`, a workflow rebuilds the bundle and commits it, so the installed plugin always matches `src/`. A `Verify bundle` workflow rebuilds it and fails if it differs from the committed file.

Source layout: `src/analyze` (facts), `src/model` (grouping, validation, rollup, summary, tours), `src/build` (D2 layout, HTML), `src/viewer` (the in-page app).

To re-record the GIF above after a viewer change:

```bash
REPOLADDER_BRAND_NAME=RepoLadder npm run gallery -- --only repoladder --title RepoLadder   # builds the map from gallery/groupings/repoladder.json
npm run readme-media   # 15 fps, dark → docs/media/tour.gif
npm run readme-media -- --poster /tmp/poster.png   # also saves the poster still (--poster-step N picks the frame)
npm run readme-media -- --list       # the map's tours, one per line
npm run readme-media -- --all-tours --max-seconds 20   # one clip per tour → .gallery/media/<repo>-<tour>.gif
npm run readme-media -- --tours open-a-box --format webm --out /tmp/open-a-box.webm
npm run readme-media -- --video /tmp/tour-video   # also the 1280×800 frames for the website's 30 fps video
```

## Community

- [Contributing](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security policy](SECURITY.md) and [privacy](PRIVACY.md)
- See [LICENSE](LICENSE) for the terms
