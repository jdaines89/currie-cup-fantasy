/**
 * Pulls fixtures and results from the live feed and upserts them.
 *
 *   npm run ingest              -- every round of the current season
 *   npm run ingest -- 6 7       -- just those rounds
 *
 * Safe to run on a cron: matches are keyed on the provider's own id, so a
 * re-run updates scores rather than duplicating fixtures.
 */
import { getDb, SEASON } from "../src/lib/db";
import { getProvider } from "../src/lib/providers";

const provider = getProvider();
const db = getDb();
const args = process.argv.slice(2).map(Number).filter(Number.isFinite);
const rounds = args.length ? args : Array.from({ length: 14 }, (_, i) => i + 1);

const upsertTeam = db.prepare(`
  INSERT INTO teams (id, name, display_name, short_name, stadium, source)
  VALUES (@id, @name, @name, @short_name, @stadium, @source)
  ON CONFLICT(id) DO UPDATE SET stadium = COALESCE(excluded.stadium, teams.stadium)`);

const upsertMatch = db.prepare(`
  INSERT INTO matches (id, season, round, kickoff_utc, home_team_id, away_team_id,
                       home_score, away_score, venue, status, source, updated_at)
  VALUES (@id, @season, @round, @kickoff_utc, @home_team_id, @away_team_id,
          @home_score, @away_score, @venue, @status, @source, datetime('now'))
  ON CONFLICT(id) DO UPDATE SET
    round = excluded.round, kickoff_utc = excluded.kickoff_utc,
    home_score = excluded.home_score, away_score = excluded.away_score,
    venue = excluded.venue, status = excluded.status, updated_at = datetime('now')`);

async function main() {
  console.log(`Provider: ${provider.name}, season ${SEASON}`);

  const teams = await provider.listTeams();
  db.transaction(() => {
    for (const t of teams) {
      upsertTeam.run({
        id: t.id, name: t.name, short_name: t.name.slice(0, 3).toUpperCase(),
        stadium: t.stadium, source: provider.name,
      });
    }
  })();
  console.log(`  teams: ${teams.length}`);

  // Feeds spell unions differently from the competition ("Blue Bulls" for
  // "Bulls XV"), so resolve by the name we stored against the provider id.
  const byName = new Map(
    (db.prepare(`SELECT id, name FROM teams`).all() as { id: string; name: string }[])
      .map((t) => [t.name.toLowerCase(), t.id]),
  );

  let written = 0;
  let empty = 0;
  for (const round of rounds) {
    const matches = await provider.listRound(SEASON, round);
    if (matches.length === 0) {
      // Two empty rounds in a row means we have run past the end of the season.
      if (++empty >= 2) break;
      continue;
    }
    empty = 0;

    db.transaction(() => {
      for (const m of matches) {
        const home = byName.get(m.home_team_name.toLowerCase());
        const away = byName.get(m.away_team_name.toLowerCase());
        if (!home || !away) {
          console.warn(`  ! round ${round}: unknown union in "${m.home_team_name} v ${m.away_team_name}"`);
          continue;
        }
        upsertMatch.run({
          id: m.id, season: m.season, round: m.round, kickoff_utc: m.kickoff_utc,
          home_team_id: home, away_team_id: away,
          home_score: m.home_score, away_score: m.away_score,
          venue: m.venue, status: m.status, source: provider.name,
        });
        written += 1;
      }
    })();
    console.log(`  round ${round}: ${matches.length}`);
  }

  console.log(`Wrote ${written} matches. Run \`npm run score\` to refresh standings and points.`);
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
