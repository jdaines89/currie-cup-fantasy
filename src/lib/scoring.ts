/**
 * Fantasy scoring rules.
 *
 * Two games share one database:
 *
 *  - Score predictions run entirely on data the free feed actually gives us
 *    -- the final score of a real match -- so they score themselves.
 *  - Player fantasy needs per-player numbers, which no free feed carries for
 *    this competition. It scores whatever stats have been imported.
 */

export interface MatchResult {
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
}

export const PREDICTION_RULES = {
  result: 6,        // called the winner (or the draw)
  margin: 5,        // and the exact winning margin
  nearSide: 2,      // per side within nearWithin points of the real score
  nearWithin: 3,
  exact: 5,         // the exact scoreline
  banker: 2,        // one match a round, backed to count double
};

export interface PredictionBreakdown {
  result: number;
  margin: number;
  near: number;
  exact: number;
  base: number;
  banker: boolean;
  total: number;
}

/** What one scoreline call earns against the real result. Mirrors the
 *  prediction_scores view in supabase/migrations. */
export function scorePrediction(
  pred: { home_score: number; away_score: number },
  match: MatchResult,
  isBanker: boolean,
  rules = PREDICTION_RULES,
): PredictionBreakdown {
  const rightResult = Math.sign(pred.home_score - pred.away_score) === Math.sign(match.home_score - match.away_score);
  const result = rightResult ? rules.result : 0;
  const margin = rightResult && pred.home_score - pred.away_score === match.home_score - match.away_score ? rules.margin : 0;
  const near = (Math.abs(pred.home_score - match.home_score) <= rules.nearWithin ? rules.nearSide : 0)
             + (Math.abs(pred.away_score - match.away_score) <= rules.nearWithin ? rules.nearSide : 0);
  const exact = pred.home_score === match.home_score && pred.away_score === match.away_score ? rules.exact : 0;
  const base = result + margin + near + exact;
  return { result, margin, near, exact, base, banker: isBanker, total: isBanker ? base * rules.banker : base };
}

export interface PlayerStatLine {
  minutes: number;
  tries: number;
  try_assists: number;
  conversions: number;
  penalties: number;
  drop_goals: number;
  tackles: number;
  carries: number;
  metres: number;
  turnovers_won: number;
  yellow_cards: number;
  red_cards: number;
}

export const PLAYER_RULES = {
  appearance: 1,
  fullGame: 2,        // on top of the appearance point, from 40 minutes
  fullGameMinutes: 40,
  try: 5,
  tryAssist: 3,
  conversion: 2,
  penalty: 3,
  dropGoal: 3,
  perTackle: 0.1,
  perCarry: 0.1,
  perMetre: 0.02,
  turnoverWon: 2,
  yellowCard: -2,
  redCard: -5,
  teamWin: 2,
  captainMultiplier: 2,
} as const;

export interface PlayerBreakdown {
  appearance: number;
  scoring: number;
  work: number;
  discipline: number;
  teamResult: number;
  base: number;
  captain: boolean;
  total: number;
}

export function scorePlayer(
  stats: PlayerStatLine,
  teamWon: boolean,
  isCaptain: boolean,
  r = PLAYER_RULES,
): PlayerBreakdown {
  if (stats.minutes <= 0) {
    // Did not take the field: nothing, not even the captain's double.
    return { appearance: 0, scoring: 0, work: 0, discipline: 0, teamResult: 0, base: 0, captain: isCaptain, total: 0 };
  }

  const appearance = r.appearance + (stats.minutes >= r.fullGameMinutes ? r.fullGame : 0);

  const scoring =
    stats.tries * r.try +
    stats.try_assists * r.tryAssist +
    stats.conversions * r.conversion +
    stats.penalties * r.penalty +
    stats.drop_goals * r.dropGoal;

  const work =
    stats.tackles * r.perTackle +
    stats.carries * r.perCarry +
    stats.metres * r.perMetre +
    stats.turnovers_won * r.turnoverWon;

  const discipline = stats.yellow_cards * r.yellowCard + stats.red_cards * r.redCard;
  const teamResult = teamWon ? r.teamWin : 0;

  const base = round2(appearance + scoring + work + discipline + teamResult);
  const total = round2(isCaptain ? base * r.captainMultiplier : base);
  return { appearance, scoring: round2(scoring), work: round2(work), discipline, teamResult, base, captain: isCaptain, total };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
