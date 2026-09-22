import type { MatchResult } from "./scoring";

export interface LogRow {
  team_id: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  points_for: number;
  points_against: number;
  diff: number;
  /**
   * Competition points, 4/2/0 plus a bonus point for losing by seven or less
   * and one for scoring thirty or more.
   *
   * The real Currie Cup awards its attacking bonus on try count, and no free
   * feed publishes try counts for this competition, so this column is an
   * estimate. Won/drawn/lost and the points columns are exact.
   */
  estimated_points: number;
}

export const LOG_RULES = {
  win: 4,
  draw: 2,
  losingBonusMargin: 7,
  losingBonus: 1,
  attackingBonusThreshold: 30,
  attackingBonus: 1,
} as const;

export function buildLog(teamIds: string[], matches: MatchResult[]): LogRow[] {
  const rows = new Map<string, LogRow>(
    teamIds.map((id) => [id, {
      team_id: id, played: 0, won: 0, drawn: 0, lost: 0,
      points_for: 0, points_against: 0, diff: 0, estimated_points: 0,
    }]),
  );

  for (const m of matches) {
    for (const side of ["home", "away"] as const) {
      const id = side === "home" ? m.home_team_id : m.away_team_id;
      const row = rows.get(id);
      if (!row) continue;

      const scored = side === "home" ? m.home_score : m.away_score;
      const conceded = side === "home" ? m.away_score : m.home_score;
      const margin = scored - conceded;

      row.played += 1;
      row.points_for += scored;
      row.points_against += conceded;

      if (margin > 0) { row.won += 1; row.estimated_points += LOG_RULES.win; }
      else if (margin === 0) { row.drawn += 1; row.estimated_points += LOG_RULES.draw; }
      else {
        row.lost += 1;
        if (-margin <= LOG_RULES.losingBonusMargin) row.estimated_points += LOG_RULES.losingBonus;
      }

      if (scored >= LOG_RULES.attackingBonusThreshold) row.estimated_points += LOG_RULES.attackingBonus;
    }
  }

  for (const row of rows.values()) row.diff = row.points_for - row.points_against;

  // Rank on what the feed gives exactly: wins, then points difference, then
  // points scored. The estimated column is shown but never used to sort.
  return [...rows.values()].sort((a, b) =>
    b.won - a.won || b.diff - a.diff || b.points_for - a.points_for);
}
