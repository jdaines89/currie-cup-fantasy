"use client";

import { useCallback, useEffect, useState } from "react";
import { NeedsEntry, useLeague } from "@/components/league";
import { RoundPicker } from "@/components/round-picker";
import { Crest } from "@/components/team";
import { kickoff } from "@/lib/format";
import { firstOpenRound, lockRound, useRoundLocks } from "@/lib/rounds";
import { supabase } from "@/lib/supabase";
import type { Prediction } from "@/lib/types";

interface PredScore {
  match_id: string; total_pts: number; is_banker: boolean;
  result_pts: number; margin_pts: number; near_pts: number; exact_pts: number;
}

// What each chip on a scored match means. Mirrors the prediction_scores view.
const PARTS = [
  { key: "result_pts", code: "RES", max: "6", what: "Right result: you picked the winner, or the draw" },
  { key: "margin_pts", code: "MAR", max: "5", what: "Exact winning margin" },
  { key: "near_pts",   code: "CLS", max: "2 per team", what: "Close: a team's score within 3 points" },
  { key: "exact_pts",  code: "EXA", max: "5", what: "Exact score" },
] as const;

function Breakdown({ s }: { s: PredScore }) {
  return (
    <div className="breakdown">
      {PARTS.map((p) => {
        const v = s[p.key];
        return <span key={p.code} className={v > 0 ? "pchip on" : "pchip"} title={p.what}>{p.code}{v > 0 ? ` +${v}` : ""}</span>;
      })}
      {s.is_banker && <span className="pchip bank2" title="Banker: this match counts double">×2</span>}
    </div>
  );
}

export default function PredictPage() {
  return <NeedsEntry><Predict /></NeedsEntry>;
}

