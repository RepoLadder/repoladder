<!-- Open this PR against `develop`, not `main`. `main` only moves through the maintainer's release PR. -->

## Summary

What changed and why. `Fixes #...`

## How verified

Tests added or run. For visual changes, attach before/after screenshots from `npm run shots -- --compare` here.

## Checklist

- [ ] `npm test` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run build` succeeds (then `git checkout -- plugin/dist`)
- [ ] `plugin/dist/` is not in this PR (`no-dist` check)
- [ ] New analysis or model behavior has tests
- [ ] Visible changes include before/after screenshots
- [ ] If AI tools helped write this PR, I say so in the summary and I have read and tested every change

CI runs on non-draft PRs; the plugin install check on Windows runs when install or packaging code changes and on the release PR.
