-- Currie Cup Fantasy schema.
-- Plain SQLite. Every table that mirrors an upstream feed keeps `source` and
-- `source_id` so a re-ingest is an UPSERT, never a duplicate.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS teams (
  id           TEXT PRIMARY KEY,          -- provider id, e.g. TheSportsDB idTeam
  name         TEXT NOT NULL UNIQUE,      -- name as the feed spells it
  display_name TEXT NOT NULL,             -- name as the competition spells it in 2026
  short_name   TEXT NOT NULL,
  stadium      TEXT,
  source       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS matches (
  id            TEXT PRIMARY KEY,         -- provider id
  season        TEXT NOT NULL,
  round         INTEGER NOT NULL,
  kickoff_utc   TEXT NOT NULL,            -- ISO 8601
  home_team_id  TEXT NOT NULL REFERENCES teams(id),
  away_team_id  TEXT NOT NULL REFERENCES teams(id),
  home_score    INTEGER,                  -- NULL until played
  away_score    INTEGER,
  venue         TEXT,
  status        TEXT NOT NULL,            -- SCHEDULED | FT | INTR | POSTP
  source        TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS matches_season_round ON matches(season, round);

CREATE TABLE IF NOT EXISTS players (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id        TEXT NOT NULL REFERENCES teams(id),
  name           TEXT NOT NULL,
  position       TEXT NOT NULL,           -- as published by the union
  position_group TEXT NOT NULL,           -- FRONT_ROW | LOCK | LOOSE | HALVES | CENTRE | BACK_THREE
  price          REAL NOT NULL,           -- fantasy credits
  source         TEXT NOT NULL,           -- where the roster came from
  as_of          TEXT NOT NULL,           -- when that roster was read
  UNIQUE (team_id, name)
);

-- Per-player, per-match numbers. No free feed carries these for the Currie Cup,
-- so they arrive via `npm run import:stats` or the /admin screen.
CREATE TABLE IF NOT EXISTS player_match_stats (
  player_id     INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  match_id      TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  minutes       INTEGER NOT NULL DEFAULT 0,
  tries         INTEGER NOT NULL DEFAULT 0,
  try_assists   INTEGER NOT NULL DEFAULT 0,
  conversions   INTEGER NOT NULL DEFAULT 0,
  penalties     INTEGER NOT NULL DEFAULT 0,
  drop_goals    INTEGER NOT NULL DEFAULT 0,
  tackles       INTEGER NOT NULL DEFAULT 0,
  carries       INTEGER NOT NULL DEFAULT 0,
  metres        INTEGER NOT NULL DEFAULT 0,
  turnovers_won INTEGER NOT NULL DEFAULT 0,
  yellow_cards  INTEGER NOT NULL DEFAULT 0,
  red_cards     INTEGER NOT NULL DEFAULT 0,
  source        TEXT NOT NULL,
  PRIMARY KEY (player_id, match_id)
);

CREATE TABLE IF NOT EXISTS managers (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  name    TEXT NOT NULL UNIQUE,
  created TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  manager_id INTEGER NOT NULL REFERENCES managers(id) ON DELETE CASCADE,
  season     TEXT NOT NULL,
  team_name  TEXT NOT NULL,
  UNIQUE (manager_id, season)
);

-- Union Pool: pick unions for a round. Scores itself from real results.
CREATE TABLE IF NOT EXISTS pool_picks (
  entry_id   INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  round      INTEGER NOT NULL,
  team_id    TEXT NOT NULL REFERENCES teams(id),
  is_captain INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (entry_id, round, team_id)
);

-- Player fantasy: a salary-capped squad per round.
CREATE TABLE IF NOT EXISTS squad_picks (
  entry_id   INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  round      INTEGER NOT NULL,
  player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  is_captain INTEGER NOT NULL DEFAULT 0,
  is_bench   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (entry_id, round, player_id)
);

-- The real total bonus points a union earned over a completed season --
-- everything past plain win/draw points, including the try bonus, which no
-- free feed carries per match. Populated only for a season that has
-- actually finished and been checked against a published table (see
-- data/seed/currie-cup-2026.json), never computed from match data. A season
-- without a row here just doesn't get one, and the log's points column
-- falls back to the exact win/draw/losing-bonus figure -- see
-- src/lib/standings.ts.
CREATE TABLE IF NOT EXISTS season_bonus_points (
  season       TEXT NOT NULL,
  team_id      TEXT NOT NULL REFERENCES teams(id),
  bonus_points INTEGER NOT NULL,
  source       TEXT NOT NULL,
  as_of        TEXT NOT NULL,
  PRIMARY KEY (season, team_id)
);

-- Computed by `npm run score`. Never hand-edited.
CREATE TABLE IF NOT EXISTS round_scores (
  entry_id   INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  round      INTEGER NOT NULL,
  mode       TEXT NOT NULL,               -- pool | player
  points     REAL NOT NULL,
  breakdown  TEXT NOT NULL,               -- JSON, so the UI can explain a score
  PRIMARY KEY (entry_id, round, mode)
);
