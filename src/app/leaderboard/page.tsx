"use client";

import { useEffect, useState } from "react";
import { useLeague } from "@/components/league";
import { supabase } from "@/lib/supabase";
import type { LeaderRow } from "@/lib/types";

export default function LeaderboardPage() {
  const { season, entry } = useLeague();
  const [rows, setRows] = useState<LeaderRow[]>([]);
  useEffect(() => {
    supabase.from("leaderboard").select("*").eq("season", season.id).order("total_points", { ascending: false })
      .then(({ data }) => setRows((data ?? []) as LeaderRow[]));
  }, [season.id]);

  return (
    <div className="card">
      <h2>Leaderboard</h2>
      <p className="sub">Everyone in the league. Only rounds that are locked in count.</p>
      {rows.length === 0 ? <p className="muted">No teams yet.</p> : (
        <table>
          <thead><tr><th>#</th><th>Team</th><th className="num">Results</th><th className="num">Exact</th><th className="num">Total</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.entry_id} className={r.entry_id === entry?.id ? "me" : ""}>
                <td className="muted">{i + 1}</td>
                <td><strong>{r.team_name}</strong><div className="small muted">{r.manager} · {r.rounds_scored} rounds</div></td>
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
