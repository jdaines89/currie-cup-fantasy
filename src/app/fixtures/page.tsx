"use client";

import { useLeague } from "@/components/league";
import { Team } from "@/components/team";
import { kickoff } from "@/lib/format";

export default function FixturesPage() {
  const { rounds, matches, teams } = useLeague();
  return (
    <>
      {rounds.map((r) => (
        <div className="card" key={r}>
          <h2>Round {r}</h2>
          <table><tbody>
            {matches.filter((m) => m.round === r).map((m) => (
              <tr key={m.id}>
                <td style={{ textAlign: "right", width: "36%" }}><Team team={teams.get(m.home_team_id)} align="right" /></td>
                <td className="score" style={{ textAlign: "center" }}>
                  {m.home_score !== null ? `${m.home_score}–${m.away_score}` : <span className="muted">v</span>}
                  {m.status === "INTR" && <div className="small muted">interrupted, score stood</div>}
                </td>
                <td style={{ width: "36%" }}><Team team={teams.get(m.away_team_id)} /></td>
                <td className="muted small hide-sm">{kickoff(m.kickoff_at)}<br />{m.venue}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      ))}
    </>
  );
}