function Predict() {
  const { entry, season, matches, rounds, teams, me } = useLeague();
  const [remind, setRemind] = useState(me.email_reminders);
  const { locked, isLocked, matchStarted, reload: reloadLocks } = useRoundLocks(entry!.id, season, matches);
  const [round, setRound] = useState<number | null>(null);
  const [preds, setPreds] = useState<Map<string, Prediction>>(new Map());
  const [draft, setDraft] = useState<Record<string, [string, string]>>({});
  const [scores, setScores] = useState<Map<string, PredScore>>(new Map());
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { if (round === null && rounds.length) setRound(firstOpenRound(rounds, isLocked)); }, [round, rounds, isLocked]);

  const ms = matches.filter((m) => m.round === round);
  const load = useCallback(async () => {
    if (round === null) return;
    const ids = matches.filter((m) => m.round === round).map((m) => m.id);
    const [p, s] = await Promise.all([
      supabase.from("predictions").select("*").eq("entry_id", entry!.id).in("match_id", ids),
      supabase.from("prediction_scores").select("match_id, total_pts, is_banker, result_pts, margin_pts, near_pts, exact_pts").eq("entry_id", entry!.id).in("match_id", ids),
    ]);
    const map = new Map(((p.data ?? []) as Prediction[]).map((x) => [x.match_id, x]));
    setPreds(map);
    setDraft(Object.fromEntries([...map].map(([k, v]) => [k, [String(v.home_score), String(v.away_score)]])));
    setScores(new Map(((s.data ?? []) as PredScore[]).map((x) => [x.match_id, x])));
  }, [entry, round, matches]);
  useEffect(() => { load(); }, [load]);

  if (round === null) return null;
  const done = isLocked(round);
  const total = [...scores.values()].reduce((a, b) => a + b.total_pts, 0);

  async function save(matchId: string, h: string, a: string) {
    setDraft((d) => ({ ...d, [matchId]: [h, a] }));
    if (h === "" || a === "") return;
    setMsg(null);
    const { error } = await supabase.from("predictions").upsert(
      { entry_id: entry!.id, match_id: matchId, home_score: Number(h), away_score: Number(a) });
    if (error) setMsg(error.message);
    else setPreds((p) => new Map(p).set(matchId, { entry_id: entry!.id, match_id: matchId, home_score: +h, away_score: +a, is_banker: p.get(matchId)?.is_banker ?? false }));
  }

  async function back(matchId: string) {
    setMsg(null);
    const { error } = await supabase.from("predictions").update({ is_banker: true })
      .eq("entry_id", entry!.id).eq("match_id", matchId);
    if (error) setMsg(error.message); else await load();
  }

  async function toggleReminders(on: boolean) {
    setRemind(on);
    const { error } = await supabase.from("members").update({ email_reminders: on }).eq("user_id", me.user_id);
    if (error) { setRemind(!on); setMsg(error.message); }
  }

  async function lockIn() {
    const { error } = await lockRound(entry!.id, season.id, round!);
    if (error) setMsg(error.message);
    await reloadLocks(); await load();
  }

  const filled = ms.filter((m) => preds.has(m.id)).length;
  const hasBanker = ms.some((m) => preds.get(m.id)?.is_banker);

  return (
    <>
      <RoundPicker rounds={rounds} round={round} onPick={setRound} locked={locked} />
      <div className="card">
        <h2>Round {round} {done && <span className="badge win">locked</span>}</h2>
        <p className="sub">
          {done ? <>You scored <strong>{total}</strong> this round.</>
            : <>Call each scoreline. 6 for the right result, 5 more for the exact margin, 2 for each side within 3 points, and 5 more for the exact score. Back one match as your <strong>Banker</strong> and it counts double.</>}
        </p>
        {ms.map((m) => {
          const h = teams.get(m.home_team_id)!, a = teams.get(m.away_team_id)!;
          const d = draft[m.id] ?? ["", ""];
          const p = preds.get(m.id);
          const shut = done || matchStarted(m);
          const bankerShut = ms.some((x) => preds.get(x.id)?.is_banker && matchStarted(x));
          return (
            <div key={m.id} className={p?.is_banker ? "match banker" : "match"}>
              <div className="mhead">
                <span>{kickoff(m.kickoff_at)} · {m.venue}</span>
                {p?.is_banker ? <span className="bank on">Banker ×2</span>
                  : !shut && !bankerShut && p ? <button type="button" className="bank" onClick={() => back(m.id)}>Make Banker</button> : null}
              </div>
              <div className="pred">
                <span className="pteam"><Crest team={h} /><strong>{h.display_name}</strong></span>
                <input className="pbox" inputMode="numeric" type="number" min={0} max={150} disabled={shut} value={d[0]}
                  aria-label={`${h.display_name} score`} onChange={(e) => save(m.id, e.target.value, d[1])} />
                <span className="muted">–</span>
                <input className="pbox" inputMode="numeric" type="number" min={0} max={150} disabled={shut} value={d[1]}
                  aria-label={`${a.display_name} score`} onChange={(e) => save(m.id, d[0], e.target.value)} />
                <span className="pteam away"><Crest team={a} /><strong>{a.display_name}</strong></span>
              </div>
              {shut && m.home_score !== null && (done || !season.is_replay) && (
                <div className="presult">
                  <div>
                    <span>Real score <strong>{m.home_score}–{m.away_score}</strong></span>
                    {scores.has(m.id) && <Breakdown s={scores.get(m.id)!} />}
                  </div>
                  <span className="pts">{scores.has(m.id) ? `+${scores.get(m.id)!.total_pts}` : "no call"}</span>
                </div>
              )}
            </div>
          );
        })}
        {scores.size > 0 && (
          <dl className="legend">
            {PARTS.map((p) => <div key={p.code}><dt><span className="pchip on">{p.code}</span></dt><dd>{p.what}, +{p.max}</dd></div>)}
            <div><dt><span className="pchip bank2">×2</span></dt><dd>Your Banker, so that match counts double</dd></div>
          </dl>
        )}
        {msg && <p className="small" style={{ color: "var(--danger)" }}>{msg}</p>}
        {!season.is_replay && (
          <label className="small muted toggle">
            <input type="checkbox" checked={remind} onChange={(e) => toggleReminders(e.target.checked)} />
            Email me an hour before kickoff if I haven&apos;t called a score
          </label>
        )}
        {!done && season.is_replay && (
          <>
            <p className="small muted">Locking in a round can't be undone. Then you see how it scored.</p>
            <button type="button" disabled={filled < ms.length || !hasBanker} onClick={lockIn}>
              {filled < ms.length ? `Call ${ms.length - filled} more` : !hasBanker ? "Pick your Banker" : `Lock in round ${round}`}
            </button>
          </>
        )}
      </div>
    </>
  );
}
