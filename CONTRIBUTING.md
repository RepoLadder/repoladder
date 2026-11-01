# Contributing to RepoLadder

Thanks for helping make RepoLadder better.

## Setup

```sh
npm install
npm test
npm run typecheck
npm run build
git checkout -- plugin/dist
```

Branch from `develop` and open PRs into `develop`; non-draft PRs into `develop` and `main` run CI (tests, typecheck and build, the gallery gate, and a plugin install check; Windows only when install or packaging code changes), draft PRs run none, and every push to `main` runs it. See "Branches and releases" below. What a PR should include is in [the PR template](.github/pull_request_template.md).

## Don't commit `plugin/dist/`

The `no-dist` check fails a PR when `plugin/dist/` changed. For maintainers: after each release to `main` a bot rebuilds and commits it. If you ran `npm run build`, run `git checkout -- plugin/dist` before committing. The `Verify bundle` workflow rebuilds it on ubuntu-latest after each bot commit (and daily) and fails if it differs from the committed file; the stamp comes from the bundle's `// repoladder-build:` line. A bundle built locally (macOS) will not match, so never compare locally. In the minutes between a release merge and the bot commit the bundle is expected to be stale; that only warns on the post-bot trigger.

## Branches and releases

Feature PRs go into `develop`. A `develop` -> `main` release PR (ready for review, not draft; merged with a merge commit) is the full CI run, including the Windows install check; feature PRs get the same checks, with Windows only when install/packaging files change. For maintainers: after a release, merge `main` back into `develop` so the bot's `plugin/dist` commit does not drift: open a PR from `main` into `develop` (`gh pr create --base develop --head main`) and merge it with a merge commit, never squashed. `develop` requires a PR, and the `no-dist` check skips a PR whose head is `main`.

For maintainers: `.github/CODEOWNERS` lists the guardrail paths (workflows, leak guard, hooks, manifests, package scripts, `plugin/dist/`, pipeline config, instructions). It takes effect only when the public repo's ruleset enables "Require review from Code Owners". A PR author cannot approve their own PR, so the owner's own PRs to those paths need a ruleset bypass or a second reviewer, and `rebuild-dist.yml`, which pushes straight to `main`, needs a ruleset bypass for the bot.

## Tests

New analysis or model behavior comes with tests (`test/*.test.ts`, fixtures under `test/fixtures/`).

## Visual changes

Any change to what a diagram looks like includes before/after screenshots. On the base branch run `npm run gallery` and `npm run shots`, and move `.gallery/shots` aside. After your change run `npm run gallery && npm run shots -- --compare <before shots dir>`. Attach the side-by-side PNGs from `.gallery/shots/compare/` to the PR under "How verified", or say that nothing changed. On a fresh machine run `npx playwright install chromium` once.

## Viewer guard
`npm run guardbase` checks the viewer's structure against `test/baselines/viewer-structure.json`: every board's fit view (1280x800 and 390x844), every wire's route and the drill-in and drill-out animations (tolerance half a board unit; durations and easings exactly). CI runs it with `npm run motioncheck` as the `viewer guard` job for PRs touching `src/viewer/**` or `src/build/**`, and the `test, typecheck, build` check fails when it fails. Pixels (colors, radii, type) may change freely. A deliberate change to fit, routing or timing re-records the baseline in the same PR with `npm run guardbase -- --update` (refused under `CI`); the JSON diff is part of review and the PR says why. Screenshot comparison stays local (`npm run shots -- --compare`, `npm run design -- --compare`).

## Issues

Use the bug or feedback forms. Questions and ideas go to [Discussions](https://github.com/repoladder/repoladder/discussions). The maintainer reads every issue and labels it; not every idea gets built. Opening an issue before a large PR is welcome.

## Changelog and credit

A PR that changes anything shipped in the npm package adds a changeset with `npm run changeset`. The changeset text is the changelog line, so write it for users: what changed and why they care, in one or two sentences. Release notes are generated from the changesets when the release PR merges (see `.changeset/README.md`), so there is nothing else to edit by hand.

To credit someone, end the changeset text with a thanks line that uses their GitHub login, for example `Thanks @octocat for the report and the fix.` Credit applies to reports and reviews as well as code. A maintainer adds the line when merging an outside PR that did not include one. Docs-only and test-only PRs need no changeset.

## Conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## AI-assisted contributions

PRs written with AI tools are welcome. You are responsible for every line you submit: understand it, and run `npm test` and `npm run typecheck` before you open the PR. Say in the PR summary that AI helped, using the checkbox in the PR template. The maintainer reviews every outside PR and may decline it or ask for changes. There is no CLA or DCO yet.

## Security

Report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md).

See [docs/development.md](docs/development.md) for the source layout and the rest.
