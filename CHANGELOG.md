# Changelog

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
