# Install

In Claude Code:

```
/plugin marketplace add repoladder/repoladder
/plugin install repoladder@repoladder
```

Then open your repo and run `/map`. That's all.

**Requirements:** Node.js 20.6 or newer (with npm, which comes with it), and Claude Code. macOS, Linux and Windows all work.

**What gets installed:** the plugin and its two runtime packages, the TypeScript parser and the D2 layout engine (about 25MB to download, 80MB on disk). Claude Code installs them along with the plugin from its lockfile, with pinned versions and no install scripts. Nothing is installed globally and nothing goes into your repo except the `.repoladder/` output folder.

**If `/map` says it's installing the runtime:** that happens when Claude Code couldn't install the packages itself (for example, the plugin was loaded from a local folder, or the install timed out on a slow network). `/map` runs the same pinned install once and carries on.

**Update:** `/plugin` → Marketplaces → repoladder → Update, or turn on auto-update there. Updates track every commit on main: the plugin's version is the commit id.

**Uninstall:** `/plugin uninstall repoladder@repoladder`. Delete `.repoladder/` from any repo you mapped if you don't want to keep the diagrams.

## Without Claude Code (npm)

```
npx repoladder build . --default
```

Open `.repoladder/diagram.html` in a browser. This groups by folders instead of asking Claude, and still draws every arrow from your code. `npx repoladder export . --format svg` writes images.

**Looking up facts (experimental; the output shape may change before 1.0).** `repoladder query` answers structural questions from `.repoladder/facts.json` as one line of JSON, every row with a `file` and `line`. It reads only what `analyze` (or `build`) already wrote and tells you to run `analyze` when that is missing; it never writes files.

```
npx repoladder query . definitions fetchUser       # where a name is exported, or an endpoint is defined
npx repoladder query . importers src/lib/user.ts   # what imports a file
npx repoladder query . callers checkIn             # who calls an endpoint
npx repoladder query . touches database            # what reads or writes a database (or name a service or store)
npx repoladder query . files <group id>            # the files a group of grouping.json owns
```

`--limit n` (1 to 500, default 50) bounds the rows; `total` and `truncated` say what was left out. `--fresh` re-analyzes first. A bare `--` lets an argument start with `--`.

**Requirements:** Node.js 20.6 or newer. The first run downloads about 25MB (the D2 layout engine's ~22MB wasm plus TypeScript). For a permanent install, `npm i -g repoladder`.

### Serve the map locally

```
npx repoladder serve . --no-open
```

Hosts the built map (building a folder-grouped one first if there is none) at a link like `http://127.0.0.1:52341/?t=<token>`. The link carries a random access token made fresh on every run; requests without it are refused. `--port 8080` picks the port (default: any free one), `--no-open` skips opening your browser, Ctrl+C stops it. It binds only to your own machine, and there is no option to change that.

The first `build` from an interactive terminal asks once whether to share anonymous usage stats (default no; see [PRIVACY.md](../PRIVACY.md)). It never asks in CI or when piped.

