/**
 * Loads a squad from CSV. No free sports API publishes Currie Cup rosters, so
 * this and the /admin screen are how players get in.
 *
 *   npm run import:roster -- squads/lions.csv
 *
 * CSV columns: team,name,position
 * `team` matches either the feed name ("Golden Lions") or the 2026 name ("Lions").
 */
import { readFileSync } from "node:fs";
import { getDb } from "../src/lib/db";
import { toPositionGroup } from "../src/lib/positions";
import { priceFor, teamStrengths } from "../src/lib/pricing";
import { buildStandings } from "../src/lib/queries";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npm run import:roster -- <file.csv>   (columns: team,name,position)");
  process.exit(1);
}

const db = getDb();
const teams = db.prepare(`SELECT id, name, display_name FROM teams`).all() as
  { id: string; name: string; display_name: string }[];
const byName = new Map<string, string>();
for (const t of teams) {
  byName.set(t.name.toLowerCase(), t.id);
  byName.set(t.display_name.toLowerCase(), t.id);
}

const strengths = teamStrengths(new Map(buildStandings().map((r) => [r.team_id, r.diff])));

const upsert = db.prepare(`
  INSERT INTO players (team_id, name, position, position_group, price, source, as_of)
  VALUES (@team_id, @name, @position, @position_group, @price, @source, date('now'))
  ON CONFLICT(team_id, name) DO UPDATE SET
    position = excluded.position, position_group = excluded.position_group,
    price = excluded.price, source = excluded.source, as_of = date('now')`);

const rows = parseCsv(readFileSync(file, "utf8"));
let imported = 0;
const unknown = new Set<string>();

db.transaction(() => {
  for (const row of rows) {
    const teamId = byName.get((row.team ?? "").trim().toLowerCase());
    if (!teamId) { unknown.add(row.team ?? ""); continue; }
    const group = toPositionGroup(row.position ?? "");
    upsert.run({
      team_id: teamId, name: (row.name ?? "").trim(), position: (row.position ?? "").trim(),
      position_group: group, price: priceFor(group, strengths.get(teamId) ?? 0.5),
      source: file,
    });
    imported += 1;
  }
})();

console.log(`Imported ${imported} players from ${file}.`);
if (unknown.size) console.warn(`Skipped unknown unions: ${[...unknown].join(", ")}`);

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = splitLine(lines[0]).map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = splitLine(line);
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]));
  });
}

/** Enough CSV for a squad list: quoted cells, doubled quotes, commas inside. */
function splitLine(line: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { out.push(cell); cell = ""; }
    else cell += c;
  }
  out.push(cell);
  return out;
}
