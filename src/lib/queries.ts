import { getDb, SEASON } from "./db";
import { buildLog, type LogRow } from "./standings";
import type { PositionGroup } from "./positions";

export interface Team {
  id: string;
  name: string;
  display_name: string;
  short_name: string;
  stadium: string | null;
}

export interface Match {
  id: string;
  season: string;
  round: number;
  kickoff_utc: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number | null;
  away_score: number | null;
  venue: string | null;
  status: string;
}

export interface Player {
  id: number;
  team_id: string;
  name: string;
  position: string;
  position_group: PositionGroup;
  price: number;
  source: string;
}

export function listTeams(): Team[] {
  return getDb().prepare(`SELECT id, name, display_name, short_name, stadium
                          FROM teams ORDER BY display_name`).all() as Team[];
}

export function teamsById(): Map<string, Team> {
  return new Map(listTeams().map((t) => [t.id, t]));
}

export function listMatches(season = SEASON): Match[] {
  return getDb().prepare(`SELECT * FROM matches WHERE season = ?
                          ORDER BY round, kickoff_utc`).all(season) as Match[];
}

export function listMatchesForRound(round: number, season = SEASON): Match[] {
  return getDb().prepare(`SELECT * FROM matches WHERE season = ? AND round = ?
                          ORDER BY kickoff_utc`).all(season, round) as Match[];
}

export function listRounds(season = SEASON): number[] {
  const rows = getDb().prepare(`SELECT DISTINCT round FROM matches WHERE season = ?
                                ORDER BY round`).all(season) as { round: number }[];
  return rows.map((r) => r.round);
}

/** The latest round with a finished match: what "current" means everywhere. */
export function latestCompletedRound(season = SEASON): number {
  const row = getDb().prepare(`SELECT MAX(round) AS r FROM matches
                               WHERE season = ? AND status = 'FT'`).get(season) as { r: number | null };
  return row.r ?? 0;
}

export function buildStandings(season = SEASON): LogRow[] {
  const played = listMatches(season).filter(
    (m) => m.home_score !== null && m.away_score !== null,
  );
  const bonusRows = getDb().prepare(
    `SELECT team_id, bonus_points FROM season_bonus_points WHERE season = ?`,
  ).all(season) as { team_id: string; bonus_points: number }[];
  const publishedBonus = bonusRows.length
    ? Object.fromEntries(bonusRows.map((r) => [r.team_id, r.bonus_points]))
    : undefined;

  return buildLog(
    listTeams().map((t) => t.id),
    played.map((m) => ({
      home_team_id: m.home_team_id,
      away_team_id: m.away_team_id,
      home_score: m.home_score as number,
      away_score: m.away_score as number,
    })),
    publishedBonus,
  );
}

export function listPlayers(): Player[] {
  return getDb().prepare(`SELECT id, team_id, name, position, position_group, price, source
                          FROM players ORDER BY price DESC, name`).all() as Player[];
}

export function teamsWithoutRosters(): Team[] {
  return getDb().prepare(`SELECT t.id, t.name, t.display_name, t.short_name, t.stadium
                          FROM teams t
                          LEFT JOIN players p ON p.team_id = t.id
                          WHERE p.id IS NULL
                          ORDER BY t.display_name`).all() as Team[];
}

export function countPlayerStats(): number {
  const row = getDb().prepare(`SELECT COUNT(*) AS n FROM player_match_stats`).get() as { n: number };
  return row.n;
}

export interface Entry { id: number; manager_id: number; season: string; team_name: string; manager: string }

export function listEntries(season = SEASON): Entry[] {
  return getDb().prepare(`SELECT e.id, e.manager_id, e.season, e.team_name, m.name AS manager
                          FROM entries e JOIN managers m ON m.id = e.manager_id
                          WHERE e.season = ? ORDER BY e.team_name`).all(season) as Entry[];
}

/** Creates the manager and their entry the first time, returns it thereafter. */
export function ensureEntry(manager: string, teamName: string, season = SEASON): Entry {
  const db = getDb();
  db.prepare(`INSERT OR IGNORE INTO managers (name, created) VALUES (?, datetime('now'))`).run(manager);
  const m = db.prepare(`SELECT id FROM managers WHERE name = ?`).get(manager) as { id: number };
  db.prepare(`INSERT OR IGNORE INTO entries (manager_id, season, team_name) VALUES (?, ?, ?)`)
    .run(m.id, season, teamName);
  return db.prepare(`SELECT e.id, e.manager_id, e.season, e.team_name, m.name AS manager
                     FROM entries e JOIN managers m ON m.id = e.manager_id
                     WHERE e.manager_id = ? AND e.season = ?`).get(m.id, season) as Entry;
}

export interface LeaderboardRow {
  entry_id: number;
  team_name: string;
  manager: string;
  pool_points: number;
  player_points: number;
  total: number;
}

export function leaderboard(season = SEASON): LeaderboardRow[] {
  return getDb().prepare(`
    SELECT e.id AS entry_id, e.team_name, m.name AS manager,
           COALESCE(SUM(CASE WHEN s.mode = 'pool'   THEN s.points END), 0) AS pool_points,
           COALESCE(SUM(CASE WHEN s.mode = 'player' THEN s.points END), 0) AS player_points,
           COALESCE(SUM(s.points), 0) AS total
    FROM entries e
    JOIN managers m ON m.id = e.manager_id
    LEFT JOIN round_scores s ON s.entry_id = e.id
    WHERE e.season = ?
    GROUP BY e.id
    ORDER BY total DESC, e.team_name
  `).all(season) as LeaderboardRow[];
}

export interface RoundScore { round: number; mode: string; points: number; breakdown: string }

export function scoresForEntry(entryId: number): RoundScore[] {
  return getDb().prepare(`SELECT round, mode, points, breakdown FROM round_scores
                          WHERE entry_id = ? ORDER BY round, mode`).all(entryId) as RoundScore[];
}

export function poolPicks(entryId: number, round: number) {
  return getDb().prepare(`SELECT team_id, is_captain FROM pool_picks
                          WHERE entry_id = ? AND round = ?`).all(entryId, round) as
    { team_id: string; is_captain: number }[];
}

export function squadPicks(entryId: number, round: number) {
  return getDb().prepare(`SELECT player_id, is_captain, is_bench FROM squad_picks
                          WHERE entry_id = ? AND round = ?`).all(entryId, round) as
    { player_id: number; is_captain: number; is_bench: number }[];
}

/**
 * True when every match in the database has been played.
 *
 * The 2026 season finished on 30 August, so a fresh clone is in exactly this
 * state. Rather than show a league nobody can enter, the app drops into replay
 * mode: picks are open on every round and you play the season back to see what
 * your calls would have earned. Ingest a live round and the locks return.
 */
export function seasonComplete(season = SEASON): boolean {
  const row = getDb().prepare(`SELECT COUNT(*) AS n FROM matches
                               WHERE season = ? AND status <> 'FT'`).get(season) as { n: number };
  const total = getDb().prepare(`SELECT COUNT(*) AS n FROM matches WHERE season = ?`)
    .get(season) as { n: number };
  return total.n > 0 && row.n === 0;
}

/** A round locks at its first kickoff, unless the season is being replayed. */
export function roundLocked(round: number, season = SEASON): boolean {
  if (seasonComplete(season)) return false;
  const row = getDb().prepare(`SELECT MIN(kickoff_utc) AS first FROM matches
                               WHERE season = ? AND round = ?`).get(season, round) as { first: string | null };
  if (!row.first) return false;
  return new Date(row.first).getTime() <= Date.now();
}
