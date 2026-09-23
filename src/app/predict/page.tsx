"use client";

import { useCallback, useEffect, useState } from "react";
import { NeedsEntry, useLeague } from "@/components/league";
import { RoundPicker } from "@/components/round-picker";
import { Crest } from "@/components/team";
import { kickoff } from "@/lib/format";
import { firstOpenRound, lockRound, useRoundLocks } from "@/lib/rounds";
import { supabase } from "@/lib/supabase";
import type { Prediction } from "@/lib/types";

interface PredScore { match_id: string; total_pts: number }

export default function PredictPage() {
  return <NeedsEntry><Predict /></NeedsEntry>;
}

function Predict() {
  const { entry, season, matches, rounds, teams } = useLeague();
  const { locked, isLocked, reload: reloadLocks } = useRoundLocks(entry!.id, season, matches);
  const [round, setRound] = useState<number | null>(null);
  const [preds, setPreds] = useState<Map<string, Prediction>>(new Map());
  const [draft, setDraft] = useState<Record<string, [string, string]>>({});
  const [scores, setScores] = useState<Map<string, number>>(new Map());
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { if (round === null && rounds.length) setRound(firstOpenRound(rounds, isLocked)); }, [round, rounds, isLocked]);

  const ms = matches.filter((m) => m.round === round);
  const load = useCallback(async () => {
    if (round === null) return;
    const ids = matches.filter((m) => m.round === round).map((m) => m.id);
    const [p, s] = await Promise.all([
      supabase.from("predictions").select("*").eq("entry_id", entry!.id).in("match_id", ids),
      supabase.from("prediction_scores").select("match_id, total_pts").eq("entry_id", entry!.id).in("match_id", ids),
    ]);
    const map = new Map(((p.data ?? []) as Prediction[]).map((x) => [x.match_id, x]));
    setPreds(map);
    setDraft(Object.fromEntries([...map].map(([k, v]) => [k, [String(v.home_score), String(v.away_score)]])));
    setScores(new Map(((s.data ?? []) as PredScore[]).map((x) => [x.match_id, x.total_pts])));
  }, [entry, round, matches]);
  useEffect(() => { load(); }, [load]);

  if (round === null) return null;
  const done = isLocked(round);
  const total = [...scores.values()].reduce((a, b) => a + b, 0);

  async function save(matchId: string, h: string, a: string) {
    setDraft((d) => ({ ...d, [matchId]: [h, a] }));
    if (h === "" || a === "") return;
    setMsg(null);
    const { error } = await supabase.from("predictions").upsert(
      { entry_id: entry!.id, match_id: matchId, home_score: Number(h), away_score: Number(a) });
    if (error) setMsg(error.message);
    else setPreds((p) => new Map(p).set(matchId, { entry_id: entry!.id, match_id: matchId, home_score: +h, away_score: +a }));
  }

  async function lockIn() {
    const { error } = await lockRound(entry!.id, season.id, round!);
    if (error) setMsg(error.message);
    await reloadLocks(); await load();
  }

  const filled = ms.filter((m) => preds.has(m.id)).length;

  return (
    <>
      <RoundPicker rounds={rounds} round={round} onPick={setRound} locked={locked} />
      <div className="card">
        <h2>Round {round} {done && <span className="badge win">locked</span>}</h2>
        <p className="sub">
          {done ? <>You scored <strong>{total}</strong> this round.</>
            : <>Call each scoreline. 6 for the right result, 5 more for the exact margin, 2 for each side within 3 points, and 10 for the exact score.</>}
        </p>
        {ms.map((m) => {
          const h = teams.get(m.home_team_id)!, a = teams.get(m.away_team_id)!;
          const d = draft[m.id] ?? ["", ""];
          return (
            <div key={m.id} className="match">
              <div className="mhead"><span>{kickoff(m.kickoff_at)}</span><span>{m.venue}</span></div>
              <div className="pred">
                <span className="pteam"><Crest team={h} /><strong>{h.display_name}</strong></span>
                <input className="pbox" inputMode="numeric" type="number" min={0} max={150} disabled={done} value={d[0]}
                  aria-label={`${h.display_name} score`} onChange={(e) => save(m.id, e.target.value, d[1])} />
                <span className="muted">–</span>
                <input className="pbox" inputMode="numeric" type="number" min={0} max={150} disabled={done} value={d[1]}
                  aria-label={`${a.display_name} score`} onChange={(e) => save(m.id, d[0], e.target.value)} />
                <span className="pteam away"><Crest team={a} /><strong>{a.display_name}</strong></span>
              </div>
              {done && m.home_score !== null && (
                <div className="presult">
                  <span>Real score <strong>{m.home_score}–{m.away_score}</strong></span>
                  <span className="pts">{scores.has(m.id) ? `+${scores.get(m.id)}` : "no call"}</span>
                </div>
              )}
            </div>
          );
        })}
        {msg && <p className="small" style={{ color: "var(--danger)" }}>{msg}</p>}
        {!done && season.is_replay && (
          <>
            <p className="small muted">Locking in a round locks your union picks and your predictions for it together.</p>
            <button type="button" disabled={filled < ms.length} onClick={lockIn}>
              {filled < ms.length ? `Call ${ms.length - filled} more` : `Lock in round ${round}`}
            </button>
          </>
        )}
      </div>
    </>
  );
}
