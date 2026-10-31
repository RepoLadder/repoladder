# Public repo settings

The GitHub settings to apply right after this repository is made public, in order, with the exact value
for each. `npm run verify:settings` reads them back through `gh api` and reports what is off.

## Verify

Sign in with `gh auth status` as a repo admin (the security fields are only returned to admins), then:

```sh
npm run verify:settings -- OWNER/REPO
npm run verify:settings -- OWNER/REPO --launch-week   # during launch week, also checks the interaction limit
```

Each check prints `OK`, `OFF` or `CANNOT-VERIFY`. `OFF` means the setting is readable and wrong, and fails
the run (exit 1). `CANNOT-VERIFY` means GitHub did not return it (no admin token, or a feature the plan does
not offer); it does not fail the run, so read those lines before trusting a clean exit. The script only
sends GET requests and never changes a setting. A missing argument exits 2.

The expected values live in `scripts/public-repo-settings.json`. Every item below names its check id.

## Phase 1: after the bot's first push works

**Settings, Actions, General**

- Fork pull request workflows from outside collaborators: "Require approval for all outside collaborators"
  (`fork-pr-approval`).
- Workflow permissions: "Read repository contents and packages permissions" (`read-only-token`), and untick
  "Allow GitHub Actions to create and approve pull requests" (`no-actions-approve-prs`). The
  `rebuild-dist.yml` and `publish.yml` workflows ask for `contents: write` and OIDC themselves.
- Forks never receive secrets on a public repo, so there is no toggle for that. The real guard is never
  using `pull_request_target` together with a checkout of the pull request's code.

**Settings, Code security**

- Secret scanning (`secret-scanning`) and push protection (`push-protection`).
- Dependabot alerts (`dependabot-alerts`) and Dependabot security updates (`dependabot-updates`).
  Dependabot reads `.github/dependabot.yml` from the default branch.
- Private vulnerability reporting (`private-vuln-reporting`).

```sh
gh api -X PUT repos/OWNER/REPO/vulnerability-alerts
gh api -X PUT repos/OWNER/REPO/private-vulnerability-reporting
gh api -X PATCH repos/OWNER/REPO --input - <<'JSON'
{ "security_and_analysis": {
    "secret_scanning": { "status": "enabled" },
    "secret_scanning_push_protection": { "status": "enabled" },
    "dependabot_security_updates": { "status": "enabled" } } }
JSON
```

**Settings, General**

- Allow squash merging only (`squash-only`), automatically delete head branches
  (`delete-branch-on-merge`), Discussions on (`discussions`).

```sh
gh api -X PATCH repos/OWNER/REPO -F allow_squash_merge=true -F allow_merge_commit=false \
  -F allow_rebase_merge=false -F delete_branch_on_merge=true -F has_discussions=true
```

## Phase 2: the ruleset on `main`

Settings, Rules, Rulesets, New branch ruleset. Enforcement: Active (`ruleset-active`). Target: the default
branch (`ruleset-exists`). Rules:

- Require a pull request (`ruleset-pr-required`).
- Code-owner review (`ruleset-code-owner-review`) stays off until a `CODEOWNERS` file exists and there is a
  decided path for the owner's own pull requests: a solo owner cannot approve their own PR, and a bot-only
  bypass leaves no admin path. To turn it on, require it in the ruleset and set `requireCodeOwnerReview` to
  `true` in `scripts/public-repo-settings.json`.
- Require status checks (`ruleset-required-checks`), listing these names exactly:
  - `changes`
  - `leak guard`
  - `test, typecheck, build`
  - `plugin install (ubuntu-latest)`
  - `PR does not touch plugin/dist`
  - `PR carries a changeset or version bump`
- Block force pushes (`ruleset-no-force-push`) and deletion (`ruleset-no-delete`).
- Bypass list (`ruleset-bot-only-bypass`): the GitHub Actions integration only, no admins, teams or users.

**Why these names, and not others.** GitHub matches a check's display name (the job's `name:`), not the job
id. A required name that matches nothing stays "Expected" forever and blocks every merge, so a list written
with job ids (`check`, `install (...)`, `no-dist`) never works. `changes` must be required: every other heavy
job needs it, a job whose dependency failed is skipped, and a skipped required check counts as passing, so
without it a failed `changes` job would let a PR merge green. Jobs skipped by their `if` (drafts, docs-only
pull requests) also count as passing, so docs-only PRs are not blocked. Left out on purpose: the gallery
default-grouping gate, because it clones a private repository and cannot pass in a public one, and the
Windows install leg, because it only runs when the changed files ask for it and a name that sometimes never
reports would deadlock merges. A test compares this list with the job names in `ci.yml`, so a renamed job
fails `npm test` instead.

**Bot bypass.** `rebuild-dist.yml` pushes the rebuilt bundle straight to `main` as `github-actions[bot]`,
which the pull-request rule blocks unless the bot may bypass. Add the GitHub Actions integration as a bypass
actor, then prove it: merge one PR that touches `src/`, wait for the `Rebuild bundle` run, and confirm a
`Rebuild plugin/dist [skip ci]` commit lands on `main`. If it does not, the fallback is a deploy key with
write access, added as a bypass actor and used by the workflow's checkout; that needs a change to
`rebuild-dist.yml`. If neither works the bundle goes stale, and the installed plugin goes stale with it.

Example body for `gh api -X POST repos/OWNER/REPO/rulesets --input ruleset.json`. Fill `actor_id` with the
GitHub Actions integration id from your own org; do not guess it.

```json
{
  "name": "main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "bypass_actors": [{ "actor_id": 0, "actor_type": "Integration", "bypass_mode": "always" }],
  "rules": [
    { "type": "pull_request", "parameters": { "required_approving_review_count": 0, "dismiss_stale_reviews_on_push": false, "require_code_owner_review": false, "require_last_push_approval": false, "required_review_thread_resolution": false } },
    { "type": "required_status_checks", "parameters": { "strict_required_status_checks_policy": false, "required_status_checks": [
      { "context": "changes" },
      { "context": "leak guard" },
      { "context": "test, typecheck, build" },
      { "context": "plugin install (ubuntu-latest)" },
      { "context": "PR does not touch plugin/dist" },
      { "context": "PR carries a changeset or version bump" }
    ] } },
    { "type": "non_fast_forward" },
    { "type": "deletion" }
  ]
}
```

## Phase 3: launch week only

Time-boxed, and not a verifier failure afterwards (the check only runs with `--launch-week`).

- Interaction limit `existing_users` for one week (`interaction-limit`): accounts under 24 hours old cannot
  file issues or pull requests; real users still can.

```sh
gh api -X PUT repos/OWNER/REPO/interaction-limits -f limit=existing_users -f expiry=one_week
gh api -X DELETE repos/OWNER/REPO/interaction-limits   # remove it if it hurts feedback
```

## Not verifiable here

- npm trusted publishing and two-factor authentication: configured in the npm account, not readable through
  the repo API.
- `CODEOWNERS`: a file in the repo, not a setting.

## Re-run

Run the verifier again after each change until it prints no `OFF`, then read the `CANNOT-VERIFY` lines.
