import { savePoolPicks } from "@/lib/actions";
import { resolveEntry } from "@/lib/entry";
import { kickoff, pts } from "@/lib/format";
import {
  listMatchesForRound, listRounds, poolPicks, roundLocked,
  scoresForEntry, seasonComplete, teamsById,
} from "@/lib/queries";
import { POOL_RULES } from "@/lib/scoring";
import { EntrySwitcher } from "../entry-switcher";
import { NewTeamForm } from "../new-team";

export const dynamic = "force-dynamic";

const PICKS_PER_ROUND = 4;

export default async function PoolPage({ searchParams }: {
  searchParams: Promise<{ entry?: string; round?: string }>;
}) {
  const params = await searchParams;
  const { entry, all } = resolveEntry(params.entry);
  if (!entry) return <NewTeamForm heading="Start a team to play the union pool" />;

  const rounds = listRounds();
  const round = Number(params.round) || rounds[rounds.length - 1] || 1;
  const teams = teamsById();
  const matches = listMatchesForRound(round);
  const picks = poolPicks(entry.id, round);
  const picked = new Set(picks.map((p) => p.team_id));
  const captain = picks.find((p) => p.is_captain)?.team_id ?? "";
  const locked = roundLocked(round);
  const scored = scoresForEntry(entry.id).find((s) => s.round === round && s.mode === "pool");

  return (
    <>
      <EntrySwitcher entries={all} current={entry} path="/pool" />

      <div className="rounds">
        {rounds.map((r) => (
          <a key={r} href={`/pool?entry=${entry.id}&round=${r}`} className={r === round ? "on" : ""}>
            R{r}
          </a>
        ))}
      </div>

      {seasonComplete() && (
        <div className="notice">
          <strong>Replay mode.</strong> Every match in the database has been played, so picks
          are open on all rounds and you are playing the season back. Ingest a live round
          and picks lock at kickoff again.
        </div>
      )}

      <div className="card">
        <h2>Round {round} &mdash; pick {PICKS_PER_ROUND} unions</h2>
        <p className="sub">
          {locked
            ? "This round is locked."
            : `Tick ${PICKS_PER_ROUND} unions and star one as captain to double its score.`}
          {scored && <> You scored <strong>{pts(scored.points)}</strong> here.</>}
        </p>

        <form action={savePoolPicks}>
          <input type="hidden" name="entry_id" value={entry.id} />
          <input type="hidden" name="round" value={round} />

          {matches.map((m) => {
            const home = teams.get(m.home_team_id)!;
            const away = teams.get(m.away_team_id)!;
            const played = m.home_score !== null;
            return (
              <div key={m.id} style={{ marginBottom: 14 }}>
                <div className="muted small" style={{ marginBottom: 6 }}>
                  {kickoff(m.kickoff_utc)} &middot; {m.venue}
                  {played && <> &middot; <span className="score">{m.home_score}&ndash;{m.away_score}</span></>}
                </div>
                {[home, away].map((t) => (
                  <label key={t.id} className={`pickrow ${picked.has(t.id) ? "on" : ""}`}>
                    <input
                      type="checkbox" name="team" value={t.id}
                      defaultChecked={picked.has(t.id)} disabled={locked}
                    />
                    <span className="grow">
                      <span className="name">{t.display_name}</span>
                      <span className="muted small"> &middot; {t.stadium}</span>
                    </span>
                    <span className="small muted">captain</span>
                    <input
                      type="radio" name="captain" value={t.id}
                      defaultChecked={captain === t.id} disabled={locked}
                    />
                  </label>
                ))}
              </div>
            );
          })}

          <button type="submit" disabled={locked}>Save round {round} picks</button>
        </form>
      </div>

      <div className="card">
        <h2>How a union scores</h2>
        <p className="sub">Straight off the real result. Nothing to enter by hand.</p>
        <table>
          <tbody>
            <tr><td>Win</td><td className="num">{POOL_RULES.win}</td></tr>
            <tr><td>Draw</td><td className="num">{POOL_RULES.draw}</td></tr>
            <tr><td>Every {POOL_RULES.pointsScoredPer} points scored</td><td className="num">+1</td></tr>
            <tr><td>Every {POOL_RULES.pointsConcededPer} points conceded</td><td className="num">&minus;1</td></tr>
            <tr><td>Winning by {POOL_RULES.bigWinMargin}+</td><td className="num">+{POOL_RULES.bigWinBonus}</td></tr>
            <tr><td>Losing by {POOL_RULES.narrowLossMargin} or less</td><td className="num">+{POOL_RULES.narrowLossBonus}</td></tr>
            <tr><td>Captain</td><td className="num">&times;{POOL_RULES.captainMultiplier}</td></tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
