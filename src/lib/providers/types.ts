export interface ProviderTeam {
  id: string;
  name: string;
  stadium: string | null;
}

export interface ProviderMatch {
  id: string;
  season: string;
  round: number;
  kickoff_utc: string;
  home_team_name: string;
  away_team_name: string;
  home_score: number | null;
  away_score: number | null;
  venue: string | null;
  status: string;
}

/**
 * What a data source has to be able to do. Fixtures and results are the whole
 * contract, because that is all any free rugby feed reliably gives us for the
 * Currie Cup. Rosters and per-player stats come in through the import scripts.
 */
export interface DataProvider {
  readonly name: string;
  listTeams(): Promise<ProviderTeam[]>;
  listRound(season: string, round: number): Promise<ProviderMatch[]>;
}
