"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLeague } from "@/components/league";
import { Team, stripe } from "@/components/team";
import { kickoff } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import type { StandingRow } from "@/lib/types";

export default function Home() {
  const { season, matches, teams, me, entry } = useLeague();
  const [log, setLog] = useState<StandingRow[]>([]);
  useEffect(() => {
    supabase.from("standings").select("*").eq("season", season.id).order("position").limit(4)
      .then(({ data }) => setLog((data ?? []) as StandingRow[]));
  }, [season.id]);

  const played = matches.filter((m) => m.home_score !== null);
  const lastRound = played.length ? Math.max(...played.map((m) => m.round)) : null;
  const latest = matches.filter((m) => m.round === lastRound);
  const upcoming = matches.filter((m) => m.home_score === null && new Date(m.kickoff_at).getTime() > Date.now());
  const nextRound = upcoming.length ? upcoming[0].round : null;
  const next = matches.filter((m) => m.round === nextRound);

  return (
    <>
      <div className="card">
        <h2>Hi {me.display_name}</h2>
        <p className="sub">
          {season.name}{season.is_replay && " · replay: the season has been played, so each of you locks a round in and then sees how it scored."}
        </p>
        {entry
          ? <p style={{ margin: 0 }}>Your team is <strong>{entry.team_name}</strong>. <Link href="/predict/">Call this round&apos;s scores</Link>.</p>
          : <p style={{ margin: 0 }}><Link href="/predict/">Name your team</Link> to start playing.</p>}
      </div>
      <div className="grid2">
        {nextRound !== null && (
          <div className="card">
            <h2>Round {nextRound}</h2>
            <p className="sub">Up next · <Link href="/predict/">call your scores</Link></p>
            <table><tbody>
              {next.map((m) => (
                <tr key={m.id}>
                  <td style={{ textAlign: "right" }}><Team team={teams.get(m.home_team_id)} align="right" bold={false} /></td>
                  <td className="muted small" style={{ textAlign: "center", width: 86 }}>{kickoff(m.kickoff_at).replace(/^\w+, /, "")}</td>
                  <td><Team team={teams.get(m.away_team_id)} bold={false} /></td>
                </tr>
              ))}
            </tbody></table>
          </div>
        )}
        {lastRound !== null && (
          <div className="card">
            <h2>Round {lastRound}</h2>
            <p className="sub">Latest results</p>
            <table><tbody>
              {latest.map((m) => (
                <tr key={m.id}>
                  <td style={{ textAlign: "right" }}><Team team={teams.get(m.home_team_id)} align="right" bold={false} /></td>
                  <td className="score" style={{ textAlign: "center", width: 70 }}>{m.home_score}&ndash;{m.away_score}</td>
                  <td><Team team={teams.get(m.away_team_id)} bold={false} /></td>
                </tr>
              ))}
            </tbody></table>
          </div>
        )}
        {log.length > 0 && <div className="card">
          <h2>Top of the log</h2>
          <p className="sub"><Link href="/standings/">Full log</Link></p>
          <table><tbody>
            {log.map((r) => (
              <tr key={r.team_id} style={stripe(teams.get(r.team_id))}>
                <td className="muted">{r.position}</td>
                <td><Team team={teams.get(r.team_id)} /></td>
                <td className="num"><strong>{r.log_points}</strong></td>
              </tr>
            ))}
          </tbody></table>
        </div>}
      </div>
    </>
  );
}
