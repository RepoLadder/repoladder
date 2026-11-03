# Changelog

## 0.6.0

### Minor Changes

- 0653820: Add an Ask bar to the map when it is served with `repoladder serve`: type a question or pick a starter, watch the answer arrive, and click its checked citations to open them in the map. Published and exported maps are unchanged.
- 1488f17: Add an Ask endpoint to `repoladder serve` that answers questions with your own signed-in Claude Code, read-only.
- b65280d: Add `repoladder serve`, which hosts the built map on localhost behind a per-run token.
- 28e2ec9: Ask answers are checked against the code facts: files, lines, names and boxes they cite come back verified (and can open in the map) or marked as not found.

### Patch Changes

- a2ff652: The board's level, title and summary now sit over the canvas at its top left, with a "More" popover for a long summary, instead of in the header.
- aa59b44: Diagram boxes get softer corners, a lighter border and a subtle shadow in the viewer. Names and colors are unchanged.
- d89f87e: Harden `repoladder serve` and Ask: cross-origin requests are refused, questions and request bodies are size-limited, one question runs at a time, a stopped question stops everything Claude started, and the privacy and security model is written down.

## 0.5.0

### Minor Changes

- 1efddcb: Add `analyzeFiles`, an analyze-only library entry that returns the extracted facts without grouping, layout or HTML, for callers that only need structure. `buildFromFiles` is unchanged.
- 02d8802: Add `repoladder query`, a read-only lookup over the code facts with file:line evidence.
- 6d63f95: Viewer: the header is a floating top bar with search, tours, export and filters; icons only on narrow screens.
- c45dd65: Viewer: the diagram fills the window with a dot grid, and the header, side panel and tour card float over it; fit-to-window frames the board clear of them.
- 8e33ba1: Viewer: zoom, fit and full screen are one floating control at the bottom right, with `+`, `-` and `F` shortcuts.

### Patch Changes

- fec214a: Fix the `"use client"` / `"use server"` directive scan hanging on large files that open with a comment and hold many block-comment ends; it now runs in linear time.
- 5c20589: The inspector is now a floating panel that opens on selection and toggles with a button and the `I` key.
- f85d083: Phone width: the first view of a wide map shows a fade at each clipped edge so it is clear the diagram continues.
- 5c20589: The map's floating controls are arranged for phones: the tour card docks above the sheet and the board is framed clear of it.
- 13da928: The viewer's tour card, menus, filter bar and search box share one popover look and open motion; the tour card gets round progress dots and Skip, Back and Next.
- 1325e07: Viewer: design tokens for floating surfaces, shadows, spacing and a nested radius; the stylesheet is split into per-area files. No visible change.

## 0.4.0

### Minor Changes

- 1efddcb: Add `analyzeFiles`, an analyze-only library entry that returns the extracted facts without grouping, layout or HTML, for callers that only need structure. `buildFromFiles` is unchanged.

## 0.3.0

### Minor Changes

- 1eed5b8: Add an opt-in hosted fidelity profile (`--profile hosted`, or the `profile` option of `buildFromFiles`) that budgets the file board's arrows again so big repos build within a hosted time limit. The default profile stays `full` and its output is unchanged.

## 0.2.0

The first public release: map a TypeScript or JavaScript repo into a diagram you can click through, where every box and arrow comes from the code.

### Map a repo
- Run `/map` in Claude Code to get a diagram that starts with the big pieces in plain language and goes one step deeper with each box you open, down to the files.
- Every arrow is traced to real imports, calls, database access or external services, and clicking an arrow shows the file and line behind it.
- Run `npx repoladder build . --default` to group by folders instead of asking Claude, with no tokens spent.
- Use `--title "My App"` to name the map, and keep `.repoladder/grouping.json` in git to get the same boxes on every run.

### Explore it
- Tours walk a real flow through the code, moving up, across and down the levels as the flow does.
- Switch the viewer between light and dark themes.

### Share it
- Save or copy the current view as SVG or PNG from the viewer's Export button.
- Run `npx repoladder export .` to write one standalone image per board, ready for a README, docs or slides.
- Publish the page as an Artifact, private until you share it.

### Install
- Install the Claude Code plugin from the `repoladder` marketplace, or use the `repoladder` package from npm (Node.js 20.6 or newer).
- Use `buildFromFiles` to build a diagram page from your own code.
- Anonymous usage stats are off unless you say yes, and `repoladder usage no` turns them off at any time.
