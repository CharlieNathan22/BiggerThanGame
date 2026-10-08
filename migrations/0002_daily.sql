-- Migration number: 0002 	 Daily Ranked (ARCHITECTURE.md §10).
--
-- Applied locally by `pnpm db:migrate:local` (and `pnpm dev`), remotely only by
-- the owner with `pnpm db:migrate:remote`. Never edit an applied migration: add
-- the next one.

-- Each game, frozen: built from the game's seed at its midnight (or by its
-- first start) and played from here all day, so a deploy or a deck update
-- never changes a game in progress. Server-only: the rounds hold every figure.
CREATE TABLE daily_games (
  game_no       INTEGER PRIMARY KEY,
  day_key       INTEGER NOT NULL,                     -- YYYYMMDD (UTC): the game's day
  deck_version  TEXT NOT NULL,                        -- the deck it was built from
  rules_version TEXT NOT NULL,                        -- the ramp and rules it was built under
  created_at    INTEGER NOT NULL,                     -- ms since the epoch
  rounds        TEXT NOT NULL                         -- JSON: the twenty and the bonus rounds
);

-- One row per Daily run, made when the run starts (the name is reserved
-- then) and finished when it ends: the score is posted, no submit step.
CREATE TABLE daily_entries (
  id                  TEXT PRIMARY KEY,               -- uuid; the owner script flags by it
  game_no             INTEGER NOT NULL,
  run_key             TEXT NOT NULL UNIQUE,           -- the run id's body, never the signed id
  device_hash         TEXT NOT NULL,                  -- HMAC of a random first-party id
  nickname            TEXT NOT NULL,
  nickname_normalised TEXT NOT NULL,                  -- the moderation skeleton
  country             TEXT CHECK (country IS NULL OR length(country) = 2),
  started_at          INTEGER NOT NULL,               -- ms since the epoch
  finished_at         INTEGER,                        -- null while the run is played
  score               INTEGER CHECK (score IS NULL OR score >= 0),
  correct             INTEGER CHECK (correct IS NULL OR correct BETWEEN 0 AND 20),
  bonus               INTEGER CHECK (bonus IS NULL OR bonus >= 0),
  think_ms            INTEGER CHECK (think_ms IS NULL OR think_ms >= 0), -- the tiebreak
  results             TEXT,                           -- right/wrong per question: "1101…"
  end_reason          TEXT,
  name_flagged        INTEGER NOT NULL DEFAULT 0,     -- shown as "Retired name"
  shadow              INTEGER NOT NULL DEFAULT 0,     -- hidden from everyone but its owner
  shadow_reason       TEXT                            -- the heuristics that fired; never public
);

-- A name is unique within its game; a device plays a game once.
CREATE UNIQUE INDEX idx_daily_name ON daily_entries (game_no, nickname_normalised);
CREATE UNIQUE INDEX idx_daily_device ON daily_entries (game_no, device_hash);
-- The board: a game's finished, public rows, best first.
CREATE INDEX idx_daily_board ON daily_entries (game_no, score DESC, think_ms, finished_at)
  WHERE finished_at IS NOT NULL AND shadow = 0;

-- Counting only: a salted hash of the connection (IPv4, or the IPv6 /64) per
-- run start, salted per game so it can't be linked across days. Used for one
-- number, how many runs of a game came from a connection that had already
-- started one. It never changes a score or who sees it. Kept 48 hours.
CREATE TABLE daily_connections (
  game_no    INTEGER NOT NULL,
  ip_hash    TEXT NOT NULL,
  run_key    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_daily_connections ON daily_connections (game_no, ip_hash);
CREATE INDEX idx_daily_connections_age ON daily_connections (created_at);
