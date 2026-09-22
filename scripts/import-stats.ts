/**
 * Loads per-player match numbers from CSV, the gap no free feed fills.
 *
 *   npm run import:stats -- stats/round-7.csv
 *
 * CSV columns: match_id,player,minutes,tries,try_assists,conversions,penalties,
 *              drop_goals,tackles,carries,metres,turnovers_won,yellow_cards,red_cards
 *
 * `player` is the player's name; it is matched within the two unions that
 * played that match, so names only have to be unique inside a squad.
 */
import { readFileSync } from "node:fs";
import { getDb } from "../src/lib/db";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npm run import:stats -- <file.csv>");
  process.exit(1);
}

const db = getDb();

const findPlayer = db.prepare(`
  SELECT p.id FROM players p
  JOIN matches m ON m.id = ?
  WHERE p.team_id IN (m.home_team_id, m.away_team_id)
    AND lower(p.name) = lower(?)`);

const upsert = db.prepare(`
  INSERT INTO player_match_stats (
    player_id, match_id, minutes, tries, try_assists, conversions, penalties,
    drop_goals, tackles, carries, metres, turnovers_won, yellow_cards, red_cards, source)
  VALUES (@player_id, @match_id, @minutes, @tries, @try_assists, @conversions, @penalties,
          @drop_goals, @tackles, @carries, @metres, @turnovers_won, @yellow_cards, @red_cards, @source)
  ON CONFLICT(player_id, match_id) DO UPDATE SET
    minutes = excluded.minutes, tries = excluded.tries, try_assists = excluded.try_assists,
    conversions = excluded.conversions, penalties = excluded.penalties,
    drop_goals = excluded.drop_goals, tackles = excluded.tackles, carries = excluded.carries,
    metres = excluded.metres, turnovers_won = excluded.turnovers_won,
    yellow_cards = excluded.yellow_cards, red_cards = excluded.red_cards, source = excluded.source`);

const rows = parseCsv(readFileSync(file, "utf8"));
let imported = 0;
const missing: string[] = [];

db.transaction(() => {
  for (const row of rows) {
    const matchId = (row.match_id ?? "").trim();
    const name = (row.player ?? "").trim();
    const found = findPlayer.get(matchId, name) as { id: number } | undefined;
    if (!found) { missing.push(`${name} (match ${matchId})`); continue; }
    upsert.run({
      player_id: found.id, match_id: matchId, source: file,
      minutes: num(row.minutes), tries: num(row.tries), try_assists: num(row.try_assists),
      conversions: num(row.conversions), penalties: num(row.penalties),
      drop_goals: num(row.drop_goals), tackles: num(row.tackles), carries: num(row.carries),
      metres: num(row.metres), turnovers_won: num(row.turnovers_won),
      yellow_cards: num(row.yellow_cards), red_cards: num(row.red_cards),
    });
    imported += 1;
  }
})();

console.log(`Imported ${imported} stat lines from ${file}.`);
if (missing.length) {
  console.warn(`Could not place ${missing.length} rows -- check the spelling or import the roster first:`);
  for (const m of missing.slice(0, 10)) console.warn(`  ${m}`);
}

function num(v: string | undefined): number {
  const n = Number((v ?? "").trim());
  return Number.isFinite(n) ? n : 0;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]));
  });
}
