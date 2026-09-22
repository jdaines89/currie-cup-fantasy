import { getDb, SEASON } from "./db";
import { round2, scorePlayer, scorePoolPick, type PlayerStatLine } from "./scoring";

/**
 * Rescores one entry across every round. Cheap enough to run on every save,
 * which keeps the leaderboard honest without a separate job.
 * `npm run score` does the same thing for every entry from the command line.
 */
export function recomputeEntry(entryId: number): void {
  const db = getDb();
  const rounds = (db.prepare(`SELECT DISTINCT round FROM matches WHERE season = ? ORDER BY round`)
    .all(SEASON) as { round: number }[]).map((r) => r.round);

  const matchFor = db.prepare(`
    SELECT home_team_id, away_team_id, home_score, away_score FROM matches
    WHERE season = ? AND round = ? AND status = 'FT'
      AND (home_team_id = ? OR away_team_id = ?)`);

  const statsFor = db.prepare(`
    SELECT s.*, p.team_id, m.home_team_id, m.home_score, m.away_score
    FROM player_match_stats s
    JOIN players p ON p.id = s.player_id
    JOIN matches m ON m.id = s.match_id
    WHERE s.player_id = ? AND m.season = ? AND m.round = ? AND m.status = 'FT'`);

  const write = db.prepare(`
    INSERT INTO round_scores (entry_id, round, mode, points, breakdown)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(entry_id, round, mode) DO UPDATE SET
      points = excluded.points, breakdown = excluded.breakdown`);

  db.transaction(() => {
    db.prepare(`DELETE FROM round_scores WHERE entry_id = ?`).run(entryId);

    for (const round of rounds) {
      const picks = db.prepare(`SELECT team_id, is_captain FROM pool_picks
                                WHERE entry_id = ? AND round = ?`)
        .all(entryId, round) as { team_id: string; is_captain: number }[];

      if (picks.length) {
        const lines: unknown[] = [];
        let total = 0;
        for (const pick of picks) {
          const match = matchFor.get(SEASON, round, pick.team_id, pick.team_id) as
            { home_team_id: string; away_team_id: string; home_score: number; away_score: number } | undefined;
          if (!match) continue;
          const b = scorePoolPick(pick.team_id, match, pick.is_captain === 1);
          total += b.total;
          lines.push({ team_id: pick.team_id, ...b });
        }
        write.run(entryId, round, "pool", round2(total), JSON.stringify(lines));
      }

      const squad = db.prepare(`SELECT player_id, is_captain FROM squad_picks
                                WHERE entry_id = ? AND round = ? AND is_bench = 0`)
        .all(entryId, round) as { player_id: number; is_captain: number }[];

      if (squad.length) {
        const lines: unknown[] = [];
        let total = 0;
        for (const pick of squad) {
          const row = statsFor.get(pick.player_id, SEASON, round) as
            (PlayerStatLine & { team_id: string; home_team_id: string; home_score: number; away_score: number }) | undefined;
          if (!row) continue;
          const teamWon = row.team_id === row.home_team_id
            ? row.home_score > row.away_score
            : row.away_score > row.home_score;
          const b = scorePlayer(row, teamWon, pick.is_captain === 1);
          total += b.total;
          lines.push({ player_id: pick.player_id, ...b });
        }
        write.run(entryId, round, "player", round2(total), JSON.stringify(lines));
      }
    }
  })();
}
