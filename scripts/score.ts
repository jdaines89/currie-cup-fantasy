/**
 * Recomputes every entry's points from whatever results and stats are in the
 * database. Idempotent, so run it after any ingest or import.
 */
import { getDb, SEASON } from "../src/lib/db";
import { recomputeEntry } from "../src/lib/recompute";

const db = getDb();
const entries = db.prepare(`SELECT id, team_name FROM entries WHERE season = ?`)
  .all(SEASON) as { id: number; team_name: string }[];

for (const entry of entries) recomputeEntry(entry.id);

const rows = db.prepare(`
  SELECT e.team_name, COALESCE(SUM(s.points), 0) AS total
  FROM entries e LEFT JOIN round_scores s ON s.entry_id = e.id
  WHERE e.season = ? GROUP BY e.id ORDER BY total DESC
`).all(SEASON) as { team_name: string; total: number }[];

console.log(`Rescored ${entries.length} entries.`);
for (const r of rows) console.log(`  ${String(r.total).padStart(7)}  ${r.team_name}`);
