# Usage ping endpoint

A Cloudflare Worker that counts the opt-in usage pings described in [PRIVACY.md](../../PRIVACY.md). It checks each POST against the fixed payload shape (`worker.ts` `parseRun`), rejects anything else, and adds one to a daily tally in a D1 (SQLite) database. It stores no IP addresses, headers or request logs (`observability` is off in `wrangler.toml`).

The CLI's default `PING_URL` (`src/usage.ts`) is `https://ping.repoladder.com/`. Until the worker is deployed there, pings fail silently within 1.5 s.

## Deploy (owner, once)

You need a Cloudflare account (the free plan covers it, RepoLadder/web#4) where `repoladder.com`'s DNS is on Cloudflare.

```bash
cd server/ping
npx wrangler login                                  # opens the browser
npx wrangler d1 create repoladder-ping                # prints a database_id
# paste that id into wrangler.toml (database_id) and commit it: the id isn't a secret
npx wrangler d1 execute repoladder-ping --remote --file schema.sql
npx wrangler deploy                                 # attaches ping.repoladder.com from `routes` and creates its DNS record
```

### If repoladder.com's DNS isn't on Cloudflare (fallback)

1. In `wrangler.toml`, set `workers_dev = true` and remove `routes`.
2. Deploy. It prints `https://repoladder-ping.<you>.workers.dev`.
3. Open a PR that sets `PING_URL` in `src/usage.ts` to that URL, and update the endpoint line in `PRIVACY.md`.
4. Update the URL test in `test/usage.test.ts`.

### Smoke test

A valid ping gets `204`, anything else `400`, and a GET `405`:

```bash
curl -i -X POST https://ping.repoladder.com/ \
  -H 'content-type: application/json' \
  -d '{"v":1,"version":"smoke-test","ok":true,"error":null,"size":"1-49","seconds":12,"mode":"default","id":"00000000-0000-4000-8000-000000000000"}'
```

Then clean up in the D1 console (the version and id above make this exact):

```sql
DELETE FROM runs WHERE version = 'smoke-test';
DELETE FROM installs WHERE id = '00000000-0000-4000-8000-000000000000';
```

### End-to-end check

1. Do one real `/map` run with usage on (`node <plugin>/dist/repoladder.mjs usage yes`).
2. In the D1 console, check that a new `runs` row for today and an `installs` row with the `id` from `~/.config/repoladder/usage.json` appear.
3. Optionally remove your own row: `DELETE FROM installs WHERE id = '<that id>'`. Then lower that day's matching `runs` row by one, or leave it; it's one run.

### Developer note

Set `REPOLADDER_NO_USAGE=1` in your shell so your own dev builds aren't counted. `npm run gallery` and `installcheck` already set it.

To try the worker from a CLI run before anyone depends on it, set `REPOLADDER_PING_URL` for one run: `REPOLADDER_PING_URL=https://… node src/cli.ts build <repo>` (the stored answer must still be yes: `node src/cli.ts usage yes`).

## Read the numbers

Open the Cloudflare dashboard → Storage & Databases → D1 → `repoladder-ping` → Console, and paste a query from the block below. Or run one with `npx wrangler d1 execute repoladder-ping --remote --command "<sql>"`.

```sql
-- Runs and success rate per day
SELECT day, SUM(n) AS runs, SUM(n * ok) AS ok, ROUND(100.0 * SUM(n * ok) / SUM(n), 1) AS ok_pct FROM runs GROUP BY day ORDER BY day DESC;
-- Totals, all time
SELECT SUM(n) AS runs, ROUND(100.0 * SUM(n * ok) / SUM(n), 1) AS ok_pct FROM runs;
-- Distinct installs that ran it
SELECT COUNT(*) AS installs FROM installs;
-- New installs per day
SELECT first_day AS day, COUNT(*) AS new_installs FROM installs GROUP BY first_day ORDER BY day DESC;
-- Installs that came back on a later day
SELECT COUNT(*) AS repeat_installs FROM installs WHERE last_day > first_day;
-- Most common errors
SELECT error, SUM(n) AS runs FROM runs WHERE ok = 0 GROUP BY error ORDER BY runs DESC;
-- Runs and average time by repo size and mode
SELECT size, mode, SUM(n) AS runs, SUM(seconds_total) / SUM(n) AS avg_s FROM runs GROUP BY size, mode ORDER BY size, mode;
-- Versions in use, last 7 days
SELECT version, SUM(n) AS runs FROM runs WHERE day >= date('now', '-7 days') GROUP BY version ORDER BY runs DESC;
```

### What the numbers can't tell



- Counts are a **lower bound**: only people who said yes, minus offline or failed pings (1.5 s timeout, failures dropped).
- **Installs** come from GitHub traffic on the marketplace repo, not from here: an install that never runs `/map`, or says no, is invisible.
- "Ran it on **their own repo**" versus a demo repo can't be told apart. The ping never names a repo, so only `size` hints at it.
- **Sharing** isn't in the ping. It comes from the viewer's "Made with" link (site analytics).
- One install id is one config dir, not one person: a second machine, or a reinstall after `usage no`, counts as a new install.

## Retention

Rows are kept indefinitely, and there is no deletion job.

## Files
- `worker.ts`: the Worker (validation and counting).
- `schema.sql`: the two tables (`runs`: daily tallies; `installs`: one row per random install id).
- `wrangler.toml`: Worker and D1 config.

Tests: `test/usage.test.ts` runs the worker against a fake database. `test/pingstore.test.ts` runs the real worker and schema on `node:sqlite`, end to end through the CLI.
