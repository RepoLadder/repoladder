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
- Workflow permissions: "Read repository contents and packages permissions" (`read-only-token`), and tick
  "Allow GitHub Actions to create and approve pull requests" (`actions-create-prs`): `release.yml` needs it
  to open and auto-merge the Version Packages PR (a ruleset still requires CI on every PR into `main`, and the PR needs
  no approvals). The `rebuild-dist.yml`, `release.yml` and `publish.yml` workflows ask for `contents: write` and OIDC themselves.
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

- Allow squash merging and merge commits, not rebase (`merge-methods`): feature PRs are squashed, the
  `develop` -> `main` release PR (and back-merges) use a merge commit so the two branches keep a shared
  history. Automatically delete head branches
  (`delete-branch-on-merge`), Discussions on (`discussions`).
- Allow auto-merge (`auto-merge`): `release.yml` turns it on for a minor or patch Version Packages PR
  (`gh pr merge --auto`), so the PR merges by itself once its required checks pass.

```sh
gh api -X PATCH repos/OWNER/REPO -F allow_squash_merge=true -F allow_merge_commit=true \
  -F allow_rebase_merge=false -F delete_branch_on_merge=true -F has_discussions=true \
  -F allow_auto_merge=true
```

**Settings, Environments**

Publishing to npm uses two environments, chosen by `publish.yml` from the release type:

- `npm-publish`: no required reviewer. Minor, patch, prerelease and first publishes run here.
- `npm-publish-major`: the required reviewer. A major release (compared with the latest version on npm)
  pauses here until approved. An unreadable npm lookup counts as major.

A major is the one human-approved step of a release. The other guards stay on every publish: main-only
commit, public repo, provenance, installcheck and the already-on-npm short-circuit.

The npm trusted publisher for `repoladder` is bound to the workflow file `publish.yml` and an environment
name, so the npm-side configuration must accept both names. npm's trusted-publisher form takes one
environment name: leave it blank to accept any environment of `publish.yml`, otherwise a major publish
fails at the npm step.

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
  - `ci gate` (aggregates the jobs above; see below)
- Block force pushes (`ruleset-no-force-push`) and deletion (`ruleset-no-delete`).
- Bypass list (`ruleset-bot-only-bypass`): the GitHub Actions integration only, no admins, teams or users.

**Why these names, and not others.** GitHub matches a check's display name (the job's `name:`), not the job
id. A required name that matches nothing stays "Expected" forever and blocks every merge, so a list written
with job ids (`check`, `install (...)`, `no-dist`) never works. `changes` must be required: every other heavy
job needs it, a job whose dependency failed is skipped, and a skipped required check counts as passing, so
without it a failed `changes` job would let a PR merge green. A job skipped by its `if` never reports a check
name, so a docs-only PR (which skips the heavy jobs and the `plugin install (ubuntu-latest)` matrix) stays
blocked on the three heavy names. `ci gate` is the fix: it always reports on non-draft PRs, fails when `changes`
did not succeed or any job failed or was cancelled, requires `unit`, `typecheck-build` and `install` to succeed
on a code run, and accepts them skipped on a docs-only run. `.github/workflows` changes also run `actionlint`,
which reports through the gate. Left out on purpose: the gallery
default-grouping gate, because it clones a private repository and cannot pass in a public one, and the
Windows install leg, because it only runs when the changed files ask for it and a name that sometimes never
reports would deadlock merges. A test compares this list with the job names in `ci.yml`, so a renamed job
fails `npm test` instead.

**The `develop` ruleset.** Require `changes`, `leak guard` and `ci gate` on `develop`. The matrix name
`plugin install (ubuntu-latest)` cannot be required there: a skipped matrix job never reports a name, so a
docs-only PR would be blocked. The older `test, typecheck, build`, `plugin install (ubuntu-latest)` and
`PR does not touch plugin/dist` stay listed in `scripts/public-repo-settings.json` until the owner has switched
the rulesets to `ci gate`; a follow-up then removes them from the list and from this document. Add `ci gate` to a
ruleset only after it has reported at least once on the base branch, since requiring a check that does not
exist blocks every PR.

**Version Packages PR.** `release.yml` opens the PR with the `RELEASE_PR_TOKEN` secret, so the PR's own
`pull_request` CI runs and satisfies the required checks (see `test/versionpr-automerge.test.ts`).
`PR does not touch plugin/dist` and `PR carries a changeset or version bump` run only for pull requests
and report as skipped, which counts as passing. A ruleset with required checks is what makes `--auto` wait for
CI; `release.yml` refuses to enable auto-merge when `main` requires none. A minor or patch PR then merges by
itself and the workflow dispatches the publish; a major is merged by a person.

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
