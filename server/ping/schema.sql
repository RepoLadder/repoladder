-- Daily tallies of runs. `error` is '' on success (SQLite treats NULLs as distinct in a key).
CREATE TABLE IF NOT EXISTS runs (
  day TEXT NOT NULL,
  version TEXT NOT NULL,
  ok INTEGER NOT NULL,
  error TEXT NOT NULL,
  size TEXT NOT NULL,
  mode TEXT NOT NULL,
  n INTEGER NOT NULL,
  seconds_total INTEGER NOT NULL,
  PRIMARY KEY (day, version, ok, error, size, mode)
);

-- One row per random install id: how many installs ran it, and how many came back.
CREATE TABLE IF NOT EXISTS installs (
  id TEXT PRIMARY KEY,
  first_day TEXT NOT NULL,
  last_day TEXT NOT NULL,
  runs INTEGER NOT NULL
);
