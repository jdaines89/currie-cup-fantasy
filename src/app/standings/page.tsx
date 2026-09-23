"use client";

import { useEffect, useState } from "react";
import { useLeague } from "@/components/league";
import { Team, stripe } from "@/components/team";
import { signed } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import type { StandingRow } from "@/lib/types";

export default function StandingsPage() {
  const { season, teams } = useLeague();
  const [log, setLog] = useState<StandingRow[]>([]);
  useEffect(() => {
    supabase.from("standings").select("*").eq("season", season.id).order("position")
      .then(({ data }) => setLog((data ?? []) as StandingRow[]));
  }, [season.id]);
  const exact = log.length > 0 && log.every((r) => r.points_exact);

  return (
    <>
      <div className="card scroll-x">
        <h2>Currie Cup log</h2>
        <p className="sub">{season.name}. Built live from the results in the database.</p>
        <table>
          <thead><tr>
            <th>#</th><th>Union</th><th className="num">P</th><th className="num">W</th><th className="num">D</th>
            <th className="num">L</th><th className="num hide-sm">PF</th><th className="num hide-sm">PA</th>
            <th className="num">Diff</th><th className="num">Pts{exact ? "" : "*"}</th>
          </tr></thead>
          <tbody>
            {log.map((r) => (
              <tr key={r.team_id} style={stripe(teams.get(r.team_id))}>
                <td className="muted">{r.position}</td>
                <td><Team team={teams.get(r.team_id)} /></td>
                <td className="num">{r.played}</td><td className="num">{r.won}</td><td className="num">{r.drawn}</td>
                <td className="num">{r.lost}</td><td className="num hide-sm">{r.points_for}</td>
                <td className="num hide-sm">{r.points_against}</td><td className="num">{signed(r.diff)}</td>
                <td className="num"><strong>{r.log_points}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="notice">
        {exact
          ? "Points include every bonus point, read off the published final table for the season: no free feed carries the per-match try counts the try bonus needs."
          : "* Points leave out the try bonus until the season's published table is on file: no free feed carries per-match try counts."}
      </div>
    </>
  );
}
