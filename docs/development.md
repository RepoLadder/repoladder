# Develop

```bash
npm install
npm test               # analyzer, grouping and rollup tests against test/fixtures
npm run typecheck      # tsc --noEmit
npm run build          # bundle src/ into plugin/dist/repoladder.mjs
node src/cli.ts build ../some-repo --default   # folder-based diagram, no Claude step (--title "My App" names the map)
```

Source layout: `src/analyze` (facts), `src/model` (grouping, validation, rollup, tours), `src/build` (D2 layout, HTML), `src/viewer` (the in-page app). Branches, releases and what a PR needs are in [CONTRIBUTING.md](../CONTRIBUTING.md). Don't commit `plugin/dist/`; a bot rebuilds it after each release.

To re-record the GIF in the [README](../README.md) after a viewer change, build the map from `gallery/groupings/repoladder.json` and record it:

```bash
REPOLADDER_BRAND_NAME=RepoLadder npm run gallery -- --only repoladder --title RepoLadder
npm run readme-media   # dark, 15 fps → docs/media/tour.gif (options are listed at the top of scripts/readme-media.ts)
```
