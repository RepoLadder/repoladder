# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately. Do not open a public issue, PR or Discussion for one.

- Preferred: GitHub private vulnerability reporting. Open the Security tab of [repoladder/repoladder](https://github.com/repoladder/repoladder) and choose "Report a vulnerability" ([direct link](https://github.com/repoladder/repoladder/security/advisories/new)).
- Fallback: email `security@repoladder.com`.

## What to include

- What is affected (the CLI, the viewer, the usage ping).
- Steps to reproduce, or a proof of concept.
- The impact you expect.
- Your Node version and OS, and the plugin commit if you know it.

A small public repo that reproduces the problem helps. Never send private code.

## What to expect

We will acknowledge your report within about a week, keep you updated while we work on a fix, and credit you in the advisory if you would like. There is no bug bounty program.

## Supported versions

Only the latest release of the plugin (`main`) and the latest `repoladder` npm version get fixes.

## In scope

- The CLI and analyzer (`src/cli.ts`, `src/analyze/`, and the bundled `plugin/dist/` they ship as). For example: reading or writing outside the repo and its `.repoladder/` output, or executing code from the analyzed repo.
- The viewer (`src/viewer/`) and the `diagram.html` it generates. For example: script injection from file names, paths or labels in an analyzed repo.
- The opt-in usage ping: the client (`src/usage.ts`) and the endpoint (`server/ping/`, a Cloudflare Worker at `ping.repoladder.com`). For example: sending more than documented, or the endpoint accepting or storing more. See [PRIVACY.md](PRIVACY.md) for exactly what the ping sends.

## Out of scope

- Your own Claude or Claude Artifact accounts and their sharing settings.
- Third-party services and dependencies themselves. Report those upstream, and tell us if RepoLadder uses them unsafely.
- Issues that need an already-compromised machine.
