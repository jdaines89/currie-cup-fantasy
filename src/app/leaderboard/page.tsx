"use client";

import { useEffect, useState } from "react";
import { HeadToHead } from "@/components/head-to-head";
import { NeedsPool, useLeague } from "@/components/league";
import { supabase } from "@/lib/supabase";
import type { LeaderRow } from "@/lib/types";

const PARTS = [
  ["res_pts", "RES"], ["mar_pts", "MAR"], ["cls_pts", "CLS"], ["exa_pts", "EXA"], ["banker_pts", "BNK"],
] as const satisfies readonly (readonly [keyof LeaderRow, string])[];

export default function LeaderboardPage() {
  return <NeedsPool><Leaderboard /></NeedsPool>;
}

function Leaderboard() {
  const { pool, me, season } = useLeague();
  const [rows, setRows] = useState<LeaderRow[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const mine = rows.find((r) => r.user_id === me.user_id)?.entry_id ?? null;
  useEffect(() => {
    supabase.from("pool_leaderboard").select("*").eq("pool_id", pool!.id)
      .order("total_points", { ascending: false }).order("exact_scores", { ascending: false }).order("manager")
      .then(({ data }) => setRows((data ?? []) as LeaderRow[]));
  }, [pool]);

  return (
    <div className="card">
      <h2>{pool!.name}</h2>
      <p className="sub">{season.name}. {season.is_replay ? "Only rounds that are locked in count." : "Scores count once a match is played."}</p>
      {rows.length === 0 ? <p className="muted">No one here yet.</p> : (
        <ol className="board">
          {rows.map((r, i) => (
            <li key={r.user_id} className={`${r.user_id === me.user_id ? "me" : ""}${picked === r.user_id ? " open" : ""}`}
              onClick={() => r.entry_id && setPicked(picked === r.user_id ? null : r.user_id)}>
              <div className="brow">
                <span className="rank">{i + 1}</span>
                <div className="who">
                  <strong>{r.manager}</strong>
                  <span className="small muted">{r.team_name ?? "No team yet"} · {r.matches_scored} matches · {r.exact_scores} exact</span>
                </div>
                <span className="btotal">{r.total_points}</span>
              </div>
              <div className="bparts">
                {PARTS.map(([k, code]) => (
                  <span key={code} className={r[k] > 0 ? "pchip on" : "pchip"}>{code} {r[k]}</span>
                ))}
              </div>
              {picked === r.user_id && r.entry_id && <HeadToHead mine={mine} theirs={r.entry_id} name={r.manager} />}
            </li>
          ))}
        </ol>
      )}
      <p className="small muted" style={{ marginTop: 12 }}>
        RES right result · MAR exact margin · CLS within 3 points · EXA exact score · BNK the extra your Banker doubled. They add up to the total. Tap someone to compare rounds with yours.
      </p>
    </div>
  );
}
