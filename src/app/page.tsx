import { pts, kickoff } from "@/lib/format";
import { Team, stripe } from "@/components/team";
import {
  buildStandings, countPlayerStats, latestCompletedRound, leaderboard,
  listMatchesForRound, listPlayers, listRounds, listTeams, seasonComplete,
  teamsById, teamsWithoutRosters,
} from "@/lib/queries";
import { NewTeamForm } from "./new-team";

export const dynamic = "force-dynamic";

export default function Dashboard() {
  const teams = teamsById();
  const rounds = listRounds();
  const round = latestCompletedRound() || rounds[0] || 1;
  const log = buildStandings().slice(0, 4);
  const board = leaderboard();
  const matches = listMatchesForRound(round);

  return (
    <>
      {seasonComplete() && (
        <div className="notice">
          <strong>The 2026 season is complete</strong>, so the app is in replay mode: every
          round is open to pick and you play the season back. Run <code>npm run ingest</code>
          {" "}to pull a live round and picks lock at kickoff again.
        </div>
      )}

      <div className="grid2">
        <div className="card">
          <h2>Round {round}</h2>
          <p className="sub">Latest completed round</p>
          <table>
            <tbody>
              {matches.map((m) => (
                <tr key={m.id}>
                  <td style={{ textAlign: "right" }}><Team team={teams.get(m.home_team_id)} align="right" bold={false} /></td>
                  <td className="score" style={{ textAlign: "center", width: 74 }}>
                    {m.home_score}&ndash;{m.away_score}
                  </td>
                  <td><Team team={teams.get(m.away_team_id)} bold={false} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted" style={{ marginBottom: 0, marginTop: 12 }}>
            {matches[0] && kickoff(matches[0].kickoff_utc)} onwards
          </p>
        </div>

        <div className="card">
          <h2>Top of the log</h2>
          <p className="sub">Ranked on wins, then points difference</p>
          <table>
            <thead>
              <tr>
                <th>Union</th><th className="num">P</th><th className="num">W</th><th className="num">Diff</th>
              </tr>
            </thead>
            <tbody>
              {log.map((r) => (
                <tr key={r.team_id} style={stripe(r.team_id)}>
                  <td><Team team={teams.get(r.team_id)} /></td>
                  <td className="num">{r.played}</td>
                  <td className="num">{r.won}</td>
                  <td className="num">{r.diff > 0 ? `+${r.diff}` : r.diff}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small" style={{ marginBottom: 0, marginTop: 12 }}>
            <a href="/standings">Full log</a>
          </p>
        </div>
      </div>

      {board.length > 0 ? (
        <div className="card">
          <h2>Leaderboard</h2>
          <p className="sub">Your fantasy season so far</p>
          <table>
            <tbody>
              {board.slice(0, 5).map((r, i) => (
                <tr key={r.entry_id}>
                  <td className="muted">{i + 1}</td>
                  <td><strong>{r.team_name}</strong> <span className="muted small">{r.manager}</span></td>
                  <td className="num">{pts(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small" style={{ marginBottom: 0, marginTop: 12 }}>
            <a href="/pool">Pick unions</a> &middot; <a href="/squad">Pick a squad</a>
          </p>
        </div>
      ) : (
        <NewTeamForm />
      )}

      <div className="card">
        <h2>What this app is running on</h2>
        <p className="sub">Free data, no key, no account.</p>
        <table>
          <tbody>
            <tr>
              <td>Fixtures and results</td>
              <td className="muted">TheSportsDB free tier</td>
              <td className="num">{listRounds().length} rounds, {listTeams().length} unions</td>
            </tr>
            <tr>
              <td>Squads</td>
              <td className="muted">Union sites and Wikipedia, loaded by hand</td>
              <td className="num">
                {listPlayers().length} players,{" "}
                {listTeams().length - teamsWithoutRosters().length}/{listTeams().length} unions
              </td>
            </tr>
            <tr>
              <td>Player match stats</td>
              <td className="muted">Imported or entered on Admin &mdash; no free feed has them</td>
              <td className="num">{countPlayerStats()} lines</td>
            </tr>
          </tbody>
        </table>
      </div>

      <footer className="foot">
        Union Pool scores itself from real results. Player squads score from whatever stats
        have been loaded.
      </footer>
    </>
  );
}
