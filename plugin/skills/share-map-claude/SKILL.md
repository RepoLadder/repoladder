---
description: Publish the last built RepoLadder map as a private Claude Artifact. Use when the user wants the map as a Claude Artifact link.
argument-hint: "[repo path]"
allowed-tools: Artifact, Read, Write
---

# RepoLadder: share the map as a Claude Artifact

`REPO` is `$ARGUMENTS` if given, otherwise the current working directory. The page is `REPO/.repoladder/diagram.html`. If it does not exist, say "run `/map` first" and stop. The page is already complete; do not rewrite it.

- **First run** (no `REPO/.repoladder/artifact.json`): publish `diagram.html` with the Artifact tool, `icon: "map"` and a one-sentence description. Then Write the returned URL to `REPO/.repoladder/artifact.json` as `{"url": "<url>"}`.
- **Later runs** (the file exists): Read the JSON, read that artifact with `action: "read"`, then publish with that `url` so the same link updates in place.

Reply with the link and say plainly: an artifact has no Ask bar. For Ask, run `/map` and accept "Open it with Ask?", or run `node ${CLAUDE_PLUGIN_ROOT}/dist/repoladder.mjs serve REPO`.
