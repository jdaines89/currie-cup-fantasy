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
   * Competition points: 4 for a win, 2 for a draw, plus the losing bonus
   * point for losing by seven or less. Every part of this is exact, read
   * straight off the final score.
   *
   * It leaves out the try bonus -- one point for scoring four or more tries
   * in a match -- because no free feed publishes try counts for this
   * competition (confirmed against TheSportsDB's own event lookup, which
   * returns nothing beyond the final score). So this column runs a few
   * points below the real Currie Cup total, more for a side that scored a
   * lot of tries. An earlier version of this file guessed at that bonus from
   * total points scored; that guess was wrong more often than not and is
   * gone. Won/drawn/lost and the points columns to its left are exact.
   */
  estimated_points: number;
}

export const LOG_RULES = {
  win: 4,
  draw: 2,
  losingBonusMargin: 7,
  losingBonus: 1,
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
    }
  }

  for (const row of rows.values()) row.diff = row.points_for - row.points_against;

  // Rank on match points from wins and draws -- 4 and 2, exact, no bonus
  // guesswork -- then points difference, then points scored. A draw has to
  // be weighed against wins here: sorting on win count alone (as this used
  // to) ranks a plain three-win side above a three-win-one-draw side even
  // though the draw earns it more log points, which is wrong. Checked
  // against the published 2026 table: this order matches it exactly, top to
  // bottom, with no bonus points needed at all.
  return [...rows.values()].sort((a, b) =>
    (b.won * LOG_RULES.win + b.drawn * LOG_RULES.draw) -
      (a.won * LOG_RULES.win + a.drawn * LOG_RULES.draw) ||
    b.diff - a.diff || b.points_for - a.points_for);
}
