# Serve and Ask: threat model

`repoladder serve` hosts the built map on `127.0.0.1` and, while it runs, answers questions with the user's own agent (Claude Code or Codex). Plain-language summary: [PRIVACY.md](../PRIVACY.md). Report problems as described in [SECURITY.md](../SECURITY.md).

| Attacker or mistake | Vector | Control | Proved by |
| --- | --- | --- | --- |
| Another website | A page the user has open calls `http://127.0.0.1:<port>` | Token on every route; a foreign or `null` `Origin` and `Sec-Fetch-Site` of cross-site or same-site are refused 403; no CORS headers ever | `test/serve-security.test.ts`, `test/serveguard.test.ts` |
| DNS rebinding | A hostile name resolves to 127.0.0.1 | Only `127.0.0.1:<port>` and `localhost:<port>` are accepted as `Host` | `test/serve-security.test.ts`, `test/serve.test.ts` |
| Another machine or local user | Connects to the port | Loopback-only listener and remote-address check; without the per-run token every route is 401 | `test/serve-security.test.ts`, `test/serve.test.ts` |
| Malicious repo | Its own Claude settings or hooks | `--setting-sources user`: the repo's settings are never loaded (Claude Code only; see Agents below) | `test/serve-security.test.ts` |
| Prompt injection from repo contents | Text in a file steers the agent | Tools limited to Read, Grep, Glob and one `repoladder query` command; no writes, no web, `dontAsk` | `test/serve-security.test.ts`, `test/askargv.test.ts` |
| Secrets in the repo | The agent reads `.env`, keys, `.ssh` | Read deny list in both the flags and the settings; the child's environment holds only allowlisted names | `test/serve-security.test.ts` |
| Reads outside the repo | A planted instruction or a plain question points the agent at another folder, a home-directory file or `/etc` | A `PreToolUse` hook (`repoladder readguard <root>`) refuses any Read, Grep or Glob whose path, glob prefix or symlink target resolves outside the repo root; it fails closed on input it cannot parse | `test/readguard.test.ts`, `test/askargv.test.ts` |
| Hostile question text | Flag or shell injection through the question | Argv array, no shell; the question is always the last single argument | `test/serve-security.test.ts`, `test/askcodex.test.ts` |
| Oversized or flooding requests | Huge body or question, many asks, slow headers | 2,000 characters, 16 KB body (chunked included), one ask at a time (429), header and request timeouts | `test/serve-security.test.ts` |
| Runaway turns | Endless or tool-hungry answer | Wall-clock timeout and a 25-tool-call cap (both agents) | `test/ask.test.ts`, `test/askengines.test.ts`, `test/serve-security.test.ts` |
| Process leftovers | A shell the agent started outlives the turn | The child leads its own process group and the group is killed on timeout, disconnect, tool cap and server close (POSIX) | `test/serve-security.test.ts`, `test/askengines.test.ts` |
| Log leakage | Question or token in terminal output | Neither is logged; the token appears only in the `SERVE_OK` line | `test/serve-security.test.ts` |
| Information leaks in errors | Stack traces or paths in responses | Any unexpected error is a generic 500 | `test/serve-security.test.ts` |
| Network code creeping in | A new import or global that calls out | Only `src/serve/`, `src/usage.ts` and `src/cli.ts` may reach the network; the published page uses no network globals | `test/no-network.test.ts` |

Known limits: on Windows the child's own process is killed but not its tree. The token is briefly visible in the process list while the browser opener starts (use `--no-open`). Each agent's own permission system or sandbox does the actual enforcing (see Agents below); the tests prove what RepoLadder passes it.

## Agents

Ask runs through one agent at a time, chosen by `--agent claude|codex`, then `REPOLADDER_AGENT`, then auto-detect (Claude Code if it starts, otherwise Codex). The browser can never choose. **RepoLadder** means RepoLadder enforces it and a test covers it; **Agent** means the agent's own enforcement, which depends on its version; **Not enforced** means nothing stops it, and only the system prompt asks.

