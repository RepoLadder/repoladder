---
description: Publish the last built RepoLadder map so others can open it. Use when the user wants to share or publish the map they just built, after /map.
argument-hint: "[repo path]"
---

# RepoLadder: share the map

`REPO` is `$ARGUMENTS` if given, otherwise the current working directory. The page is `REPO/.repoladder/diagram.html`.

1. If that file does not exist, say "run `/map` first" and stop.
2. If this plugin has a skill named `share-map-<platform>` that matches the platform you are running on, use it (invoke it with the Skill tool, or if you cannot, tell the user to run it) and stop.
3. Otherwise publish the single file `diagram.html`, without rewriting it, with whatever page-publishing or file-sharing tool this platform gives you.
4. If there is no such tool, say so plainly and point at the file path. It is one self-contained HTML file that can be opened in a browser or hosted anywhere.

Always say the shared copy has no Ask bar, and that `node ${CLAUDE_PLUGIN_ROOT}/dist/repoladder.mjs serve REPO` gives Ask locally.
