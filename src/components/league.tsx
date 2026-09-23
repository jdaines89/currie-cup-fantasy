"use client";

import { createContext, useCallback, useContext, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import type { Entry, Match, Member, Season, Team } from "@/lib/types";

interface League {
  season: Season;
  teams: Map<string, Team>;
  matches: Match[];
  rounds: number[];
  me: Member;
  entry: Entry | null;
  reloadEntry: () => Promise<void>;
}

const Ctx = createContext<League | null>(null);

export function useLeague(): League {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLeague outside <LeagueProvider>");
  return v;
}

/** Loads the reference data every screen needs once, after sign-in. */
export function LeagueProvider({ children }: { children: ReactNode }) {
  const [league, setLeague] = useState<Omit<League, "reloadEntry"> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: user } = await supabase.auth.getUser();
    const uid = user.user?.id;
    const [seasons, teams, members] = await Promise.all([
      supabase.from("seasons").select("*").order("id", { ascending: false }).limit(1),
      supabase.from("teams").select("id, display_name, short_name, stadium, colour, colour_ink, badge_url"),
      supabase.from("members").select("*").eq("user_id", uid ?? ""),
    ]);
    const season = seasons.data?.[0] as Season | undefined;
    const me = members.data?.[0] as Member | undefined;
    if (!me) { setError("Your account isn't a member of this league. Ask Justin for an invite."); return; }
    if (!season) { setError("No season has been loaded yet."); return; }

    const [matches, entries] = await Promise.all([
      supabase.from("matches").select("*").eq("season", season.id).order("kickoff_at"),
      supabase.from("entries").select("*").eq("season", season.id).eq("user_id", me.user_id),
    ]);
    const ms = (matches.data ?? []) as Match[];
    setLeague({
      season, me, matches: ms,
      teams: new Map(((teams.data ?? []) as Team[]).map((t) => [t.id, t])),
      rounds: [...new Set(ms.map((m) => m.round))].sort((a, b) => a - b),
      entry: (entries.data?.[0] as Entry | undefined) ?? null,
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  if (error) return <div className="notice">{error}</div>;
  if (!league) return <p className="muted">Loading the league&hellip;</p>;
  return <Ctx.Provider value={{ ...league, reloadEntry: load }}>{children}</Ctx.Provider>;
}

/** Wraps screens that need the member's own entry; offers to create it. */
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
      <h2>Name your team</h2>
      <p className="sub">One team per season. It plays the union pool and score predictions.</p>
      <form onSubmit={create} className="row">
        <input required maxLength={40} placeholder="Team name" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit">Create</button>
      </form>
      {msg && <p className="small" style={{ color: "var(--danger)" }}>{msg}</p>}
    </div>
  );
}
