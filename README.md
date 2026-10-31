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

The viewer's Export button saves or copies the current view (SVG, PNG); a published Artifact may block downloads, in which case it shows the image to save by hand. After a build, the CLI exports whole boards for READMEs, docs and slides:

```bash
npx repoladder export REPO [--board id] [--format svg|png] [--theme light|dark]
```

It writes one standalone SVG per board to `REPO/.repoladder/export/<board>-<theme>.svg`, which renders as a plain `<img>` on GitHub. `--format png` also writes 2x PNGs when Playwright with Chromium is installed.

## Develop

```bash
npm install
npm test               # analyzer, grouping and rollup tests against test/fixtures
npm run typecheck      # tsc --noEmit
npm run build          # bundle src/ into plugin/dist/repoladder.mjs
node src/cli.ts build ../some-repo --default   # folder-based diagram, no Claude step (--title "My App" names the map)
```

Source layout: `src/analyze` (facts), `src/model` (grouping, validation, rollup, tours), `src/build` (D2 layout, HTML), `src/viewer` (the in-page app). Branches, releases and what a PR needs are in [CONTRIBUTING.md](CONTRIBUTING.md). Don't commit `plugin/dist/`; a bot rebuilds it after each release.

To re-record the GIF above after a viewer change, build the map from `gallery/groupings/repoladder.json` and record it:

```bash
REPOLADDER_BRAND_NAME=RepoLadder npm run gallery -- --only repoladder --title RepoLadder
npm run readme-media   # dark, 15 fps → docs/media/tour.gif (options are listed at the top of scripts/readme-media.ts)
```

## Community

- [Contributing](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security policy](SECURITY.md) and [privacy](PRIVACY.md)
- See [LICENSE](LICENSE) for the terms
