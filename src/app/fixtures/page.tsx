import { listRounds, listMatchesForRound, teamsById } from "@/lib/queries";
import { Team, stripe } from "@/components/team";
import { kickoff } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function FixturesPage() {
  const teams = teamsById();
  const rounds = listRounds();

  return (
    <>
      {rounds.map((round) => (
        <div className="card" key={round}>
          <h2>Round {round}</h2>
          <p className="sub">{listMatchesForRound(round).length} matches</p>
          <table>
            <tbody>
              {listMatchesForRound(round).map((m) => {
                const home = teams.get(m.home_team_id);
                const away = teams.get(m.away_team_id);
                const played = m.home_score !== null && m.away_score !== null;
                return (
                  <tr key={m.id}>
                    <td style={{ width: "30%", textAlign: "right" }}>
                      <Team team={home} align="right" />
                    </td>
                    <td className="score" style={{ width: 80, textAlign: "center" }}>
                      {played ? `${m.home_score} – ${m.away_score}` : <span className="muted">v</span>}
                    </td>
                    <td style={{ width: "30%" }}><Team team={away} /></td>
                    <td className="muted small">{kickoff(m.kickoff_utc)}</td>
                    <td className="muted small">{m.venue}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}
