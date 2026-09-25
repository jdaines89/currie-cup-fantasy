"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Avatar } from "@/components/avatar";
import { useLeague } from "@/components/league";
import { supabase } from "@/lib/supabase";
import type { Member, School } from "@/lib/types";

type Stage = "primary" | "high";
interface Saved { stage: Stage; emis: string; last_year: number | null; first_saved_at: string; schools: School }
/** Someone in the league at one of your schools, with their vouch count. */
interface Mate { user_id: string; stage: Stage; emis: string; last_year: number | null; vouches: number; verified: boolean }
const NEEDED = 2;

const OPEN_DAYS = 14;
const LABEL: Record<Stage, { title: string; year: string }> = {
  primary: { title: "Primary school", year: "Year you left" },
  high: { title: "High school", year: "Matric year" },
};

function fixedFrom(s: Saved): Date {
  return new Date(new Date(s.first_saved_at).getTime() + OPEN_DAYS * 864e5);
}
const day = (d: Date) => d.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });

/**
 * The primary and high school you went to. Everyone in the league sees them,
 * and each one is fixed 14 days after it is first saved, so a school's table
 * is made of the people who really went there.
 */
export function MySchools({ me, members, onMessage }: { me: Member; members: Member[]; onMessage: (ok: boolean, text: string) => void }) {
  const [saved, setSaved] = useState<Saved[] | null>(null);
  const [mates, setMates] = useState<Mate[]>([]);
  const [given, setGiven] = useState<Set<string>>(new Set());
  const load = useCallback(async () => {
    const { data } = await supabase.from("member_schools")
      .select("stage, emis, last_year, first_saved_at, schools(emis, name, town, no_fee)")
      .eq("user_id", me.user_id);
    const mine = (data ?? []) as unknown as Saved[];
    setSaved(mine);
    if (!mine.length) { setMates([]); setGiven(new Set()); return; }
    const [m, v] = await Promise.all([
      supabase.from("school_members").select("user_id, stage, emis, last_year, vouches, verified")
        .in("emis", mine.map((s) => s.emis)),
      supabase.from("school_vouches").select("member_id, stage, emis").eq("voucher_id", me.user_id),
    ]);
    setMates(((m.data ?? []) as Mate[]).filter((x) => mine.some((s) => s.stage === x.stage && s.emis === x.emis)));
    setGiven(new Set((v.data ?? []).map((x) => `${x.member_id}:${x.stage}:${x.emis}`)));
  }, [me.user_id]);
  useEffect(() => { load(); }, [load]);
  // Saving a school changes which school pools you're in.
  const { reloadPools } = useLeague();
  const afterSave = useCallback(async () => { await load(); await reloadPools(); }, [load, reloadPools]);

  return (
    <div className="stack schools">
      {(["primary", "high"] as Stage[]).map((st) => (
        <SchoolRow key={st} stage={st} me={me} saved={saved?.find((s) => s.stage === st)} loading={!saved}
          mates={mates.filter((x) => x.stage === st)} members={members} given={given}
          onSaved={afterSave} onMessage={onMessage} />
      ))}
      <p className="small muted">
        You&apos;re in each school&apos;s pool automatically. Your mates in the league can see these. Each one is fixed {OPEN_DAYS} days after you first save it,
        and counts for the school once {NEEDED} schoolmates confirm you.
      </p>
    </div>
  );
}

