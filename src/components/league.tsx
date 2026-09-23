"use client";

import { createContext, useCallback, useContext, useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { Competition, Entry, Match, Member, Pool, Season, Team } from "@/lib/types";

interface League {
  seasons: Season[];
  competitions: Map<string, Competition>;
  season: Season;
  setSeason: (id: string) => void;
  pools: Pool[];
  pool: Pool | null;
  setPool: (id: number) => void;
  reloadPools: () => Promise<void>;
  teams: Map<string, Team>;
  matches: Match[];
  rounds: number[];
  me: Member;
  members: Member[];
  entry: Entry | null;
  reloadEntry: () => Promise<void>;
}

const Ctx = createContext<League | null>(null);

export function useLeague(): League {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLeague outside <LeagueProvider>");
  return v;
}

function remember(key: string, value?: string): string | null {
  try {
    if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key);
  } catch { return null; }
}

/** The newest season that hasn't finished yet, else the newest. */
function defaultSeason(seasons: Season[]): Season {
  return seasons.find((s) => !s.is_replay) ?? seasons[0];
}

/**
 * Loads what every screen needs after sign-in: who you are, the tournaments,
 * the one you're looking at (remembered per device) with its fixtures, your
 * entry for it, and the pools you're in for it.
 */
export function LeagueProvider({ children }: { children: ReactNode }) {
  const [base, setBase] = useState<{
    seasons: Season[]; competitions: Map<string, Competition>; teams: Map<string, Team>; me: Member; members: Member[];
  } | null>(null);
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [data, setData] = useState<{ matches: Match[]; entry: Entry | null; pools: Pool[] } | null>(null);
  const [poolId, setPoolId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: user } = await supabase.auth.getUser();
      const uid = user.user?.id;
      const [seasons, comps, teams, members] = await Promise.all([
        supabase.from("seasons").select("*").order("starts_on", { ascending: false, nullsFirst: false }),
        supabase.from("competitions").select("*"),
        supabase.from("teams").select("id, display_name, short_name, stadium, colour, colour_ink, badge_url"),
        supabase.from("members").select("*").order("display_name"),
      ]);
      const everyone = (members.data ?? []) as Member[];
      const me = everyone.find((m) => m.user_id === uid);
      const ss = (seasons.data ?? []) as Season[];
      if (!me) { setError("Your account isn't a member of this league. Ask Justin for an invite."); return; }
      if (!ss.length) { setError("No season has been loaded yet."); return; }
      setBase({
        seasons: ss, me, members: everyone,
        competitions: new Map(((comps.data ?? []) as Competition[]).map((c) => [c.id, c])),
        teams: new Map(((teams.data ?? []) as Team[]).map((t) => [t.id, t])),
      });
      const saved = remember("season");
      setSeasonId(ss.some((s) => s.id === saved) ? saved : defaultSeason(ss).id);
    })();
  }, []);

  const loadSeason = useCallback(async () => {
    if (!base || !seasonId) return;
    const [matches, entries, pools] = await Promise.all([
      supabase.from("matches").select("*").eq("season", seasonId).order("kickoff_at"),
      supabase.from("entries").select("*").eq("season", seasonId).eq("user_id", base.me.user_id),
      supabase.from("pools").select("*").eq("season", seasonId).order("created_at"),
    ]);
    const ps = (pools.data ?? []) as Pool[];
    setData({ matches: (matches.data ?? []) as Match[], entry: (entries.data?.[0] as Entry | undefined) ?? null, pools: ps });
    const saved = Number(remember(`pool:${seasonId}`));
    setPoolId(ps.some((p) => p.id === saved) ? saved : ps[0]?.id ?? null);
  }, [base, seasonId]);
  useEffect(() => { loadSeason(); }, [loadSeason]);

  if (error) return <div className="notice">{error}</div>;
  if (!base || !seasonId || !data) return <p className="muted">Loading the league&hellip;</p>;

  const season = base.seasons.find((s) => s.id === seasonId)!;
  const value: League = {
    ...base, season,
    setSeason: (id) => { remember("season", id); setData(null); setSeasonId(id); },
    pools: data.pools,
    pool: data.pools.find((p) => p.id === poolId) ?? null,
    setPool: (id) => { remember(`pool:${seasonId}`, String(id)); setPoolId(id); },
    reloadPools: loadSeason,
    matches: data.matches,
    rounds: [...new Set(data.matches.map((m) => m.round))].sort((a, b) => a - b),
    entry: data.entry,
    reloadEntry: loadSeason,
  };
  return (
    <Ctx.Provider value={value}>
      <Switcher />
      {children}
    </Ctx.Provider>
  );
}

// Only these screens show one pool's view; everywhere else the pool picker is noise.
const POOL_SCREENS = ["/leaderboard", "/chat"];

/** Which tournament you're looking at, and on pool screens which pool. */
function Switcher() {
  const { seasons, season, setSeason, pools, pool, setPool } = useLeague();
  const path = usePathname() ?? "";
  const showPool = POOL_SCREENS.some((p) => path.startsWith(p));
  return (
    <div className="switcher">
      <label>
        <span>Tournament</span>
        <select value={season.id} onChange={(e) => setSeason(e.target.value)}>
          {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_replay ? " (replay)" : ""}</option>)}
        </select>
      </label>
      {showPool && <label>
        <span>Pool</span>
        {pools.length ? (
          <select value={pool?.id ?? ""} onChange={(e) => setPool(Number(e.target.value))}>
            {pools.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        ) : <Link href="/pools/" className="nopool">Start or join a pool</Link>}
      </label>}
    </div>
  );
}

/** Screens that need a pool: points the way to one when you have none. */
export function NeedsPool({ children }: { children: ReactNode }) {
  const { pool, season } = useLeague();
  if (pool) return <>{children}</>;
  return (
    <div className="card narrow">
      <h2>No pool yet</h2>
      <p className="sub">You&apos;re not in a pool for {season.name}. Start one or join with a code from a mate.</p>
      <Link className="btn" href="/pools/">Go to pools</Link>
    </div>
  );
}

export function NeedsEntry({ children }: { children: ReactNode }) {
  const { entry, season, reloadEntry, me } = useLeague();
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  if (entry) return <>{children}</>;

  async function create(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from("entries").insert({ season: season.id, team_name: name.trim(), user_id: me.user_id });
    if (error) { setMsg(error.message); return; }
    await reloadEntry();
  }

  return (
    <div className="card narrow">
      <h2>Name your team for {season.name}</h2>
      <p className="sub">One team per tournament. Your calls count in every pool you&apos;re in, and you back one match a round as your Banker.</p>
      <form onSubmit={create} className="row">
        <input required maxLength={40} placeholder="Team name" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit">Create</button>
      </form>
      {msg && <p className="small" style={{ color: "var(--danger)" }}>{msg}</p>}
    </div>
  );
}
