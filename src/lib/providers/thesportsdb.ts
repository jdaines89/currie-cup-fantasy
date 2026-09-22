import type { DataProvider, ProviderMatch, ProviderTeam } from "./types";

/**
 * TheSportsDB, free tier.
 *
 * Key "3" is their documented public test key: no account, no card, no cost.
 * Set THESPORTSDB_KEY if you ever take out a Patreon key of your own.
 *
 * Currie Cup is league 5069. The season endpoint truncates on the free key, so
 * we walk rounds instead -- eight teams means four matches a round.
 */
const LEAGUE_ID = "5069";

export class TheSportsDbProvider implements DataProvider {
  readonly name = "thesportsdb";
  private readonly base: string;

  constructor(key = process.env.THESPORTSDB_KEY ?? "3") {
    this.base = `https://www.thesportsdb.com/api/v1/json/${key}`;
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.base}/${path}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`TheSportsDB ${path} -> ${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  }

  async listTeams(): Promise<ProviderTeam[]> {
    const body = await this.get<{ teams: RawTeam[] | null }>(
      "search_all_teams.php?l=Currie%20Cup",
    );
    return (body.teams ?? []).map((t) => ({
      id: t.idTeam,
      name: t.strTeam,
      stadium: t.strStadium ?? null,
    }));
  }

  async listRound(season: string, round: number): Promise<ProviderMatch[]> {
    const body = await this.get<{ events: RawEvent[] | null }>(
      `eventsround.php?id=${LEAGUE_ID}&r=${round}&s=${season}`,
    );
    return (body.events ?? []).map((e) => ({
      id: e.idEvent,
      season,
      round,
      kickoff_utc: `${e.dateEvent}T${e.strTime || "00:00:00"}Z`,
      home_team_name: e.strHomeTeam,
      away_team_name: e.strAwayTeam,
      home_score: toScore(e.intHomeScore),
      away_score: toScore(e.intAwayScore),
      venue: e.strVenue || null,
      status: e.strStatus || (e.intHomeScore ? "FT" : "SCHEDULED"),
    }));
  }
}

function toScore(raw: string | null): number | null {
  if (raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

interface RawTeam { idTeam: string; strTeam: string; strStadium?: string }
interface RawEvent {
  idEvent: string; dateEvent: string; strTime: string;
  strHomeTeam: string; strAwayTeam: string;
  intHomeScore: string | null; intAwayScore: string | null;
  strVenue: string; strStatus: string;
}
