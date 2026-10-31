# Changesets

A change that ships in the `repoladder` npm package (`src/`, the packaging scripts) adds a changeset in
the same PR: `npm run changeset`, pick the bump (patch, minor or major) and write the changelog line.
Commit the generated `.changeset/*.md`.

Releasing is automatic from there: the `develop` -> `main` release PR carries the changesets; on main the
`Release` workflow opens a "Version Packages" PR that bumps `package.json` and writes `CHANGELOG.md`;
merging that PR publishes to npm and creates the `v<version>` tag and GitHub Release (`publish.yml`).
