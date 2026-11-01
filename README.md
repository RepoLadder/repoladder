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
  <a href="#documentation">Documentation</a>
</p>

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

## Community

- [Contributing](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security policy](SECURITY.md) and [privacy](PRIVACY.md)
- See [LICENSE](LICENSE) for the terms
