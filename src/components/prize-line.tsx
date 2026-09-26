"use client";

import { useState } from "react";
import { useLeague } from "@/components/league";
import { trackRecord, type PoolPrize } from "@/lib/prizes";
import { supabase } from "@/lib/supabase";

/**
 * The pool's round prize in one quiet line, plus, for a winner, the button to
 * say it arrived. The prize is always shown as the creator's offer, never
 * Scrumline's.
 */
export function PrizeLine({ prizes, round, onChange, compact = false }: { prizes: PoolPrize[]; round?: number; onChange?: () => void; compact?: boolean }) {
  const { members, me, pool, matches } = useLeague();
  const [busy, setBusy] = useState(false);
  const nameOf = (id: string) => (id === me.user_id ? "you" : members.find((m) => m.user_id === id)?.display_name ?? "a mate");
  if (!prizes.length) return null;

  // The round this line is about: the one asked for, else the first that isn't decided yet.
  const shown = round !== undefined
    ? prizes.find((p) => p.round === round)
    : prizes.find((p) => p.status === "in play") ?? prizes.find((p) => p.status === "upcoming");
  const owed = prizes.filter((p) => p.status === "awaiting" && p.winners?.includes(me.user_id) && !p.received.includes(me.user_id));
  const rec = trackRecord(prizes);
  const firstKick = (r: number) => matches.filter((m) => m.round === r).map((m) => m.kickoff_at).sort()[0];

  async function received(p: PoolPrize) {
    setBusy(true);
    await supabase.from("prize_receipts").insert({ pool_id: pool!.id, round: p.round });
    setBusy(false);
    onChange?.();
  }

  return (
    <div className="prizeline">
      {shown && (
        <p>
          <span className="muted">Round {shown.round} prize:</span> {shown.prize} from {shown.sponsor}
          <span className="muted"> · offered by {nameOf(shown.offered_by)}</span>
          {shown.status === "upcoming" && firstKick(shown.round) && <span className="muted"> · locked at kickoff</span>}
        </p>
      )}
      {!compact && owed.map((p) => (
        <p key={p.round}>
          You won round {p.round}&apos;s {p.prize}. Once {p.sponsor} has handed it over,{" "}
          <button type="button" className="linkish small" disabled={busy} onClick={() => received(p)}>mark it received</button>.
        </p>
      ))}
      {!compact && rec.decided > 0 && (
        <p className="small muted">
          Prizes delivered in this pool: {rec.delivered} of {rec.decided}
          {rec.missed > 0 && <span className="missed"> · {rec.missed} not delivered</span>}
        </p>
      )}
    </div>
  );
}
