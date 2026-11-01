<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/media/logo-dark.svg">
    <img src="docs/media/logo-light.svg" alt="RepoLadder" width="88">
  </picture>
</p>

<h1 align="center">RepoLadder</h1>

<p align="center"><strong>Architecture diagrams grounded in your code that stay in sync.</strong></p>

<p align="center">
  <a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue"></a>
  <a href="https://www.npmjs.com/package/repoladder"><img alt="npm version" src="https://img.shields.io/npm/v/repoladder"></a>
  <a href="https://github.com/RepoLadder/repoladder/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/RepoLadder/repoladder/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="https://www.npmjs.com/package/repoladder"><img alt="Node.js version" src="https://img.shields.io/node/v/repoladder"></a>
</p>

<p align="center">
  <a href="https://repoladder.com/browse">Live demo</a> ·
  <a href="docs/install.md">Install</a> ·
  <a href="#documentation">Documentation</a> ·
  <a href="#is-it-safe-to-install">Safe to install</a> ·
  <a href="#faq">FAQ</a>
</p>

**Run one command on your TypeScript or JavaScript repo. In a few minutes you get a diagram a newcomer can click through and understand, and every box and arrow comes from the code.**

![A tour on RepoLadder's own map, in the dark theme: it starts on the overview, follows "Reading a repo" down through the rungs, climbs back out, and follows the command line into "Laying out a board"](docs/media/tour.gif)

<sub>A tour on RepoLadder's map of its own code, in the dark theme, recorded from the real viewer.</sub>

## Why RepoLadder

Architecture diagrams drawn by hand go stale, or leave things out. RepoLadder reads the code instead, so every box and arrow is traced back to it. A newcomer starts with the big pieces in plain language and goes as deep as they need, one rung at a time, down to the files.

## What you get

### The map

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/media/map-dark.png">
  <img src="docs/media/map-light.png" alt="The top board of RepoLadder's own map: six named parts as boxes, with arrows between them">
</picture>

`/map` turns your repo into boxes and arrows named in plain language. Every box and arrow is traced to the code: imports, runtime calls, database access and outside services.

### Drill in

<img src="docs/media/drill-in.png" alt="The Command line box opened one rung down, showing its files as boxes with the arrows between them">

Double-click a box to open it one rung deeper, down to the files. Each board is kept small enough to take in at once.

### Trace an arrow to the code

<img src="docs/media/trace-arrow.png" alt="An arrow selected on the map, with a side panel listing the file and line of each import behind it">

Click an arrow to see the evidence behind it. It shows the file and line where the import or call happens.

### Tours

<img src="docs/media/tour-step.png" alt="A tour paused on its second step, with the matching boxes and arrows highlighted and a Back and Next strip underneath">

A tour walks one real flow through the code, moving up, across and down the rungs as the flow does. Every step lands on boxes and arrows the diagram actually draws.

### Export

<img src="docs/media/export-board.svg" alt="A board exported as a standalone SVG: named boxes joined by arrows">

Save a board as SVG or PNG from the viewer, or export every board from the command line. The SVG renders as a plain image on GitHub, so it drops straight into a README or slide deck.

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

## What it does and doesn't do

| | What to expect |
|---|---|
| **Languages** | TypeScript and JavaScript (`.ts .tsx .mts .cts .js .jsx .mjs .cjs`). A repo with no such files stops with a message; other languages are not read. |
| **Drawn from the code** | Boxes of files, imports, runtime calls by function name or URL, database reads and writes, SDK imports of outside services, server endpoints. Click an arrow for the file and line behind it. |
| **Only named by the AI** | Claude groups files into parts and gives them names, summaries and tours. It cannot add an arrow: arrows always come from the code facts, and a grouping that leaves a file out is rejected. |
| **Runs on your machine** | Reading the repo, laying out the diagram and writing `.repoladder/` all run locally. RepoLadder itself sends nothing unless you opt in to anonymous usage stats; as in any Claude Code session, Claude sees the repo summary through your own Claude account. Details: [PRIVACY.md](PRIVACY.md#where-things-run). |
| **Time** | Analysis and layout take under about 5 seconds up to ~300 files, and about 10 seconds at 500 files. Most of a `/map` run is Claude reading the digest and naming the parts. |
| **Tokens** | Claude reads the skill and a digest of the repo (capped): roughly 6K input tokens for a small repo and 16K for a large one, plus the grouping it writes. These count against your Claude plan like any other Claude Code turn. |
| **Without AI** | `npx repoladder build . --default` groups by folders, costs no tokens and still draws every arrow from the code. |
| **Known limits** | Very large repos use a two-pass grouping and some deep boards stay crowded; names on the busiest boards can be small. Measured on 15 public repos: [docs/reliability.md](docs/reliability.md). |

Measured on 15 public repos; the details are in [docs/reliability.md](docs/reliability.md).

## Install

Both paths need Node.js 20.6 or newer.

**In Claude Code (plugin, recommended).**

```
/plugin marketplace add repoladder/repoladder
/plugin install repoladder@repoladder
```

Then open your repo and run `/map`.

**Without Claude Code (CLI).** This groups by folders instead of asking Claude, and still draws every arrow from your code.

```
npx repoladder build . --default
npx repoladder export . --format svg
```

`build` writes `.repoladder/diagram.html`; open it in a browser. `export` writes images. Requirements, what gets installed, updating and uninstalling are in [docs/install.md](docs/install.md).

## Quick start

1. **Run the first command.** `/map` in your repo, or `npx repoladder build . --default` without Claude Code.
2. **See the map.** `/map` replies with a link to the diagram and the main parts in one line. Click a box or arrow for the evidence; double-click a box to open it. The CLI writes the same diagram to `.repoladder/diagram.html`.
3. **First-run notes.** The plugin's first `/map` asks once whether to share anonymous usage stats (default no; see [PRIVACY.md](PRIVACY.md#usage-stats-off-unless-you-say-yes)). The CLI's first run downloads about 25MB and asks the same question once on an interactive terminal, never in CI or when piped.

Things to try:

| Try | What it does |
|---|---|
| `/map` | Maps the repo you are in and publishes the diagram as a private Artifact. |
| `/map path/to/repo` | Maps another folder. |
| `/map` again after changes | Keeps the same boxes and names; commit `.repoladder/grouping.json` so teammates get them too. |
| Ask Claude: "regroup this map from scratch" | Rewrites the grouping instead of keeping it. |
| Ask Claude: "export the diagram as SVG" | Writes one SVG per board to `.repoladder/export/`. |
| Ask Claude: "turn off RepoLadder usage stats" | Stores your no and removes the install id. |

## Is it safe to install?

Short answers, each with the file that backs it:

- **What it reads:** your repo's files, from disk. It runs `git` locally to list them ([`src/analyze/files.ts`](src/analyze/files.ts)).
- **What it writes:** a `.repoladder/` folder inside your repo, and your usage-stats answer in `~/.config/repoladder/`. Nothing else ([PRIVACY.md](PRIVACY.md#where-things-run)).
- **The analyzer never touches the network.** The code that reads your repo, builds the model and lays out the diagram makes no network calls, and a test fails if one appears ([`test/no-network.test.ts`](test/no-network.test.ts)).
- **Usage stats are off unless you say yes.** The default answer is no, and nothing is sent without a yes ([PRIVACY.md](PRIVACY.md#usage-stats-off-unless-you-say-yes)).
- **The npm package is published with provenance.** It is built and published by a GitHub Actions workflow with no stored token, so npm can show where each release came from ([`.github/workflows/publish.yml`](.github/workflows/publish.yml), [package page](https://www.npmjs.com/package/repoladder)). Its dependencies are pinned to exact versions and the package declares no scripts of its own.
- **The plugin installs from a pinned lockfile with no install scripts.** It adds two packages, the TypeScript parser and the D2 layout engine, with `npm ci --ignore-scripts` ([`plugin/package-lock.json`](plugin/package-lock.json), [docs/install.md](docs/install.md)).

Two honest edges: Claude sees the repo summary through your own Claude account, and the first run downloads those two packages from npm. Full detail: [PRIVACY.md](PRIVACY.md) and [docs/install.md](docs/install.md). These claims are about installing the plugin or the package; working on RepoLadder itself (`npm install` in this repo) also installs git hooks and dev tools, see [docs/development.md](docs/development.md).

## Why you can trust the arrows

Every box and arrow is traced to the code: imports, runtime calls by function name or URL (for example `httpsCallable('createUser')` or `` fetch(`${base}/createUser`) ``), database reads and writes, and SDK imports of external services. Click an arrow to see the file and line evidence.

Claude only names and groups. Arrows always come from the facts, so a grouping can't invent a connection. The build rejects a grouping that leaves a file out or assigns one ambiguously, and Claude fixes it and retries.

Everything runs on your machine, and the website only ever reads public repos. Usage stats are off unless you say yes; see [where things run](PRIVACY.md#where-things-run) in PRIVACY.md.

How a build works, step by step: [docs/how-it-works.md](docs/how-it-works.md)

## Documentation

| Page | What it covers |
|---|---|
| [Install](docs/install.md) | Requirements, what gets installed, updating and uninstalling, and using the CLI without Claude Code. |
| [How it works](docs/how-it-works.md) | The steps behind `/map`: facts, grouping, validation, layout and publishing. |
| [Export images](docs/export.md) | Saving boards as SVG or PNG for READMEs, docs and slides. |
| [Reliability](docs/reliability.md) | The 15-repo sweep, build time and token cost by repo size, and known limits. |
| [Tours: data](docs/tours-data.md) | Building a tour from a page's data. |
| [Tours: design](docs/tours-v2.md) | Design notes for multi-depth tours. |
| [Detail dial: design](docs/detail-dial-v2.md) | Design notes for the detail dial. |
| [Develop](docs/development.md) | Running the tests, source layout and re-recording the README GIF. |

## Privacy

RepoLadder runs on your machine and reads your repo from disk. It writes a `.repoladder/` folder inside the repo, and nothing else except your usage-stats answer. Usage stats are off unless you say yes. As in any Claude Code session, Claude sees the repo summary through your own Claude account, and the website only reads public repos. See [where things run](PRIVACY.md#where-things-run), the [full privacy policy](PRIVACY.md) and [Is it safe to install?](#is-it-safe-to-install).

## FAQ

### Does it send my code anywhere?

Not by itself: the analysis, layout and output run locally, and usage stats are off unless you opt in. Claude sees the summary of the repo, and the diagram is published as a private Artifact, both through your own Claude account. Details: [where things run](PRIVACY.md#where-things-run).

### Which languages does it read?

TypeScript and JavaScript only. A repo with no such files stops with a message. See [what it does and doesn't do](#what-it-does-and-doesnt-do).

### Does it cost tokens?

`/map` uses Claude: roughly 6K input tokens for a small repo and 16K for a large one, plus the grouping it writes. `npx repoladder build . --default` uses none. See [docs/reliability.md](docs/reliability.md).

### Can I use it without Claude Code?

Yes: `npx repoladder build . --default` groups by folders and still draws every arrow from the code. See [Without Claude Code](docs/install.md#without-claude-code-npm).

### Can I commit the grouping file?

Yes. Commit `.repoladder/grouping.json` to keep the same boxes across runs and teammates, and ignore the rest of `.repoladder/`. See [How it works](docs/how-it-works.md).

### Why did my build fail?

The build checks Claude's grouping against the code and says what is wrong, for example a file left out. Claude fixes it and retries up to three times, and `--default` skips the grouping step by grouping by folders. Otherwise open a [bug report](https://github.com/repoladder/repoladder/issues/new?template=bug.yml). See [docs/reliability.md](docs/reliability.md).

## Contributing

Want to help? [CONTRIBUTING.md](CONTRIBUTING.md) covers setup, branches and what a pull request needs; please follow the [Code of Conduct](CODE_OF_CONDUCT.md), and report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

Questions or ideas: use the [feedback form](https://github.com/repoladder/repoladder/issues/new?template=feedback.yml).

## License

Apache-2.0. See [LICENSE](LICENSE), [NOTICE](NOTICE) and [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt).
