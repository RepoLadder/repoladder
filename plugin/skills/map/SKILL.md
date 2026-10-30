---
description: Map this repo's architecture into a grounded, drill-down diagram published as an Artifact. Use when the user wants an architecture diagram or overview map of the current TS/JS repo.
argument-hint: "[repo path]"
disable-model-invocation: true
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/dist/repoladder.mjs *), Read, Write, Edit, Artifact, AskUserQuestion
---

# RepoLadder: map this repo

Preflight: !`command -v node >/dev/null 2>&1 && node "${CLAUDE_PLUGIN_ROOT}/dist/repoladder.mjs" preflight || echo NO_NODE`

`CLI` below means `node ${CLAUDE_PLUGIN_ROOT}/dist/repoladder.mjs`. `REPO` is `$ARGUMENTS` if given, otherwise the current working directory. All output goes to `REPO/.repoladder/`.

## 1. Preflight
- `PREFLIGHT_OK` → continue.
- `PREFLIGHT_NEEDS_INSTALL` (rare: Claude Code normally installs the runtime with the plugin) → tell the user you're installing RepoLadder's runtime once (about 25MB: the TypeScript parser and the D2 layout engine), run `CLI install`, and continue on `INSTALL_OK`. On `INSTALL_FAILED` or an npm error, stop and show the error; it is usually no network or no npm on the PATH.
- `NO_NODE` or `PREFLIGHT_NODE_TOO_OLD` → stop; tell the user RepoLadder needs Node.js 20 or newer.
- `USAGE_ASK` (a second line) → before anything else, ask the user once with AskUserQuestion: "Share anonymous usage stats with RepoLadder? Each run would send the version, whether it worked (and the error code if not), the repo's size range, the run time, the mode and a random install id. Never repo names, file paths or code." with the options "Yes, share" and "No". Run `CLI usage yes` or `CLI usage no` to store the answer; if they skip or dismiss the question, run `CLI usage no`. Don't mention it again on later runs. If the user later asks to turn it off or on, run `CLI usage no` or `CLI usage yes` (details in PRIVACY.md in the RepoLadder repo).

## 2. Read the code facts
Run `CLI summary REPO --fresh`. It analyzes the repo deterministically (files, imports, runtime calls, external services, server endpoints) and prints a digest. Read all of it. Every arrow in the diagram comes from these facts; your job is only to **group and name**.

If the digest says `Large repo: two passes.`, follow **Large repo** below before section 3's rules apply to the leaves.

If it exits with `NO_SOURCE_FILES` or `EMPTY`, stop and tell the user RepoLadder currently maps JavaScript/TypeScript repos only (for `EMPTY`: that the folder has no files).

If `REPO/.repoladder/grouping.json` already exists from an earlier run, Read it too: it is the starting point (see Consistency). The digest then ends with "Leaves to split": its big leaves that have no `split` yet, with their files.

