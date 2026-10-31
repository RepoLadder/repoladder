# Privacy

RepoLadder runs on your machine. It reads your repo locally, writes its output to `.repoladder/` in the repo, and publishes the diagram only where you ask it to (a private Claude Artifact). `repoladder serve` can also host the map on your own machine; [see below](#serving-the-map-on-your-machine).

The analyzer and diagram builder (`src/analyze`, `src/build`, `src/model`) never touch the network: they only read the repo they are given, and run `git` locally to list its files. A test ([test/no-network.test.ts](test/no-network.test.ts)) runs in CI on every change and fails if network code is added to them.

## Where things run

- **The plugin and the engine run on your machine.** `/map` and the CLI behind it read your repo from disk and write their output only to `.repoladder/` inside it. The one file they write elsewhere is your usage-stats answer, in `~/.config/repoladder/`. They make no network requests of their own, except the usage ping below, which is off unless you say yes. The one other download is the plugin's own runtime dependencies from npm on first run, and that carries nothing about your repo. As with anything you do in Claude Code, Claude sees the repo summary `/map` gives it and publishes the diagram as a private Artifact, both through your own Claude account. RepoLadder adds no other destination.
- **The website only ever reads public repos.** [repoladder.com](https://repoladder.com) and any maps hosted there are built only from public GitHub repos. The site never asks for a GitHub token, access to a private repo, or an upload of your code, and never accepts any of them. Its own [privacy page](https://repoladder.com/privacy) covers the waitlist and site analytics.
- **Sharing from the plugin, if we ever add it, will be explicit and opt-in.** Today nothing you map is uploaded anywhere. A future way to send a map from the plugin to the website would be off by default and ask you every time, and this page would list exactly what it sends before it ships.

## Serving the map on your machine

`repoladder serve` is off unless you run it. It hosts your built map on `127.0.0.1` (your own machine only) behind a random per-run token that lives in the link it prints and nowhere on disk. It refuses connections from other machines and requests for other host names, serves only the built page, and sends nothing anywhere.

## Asking questions about your repo (repoladder serve)

While `repoladder serve` runs, it can answer a question about your repo with your own Claude Code. The flow: your browser, then the local server on your machine, then your own `claude` command, then Anthropic under your own Claude account and plan. RepoLadder never sees or stores a key or a sign-in.

- **What Claude can do here:** read files, search them, and run `repoladder query` in your repo. It cannot write or edit files, use the web, or run any other command. A deny list blocks reads of secret-looking files (`.env`, keys, `.ssh`, `.aws` and similar).
- **What leaves your machine:** what Claude Code itself sends when it reads the files it needs to answer. RepoLadder sends nothing of its own.
- **Where it shows up:** the conversation appears in Claude Code's own session history for that folder.
- **Your repo's own Claude settings are not loaded** for these questions; your personal Claude Code settings still apply.
- **When it exists:** only while `repoladder serve` runs, and only on your machine behind the same token. `--no-ask` turns it off.
- **How the limits are enforced, honestly:** by Claude Code's own permission system. Our tests pin the exact arguments we pass, and the maintainers check the behavior by hand against a real install; a test cannot prove Claude Code enforces them.

## Usage stats: off unless you say yes

The first time you run `/map`, Claude asks once whether you want to share anonymous usage stats. If you say no, or skip the question, nothing is ever sent.

If you say yes, each build sends one small POST with exactly these fields:

| Field | Example | What it is |
| --- | --- | --- |
| `v` | `1` | Payload format |
| `version` | `a1b2c3d` | The commit the plugin was built from |
| `ok` | `true` | Whether the build succeeded |
| `error` | `"INVALID_GROUPING"` | On failure, a fixed error code; otherwise `null` |
| `size` | `"200-999"` | The repo's number of source files, as a range |
| `seconds` | `42` | How long the build took |
| `mode` | `"ai"` | Whether Claude grouped the repo (`ai`) or the folder-based grouping was used (`default`) |
| `id` | `"3f6c…"` | A random install id, made when you said yes. It is not derived from anything about you or your machine |

**Never sent:** repo names, file names or paths, code, error messages, your username, hostname, or anything else.

The endpoint is `https://ping.repoladder.com/`, a Cloudflare Worker with a D1 database (`server/ping/` in this repo). It only checks that the payload has this exact shape. It then stores two things: daily totals of the fields above, and one row per random install id holding the first day it ran, the last day it ran, and how many runs it has made. That's how we count how many people come back. Our code stores no IP addresses or request logs. Cloudflare handles the request on its own network under its own policies. The counts tell us how many people use RepoLadder, which errors to fix first, and how long runs take by repo size.

**How long it's kept.** The daily totals and the per-install rows (the random id, the first and last day it ran, and the run count) are kept indefinitely. Deleting or replacing your local id (`usage no`) means future runs can't be linked to that row, but the row already on the server stays. Rows hold no names, paths, IPs or anything that identifies you.

A ping waits at most 1.5 seconds and fails silently, so being offline never slows a run down or breaks it.

## Using the npm package (npx)

`npx repoladder build` asks the same question once, in the terminal, the first time you run `build` from an interactive terminal. The default is no (Enter means no). It never asks in CI (when `CI` is set) or when its input or output is piped, so a first run there stores nothing and sends nothing. The answer is the same `~/.config/repoladder/usage.json` the plugin uses, so you are asked once for both. If you say yes, the `version` field reads like `0.1.0+a1b2c3d` (the package version plus the commit it was built from). Change your answer with `npx repoladder usage yes|no`.

## Changing your mind

- Turn it off: `node <plugin>/dist/repoladder.mjs usage no` (this also deletes the install id stored on your machine; the counts already sent stay on the server, as above). Or tell Claude "turn off RepoLadder usage stats".
- Turn it on: `… usage yes`.
- See what's stored: `… usage` prints `USAGE_ON`, `USAGE_OFF` or `USAGE_ASK`.
- Opt out everywhere with an environment variable: `DO_NOT_TRACK=1` or `REPOLADDER_NO_USAGE=1`. Either one overrides a stored yes, and RepoLadder won't ask.

The answer lives in `~/.config/repoladder/usage.json` (or `$XDG_CONFIG_HOME/repoladder/usage.json`). Deleting that file means you'll be asked again.
