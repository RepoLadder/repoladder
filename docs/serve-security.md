# Serve and Ask: threat model

`repoladder serve` hosts the built map on `127.0.0.1` and, while it runs, answers questions with the user's own Claude Code. Plain-language summary: [PRIVACY.md](../PRIVACY.md). Report problems as described in [SECURITY.md](../SECURITY.md).

| Attacker or mistake | Vector | Control | Proved by |
| --- | --- | --- | --- |
| Another website | A page the user has open calls `http://127.0.0.1:<port>` | Token on every route; a foreign or `null` `Origin` and `Sec-Fetch-Site` of cross-site or same-site are refused 403; no CORS headers ever | `test/serve-security.test.ts`, `test/serveguard.test.ts` |
| DNS rebinding | A hostile name resolves to 127.0.0.1 | Only `127.0.0.1:<port>` and `localhost:<port>` are accepted as `Host` | `test/serve-security.test.ts`, `test/serve.test.ts` |
| Another machine or local user | Connects to the port | Loopback-only listener and remote-address check; without the per-run token every route is 401 | `test/serve-security.test.ts`, `test/serve.test.ts` |
| Malicious repo | Its own Claude settings or hooks | `--setting-sources user`: the repo's settings are never loaded | `test/serve-security.test.ts` |
| Prompt injection from repo contents | Text in a file steers the agent | Tools limited to Read, Grep, Glob and one `repoladder query` command; no writes, no web, `dontAsk` | `test/serve-security.test.ts`, `test/askargv.test.ts` |
| Secrets in the repo | The agent reads `.env`, keys, `.ssh` | Read deny list in both the flags and the settings; the child's environment holds only allowlisted names | `test/serve-security.test.ts` |
| Hostile question text | Flag or shell injection through the question | Argv array, no shell; the question is always the last single argument | `test/serve-security.test.ts` |
| Oversized or flooding requests | Huge body or question, many asks, slow headers | 2,000 characters, 16 KB body (chunked included), one ask at a time (429), header and request timeouts | `test/serve-security.test.ts` |
| Runaway turns | Endless or tool-hungry answer | Wall-clock timeout and a 25-tool-call cap | `test/ask.test.ts`, `test/serve-security.test.ts` |
| Process leftovers | A shell the agent started outlives the turn | The child leads its own process group and the group is killed on timeout, disconnect, tool cap and server close (POSIX) | `test/serve-security.test.ts` |
| Log leakage | Question or token in terminal output | Neither is logged; the token appears only in the `SERVE_OK` line | `test/serve-security.test.ts` |
| Information leaks in errors | Stack traces or paths in responses | Any unexpected error is a generic 500 | `test/serve-security.test.ts` |
| Network code creeping in | A new import or global that calls out | Only `src/serve/`, `src/usage.ts` and `src/cli.ts` may reach the network; the published page uses no network globals | `test/no-network.test.ts` |

Known limits: on Windows the child's own process is killed but not its tree. The token is briefly visible in the process list while the browser opener starts (use `--no-open`). Claude Code's permission engine does the actual enforcing; the tests prove what RepoLadder passes it.

## Verified by hand

Not yet recorded. Someone signed in to the real Claude Code CLI runs this once, then writes the Claude Code version, date and results here:

1. Ask it to write or edit a file: refused.
2. Ask it to read `.env` and a `.pem` file: refused.
3. Ask it to run `repoladder query ... ; ls`: refused.
4. Ask it to read a path outside the repo: refused.
5. Ask an ordinary in-repo question: it reads files and answers.
6. Sign out and ask: the signed-out message appears.

| Claude Code version | Date | Results |
| --- | --- | --- |
| | | |
