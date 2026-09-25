"use client";

import { useEffect, useState } from "react";
import { HeadToHead } from "@/components/head-to-head";
import { NeedsPool, useLeague } from "@/components/league";
import { RoundRecap } from "@/components/round-recap";
import { RoundTable } from "@/components/round-table";
import { readCache, writeCache } from "@/lib/cache";
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
  // null while the first copy loads; last visit's table shows instantly if this device has one.
  const [rows, setRows] = useState<LeaderRow[] | null>(() => readCache<LeaderRow[]>(`board:${pool!.id}`) ?? null);
  const [picked, setPicked] = useState<string | null>(null);
  const [view, setView] = useState<"overall" | "round">("overall");
  const mine = rows?.find((r) => r.user_id === me.user_id)?.entry_id ?? null;
  useEffect(() => {
    setRows(readCache<LeaderRow[]>(`board:${pool!.id}`) ?? null);
    supabase.from("pool_leaderboard").select("*").eq("pool_id", pool!.id)
      .order("total_points", { ascending: false }).order("exact_scores", { ascending: false }).order("manager")
      .then(({ data }) => { const r = (data ?? []) as LeaderRow[]; writeCache(`board:${pool!.id}`, r); setRows(r); });
  }, [pool]);

  return (
    <div className="card">
      <h2>{pool!.name}</h2>
      <p className="sub">{season.name}. {season.is_replay ? "Only rounds that are locked in count." : "Scores count once a match is played."}</p>
      {rows && <RoundRecap rows={rows} />}
      <div className="seg" role="tablist">
        <button type="button" role="tab" aria-selected={view === "overall"} className={view === "overall" ? "on" : ""} onClick={() => setView("overall")}>Overall</button>
        <button type="button" role="tab" aria-selected={view === "round"} className={view === "round" ? "on" : ""} onClick={() => setView("round")}>By round</button>
      </div>
      {view === "round" ? (rows === null ? <SkeletonRows /> : <RoundTable rows={rows} />) : rows === null ? <SkeletonRows /> : rows.length === 0 ? <p className="muted">No one here yet.</p> : (
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
      {view === "overall" && <p className="small muted" style={{ marginTop: 12 }}>
        RES right result · MAR exact margin · CLS within 3 points · EXA exact score · BNK the extra your Banker doubled. They add up to the total. Tap someone to compare rounds with yours.
      </p>}
    </div>
  );
}

// Placeholder cards the same size as the real ones, so nothing jumps when the table arrives.
function SkeletonRows() {
  return (
    <ol className="board" aria-busy="true" aria-label="Loading the table">
      {[0, 1, 2].map((i) => <li key={i} className="skeleton" style={{ height: 96 }} />)}
    </ol>
  );
}