### Large repo (two passes)
On a big repo the digest can't name every file, so it lists folders with file counts. Group in two passes:
1. Write `REPO/.repoladder/grouping.json` with the `summary`, the first rung and any deeper groups you can name from the folder digest, packages, services and entry points. Every group follows section 3. Wherever a part's files aren't listed yet, write a **placeholder leaf**: a real id, name and summary, with folder patterns (`dir/**`) that cover its files. Every file must still land in exactly one leaf. Reuse the default grouping's ids. Make placeholders big: a part digest names every file of a part of up to about 500 files, and 12 `--part` runs have to cover the repo, so one placeholder per package or major folder, not per small folder.
2. For each placeholder over 16 files, biggest first, run `CLI summary REPO --part <leaf id>` and read it. It names every file in that part, with the part's own default grouping and where its code reaches. Then replace that leaf's `files` with `children` (keeping its id, name and summary), grouped by section 3's rules. Use the part's default ids (already prefixed with the leaf's id) for boxes that keep their meaning.
3. If a part digest says `Part still too big`, replace that placeholder with placeholder sub-leaves by folder from it, and run `--part` on those.
4. At most **12** `--part` runs per `/map` run. When they run out, leave the remaining placeholders as folder leaves (they may be over budget; that's still a working diagram).
5. Write the story (only when the digest has no `## Story: off` heading), tours and flows from the top digest's entry points and chains and the part digests' chains. On a big repo, check hops in the `imports` of `REPO/.repoladder/facts.json` (one line: query it with `node -e` or `jq`, never grep or read it whole).
6. Then go on to section 4.
7. On a later run with an existing `grouping.json`, only run `--part` for leaves that need changes: those named in "Leaves to split", or ones a build reports uncovered files under.

## 3. Write `REPO/.repoladder/grouping.json`

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
        { "id": "web-billing", "name": "Billing & checkout", "summary": "…", "files": ["web/src/components/billing/**", "web/src/utils/billing*.ts"] }
      ]
    }
  ]
}
```

A node has **either** `files` (a leaf) **or** `children` (opens into a deeper rung), never both.

**Who it's for:** a developer who is new to this repo. Each rung goes one step deeper, and the code decides how many rungs there are: a small part may be one leaf, a big one may go four or five rungs down. There is no fixed number.
- **First rung (root children), 2-7 boxes:** the major running pieces in plain language: apps, servers, workers, scripts. If the repo is a single app, use its 3-7 main feature areas or layers instead. No folder names and no jargon in names.
- **Below that:** feature areas and responsibilities (billing, check-in, admin tools, shared UI), grouped by what the code *does*, which often cuts across folders. Use the file names and endpoint names in the summary to infer the domain. Keep splitting a group into sub-groups until every board fits the budget below.

**The budget: every board can be taken in at once.** A board (what you see when you open a group) draws at most **12 boxes** and **20 arrows**. That counts everything on it: its own sub-groups or files, the dashed boxes for other parts its code reaches (up to 4), and the services and databases it uses. So:
- A group of sub-groups: about 3-8 sub-groups.
- A leaf opens to its files, one box each, plus those extras. Aim for **about 8 boxes in all**, files plus extras: on most boards names drop below the readable size at around 10. So 5-8 files for a leaf whose code keeps to itself, 3-5 when it reaches several other parts, services or databases (a leaf whose code reaches 4 other parts and a database already has 5 extra boxes). A leaf over 16 files hides the rest behind a "+N more" box, so that never passes. Every connection of a leaf's files is drawn on its file board (no hub, budget or "used throughout" listing), so a leaf with many connections should be split.
- Box names must also stay readable (11.5px at the desktop fit), and every extra box shrinks them. When a leaf fails on names alone, move the files that reach outside it into a sibling leaf, or drop a file or two into a neighbor; don't add a rung of 2-3-file leaves just to pass it.
- A group that is over budget is split into sub-groups **by what the code does** ("Plans & pricing", "Checkout", "Invoices & receipts"), not alphabetically or by file count. Each sub-group gets a real name and summary like any other group.
- Every rung has to be worth a click: never a group with a single child (merge them), and never a group with only 2 sub-groups unless its board also shows other parts or services. If a split would give that, keep the group a leaf, or split it three ways.

**Names and summaries:**
- Names are 1-4 words and at most 40 characters ("Billing & checkout", not "web-src-components-billing").
- Summaries say what the part does and why it matters, not how it's built. The first rung should make sense to a non-engineer. Deeper rungs may name key technologies or files.
- Avoid "Other" and "Misc". If leftovers remain, give them an honest name, like "Shared helpers" or "Site pages & layout".

**Files:**
- Every source file in the summary must belong to exactly one leaf.
- Patterns:
  - `dir/**` covers everything under a folder.
  - `dir/*.ts` covers one level of a folder.
  - `dir/prefix*` covers files whose names start with a prefix.
  - A plain path covers one file.
- When patterns overlap, the most specific one wins. So a broad pattern like `packages/functions/src/**` can sit in one leaf while more specific ones claim files out of it.
- Prefer folder patterns. Use explicit paths or prefixes for flat folders, where the files sit side by side.
- The digest's file list leaves off only the repo's most common extension (its heading says which, e.g. "`.ts` dropped"); every other extension is shown. An explicit path needs the real one: `Button.tsx` beside `.ts` files, `env.mjs`. When unsure, a prefix (`web/src/Button*`) avoids the extension.

**Finer splits (the Less stop):** the viewer has a detail dial, and its bottom stop, Less, draws one more rung than your tree: smaller boards, more clicks. You write that rung too, as an optional `split`, which the normal diagram ignores.
- **For every leaf over 6 files, add a `split` of 2-4 named parts** that share out its files by what they do, each with its own `files` patterns (the same pattern rules as above; they only pick among that leaf's files, and every file must land in exactly one part).
- A group with more than 6 children may get a `split` too: 2-4 named buckets, each listing its children's ids in `members`. Every child goes in exactly one bucket.
- Parts and buckets get real names, summaries and unique ids, like any group. Never "X and 5 more", "Part 1" or "Misc"; if a leaf has no natural seams, leave it unsplit.

```json
{ "id": "web-billing-plan", "name": "Plan & billing cycle", "summary": "…", "files": ["web/src/pages/Plan.tsx", "web/src/components/billing/PlanTab.tsx", "web/src/hooks/useCadence*", "web/src/hooks/useCompanySubscription.ts"],
  "split": [
    { "id": "web-billing-plan-page", "name": "Plan page", "summary": "…", "files": ["web/src/pages/Plan.tsx", "web/src/components/billing/PlanTab.tsx"] },
    { "id": "web-billing-plan-cycle", "name": "Switch billing cycle", "summary": "…", "files": ["web/src/hooks/useCadence*"] },
    { "id": "web-billing-plan-data", "name": "Subscription data", "summary": "…", "files": ["web/src/hooks/useCompanySubscription.ts"] }
  ] }
```

A split that wouldn't earn its click (its rung shows fewer than 3 boxes, or a bucket holds one child) is left out of the Less stop with a warning; the rest of the diagram is unaffected.

**IDs:**
- IDs are unique lowercase slugs (`a-z`, `0-9`, `-`).
- **Reuse the default grouping's ids** for boxes that keep the same meaning. This keeps the same boxes on re-runs.

**Story (rung 0):** If the digest has a `## Story: off` heading, skip this whole block: write no new `story` (leave one already in `grouping.json` untouched, so turning the switch back on needs no re-run), and the Likely entry points section is not in the digest. Otherwise: above the parts, add a `story` that tells a non-engineer who uses this system and what it does for them.

```json
"story": {
  "actors": [
    { "id": "patient", "name": "Patient", "summary": "Checks in for an appointment.", "kind": "person" },
    { "id": "stripe-webhook", "name": "Stripe", "summary": "Tells us when a payment succeeds or fails.", "kind": "system" }
  ],
  "uses": [
    { "actor": "patient", "part": "web", "says": "checks in", "entry": "web/src/pages/CheckIn.tsx" },
    { "actor": "stripe-webhook", "part": "functions", "says": "reports payments", "entry": "stripeWebhook" }
  ],
  "narrative": [
    "A [[patient]] checks in on the [[web|website]] when they arrive.",
    "Payments run through [[svc-stripe]], which reports back to the [[functions]]."
  ]
}
```

- **Actors** (2-6): the people and outside systems that use it, in plain words ("Patient", "Practice staff", "Stripe"). `kind` is `person` or `system`. Actor ids must not reuse a group id.
- **Uses:** one per thing an actor does with a first-rung part. `part` is a first-rung id (a child of the root). `says` is a short verb phrase ("books appointments"): aim for 20 characters or less, one idea per use. The story reads left to right, and its longest phrase sets how wide every actor's lane is, so a long one shrinks the whole board.
- **Every use cites an `entry`**: an exact source file path, a page route (e.g. `/check-in`), or an endpoint name, that lives inside that part. Pick from the digest's "Likely entry points" section. These arrows are the only relationships you declare, so the build rejects any entry it can't find in the facts, or that sits in a different part.
- **Narrative:** 3-6 short sentences, at most 6, in plain language with no jargon, tech names or file names. Reference actors, groups and services inline as `[[id]]`, which the viewer shows as the item's name and links to it, or as `[[id|shown text]]` to choose the words. Services and databases go by the ids in brackets in the digest's "External services" and "Data stores" headings, for example `[[svc-stripe]]` or `[[store-prisma]]`; copy them, never build one from the service's name. Every referenced id must exist.
- Keep the story stable across runs, like the ids: reuse the earlier actors, ids and wording, and change a use only when its entry point moved or disappeared.

**Tours:** add 2-4 `tours` that walk a new developer through the system's most important flows ("what happens when a patient checks in?"), step by step and across rungs.

A tour is a **chain of files**: the code a flow runs through, in order. You name the files and write a caption per hop; the build works out where each hop is drawn. A hop between two parts plays on the board where both parts show (the arrow Web app → Cloud backend on the top rung); a hop inside one part plays inside it, down to its files. So a tour starts high, drops into a part where the detail is, and comes back up on its own.

```json
"tours": [
  { "id": "patient-check-in", "title": "Patient check-in",
    "chain": ["web/src/pages/KioskPage.tsx", "web/src/api/kioskHttp.ts", "functions/src/checkin.ts", "functions/src/forms.ts"],
    "captions": [
      "The kiosk page hands the patient's details to its small HTTP helper.",
      "The helper calls the check-in function in the cloud backend by name.",
      "The check-in function loads the practice's intake forms to show next."
    ] }
]
```

- Pick the chains from the digest's **Runtime chains** section: each line is a real chain from an entry file (a page, an endpoint file, an app entry) through a runtime call (⇒) to code that uses a service or store. Copy a chain as it is, cut it shorter, or build a different one from its **Next hops** lines (`file → what it imports, ⇒ what it calls`), which list the real hops out of the entry and chain files. Don't guess a hop from file names: one on neither list is likely not there (on a big repo, check the `imports` of `REPO/.repoladder/facts.json` with `node -e` or `jq`: the file is one line, so never grep or read it whole). Prefer flows a new developer would ask about first ("what happens when a patient checks in?").
- `chain`: 3-7 repo paths, exactly as in the digest, plus an optional service or store id at the end. Every consecutive pair must be a real import or call that points from the code that imports or calls (`a` imports `b`, or `a` calls an endpoint in `b`: → and ⇒ in the digest). The build rejects a hop it can't find and says when it exists the other way round. The chain may end with a service or store id the last file uses (`"svc-stripe"`, `"store-firestore"`), so the tour finishes on the database or outside service the flow reaches.
- `captions`: one per hop (one fewer than the entries in `chain`), each 1-2 plain sentences (at most 300 characters) for someone new to the repo: what happens and why, not the file names. Without captions the build writes mechanical ones from the evidence ("kioskHttp.ts calls checkIn in checkin.ts").
- `id` (a lowercase slug) and `title` (at most 60 characters). `id` defaults to the title as a slug; give one so links stay stable when you retitle.
- `depth` (optional): how many rungs below the chain's top board (the deepest group holding all its files) a step may go; a deeper hop is shown on its ancestor at that rung, opened up on the detail dial. Leave it out for no limit.
- Go for 2-4 tours over different parts of the system, not four variations of one flow.
- The older `steps` form (`{ "id", "title", "steps": [{ "text", "edge": [from, to] } | { "text", "node" }] }`, by group ids) still validates; keep tours written that way in an existing grouping unless you're asked to rewrite them, and write new tours as chains.

**Flows (optional):** the build finds up to 5 flows on every board by itself: short chains of drawn arrows from where something starts (a page, a route, an endpoint, or a box nothing points into) to a service, store or outside part. Each board's "Walk through" steps through them one arrow at a time. To name a board's most important one and caption its steps, add it to `flows`:

```json
"flows": [
  { "board": "web-checkin", "title": "Kiosk check-in", "path": ["web/src/pages/CheckIn.tsx", "web/src/api/checkin.ts", "functions"],
    "captions": ["The check-in page loads its API helper.", "The helper calls the check-in functions by URL."] }
]
```

- `board` is a group id; `path` lists the boxes in order: group ids, service ids (`svc-stripe`), store ids (`store-firestore`), or on a leaf group's board, file paths. Every consecutive pair must be an arrow drawn on that board, pointing from the code that imports or calls. `captions` (optional) gives one short line per arrow. At most 5 per board; most boards need none.

**Consistency:** if an earlier `grouping.json` exists, keep its structure, ids, names and summaries. Only change what the code change requires, such as covering new files, dropping empty groups or splitting a board that went over budget, unless the user asked for a regroup. A group you split keeps its id, name and summary; its new sub-groups get new ids (`web-billing` → `web-billing-checkout`, …), so tours and the story still point at it.

## 4. Build
Run `CLI build REPO`.
- `INVALID …` (exit code 2) → the message lists uncovered files (and an explicit path written with the wrong extension), ties between patterns, story errors (only when the story is on: unknown actor, part or reference, with the closest id when there is one, or an entry not found in that part), tour errors (`INVALID tours`: a chain file that isn't a source file, with a guess at the path you meant; a hop with no import or call, saying when it exists the other way round; a hop into a file its board hides under "+N more"; the wrong number of captions; or, in the `steps` form, an unknown id or an edge on no board), flow errors (`INVALID flows`: a box not on that board, or an arrow the board does not draw), or schema errors. Fix `grouping.json` with Edit and build again.
- `OVER_BUDGET <board> (<kind>): <reasons>` lines (printed before `BUILD_OK`; the build still succeeded) → that board breaks the budget. Act on them by kind:
  - `files` (a leaf) or `group`: split that group into sub-groups by what the code does, as above. For a `group` board with too many boxes, you may instead nest some of its sub-groups one rung deeper under a new group. A `files` board over on names alone (`names …px`, no box or arrow count) usually needs a file or two moved to a sibling leaf rather than a new rung. `REPO/.repoladder/lint.json` has every board's numbers under `budget.byBoard`.
  - `story` (only when the story is on): for `names … px`, the story is too wide, not too full: its width is the actors' lane (the longest `says`) plus one column of parts per step left to right. Shorten the phrase the reason quotes (and any other `says` over 20 characters); long first-rung names already wrap onto two lines, so don't merge or cut parts for it. Only a `boxes` or `arrows` reason calls for fewer actors or first-rung parts.
  - `store` (a database's collections): leave it. The build already folds its readers up a rung, or into the panel, to fit; grouping can't change its collections.
- Warnings (a pattern matching no files, a group with a single child, a group that opens to too few boxes, a split that isn't drawn) don't block the build, but fix them anyway.
- `SIMPLE …` says how many splits the Simple stop draws, and lists leaves over 6 files that still have no `split`. Add the missing splits along with any other fix; don't spend a rebuild on them alone. Split errors (a file in no part, a child in no bucket) are `INVALID` like any other.
- `BUILD_OK <path>` with no `OVER_BUDGET` lines left (other than `store` ones) → continue.

Fixing `INVALID` errors and splitting over-budget boards share **up to 3 rebuilds** in all, as before. When they run out, continue with the last `BUILD_OK` build; a board still over budget is still a working diagram. `summary --part` runs don't count against these 3 rebuilds; they share their own limit of 12 per run (section 2). You may also run `--part` on a leaf whose board is over budget on names, to see its files.

## 5. Publish
Publish `REPO/.repoladder/diagram.html` with the Artifact tool. The page is already complete; don't rewrite it.
- **First run:** publish it with `icon: "map"` and a one-sentence description. Then write the returned URL to `REPO/.repoladder/artifact.json` as `{"url": "<url>"}`.
- **Later runs** (`artifact.json` exists): Read that artifact first with `action: "read"`, then publish with that `url` so the same link updates in place.

## 6. Reply
Keep it short:
- The artifact link.
- The first-rung parts in one line.
- One sentence on how to explore: click a box or arrow for evidence; double-click a box to open it.
- One tip: commit `.repoladder/grouping.json` so everyone gets the same boxes, and gitignore the rest of `.repoladder/`.

## Optional: export images
If the user wants the diagram in a README, doc or slide, run `CLI export REPO [--board id] [--format svg|png] [--theme light|dark]` after a build. It writes one standalone SVG per board to `REPO/.repoladder/export/` (`EXPORT_OK <dir>`). PNG needs Playwright; without it the command prints `PNG_UNAVAILABLE` and writes SVG only. The viewer's own Export button saves or copies the current view (SVG, PNG), but a published Artifact may block downloads (it then shows the image to save by hand), so the CLI is the way to get every board, or a specific one, non-interactively.
