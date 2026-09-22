/**
 * Loads the committed snapshot of real 2026 Currie Cup data, so a fresh clone
 * has a working league without touching the network. `npm run ingest` refreshes
 * it from the live feed afterwards.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "../src/lib/db";
import { toPositionGroup } from "../src/lib/positions";
import { priceFor, teamStrengths } from "../src/lib/pricing";
import { buildStandings } from "../src/lib/queries";

interface SeedFile {
  season: string;
  teams: { id: string; name: string; display_name: string; short_name: string; stadium: string; source: string }[];
  matches: {
    id: string; season: string; round: number; kickoff_utc: string;
    home_team_id: string; away_team_id: string;
    home_score: number | null; away_score: number | null;
    venue: string | null; status: string;
  }[];
  /** The real total bonus points per union for a season that has already
   * finished, read off a published table rather than computed -- see
   * `season_bonus_points` in the schema and `standings.ts`. Absent for a
   * season still in progress. */
  published_final_bonus_points?: {
    source: string; as_of: string; points: Record<string, number>;
  };
}

interface RosterFile {
  rosters: { team_id: string; team: string; source: string; as_of: string;
             players: { name: string; position: string }[] }[];
}

const db = getDb();
const seed: SeedFile = JSON.parse(readFileSync(join(process.cwd(), "data/seed/currie-cup-2026.json"), "utf8"));
const rosters: RosterFile = JSON.parse(readFileSync(join(process.cwd(), "data/seed/rosters-2026.json"), "utf8"));

const upsertTeam = db.prepare(`
  INSERT INTO teams (id, name, display_name, short_name, stadium, source)
  VALUES (@id, @name, @display_name, @short_name, @stadium, @source)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name, display_name = excluded.display_name,
    short_name = excluded.short_name, stadium = excluded.stadium`);

const upsertMatch = db.prepare(`
  INSERT INTO matches (id, season, round, kickoff_utc, home_team_id, away_team_id,
                       home_score, away_score, venue, status, source, updated_at)
  VALUES (@id, @season, @round, @kickoff_utc, @home_team_id, @away_team_id,
          @home_score, @away_score, @venue, @status, 'seed', datetime('now'))
  ON CONFLICT(id) DO UPDATE SET
    home_score = excluded.home_score, away_score = excluded.away_score,
    status = excluded.status, venue = excluded.venue, updated_at = datetime('now')`);

db.transaction(() => {
  for (const t of seed.teams) upsertTeam.run(t);
  for (const m of seed.matches) upsertMatch.run(m);
})();

if (seed.published_final_bonus_points) {
  const { source, as_of, points } = seed.published_final_bonus_points;
  const upsertBonus = db.prepare(`
    INSERT INTO season_bonus_points (season, team_id, bonus_points, source, as_of)
    VALUES (@season, @team_id, @bonus_points, @source, @as_of)
    ON CONFLICT(season, team_id) DO UPDATE SET
      bonus_points = excluded.bonus_points, source = excluded.source, as_of = excluded.as_of`);
  db.transaction(() => {
    for (const [team_id, bonus_points] of Object.entries(points)) {
      upsertBonus.run({ season: seed.season, team_id, bonus_points, source, as_of });
    }
  })();
}

// Prices depend on the log, so rosters go in after the results.
const strengths = teamStrengths(new Map(buildStandings(seed.season).map((r) => [r.team_id, r.diff])));

const upsertPlayer = db.prepare(`
  INSERT INTO players (team_id, name, position, position_group, price, source, as_of)
  VALUES (@team_id, @name, @position, @position_group, @price, @source, @as_of)
  ON CONFLICT(team_id, name) DO UPDATE SET
    position = excluded.position, position_group = excluded.position_group,
    price = excluded.price, source = excluded.source, as_of = excluded.as_of`);

let players = 0;
db.transaction(() => {
  for (const roster of rosters.rosters) {
    for (const p of roster.players) {
      const group = toPositionGroup(p.position);
      upsertPlayer.run({
        team_id: roster.team_id, name: p.name, position: p.position,
        position_group: group,
        price: priceFor(group, strengths.get(roster.team_id) ?? 0.5),
        source: roster.source, as_of: roster.as_of,
      });
      players += 1;
    }
  }
})();

console.log(`Seeded ${seed.teams.length} unions, ${seed.matches.length} matches, ${players} players.`);
