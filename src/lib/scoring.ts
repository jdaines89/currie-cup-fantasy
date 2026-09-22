/**
 * Fantasy scoring rules.
 *
 * Two games share one database:
 *
 *  - Union Pool runs entirely on data the free feed actually gives us -- the
 *    final score of a real match -- so it scores itself with no manual work.
 *  - Player fantasy needs per-player numbers, which no free feed carries for
 *    this competition. It scores whatever stats have been imported.
 */

export interface MatchResult {
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
}

export interface PoolRules {
  win: number;
  draw: number;
  pointsScoredPer: number;    // one fantasy point per N points scored
  pointsConcededPer: number;  // minus one per N points conceded
  bigWinMargin: number;
  bigWinBonus: number;
  narrowLossMargin: number;
  narrowLossBonus: number;
  captainMultiplier: number;
}

export const POOL_RULES: PoolRules = {
  win: 10,
  draw: 5,
  pointsScoredPer: 5,
  pointsConcededPer: 10,
  bigWinMargin: 15,
  bigWinBonus: 5,
  narrowLossMargin: 7,
  narrowLossBonus: 3,
  captainMultiplier: 2,
};

export interface PoolBreakdown {
  result: number;
  attack: number;
  defence: number;
  bonus: number;
  base: number;
  captain: boolean;
  total: number;
}

/** What one union earns its picker from one real result. */
export function scorePoolPick(
  teamId: string,
  match: MatchResult,
  isCaptain: boolean,
  rules: PoolRules = POOL_RULES,
): PoolBreakdown {
  const isHome = match.home_team_id === teamId;
  const isAway = match.away_team_id === teamId;
  if (!isHome && !isAway) throw new Error(`${teamId} did not play in this match`);

  const scored = isHome ? match.home_score : match.away_score;
  const conceded = isHome ? match.away_score : match.home_score;
  const margin = scored - conceded;

  const result = margin > 0 ? rules.win : margin === 0 ? rules.draw : 0;
  const attack = Math.floor(scored / rules.pointsScoredPer);
  const defence = -Math.floor(conceded / rules.pointsConcededPer);

  let bonus = 0;
  if (margin >= rules.bigWinMargin) bonus += rules.bigWinBonus;
  if (margin < 0 && -margin <= rules.narrowLossMargin) bonus += rules.narrowLossBonus;

  const base = result + attack + defence + bonus;
  const total = isCaptain ? base * rules.captainMultiplier : base;
  return { result, attack, defence, bonus, base, captain: isCaptain, total };
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
