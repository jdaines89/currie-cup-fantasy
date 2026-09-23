"use client";

import { useEffect, useState } from "react";
import { NeedsPool, useLeague } from "@/components/league";
import { supabase } from "@/lib/supabase";
import type { LeaderRow } from "@/lib/types";

export default function LeaderboardPage() {
  return <NeedsPool><Leaderboard /></NeedsPool>;
}

function Leaderboard() {
  const { pool, me, season } = useLeague();
  const [rows, setRows] = useState<LeaderRow[]>([]);
  useEffect(() => {
    supabase.from("pool_leaderboard").select("*").eq("pool_id", pool!.id)
      .order("total_points", { ascending: false }).order("exact_scores", { ascending: false })
      .then(({ data }) => setRows((data ?? []) as LeaderRow[]));
  }, [pool]);

  return (
    <div className="card">
      <h2>{pool!.name}</h2>
      <p className="sub">{season.name}. {season.is_replay ? "Only rounds that are locked in count." : "Scores count once a match is played."}</p>
      {rows.length === 0 ? <p className="muted">No one here yet.</p> : (
        <table>
          <thead><tr><th>#</th><th>Team</th><th className="num">Results</th><th className="num">Exact</th><th className="num">Total</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.user_id} className={r.user_id === me.user_id ? "me" : ""}>
                <td className="muted">{i + 1}</td>
                <td>
                  <strong>{r.team_name ?? <span className="muted">No team yet</span>}</strong>
                  <div className="small muted">{r.manager} · {r.rounds_scored} rounds</div>
                </td>
                <td className="num">{r.right_results}</td><td className="num">{r.exact_scores}</td>
                <td className="num"><strong>{r.total_points}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
