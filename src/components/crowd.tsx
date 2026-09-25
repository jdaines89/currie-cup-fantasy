import type { Team } from "@/lib/types";

// One row from the match_crowd function: totals across every player in the
// tournament. The split is null below 3 calls so no single call can be read off it.
export interface CrowdRow {
  match_id: string; calls: number;
  home_wins: number | null; draws: number | null; away_wins: number | null;
  avg_home: number | null; avg_away: number | null;
  top_home: number | null; top_away: number | null; top_calls: number | null;
}

const pct = (n: number, of: number) => Math.round((100 * n) / of);

export function Crowd({ c, home, away }: { c: CrowdRow; home?: Team; away?: Team }) {
  const split = c.home_wins !== null && c.draws !== null && c.away_wins !== null;
  return (
    <div className="crowd">
      <div className="crowdhead">
        <span>The crowd</span>
        <span className="muted">{c.calls} call{c.calls === 1 ? "" : "s"} across the tournament</span>
      </div>
      {split ? (
        <>
          <div className="crowdbar" role="img"
            aria-label={`${pct(c.home_wins!, c.calls)}% ${home?.display_name ?? "home"}, ${pct(c.draws!, c.calls)}% draw, ${pct(c.away_wins!, c.calls)}% ${away?.display_name ?? "away"}`}>
            {c.home_wins! > 0 && <span className="h" style={{ flex: c.home_wins! }}>{home?.short_name} {pct(c.home_wins!, c.calls)}%</span>}
            {c.draws! > 0 && <span className="d" style={{ flex: c.draws! }}>Draw {pct(c.draws!, c.calls)}%</span>}
            {c.away_wins! > 0 && <span className="a" style={{ flex: c.away_wins! }}>{away?.short_name} {pct(c.away_wins!, c.calls)}%</span>}
          </div>
          <p className="small muted" style={{ margin: "6px 0 0" }}>
            Most called <strong className="txt">{c.top_home}–{c.top_away}</strong> ({c.top_calls}) · Average <strong className="txt">{c.avg_home}–{c.avg_away}</strong>
          </p>
        </>
      ) : (
        <p className="small muted" style={{ margin: "4px 0 0" }}>The split shows once 3 players have locked a call.</p>
      )}
    </div>
  );
}
