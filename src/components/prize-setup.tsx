"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useLeague } from "@/components/league";
import { trackRecord, usePoolPrizes, whoWon, type PoolPrize } from "@/lib/prizes";
import { supabase } from "@/lib/supabase";

const STATUS: Record<PoolPrize["status"], string> = {
  upcoming: "Upcoming", "in play": "In play", "no winner": "No winner", awaiting: "Awaiting",
  delivered: "Delivered", "not delivered": "Not delivered",
};

/**
 * For a pool's creator: put up a prize for a round. It's your promise, in
 * your name: it locks at the round's first kickoff, the winner marks it
 * received, and the pool sees your track record.
 */
export function PrizeSetup() {
  const { pool, me, members, matches, season } = useLeague();
  const [prizes, reload] = usePoolPrizes(pool?.id);
  const open = useMemo(() => {
    const first = new Map<number, string>();
    for (const m of matches) if (!first.has(m.round) || m.kickoff_at < first.get(m.round)!) first.set(m.round, m.kickoff_at);
    const now = new Date().toISOString();
    return [...first].filter(([, k]) => k > now).map(([r]) => r).sort((a, b) => a - b);
  }, [matches]);
  const [round, setRound] = useState<number | null>(null);
  const [sponsor, setSponsor] = useState("");
  const [prize, setPrize] = useState("");
  const [every, setEvery] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const nameOf = (id: string) => (id === me.user_id ? "You" : members.find((m) => m.user_id === id)?.display_name ?? "A mate");

  if (!pool || pool.school_emis || pool.created_by !== me.user_id || season.is_replay) return null;
  const pick = round ?? open.find((r) => !prizes.some((p) => p.round === r)) ?? open[0] ?? null;
  const rec = trackRecord(prizes);

  async function offer(e: FormEvent) {
    e.preventDefault(); setMsg(null);
    if (pick === null) return;
    const rounds = (every ? open.filter((r) => r >= pick) : [pick]).filter((r) => !prizes.some((p) => p.round === r));
    if (!rounds.length) { setMsg("There's already a prize on that round."); return; }
    const { error } = await supabase.from("round_prizes")
      .insert(rounds.map((r) => ({ pool_id: pool!.id, round: r, sponsor: sponsor.trim(), prize: prize.trim() })));
    if (error) {
      setMsg("That didn't go through. Prizes can only go on rounds that haven't kicked off, in pools of up to 50, and not while a prize you offered is still waiting to be marked received.");
      return;
    }
    setSponsor(""); setPrize(""); setEvery(false); reload();
  }

  async function withdraw(r: number) {
    setMsg(null);
    await supabase.from("round_prizes").delete().eq("pool_id", pool!.id).eq("round", r);
    reload();
  }

  return (
    <div className="card">
      <h2>Round prize for {pool.name}</h2>
      <p className="sub">For the round&apos;s top caller, in your name. It locks at kickoff, and the winner confirms it arrived.</p>
      {open.length === 0 ? <p className="muted">Every round has kicked off, so there&apos;s nothing left to put a prize on.</p> : (
        <form className="prizeform" onSubmit={offer}>
          <div className="prizefields">
            <select id="prize-round" value={pick ?? ""} onChange={(e) => setRound(Number(e.target.value))} aria-label="Round">
              {open.map((r) => <option key={r} value={r}>Round {r}</option>)}
            </select>
            <input id="prize-sponsor" required maxLength={40} placeholder="Sponsor, e.g. Joe's Pub" value={sponsor} onChange={(e) => setSponsor(e.target.value)} />
            <input id="prize-what" required maxLength={60} placeholder="Prize, e.g. R200 bar tab" value={prize} onChange={(e) => setPrize(e.target.value)} />
          </div>
          <label className="small"><input id="prize-every" type="checkbox" checked={every} onChange={(e) => setEvery(e.target.checked)} /> Every round after that too</label>
          <div><button type="submit">Offer prize</button></div>
        </form>
      )}
      {msg && <p className="small" style={{ marginTop: 10 }}>{msg}</p>}
      {prizes.length > 0 && (
        <>
          <ul className="prizelist">
            {prizes.map((p) => (
              <li key={p.round}>
                <span className="pl-round">R{p.round}</span>
                <span className="pl-what">
                  {p.prize}
                  <span className="prize-meta">{p.sponsor}{p.winners?.length ? ` · ${whoWon(p, nameOf)}` : ""}</span>
                </span>
                {p.status === "upcoming" && p.offered_by === me.user_id
                  ? <button type="button" className="ghost prize-btn" onClick={() => withdraw(p.round)}>Withdraw</button>
                  : <span className={p.status === "not delivered" ? "pl-st bad" : "pl-st"}>{STATUS[p.status]}</span>}
              </li>
            ))}
          </ul>
          {rec.decided > 0 && <p className="prize-meta" style={{ marginTop: 10 }}>Delivered {rec.delivered} of {rec.decided}</p>}
        </>
      )}
    </div>
  );
}
