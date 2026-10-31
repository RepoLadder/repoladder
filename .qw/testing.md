# Testing RepoLadder

How the pipeline's test workers verify changes to this repo. Install with `npm ci` (Node 22 or newer). PRs target `develop`. See `CLAUDE.md`, `CONTRIBUTING.md` and `gallery/README.md` for the deeper docs.

## typecheck

`npm run typecheck` (`tsc --noEmit`). Passes with no output.

## unit

`npm test` runs `node --test "test/*.test.ts"` with fixtures in `test/fixtures`. Add a test next to the existing ones for the area you changed. A new test file is compile-checked by `npm run typecheck` without running it.

## Safety

- Never commit `plugin/dist/`: a PR that touches it fails the `no-dist` check. After `npm run build`, run `git checkout -- plugin/dist`. A bundle built on macOS never matches CI's, so never compare them locally.
- The repo is public. Run `npm run leakguard` before pushing, and `npm run leakguard -- --text < draft.md` on any issue or PR text.
- Never push a `v*` tag or merge into `main`: that publishes to npm.
