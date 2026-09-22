import { saveSquadPicks } from "@/lib/actions";
import { resolveEntry } from "@/lib/entry";
import { pts } from "@/lib/format";
import { PLAYER_RULES } from "@/lib/scoring";
import {
  countPlayerStats, listPlayers, listRounds, roundLocked, scoresForEntry,
  seasonComplete, squadPicks, teamsById, teamsWithoutRosters,
} from "@/lib/queries";
import { EntrySwitcher } from "../entry-switcher";
import { NewTeamForm } from "../new-team";
import { SquadPicker, type PickerPlayer } from "./squad-picker";

export const dynamic = "force-dynamic";

export default async function SquadPage({ searchParams }: {
  searchParams: Promise<{ entry?: string; round?: string }>;
}) {
  const params = await searchParams;
  const { entry, all } = resolveEntry(params.entry);
  if (!entry) return <NewTeamForm heading="Start a team to pick a squad" />;

  const rounds = listRounds();
  const round = Number(params.round) || rounds[rounds.length - 1] || 1;
  const teams = teamsById();
  const locked = roundLocked(round);

  const players: PickerPlayer[] = listPlayers().map((p) => ({
    id: p.id, name: p.name, position: p.position, position_group: p.position_group,
    price: p.price, team: teams.get(p.team_id)?.display_name ?? p.team_id,
  }));

  const picks = squadPicks(entry.id, round);
  const scored = scoresForEntry(entry.id).find((s) => s.round === round && s.mode === "player");
  const missingRosters = teamsWithoutRosters();
  const statLines = countPlayerStats();

  if (players.length === 0) {
    return (
      <div className="card">
        <h2>No players yet</h2>
        <p className="sub">
          No free sports API publishes Currie Cup squads, so rosters are loaded rather than
          fetched. Run <code>npm run seed</code> for the three squads that ship with the repo,
          or <code>npm run import:roster -- squads/your-file.csv</code> for the rest.
        </p>
      </div>
    );
  }

  return (
    <>
      <EntrySwitcher entries={all} current={entry} path="/squad" />

      <div className="rounds">
        {rounds.map((r) => (
          <a key={r} href={`/squad?entry=${entry.id}&round=${r}`} className={r === round ? "on" : ""}>
            R{r}
          </a>
        ))}
      </div>

      {missingRosters.length > 0 && (
        <div className="notice">
          <strong>{missingRosters.length} of 8 unions have no squad loaded</strong> &mdash;{" "}
          {missingRosters.map((t) => t.display_name).join(", ")}. Their sites block automated
          reads, so add them with <code>npm run import:roster</code> or on the Admin screen.
        </div>
      )}

      {statLines === 0 && (
        <div className="notice">
          <strong>No player stats yet.</strong> Squads score from per-player match numbers,
          which no free feed carries for this competition. Enter a match on the Admin screen or
          run <code>npm run import:stats</code>, and this squad scores immediately. The Union
          Pool needs none of that.
        </div>
      )}

      <div className="card">
        <h2>Round {round} squad</h2>
        <p className="sub">
          {locked ? "This round is locked." : "Fifteen starters, four on the bench, one captain."}
          {scored && <> You scored <strong>{pts(scored.points)}</strong> here.</>}
          {seasonComplete() && " Replay mode: every round is open."}
        </p>
      </div>

      <form action={saveSquadPicks}>
        <input type="hidden" name="entry_id" value={entry.id} />
        <input type="hidden" name="round" value={round} />
        <SquadPicker
          players={players}
          initialStarters={picks.filter((p) => !p.is_bench).map((p) => p.player_id)}
          initialBench={picks.filter((p) => p.is_bench).map((p) => p.player_id)}
          initialCaptain={picks.find((p) => p.is_captain)?.player_id ?? null}
          locked={locked}
        />
      </form>

      <div className="card">
        <h2>How a player scores</h2>
        <table>
          <tbody>
            <tr><td>Took the field</td><td className="num">{PLAYER_RULES.appearance}</td></tr>
            <tr><td>{PLAYER_RULES.fullGameMinutes}+ minutes</td><td className="num">+{PLAYER_RULES.fullGame}</td></tr>
            <tr><td>Try</td><td className="num">{PLAYER_RULES.try}</td></tr>
            <tr><td>Try assist</td><td className="num">{PLAYER_RULES.tryAssist}</td></tr>
            <tr><td>Conversion</td><td className="num">{PLAYER_RULES.conversion}</td></tr>
            <tr><td>Penalty / drop goal</td><td className="num">{PLAYER_RULES.penalty}</td></tr>
            <tr><td>Turnover won</td><td className="num">{PLAYER_RULES.turnoverWon}</td></tr>
            <tr><td>Tackle / carry</td><td className="num">{PLAYER_RULES.perTackle}</td></tr>
            <tr><td>Metre carried</td><td className="num">{PLAYER_RULES.perMetre}</td></tr>
            <tr><td>Team won</td><td className="num">+{PLAYER_RULES.teamWin}</td></tr>
            <tr><td>Yellow card</td><td className="num">{PLAYER_RULES.yellowCard}</td></tr>
            <tr><td>Red card</td><td className="num">{PLAYER_RULES.redCard}</td></tr>
            <tr><td>Captain</td><td className="num">&times;{PLAYER_RULES.captainMultiplier}</td></tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
