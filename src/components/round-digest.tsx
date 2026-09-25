import { Crest } from "@/components/team";
import type { Digest, Side, SwingGame } from "@/lib/digest";
import type { Team } from "@/lib/types";

function Split({ g, home, away }: { g: SwingGame; home: Team; away: Team }) {
  const seg = (s: Side, cls: string, label: string) => g.counts[s] > 0 && (
    <span className={`${cls}${g.mine === s ? " me" : ""}`} style={{ flex: g.counts[s] }}>
      {label} {g.counts[s]}{g.mine === s && <em>you</em>}
    </span>
  );
  return (
    <div className="crowdbar digestbar" role="img"
      aria-label={`${g.counts.home} on ${home.display_name}, ${g.counts.draw} on a draw, ${g.counts.away} on ${away.display_name}`}>
      {seg("home", "h", home.short_name)}
      {seg("draw", "d", "Draw")}
      {seg("away", "a", away.short_name)}
    </div>
  );
}

/** The round at a glance, above the match cards once mates' calls show. */
export function RoundDigest({ d, round, open, teamsOf }: {
  d: Digest; round: number; open: number; teamsOf: (matchId: string) => [Team, Team];
}) {
  return (
    <section className="recap digest" aria-label={`Round ${round} at a glance`}>
      <div className="recaphead"><h3>Round {round} at a glance</h3></div>
      <p className="digesthead">{d.headline}</p>
      {d.standing && <p className="small muted" style={{ margin: "2px 0 0" }}>{d.standing}</p>}
      <div className="digeststats">
        <div><strong>{d.swings.length + d.moreSwings}</strong><span>swing game{d.swings.length + d.moreSwings === 1 ? "" : "s"}</span></div>
        <div><strong>{d.bold}</strong><span>bold call{d.bold === 1 ? "" : "s"}</span></div>
        <div><strong>{d.agreed}</strong><span>everyone agrees</span></div>
      </div>
      {d.swings.map((g) => {
        const [h, a] = teamsOf(g.match_id);
        return (
          <div key={g.match_id} className={`swing ${g.kind}`}>
            <div className="swinghead">
              <span className="team"><Crest team={h} size={20} /><strong>{h.short_name}</strong><span className="muted">v</span><strong>{a.short_name}</strong><Crest team={a} size={20} /></span>
              <span className={`swingtag ${g.kind}`}>{g.label}</span>
            </div>
            <Split g={g} home={h} away={a} />
            <p className="small" style={{ margin: "6px 0 0" }}>
              {g.text}{g.bankers.map((b) => <span key={b} className="pchip bank2">{b}</span>)}
            </p>
          </div>
        );
      })}
      {(d.moreSwings > 0 || open > 0) && (
        <p className="small muted" style={{ margin: "8px 0 0" }}>
          {d.moreSwings > 0 && <>Plus {d.moreSwings} more split{d.moreSwings === 1 ? "" : "s"} below. </>}
          {open > 0 && <>Lock your other {open} call{open === 1 ? "" : "s"} to see your mates&apos; there too.</>}
        </p>
      )}
    </section>
  );
}
