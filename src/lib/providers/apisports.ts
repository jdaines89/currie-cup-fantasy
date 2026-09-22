import type { DataProvider, ProviderMatch, ProviderTeam } from "./types";

/**
 * API-Sports rugby, kept as a second opinion on fixtures and results.
 *
 * Worth knowing before you reach for it: this API has no players endpoint at
 * all -- leagues, teams, standings, games and odds are the whole surface -- so
 * it cannot feed the player fantasy game. It also needs a personal key; the
 * free tier is 100 requests a day.
 */
const LEAGUE_ID = 69; // Currie Cup

export class ApiSportsProvider implements DataProvider {
  readonly name = "apisports";

  constructor(private readonly key = process.env.APISPORTS_KEY ?? "") {
    if (!this.key) {
      throw new Error(
        "APISPORTS_KEY is not set. Leave DATA_PROVIDER unset to use the free " +
        "TheSportsDB provider, which needs no key.",
      );
    }
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`https://v1.rugby.api-sports.io/${path}`, {
      headers: { "x-apisports-key": this.key, accept: "application/json" },
    });
    if (!res.ok) throw new Error(`API-Sports ${path} -> ${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  }

  async listTeams(): Promise<ProviderTeam[]> {
    const body = await this.get<{ response: RawTeam[] }>(`teams?league=${LEAGUE_ID}&season=${new Date().getFullYear()}`);
    return body.response.map((t) => ({ id: String(t.id), name: t.name, stadium: null }));
  }

  async listRound(season: string, round: number): Promise<ProviderMatch[]> {
    const body = await this.get<{ response: RawGame[] }>(
      `games?league=${LEAGUE_ID}&season=${season}&round=${encodeURIComponent(`Regular Season - ${round}`)}`,
    );
    return body.response.map((g) => ({
      id: String(g.id),
      season,
      round,
      kickoff_utc: new Date(g.date).toISOString(),
      home_team_name: g.teams.home.name,
      away_team_name: g.teams.away.name,
      home_score: g.scores.home,
      away_score: g.scores.away,
      venue: null,
      status: g.status.short === "FT" ? "FT" : "SCHEDULED",
    }));
  }
}

interface RawTeam { id: number; name: string }
interface RawGame {
  id: number; date: string;
  teams: { home: { name: string }; away: { name: string } };
  scores: { home: number | null; away: number | null };
  status: { short: string };
}
