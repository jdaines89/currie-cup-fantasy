"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { NeedsEntry, useLeague } from "@/components/league";
import { RoundPicker } from "@/components/round-picker";
import { Crowd, type CrowdRow } from "@/components/crowd";
import { Crest } from "@/components/team";
import { kickoff } from "@/lib/format";
import { isRugbyScore, scoreInput } from "@/lib/rugby";
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

const bad = (v: string) => v !== "" && !isRugbyScore(Number(v));

interface MateCall extends Prediction { name: string; pts: number | null }

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
  const { entry, season, matches, rounds, teams, me, members, pools, reloadPools } = useLeague();
  const [code, setCode] = useState("");
  const [remind, setRemind] = useState(me.email_reminders);
  const { locked, isLocked, matchStarted, reload: reloadLocks } = useRoundLocks(entry!.id, season, matches);
  const [round, setRound] = useState<number | null>(null);
  const [preds, setPreds] = useState<Map<string, Prediction>>(new Map());
  const [draft, setDraft] = useState<Record<string, [string, string]>>({});
  const [scores, setScores] = useState<Map<string, PredScore>>(new Map());
  const [mates, setMates] = useState<MateCall[]>([]);
  const [myLocks, setMyLocks] = useState<Set<string>>(new Set());
  const [crowd, setCrowd] = useState<Map<string, CrowdRow>>(new Map());
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { if (round === null && rounds.length) setRound(firstOpenRound(rounds, isLocked)); }, [round, rounds, isLocked]);

  const ms = matches.filter((m) => m.round === round);
  const load = useCallback(async () => {
    if (round === null) return;
    const ids = matches.filter((m) => m.round === round).map((m) => m.id);
    const [p, s, theirs, theirScores, entries, ml, cr] = await Promise.all([
      supabase.from("predictions").select("*").eq("entry_id", entry!.id).in("match_id", ids),
      supabase.from("prediction_scores").select("match_id, total_pts, is_banker, result_pts, margin_pts, near_pts, exact_pts").eq("entry_id", entry!.id).in("match_id", ids),
      // Only calls that are locked come back: the database hides the rest.
      supabase.from("predictions").select("entry_id, match_id, home_score, away_score, is_banker").neq("entry_id", entry!.id).in("match_id", ids),
      supabase.from("prediction_scores").select("entry_id, match_id, total_pts").neq("entry_id", entry!.id).in("match_id", ids),
      supabase.from("entries").select("id, user_id, team_name").eq("season", season.id),
      supabase.from("match_locks").select("match_id").eq("entry_id", entry!.id).in("match_id", ids),
      // Every player's calls as totals, only for matches your own call can no longer change.
      supabase.rpc("match_crowd", { p_season: season.id }),
    ]);
    setCrowd(new Map(((cr.data ?? []) as CrowdRow[]).map((x) => [x.match_id, x])));
    setMyLocks(new Set((ml.data ?? []).map((r: { match_id: string }) => r.match_id)));
    const owner = new Map(((entries.data ?? []) as { id: number; user_id: string }[]).map((e) => [e.id, e.user_id]));
    const pts = new Map(((theirScores.data ?? []) as { entry_id: number; match_id: string; total_pts: number }[])
      .map((x) => [`${x.entry_id}:${x.match_id}`, x.total_pts]));
    setMates(((theirs.data ?? []) as Prediction[]).map((x) => ({
      ...x, name: members.find((m) => m.user_id === owner.get(x.entry_id))?.display_name ?? "A mate",
      pts: pts.get(`${x.entry_id}:${x.match_id}`) ?? null,
    })).sort((a, b) => a.name.localeCompare(b.name)));
    const map = new Map(((p.data ?? []) as Prediction[]).map((x) => [x.match_id, x]));
    setPreds(map);
    setDraft(Object.fromEntries([...map].map(([k, v]) => [k, [String(v.home_score), String(v.away_score)]])));
    setScores(new Map(((s.data ?? []) as PredScore[]).map((x) => [x.match_id, x])));
  }, [entry, round, matches, season.id, members]);
  useEffect(() => { load(); }, [load]);

  if (round === null) return null;
  const done = isLocked(round);
  const total = [...scores.values()].reduce((a, b) => a + b.total_pts, 0);
  const filled = ms.filter((m) => preds.has(m.id)).length;
  const hasBanker = ms.some((m) => preds.get(m.id)?.is_banker);

  async function save(matchId: string, rawH: string, rawA: string) {
    const h = scoreInput(rawH), a = scoreInput(rawA);
    setDraft((d) => ({ ...d, [matchId]: [h, a] }));
    if (h === "" || a === "" || !isRugbyScore(+h) || !isRugbyScore(+a)) return;
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

  // Live seasons: lock a call before kickoff to see mates who've locked theirs.
  async function lockMatches(matchIds: string[]) {
    if (!matchIds.length) return;
    setMsg(null);
    const { error } = await supabase.from("match_locks").insert(matchIds.map((id) => ({ entry_id: entry!.id, match_id: id })));
    if (error) setMsg(error.message);
    await load();
  }

  async function clearRound() {
    const ids = ms.filter((m) => preds.has(m.id) && !(done || matchStarted(m) || myLocks.has(m.id))).map((m) => m.id);
    if (!ids.length || !window.confirm(`Clear your ${ids.length} unlocked call${ids.length === 1 ? "" : "s"} for round ${round}?`)) return;
    setMsg(null);
    const { error } = await supabase.from("predictions").delete().eq("entry_id", entry!.id).in("match_id", ids);
    if (error) setMsg(error.message);
    await load();
  }

  async function lockIn() {
    const { error } = await lockRound(entry!.id, season.id, round!);
    if (error) setMsg(error.message);
    await reloadLocks(); await load();
  }


  async function joinPool(e: FormEvent) {
    e.preventDefault(); setMsg(null);
    const { error } = await supabase.rpc("join_pool", { p_code: code.trim() });
    if (error) setMsg(error.message); else { setCode(""); await reloadPools(); }
  }

  return (
    <>
      {pools.length === 0 && (
        <form className="notice joinnudge" onSubmit={joinPool}>
          <span>You&apos;re not in a pool for {season.name} yet, so nobody sees your score on a leaderboard. Got a code from a mate?</span>
          <span className="row">
            <input required maxLength={6} placeholder="Pool code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
            <button type="submit">Join</button>
          </span>
        </form>
      )}
      <RoundPicker rounds={rounds} round={round} onPick={setRound} locked={locked} matches={matches} />
      <div className="card">
        <h2>Round {round} {done && <span className="badge win">locked</span>}</h2>
        <p className="sub">
          {done ? <>You scored <strong>{total}</strong> this round.</>
            : <>{filled} of {ms.length} called{hasBanker ? ", Banker picked" : ", no Banker yet"}.</>}
        </p>
        {!done && (
          <details className="rules">
            <summary>How scoring works</summary>
            6 for the right result, 5 more for the exact margin, 2 for each side within 3 points, and 5 more for the exact score. Back one match as your <strong>Banker</strong> and it counts double.
          </details>
        )}
        {ms.map((m) => {
          const h = teams.get(m.home_team_id)!, a = teams.get(m.away_team_id)!;
          const d = draft[m.id] ?? ["", ""];
          const p = preds.get(m.id);
          const started = matchStarted(m);
          const shut = done || started || myLocks.has(m.id);
          const bankerShut = ms.some((x) => preds.get(x.id)?.is_banker && (matchStarted(x) || myLocks.has(x.id)));
          return (
            <div key={m.id} className={p?.is_banker ? "match banker" : "match"}>
              <div className="mhead">
                <span>{kickoff(m.kickoff_at)} · {m.venue}</span>
                <span className="mactions">
                  {p?.is_banker ? <span className="bank on">Banker ×2</span>
                    : !shut && !bankerShut && p ? <button type="button" className="bank" onClick={() => back(m.id)}>Make Banker</button> : null}
                  {!season.is_replay && !started && (myLocks.has(m.id)
                    ? <span className="bank locked">🔒 Locked</span>
                    : p && <button type="button" className="bank" onClick={() => lockMatches([m.id])}>Lock</button>)}
                </span>
              </div>
              <div className="pred">
                <span className="pteam"><span className="ha home">Home</span><Crest team={h} /><strong>{h.display_name}</strong></span>
                <input className={`pbox${bad(d[0]) ? " bad" : ""}`} inputMode="numeric" pattern="[0-9]*" maxLength={2} disabled={shut} value={d[0]}
                  aria-label={`${h.display_name} score`} onChange={(e) => save(m.id, e.target.value, d[1])} />
                <span className="muted">–</span>
                <input className={`pbox${bad(d[1]) ? " bad" : ""}`} inputMode="numeric" pattern="[0-9]*" maxLength={2} disabled={shut} value={d[1]}
                  aria-label={`${a.display_name} score`} onChange={(e) => save(m.id, d[0], e.target.value)} />
                <span className="pteam away"><span className="ha">Away</span><Crest team={a} /><strong>{a.display_name}</strong></span>
              </div>
              {!shut && (bad(d[0]) || bad(d[1])) && (
                <p className="scorewarn">A rugby side can&apos;t score 1, 2 or 4, so this call isn&apos;t saved yet.</p>
              )}
              {shut && m.home_score !== null && (done || !season.is_replay) && (
                <div className="presult">
                  <div>
                    <span>Real score <strong>{m.home_score}–{m.away_score}</strong></span>
                    {scores.has(m.id) && <Breakdown s={scores.get(m.id)!} />}
                  </div>
                  <span className="pts">{scores.has(m.id) ? `+${scores.get(m.id)!.total_pts}` : "no call"}</span>
                </div>
              )}
              {crowd.has(m.id) && <Crowd c={crowd.get(m.id)!} home={h} away={a} />}
              {mates.some((x) => x.match_id === m.id) && (
                <details className="mates">
                  <summary>Your mates&apos; calls ({mates.filter((x) => x.match_id === m.id).length})</summary>
                  <ul>
                    {mates.filter((x) => x.match_id === m.id).map((x) => (
                      <li key={x.entry_id}>
                        <span>{x.name}{x.is_banker && <span className="pchip bank2">×2</span>}</span>
                        <strong>{x.home_score}–{x.away_score}</strong>
                        <span className="pts">{x.pts !== null ? `+${x.pts}` : ""}</span>
                      </li>
                    ))}
                  </ul>
                </details>
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
        {!done && (
          <div className="roundactions">
            {!season.is_replay && (() => {
              const open = ms.filter((m) => preds.has(m.id) && !matchStarted(m) && !myLocks.has(m.id)).map((m) => m.id);
              return open.length > 0 && (
                <button type="button" onClick={() => {
                  if (window.confirm(`Lock ${open.length} call${open.length === 1 ? "" : "s"}? You can't change them after, but you'll see the calls of mates who've locked the same games.`)) lockMatches(open);
                }}>Lock {open.length === ms.length ? "all" : open.length} call{open.length === 1 ? "" : "s"}</button>
              );
            })()}
            {ms.some((m) => preds.has(m.id) && !matchStarted(m) && !myLocks.has(m.id)) && (
              <button type="button" className="ghost" onClick={clearRound}>Clear unlocked calls</button>
            )}
          </div>
        )}
        {!season.is_replay && !done && (
          <p className="small muted">Every call locks at kickoff anyway. Lock one earlier and you&apos;ll see the calls of mates who&apos;ve locked that game too. A lock can&apos;t be undone.</p>
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
