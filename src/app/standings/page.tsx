import { buildStandings, listTeams, latestCompletedRound } from "@/lib/queries";
import { signed } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function StandingsPage() {
  const teams = new Map(listTeams().map((t) => [t.id, t]));
  const log = buildStandings();
  const round = latestCompletedRound();

  return (
    <>
      <div className="card">
        <h2>Currie Cup log</h2>
        <p className="sub">After round {round}. Built from real results in the database.</p>
        <table>
          <thead>
            <tr>
              <th>#</th><th>Union</th>
              <th className="num">P</th><th className="num">W</th>
              <th className="num">D</th><th className="num">L</th>
              <th className="num">PF</th><th className="num">PA</th>
              <th className="num">Diff</th><th className="num">Pts*</th>
            </tr>
          </thead>
          <tbody>
            {log.map((row, i) => (
              <tr key={row.team_id}>
                <td className="muted">{i + 1}</td>
                <td><strong>{teams.get(row.team_id)?.display_name}</strong></td>
                <td className="num">{row.played}</td>
                <td className="num">{row.won}</td>
                <td className="num">{row.drawn}</td>
                <td className="num">{row.lost}</td>
                <td className="num">{row.points_for}</td>
                <td className="num">{row.points_against}</td>
                <td className="num">{signed(row.diff)}</td>
                <td className="num">{row.estimated_points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="notice">
        <strong>* Points are an estimate.</strong> The real Currie Cup awards its attacking
        bonus point on try count, and no free feed publishes try counts for this competition.
        This column uses four for a win, two for a draw, one for losing by seven or less and
        one for scoring thirty or more. Everything to the left of it is exact, and the table is
        ranked on wins and points difference rather than the estimate.
      </div>
    </>
  );
}
