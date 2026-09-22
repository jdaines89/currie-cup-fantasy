import { saveStatLine } from "@/lib/actions";
import { getDb } from "@/lib/db";
import { kickoff } from "@/lib/format";
import {
  listMatches, listRounds, listPlayers, teamsById, teamsWithoutRosters,
} from "@/lib/queries";
import { NewTeamForm } from "../new-team";

export const dynamic = "force-dynamic";

const FIELDS: [string, string][] = [
  ["minutes", "Min"], ["tries", "T"], ["try_assists", "TA"], ["conversions", "C"],
  ["penalties", "P"], ["drop_goals", "DG"], ["tackles", "Tck"], ["carries", "Car"],
  ["metres", "M"], ["turnovers_won", "TO"], ["yellow_cards", "YC"], ["red_cards", "RC"],
];

export default async function AdminPage({ searchParams }: {
  searchParams: Promise<{ match?: string }>;
}) {
  const params = await searchParams;
  const teams = teamsById();
  const matches = listMatches().filter((m) => m.status === "FT");
  const match = matches.find((m) => m.id === params.match);

  const roster = match
    ? listPlayers().filter((p) => p.team_id === match.home_team_id || p.team_id === match.away_team_id)
    : [];

  const existing = match
    ? new Map((getDb().prepare(
        `SELECT * FROM player_match_stats WHERE match_id = ?`,
      ).all(match.id) as Record<string, number>[]).map((r) => [r.player_id, r]))
    : new Map();

  const missing = teamsWithoutRosters();

  return (
    <>
      <div className="card">
        <h2>Enter player stats</h2>
        <p className="sub">
          No free API carries per-player numbers for the Currie Cup, so this is where they come
          from. Pick a match, fill in what you have, and the leaderboard updates as you save.
          For a whole round at once use <code>npm run import:stats -- file.csv</code>.
        </p>

        <div className="rounds">
          {listRounds().map((r) => (
            <span key={r} className="badge">R{r}</span>
          ))}
        </div>

        <table>
          <tbody>
            {matches.map((m) => (
              <tr key={m.id} className={match?.id === m.id ? "me" : ""}>
                <td className="muted small">R{m.round}</td>
                <td style={{ textAlign: "right" }}>{teams.get(m.home_team_id)?.display_name}</td>
                <td className="score" style={{ textAlign: "center", width: 74 }}>
                  {m.home_score}&ndash;{m.away_score}
                </td>
                <td>{teams.get(m.away_team_id)?.display_name}</td>
                <td className="muted small">{kickoff(m.kickoff_utc)}</td>
                <td className="num"><a href={`/admin?match=${m.id}`}>Enter</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {missing.length > 0 && (
        <div className="notice">
          <strong>Squads still to load:</strong> {missing.map((t) => t.display_name).join(", ")}.
          A match involving them will show no players here until you run{" "}
          <code>npm run import:roster -- squads/your-file.csv</code>.
        </div>
      )}

      {match && (
        <div className="card">
          <h2>
            {teams.get(match.home_team_id)?.display_name} {match.home_score}
            &ndash;{match.away_score} {teams.get(match.away_team_id)?.display_name}
          </h2>
          <p className="sub">
            {roster.length
              ? `${roster.length} players. Anyone left on zero minutes scores nothing.`
              : "Neither squad has been loaded yet."}
          </p>

          {roster.map((p) => {
            const row = existing.get(p.id);
            return (
              <form key={p.id} action={saveStatLine} className="pickrow">
                <input type="hidden" name="match_id" value={match.id} />
                <input type="hidden" name="player_id" value={p.id} />
                <span className="grow">
                  <span className="name">{p.name}</span>{" "}
                  <span className="muted small">
                    {teams.get(p.team_id)?.display_name} &middot; {p.position}
                  </span>
                </span>
                {FIELDS.map(([field, label]) => (
                  <label key={field} className="muted small" style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    {label}
                    <input
                      type="number" name={field} min={0} style={{ width: 62 }}
                      defaultValue={row?.[field] ?? 0}
                    />
                  </label>
                ))}
                <button type="submit">Save</button>
              </form>
            );
          })}
        </div>
      )}

      <NewTeamForm heading="Add a team" />
    </>
  );
}
