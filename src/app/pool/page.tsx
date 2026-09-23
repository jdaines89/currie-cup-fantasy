"use client";

import { useCallback, useEffect, useState } from "react";
import { NeedsEntry, useLeague } from "@/components/league";
import { RoundPicker } from "@/components/round-picker";
import { Team, stripe } from "@/components/team";
import { kickoff } from "@/lib/format";
import { firstOpenRound, lockRound, useRoundLocks } from "@/lib/rounds";
import { supabase } from "@/lib/supabase";
import type { PoolPick } from "@/lib/types";

interface PickScore { team_id: string; result_pts: number; attack_pts: number; defence_pts: number; bonus_pts: number; total_pts: number }

export default function PoolPage() {
  return <NeedsEntry><Pool /></NeedsEntry>;
}

function Pool() {
  const { entry, season, matches, rounds, teams } = useLeague();
  const { locked, isLocked, reload: reloadLocks } = useRoundLocks(entry!.id, season, matches);
  const [round, setRound] = useState<number | null>(null);
  const [picks, setPicks] = useState<PoolPick[]>([]);
  const [scores, setScores] = useState<PickScore[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { if (round === null && rounds.length) setRound(firstOpenRound(rounds, isLocked)); }, [round, rounds, isLocked]);

  const load = useCallback(async () => {
    if (round === null) return;
    const [p, s] = await Promise.all([
      supabase.from("pool_picks").select("*").eq("entry_id", entry!.id).eq("round", round),
      supabase.from("pool_pick_scores").select("*").eq("entry_id", entry!.id).eq("round", round),
    ]);
    setPicks((p.data ?? []) as PoolPick[]);
    setScores((s.data ?? []) as PickScore[]);
  }, [entry, round]);
  useEffect(() => { load(); }, [load]);

  if (round === null) return null;
  const done = isLocked(round);
  const ms = matches.filter((m) => m.round === round);
  const picked = new Set(picks.map((p) => p.team_id));
  const captain = picks.find((p) => p.is_captain)?.team_id;
  const scoreOf = new Map(scores.map((s) => [s.team_id, s]));
  const total = scores.reduce((a, s) => a + s.total_pts, 0);

  async function run(op: PromiseLike<{ error: { message: string } | null }>) {
    setMsg(null);
    const { error } = await op;
    if (error) setMsg(error.message);
    await load();
  }

  const toggle = (teamId: string) => run(picked.has(teamId)
    ? supabase.from("pool_picks").delete().eq("entry_id", entry!.id).eq("round", round).eq("team_id", teamId)
    : supabase.from("pool_picks").insert({ entry_id: entry!.id, season: season.id, round, team_id: teamId }));

  async function makeCaptain(teamId: string) {
    setMsg(null);
    if (captain) await supabase.from("pool_picks").update({ is_captain: false }).eq("entry_id", entry!.id).eq("round", round).eq("team_id", captain);
    if (captain !== teamId) await run(supabase.from("pool_picks").update({ is_captain: true }).eq("entry_id", entry!.id).eq("round", round).eq("team_id", teamId));
    else await load();
  }

  async function lockIn() {
    setMsg(null);
    const { error } = await lockRound(entry!.id, season.id, round!);
    if (error) setMsg(error.message);
    await reloadLocks(); await load();
  }

  return (
    <>
      <RoundPicker rounds={rounds} round={round} onPick={setRound} locked={locked} />
      <div className="card">
        <h2>Round {round} {done && <span className="badge win">locked</span>}</h2>
        <p className="sub">
          {done
            ? <>You scored <strong>{total}</strong> this round.</>
            : <>Pick four unions, then star one as captain to double its score. {season.is_replay ? "Lock the round in to see how it scored: you can't change it after that." : "Picks lock at the round's first kickoff."}</>}
        </p>
        {ms.map((m) => (
          <div key={m.id} className="match">
            <div className="mhead">
              <span>{kickoff(m.kickoff_at)}</span><span>{m.venue}</span>
            </div>
            {[m.home_team_id, m.away_team_id].map((id) => {
              const t = teams.get(id); const on = picked.has(id); const sc = scoreOf.get(id);
              const theirs = id === m.home_team_id ? m.home_score : m.away_score;
              return (
                <div key={id} className={`pickrow ${on ? "on" : ""}`} style={stripe(t)}>
                  <button type="button" className={`tick ${on ? "on" : ""}`} disabled={done} onClick={() => toggle(id)} aria-pressed={on} aria-label={`Pick ${t?.display_name}`}>✓</button>
                  <span className="grow"><Team team={t} /></span>
                  {done
                    ? <>{theirs !== null && <span className="muted small">{theirs}</span>}<span className="pts">{sc ? sc.total_pts : on ? "–" : ""}</span></>
                    : on && <button type="button" className={`cap ${captain === id ? "on" : ""}`} onClick={() => makeCaptain(id)}>★ Captain</button>}
                </div>
              );
            })}
          </div>
        ))}
        {msg && <p className="small" style={{ color: "var(--danger)" }}>{msg}</p>}
        {!done && season.is_replay && (
          <button type="button" disabled={picked.size !== 4 || !captain} onClick={lockIn}>
            {picked.size !== 4 ? `Pick ${4 - picked.size} more` : !captain ? "Choose a captain" : `Lock in round ${round}`}
          </button>
        )}
      </div>
    </>
  );
}