| Control | Claude Code | Codex |
| --- | --- | --- |
| Loopback, token, Origin and Host checks | RepoLadder | RepoLadder |
| One ask at a time, size and time caps, tool-call cap, process-group kill | RepoLadder | RepoLadder |
| Citations verified against the facts on disk | RepoLadder | RepoLadder |
| Read-only (no writes) | Agent: `--tools`, deny rules and `dontAsk` | Agent: `--sandbox read-only` and approvals set to never |
| Secret-file deny list | Agent, from RepoLadder's deny rules | Not enforced: the sandbox limits writes and network, not reads |
| Reads outside the repo | RepoLadder: the `readguard` hook | Not enforced: only the system prompt asks |
| Repo-local config and instructions not loaded | Agent: `--setting-sources user` | Not enforced: not verified that Codex skips them |
| Only one allowed shell command | Agent: a single `Bash(...)` rule | Not enforced: any command the sandbox allows can run |
| Network | Agent: no web tools | Agent: the read-only sandbox (not verified by hand) |
| Follow-up memory | Agent: resumes the session | None: every Codex turn is a fresh session, because the sandbox flags were not shown to carry over to `exec resume` |

Codex flags used: `codex exec --sandbox read-only -c approval_policy="never" --json --color never --skip-git-repo-check -- <prompt>`. They come from the openai/codex sources (`codex-rs/exec`, `codex-rs/utils/cli`), read on 2026-11-02. No Codex binary was available to the build, so no Codex CLI version was run and none is pinned; the `Codex` row below stays pending until the owner runs it. Codex's environment holds only the base names plus `OPENAI_*` and `CODEX_*`; Claude's holds `ANTHROPIC_*`, `CLAUDE_*` and cloud credentials names but no `OPENAI_*` or `CODEX_*`. Proved by `test/askcodex.test.ts`, `test/askengines.test.ts`, `test/askagentflag.test.ts`.

If you need the secret deny list or the outside-repo guard, use Claude Code. With Codex, treat Ask as able to read any file your user account can read.

### Adding an agent

An engine is one file in `src/serve/engines/` implementing `Engine` (`types.ts`): its binary and version command, optional sign-in check, the complete argv (question last, `shell: false`), an environment allowlist, a per-child stream parser that turns the agent's output into `session`, `text`, `tool` and `result` events, and failure texts for the shared codes. `ask.ts` holds everything else. Engine code stays in `src/serve/` (`test/no-network.test.ts`) and never imports `child_process`.

### Why not the Agent Client Protocol (for now)

ACP is JSON-RPC over stdio between an editor-like client and an agent. It is a generic route, but neither Claude Code nor Codex speaks it natively (each needs a separate adapter program to install and trust), RepoLadder would have to ship a JSON-RPC client and the client-side file and permission callbacks, and the agents still run their own built-in tools unless the adapter restricts them, so ACP does not by itself make them read-only. Recommendation: not for v1. Revisit if the Codex CLI route proves awkward or a third agent appears; the `Engine` interface is small so an ACP-backed engine can be added later. This reasoning was not re-checked against the current ACP specification.

## Verified by hand

Run against a real signed-in agent CLI (once per agent); results are in the tables. Repeat it when an agent's permission, sandbox or hook behaviour changes:

1. Ask it to write or edit a file: refused.
2. Ask it to read `.env` and a `.pem` file: refused.
3. Ask it to run `repoladder query ... ; ls`: refused.
4. Ask it to read a path outside the repo: refused.
5. Ask an ordinary in-repo question: it reads files and answers.
6. Sign out and ask: the signed-out message appears.

| Claude Code version | Date | Results |
| --- | --- | --- |
| 2.1.316 | 2026-11-01 | All six pass. Writes refused and nothing written. `.env` and `.pem` reads refused by the permission rules. `; ls`, redirection and `$(...)` forms did not run. Reads outside the repo (absolute, `../` and home paths) are refused; with the system prompt's own refusal removed, the read guard hook alone still blocked a Read and a Glob outside the repo while an in-repo Read worked. In-repo questions answered. Signed out: the "run `claude` once" message appears. |

| Codex version | Date | Results |
| --- | --- | --- |
| Pending | Pending | Pending: owner to run the six checks. Expect checks 2 and 4 (secret reads, reads outside the repo) and 3 (a chained command) to be allowed by the read-only sandbox. Record what actually happens. |
