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
   * Competition points: 4 for a win, 2 for a draw, plus every bonus point.
   *
   * When `publishedBonus` has an entry for this union, that bonus is the
   * real published total for the whole season -- including the try bonus,
   * one point for scoring four or more tries in a match -- and this column
   * is exact throughout. See `points_exact`.
   *
   * Without one, this falls back to 4/2 plus the losing bonus for losing by
   * seven or less, which is exact as far as it goes but leaves out the try
   * bonus: no free feed publishes try counts for this competition (checked
   * directly against TheSportsDB's own event lookup, which returns nothing
   * beyond the final score). That version runs a few points below the real
   * total, more for a side that scored a lot of tries.
   */
  estimated_points: number;
  /** Whether `estimated_points` is the real total (from `publishedBonus`) or the partial fallback. */
  points_exact: boolean;
}

export const LOG_RULES = {
  win: 4,
  draw: 2,
  losingBonusMargin: 7,
  losingBonus: 1,
} as const;

export function buildLog(
  teamIds: string[],
  matches: MatchResult[],
  /**
   * The real total bonus points a union earned over a *finished* season,
   * read from a published table rather than computed -- see
   * `data/seed/currie-cup-2026.json` and `season_bonus_points` in the
   * schema. Omit it for a season still in progress, where no such table
   * exists yet.
   */
  publishedBonus?: Record<string, number>,
): LogRow[] {
  const rows = new Map<string, LogRow>(
    teamIds.map((id) => [id, {
      team_id: id, played: 0, won: 0, drawn: 0, lost: 0,
      points_for: 0, points_against: 0, diff: 0,
      estimated_points: 0, points_exact: false,
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

  for (const row of rows.values()) {
    row.diff = row.points_for - row.points_against;

    const published = publishedBonus?.[row.team_id];
    if (published !== undefined) {
      // Swap the partial losing-bonus guess for the real published total.
      row.estimated_points = row.won * LOG_RULES.win + row.drawn * LOG_RULES.draw + published;
      row.points_exact = true;
    }
  }

  // Rank on the points column above when it's exact for every union in the
  // table; otherwise fall back to match points from wins and draws alone --
  // exact, no bonus guesswork -- then points difference, then points
  // scored. A draw has to be weighed against wins either way: sorting on
  // win count alone ranks a plain three-win side above a
  // three-win-one-draw side even though the draw earns it more log points,
  // which is wrong. Checked against the published 2026 table: both of
  // these orderings match it exactly, top to bottom.
  const allExact = [...rows.values()].every((r) => r.points_exact);
  return [...rows.values()].sort((a, b) =>
    (allExact
      ? b.estimated_points - a.estimated_points
      : (b.won * LOG_RULES.win + b.drawn * LOG_RULES.draw) -
        (a.won * LOG_RULES.win + a.drawn * LOG_RULES.draw)) ||
    b.diff - a.diff || b.points_for - a.points_for);
}
