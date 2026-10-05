-- Migration number: 0001 	 The leaderboards (ARCHITECTURE.md §10).
--
-- Applied locally by `pnpm db:migrate:local` (and `pnpm dev`), remotely only by
-- the owner with `pnpm db:migrate:remote`. Never edit an applied migration: add
-- the next one.

-- One row per published run. Endless boards read ranges of day_key: a day is
-- one key, an ISO week or a calendar month a range (packages/core periods.ts).
CREATE TABLE scores (
  id                  TEXT PRIMARY KEY,               -- uuid; the owner script flags by it
  mode                TEXT NOT NULL CHECK (mode IN ('endless', 'ranked')),
  day_key             INTEGER NOT NULL,               -- YYYYMMDD (UTC) the run started
  game_no             INTEGER,                        -- Daily Ranked's game; NULL in Endless
  nickname            TEXT NOT NULL,
  nickname_normalised TEXT NOT NULL,                  -- the moderation skeleton
  streak              INTEGER NOT NULL CHECK (streak > 0),
  think_ms            INTEGER NOT NULL CHECK (think_ms >= 0), -- server-measured thinking time; the tiebreak
  country             TEXT CHECK (country IS NULL OR length(country) = 2), -- a flag's code, if shown
  device_hash         TEXT NOT NULL,                  -- HMAC of a random first-party id
  run_id              TEXT NOT NULL UNIQUE,           -- the run key: a run publishes once
  created_at          INTEGER NOT NULL,               -- ms since the epoch
  name_flagged        INTEGER NOT NULL DEFAULT 0,     -- shown as "Retired name"
  shadow              INTEGER NOT NULL DEFAULT 0,     -- hidden from everyone but its owner
  shadow_reason       TEXT                            -- the heuristics that fired; never public
);

-- The board: a period's rows, best first.
CREATE INDEX idx_scores_board ON scores (mode, day_key, streak DESC, think_ms, created_at);
-- A device's own rows, for its best and its rank.
CREATE INDEX idx_scores_device ON scores (mode, device_hash, day_key);
-- The nightly prune.
CREATE INDEX idx_scores_day ON scores (day_key);

-- Daily Ranked, later: a nickname is unique within its game.
CREATE UNIQUE INDEX idx_ranked_name ON scores (game_no, nickname_normalised)
  WHERE mode = 'ranked';

-- Daily Ranked, later: one attempt per device per game.
CREATE TABLE ranked_attempts (
  device_hash TEXT NOT NULL,
  game_no     INTEGER NOT NULL,
  PRIMARY KEY (device_hash, game_no)
);

-- A closed period's top 50, taken by the midnight cron: the "winner" lines.
CREATE TABLE board_snapshots (
  mode       TEXT NOT NULL,
  period     TEXT NOT NULL CHECK (period IN ('day', 'week', 'month')),
  period_key TEXT NOT NULL,                           -- 2026-09-29, 2026-W40, 2026-09
  taken_at   INTEGER NOT NULL,
  total      INTEGER NOT NULL,
  entries    TEXT NOT NULL,                           -- JSON: the public board's entries
  PRIMARY KEY (mode, period, period_key)
);