function SchoolRow({ stage, me, saved, loading, mates, members, given, onSaved, onMessage }: {
  stage: Stage; me: Member; saved?: Saved; loading: boolean; mates: Mate[]; members: Member[]; given: Set<string>;
  onSaved: () => Promise<void>; onMessage: (ok: boolean, text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<School[]>([]);
  const [pick, setPick] = useState<School | null>(null);
  const [year, setYear] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = !!saved && fixedFrom(saved) <= new Date();
  const mine = mates.find((x) => x.user_id === me.user_id);
  const others = mates.filter((x) => x.user_id !== me.user_id);

  async function vouch(m: Mate, on: boolean) {
    setBusy(true);
    const { error } = on
      ? await supabase.from("school_vouches").insert({ voucher_id: me.user_id, member_id: m.user_id, stage: m.stage, emis: m.emis })
      : await supabase.from("school_vouches").delete().eq("voucher_id", me.user_id).eq("member_id", m.user_id).eq("stage", m.stage);
    setBusy(false);
    if (error) return onMessage(false, error.message);
    await onSaved();
  }

  useEffect(() => {
    const words = q.trim().replace(/[%_,()]/g, " ").split(/\s+/).filter(Boolean);
    if (!editing || pick || words.join("").length < 3) { setHits([]); return; }
    let live = true;
    const t = setTimeout(async () => {
      const { data } = await supabase.from("schools").select("emis, name, town, no_fee")
        .eq(stage === "primary" ? "offers_primary" : "offers_matric", true)
        .ilike("name", `%${words.join("%")}%`).order("name").limit(8);
      if (live) setHits((data ?? []) as School[]);
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q, stage, editing, pick]);

  function start() {
    setEditing(true); setPick(null); setQ(""); setHits([]);
    setYear(saved?.last_year ? String(saved.last_year) : "");
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const y = Number(year);
    const now = new Date().getFullYear();
    if (!pick) return onMessage(false, "Pick your school from the list.");
    if (!Number.isInteger(y) || y < 1940 || y > now + 20) return onMessage(false, `Add the ${LABEL[stage].year.toLowerCase()}, like 1997.`);
    setBusy(true);
    const row = { emis: pick.emis, last_year: y };
    const { error } = saved
      ? await supabase.from("member_schools").update(row).eq("user_id", me.user_id).eq("stage", stage)
      : await supabase.from("member_schools").insert({ user_id: me.user_id, stage, ...row });
    setBusy(false);
    if (error) return onMessage(false, error.message);
    setEditing(false);
    await onSaved();
    onMessage(true, `${LABEL[stage].title} saved.`);
  }

  return (
    <div className="school">
      <label className="small muted">{LABEL[stage].title}</label>
      {loading && <div className="skeleton" style={{ height: 44 }} />}
      {!loading && !editing && saved && (
        <>
          <div className="school-saved">
            <div>
              <div className="school-name">{saved.schools.name}</div>
              <div className="small muted">
                {[saved.schools.town, saved.last_year && `${stage === "high" ? "Matric" : "Left"} ${saved.last_year}`].filter(Boolean).join(" · ")}
              </div>
            </div>
            {locked
              ? <span className="small muted">Fixed</span>
              : <button type="button" className="ghost" onClick={start}>Change</button>}
          </div>
          <p className={`small ${mine?.verified ? "school-ok" : "muted"}`}>
            {mine?.verified
              ? `Confirmed by ${mine.vouches} schoolmates`
              : `Needs ${NEEDED - (mine?.vouches ?? 0)} more schoolmate${NEEDED - (mine?.vouches ?? 0) === 1 ? "" : "s"} to confirm you`}
          </p>
          {others.length > 0 && (
            <ul className="school-mates">
              {others.map((m) => {
                const who = members.find((x) => x.user_id === m.user_id);
                const on = given.has(`${m.user_id}:${m.stage}:${m.emis}`);
                return (
                  <li key={m.user_id}>
                    <Avatar member={who} size={28} />
                    <span className="mate-name">
                      {who?.display_name ?? "A member"}
                      {m.last_year && <span className="small muted"> · {stage === "high" ? "Matric" : "Left"} {m.last_year}</span>}
                    </span>
                    <button type="button" className={on ? "ghost" : ""} disabled={busy} onClick={() => vouch(m, !on)}
                      title={on ? "Tap to take it back" : "You went to school with them"}>
                      {on ? "Confirmed" : "Confirm"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      {!loading && !editing && !saved && (
        <button type="button" className="ghost school-add" onClick={start}>Add your {stage} school</button>
      )}
      {editing && (
        <form onSubmit={save} className="stack school-edit">
          {pick ? (
            <div className="school-saved">
              <div>
                <div className="school-name">{pick.name}</div>
                <div className="small muted">{pick.town}</div>
              </div>
              <button type="button" className="ghost" onClick={() => { setPick(null); setQ(""); }}>Other school</button>
            </div>
          ) : (
            <>
              <input autoFocus placeholder="Start typing the school's name" value={q} onChange={(e) => setQ(e.target.value)} />
              {hits.length > 0 && (
                <ul className="school-hits">
                  {hits.map((s) => (
                    <li key={s.emis}>
                      <button type="button" onClick={() => setPick(s)}>
                        <span>{s.name}</span>
                        <span className="small muted">{s.town}{s.no_fee ? " · No-fee school" : ""}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="small muted">Only Eastern Cape schools are listed so far.</p>
            </>
          )}
          <div className="row">
            <input type="number" inputMode="numeric" placeholder={LABEL[stage].year} aria-label={LABEL[stage].year}
              value={year} onChange={(e) => setYear(e.target.value.slice(0, 4))} />
            <button type="button" className="ghost" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
            <button type="submit" disabled={busy || !pick}>{busy ? "Saving…" : "Save"}</button>
          </div>
          <p className="small muted">You can change it until {day(saved ? fixedFrom(saved) : new Date(Date.now() + OPEN_DAYS * 864e5))}.</p>
        </form>
      )}
    </div>
  );
}
