"use server";

import { revalidatePath } from "next/cache";
import { getDb, SEASON } from "./db";
import { ensureEntry, roundLocked } from "./queries";
import { recomputeEntry } from "./recompute";

export async function createEntry(formData: FormData) {
  const manager = String(formData.get("manager") ?? "").trim();
  const teamName = String(formData.get("team_name") ?? "").trim();
  if (!manager || !teamName) return;
  const entry = ensureEntry(manager, teamName);
  recomputeEntry(entry.id);
  revalidatePath("/", "layout");
}

export async function savePoolPicks(formData: FormData) {
  const entryId = Number(formData.get("entry_id"));
  const round = Number(formData.get("round"));
  if (!entryId || !round || roundLocked(round)) return;

  const teamIds = formData.getAll("team").map(String);
  const captain = String(formData.get("captain") ?? "");
  const db = getDb();

  db.transaction(() => {
    db.prepare(`DELETE FROM pool_picks WHERE entry_id = ? AND round = ?`).run(entryId, round);
    const ins = db.prepare(`INSERT INTO pool_picks (entry_id, round, team_id, is_captain)
                            VALUES (?, ?, ?, ?)`);
    for (const id of teamIds) ins.run(entryId, round, id, id === captain ? 1 : 0);
  })();

  recomputeEntry(entryId);
  revalidatePath("/pool");
  revalidatePath("/leaderboard");
  revalidatePath("/");
}

export async function saveSquadPicks(formData: FormData) {
  const entryId = Number(formData.get("entry_id"));
  const round = Number(formData.get("round"));
  if (!entryId || !round || roundLocked(round)) return;

  const starters = formData.getAll("starter").map(Number);
  const bench = formData.getAll("bench").map(Number);
  const captain = Number(formData.get("captain"));
  const db = getDb();

  db.transaction(() => {
    db.prepare(`DELETE FROM squad_picks WHERE entry_id = ? AND round = ?`).run(entryId, round);
    const ins = db.prepare(`INSERT INTO squad_picks (entry_id, round, player_id, is_captain, is_bench)
                            VALUES (?, ?, ?, ?, ?)`);
    for (const id of starters) ins.run(entryId, round, id, id === captain ? 1 : 0, 0);
    for (const id of bench) if (!starters.includes(id)) ins.run(entryId, round, id, 0, 1);
  })();

  recomputeEntry(entryId);
  revalidatePath("/squad");
  revalidatePath("/leaderboard");
  revalidatePath("/");
}

export async function saveStatLine(formData: FormData) {
  const matchId = String(formData.get("match_id") ?? "");
  const playerId = Number(formData.get("player_id"));
  if (!matchId || !playerId) return;

  const n = (k: string) => {
    const v = Number(formData.get(k));
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
  };

  getDb().prepare(`
    INSERT INTO player_match_stats (
      player_id, match_id, minutes, tries, try_assists, conversions, penalties,
      drop_goals, tackles, carries, metres, turnovers_won, yellow_cards, red_cards, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin')
    ON CONFLICT(player_id, match_id) DO UPDATE SET
      minutes = excluded.minutes, tries = excluded.tries, try_assists = excluded.try_assists,
      conversions = excluded.conversions, penalties = excluded.penalties,
      drop_goals = excluded.drop_goals, tackles = excluded.tackles, carries = excluded.carries,
      metres = excluded.metres, turnovers_won = excluded.turnovers_won,
      yellow_cards = excluded.yellow_cards, red_cards = excluded.red_cards, source = 'admin'
  `).run(
    playerId, matchId, n("minutes"), n("tries"), n("try_assists"), n("conversions"),
    n("penalties"), n("drop_goals"), n("tackles"), n("carries"), n("metres"),
    n("turnovers_won"), n("yellow_cards"), n("red_cards"),
  );

  const db = getDb();
  for (const e of db.prepare(`SELECT id FROM entries WHERE season = ?`).all(SEASON) as { id: number }[]) {
    recomputeEntry(e.id);
  }
  revalidatePath("/admin");
  revalidatePath("/leaderboard");
}
