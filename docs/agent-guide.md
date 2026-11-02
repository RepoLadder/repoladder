# Map a repo with your coding agent

<!-- Rules mirror plugin/skills/map/SKILL.md sections 2 to 4; test/agent-guide.test.ts checks the shared numbers. -->

These are the same steps `/map` runs in Claude Code, written so another coding agent can follow them. They have not been tried with any agent other than Claude Code, so nothing here claims that another agent works. With Claude Code, use `/map` instead.

The idea: RepoLadder reads your code and works out every arrow itself. Your agent only **groups and names**: it reads a digest of the repo's facts and writes `.repoladder/grouping.json`, and RepoLadder checks that file and draws the map.

## Before you start

- Your agent needs a shell and the ability to read and write files in the repo you want to map.
- Node.js 20.6 or newer, and a TypeScript or JavaScript repo.
- To hand it over, tell the agent "follow docs/agent-guide.md from the RepoLadder repository for this repo", or paste this guide into your repo's own agent instructions file.
- Privacy: the digest from step 1 is read by your agent, so it goes wherever your agent sends its context. It holds file paths, package and dependency names, the names of outside services, endpoint names and the import links between files. It holds no source code. [PRIVACY.md](../PRIVACY.md) describes the Claude Code case.

## The usage-stats question

The agent must never answer the usage-stats question for the user. Run every command non-interactively. An agent's shell is usually not a terminal, so `build` does not ask. If a command stops to ask, answer no, or set `REPOLADDER_NO_USAGE=1` (`DO_NOT_TRACK=1` works too) before you run it. The user can opt in themselves with `npx repoladder usage yes`. Skip `preflight`: its prompt is specific to Claude Code.

## Step 1: read the code facts

```
npx repoladder summary . --fresh
```

Read all of the digest. It analyzes the repo and lists files, imports, runtime calls, outside services and server endpoints. Every arrow in the map comes from these facts.

- `NO_SOURCE_FILES` or `EMPTY`: stop and tell the user that RepoLadder maps JavaScript and TypeScript repos only.
- If `.repoladder/grouping.json` already exists, read it and keep its structure and ids. Change only what the code change requires. The digest then ends with "Leaves to split": big leaves that have no `split` yet.

## Step 2: write `.repoladder/grouping.json`

```json
{
  "version": 1,
  "summary": "2-3 sentences: what this system is and does, for someone who has never seen it.",
  "children": [
    {
      "id": "web",
      "name": "Customer web app",
      "summary": "One or two sentences: what this part does and why it exists.",
      "children": [
        { "id": "web-billing", "name": "Billing & checkout", "summary": "What the billing code does.", "files": ["web/src/components/billing/**", "web/src/utils/billing*.ts"] },
        { "id": "web-pages", "name": "Site pages", "summary": "The pages a customer sees.", "files": ["web/src/pages/**"] }
      ]
    },
    { "id": "api", "name": "Backend API", "summary": "The server the web app calls.", "files": ["api/src/**"] }
  ]
}
```

The rules:

- A node has either `files` (a leaf) or `children` (it opens into a deeper rung), never both.
- The first rung (the root's children) is 2 to 7 boxes in plain language: the major running pieces, such as apps, servers and workers. A single app uses its 3 to 7 main feature areas instead. No folder names and no jargon in these names.
- Below that, group by what the code does (billing, check-in, shared UI), which often cuts across folders. Keep splitting a group until every board fits the budget.
- **The budget:** a board draws at most 12 boxes and 20 arrows. That counts sub-groups or files, the dashed boxes for other parts its code reaches, and the services and databases it uses. Aim for about 8 boxes per leaf board. Names must stay readable at 11.5px, so a leaf that fails on names alone should hand a file or two to a sibling instead of gaining a rung.
- Never write a group with a single child; merge it. Split an over-budget group by what the code does, never alphabetically.
- Names are 1 to 4 words and at most 40 characters. Summaries say what the part does and why it matters. Never use "Other" or "Misc"; give leftovers an honest name such as "Shared helpers".
- Every source file in the digest belongs to exactly one leaf.
- Patterns: `dir/**` covers everything under a folder, `dir/*.ts` covers one level, `dir/prefix*` covers files whose names start with a prefix, and a plain path covers one file. When patterns overlap, the most specific one wins. Prefer folder patterns.
- The digest drops the most common extension from its file list (its heading says which, for example "`.ts` dropped") and shows every other one. An explicit path needs the real extension, such as `Button.tsx` beside `.ts` files. When unsure, use a prefix.
- Ids are unique lowercase slugs (`a-z`, `0-9`, `-`). Reuse the ids of the digest's default grouping for boxes that keep their meaning.
- For every leaf over 6 files, add a `split` of 2 to 4 named parts that share out its files by what they do. Each part has its own `id`, `name`, `summary` and `files`, and every file lands in exactly one part. A leaf with no natural seams stays unsplit. The full example is in the "Finer splits" part of [the Claude Code skill](../plugin/skills/map/SKILL.md).

**Story, tours and flows are optional and left out of this guide.** If the digest contains the `## Story: off` heading, write no `story`. If it does not, the story level is on: follow the "Story (rung 0)" block in [the Claude Code skill](../plugin/skills/map/SKILL.md). Without `tours`, the build derives up to four tours itself.

### Large repo (two passes)

When the digest starts with `Large repo: two passes.`, it cannot name every file, so group in two passes:

1. Write `.repoladder/grouping.json` with the `summary`, the first rung and any deeper groups you can name from the folder digest. Where a part's files are not listed yet, write a placeholder leaf: a real id, name and summary, with folder patterns (`dir/**`) that cover its files. Make placeholders big, one per package or major folder.
2. For each placeholder over 16 files, biggest first, run `npx repoladder summary . --part <leaf id>`, with the placeholder's id. It names every file in that part. Replace the placeholder's `files` with `children`, keeping its id, name and summary, grouped by the rules above. `--part` needs a valid grouping already written; without one it prints `NO_GROUPING`.
3. If a part digest says `Part still too big`, split that placeholder into placeholder sub-leaves by folder and run `--part` on those.
4. Run `--part` at most 12 times in one pass. Leftover placeholders stay as folder leaves, which is still a working map.

## Step 3: build

```
npx repoladder build .
```

- `INVALID ...` (exit code 2) lists the problem: uncovered files, a path with the wrong extension, ties between patterns, or schema errors, with the closest id or path suggested where one exists. Fix `grouping.json` and build again.
- `OVER_BUDGET <board> (<kind>)` lines print before `BUILD_OK`. That board breaks the budget: split its group by what the code does.

Fixing `INVALID` errors and over-budget boards share up to 3 rebuilds in all; `summary --part` runs do not count against them. After that, keep the last `BUILD_OK` build: a board that is still over budget is still a working map.

## Finish

Tell the user that `.repoladder/diagram.html` is the map. Open it in a browser, or run `npx repoladder serve . --no-open`. Suggest committing `.repoladder/grouping.json` and ignoring the rest of `.repoladder/`.

## No agent at all

```
npx repoladder build . --default
```

This groups by folders with no AI and still draws every arrow from the code.

## What is deliberately not here

The parts that only make sense in Claude Code: the preflight check, the usage prompt and publishing the map as an Artifact. For the Claude Code baseline, `docs/reliability.md` reports 5 of 5 repos reaching `BUILD_OK` and 2 of 5 groupings valid on the first try. That is Claude Code's result only; it says nothing about other agents.
