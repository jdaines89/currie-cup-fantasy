"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Match, Season } from "@/lib/types";

/** Which rounds this entry has locked, and the round to open on. */
export function useRoundLocks(entryId: number | undefined, season: Season, matches: Match[]) {
  const [locked, setLocked] = useState<Set<number>>(new Set());
  const reload = useCallback(async () => {
    if (!entryId) return;
    const { data } = await supabase.from("round_locks").select("round").eq("entry_id", entryId);
    setLocked(new Set((data ?? []).map((r: { round: number }) => r.round)));
  }, [entryId]);
  useEffect(() => { reload(); }, [reload]);

  const now = Date.now();
  const isLocked = (round: number) => season.is_replay
    ? locked.has(round)
    : matches.some((m) => m.round === round && new Date(m.kickoff_at).getTime() <= now);

  return { locked, isLocked, reload };
}

export async function lockRound(entryId: number, season: string, round: number) {
  return supabase.from("round_locks").insert({ entry_id: entryId, season, round });
}

export function firstOpenRound(rounds: number[], isLocked: (r: number) => boolean): number {
  return rounds.find((r) => !isLocked(r)) ?? rounds[rounds.length - 1] ?? 1;
}
