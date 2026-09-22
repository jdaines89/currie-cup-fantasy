import { pts } from "@/lib/format";
import { leaderboard, listRounds, scoresForEntry } from "@/lib/queries";
import { NewTeamForm } from "../new-team";

export const dynamic = "force-dynamic";

export default function LeaderboardPage() {
  const rows = leaderboard();
  const rounds = listRounds();

  if (rows.length === 0) return <NewTeamForm heading="No teams yet" />;

  const perRound = new Map(
    rows.map((r) => {
      const scores = scoresForEntry(r.entry_id);
      const totals = new Map<number, number>();
      for (const s of scores) totals.set(s.round, (totals.get(s.round) ?? 0) + s.points);
      return [r.entry_id, totals];
    }),
  );

  return (
    <>
      <div className="card">
        <h2>Leaderboard</h2>
        <p className="sub">Union pool and player squad points, added together.</p>
        <table>
          <thead>
            <tr>
              <th>#</th><th>Team</th><th>Manager</th>
              <th className="num">Pool</th><th className="num">Squad</th><th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.entry_id}>
                <td className="muted">{i + 1}</td>
                <td><strong>{r.team_name}</strong></td>
                <td className="muted">{r.manager}</td>
                <td className="num">{pts(r.pool_points)}</td>
                <td className="num">{pts(r.player_points)}</td>
                <td className="num"><strong>{pts(r.total)}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Round by round</h2>
        <p className="sub">Blank means no picks were saved for that round.</p>
        <table>
          <thead>
            <tr>
              <th>Team</th>
              {rounds.map((r) => <th key={r} className="num">R{r}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.entry_id}>
                <td><strong>{r.team_name}</strong></td>
                {rounds.map((round) => {
                  const v = perRound.get(r.entry_id)?.get(round);
                  return <td key={round} className="num">{v === undefined ? <span className="muted">&mdash;</span> : pts(v)}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <NewTeamForm heading="Add another team" />
    </>
  );
}
