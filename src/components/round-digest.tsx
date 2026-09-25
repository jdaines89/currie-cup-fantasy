import type { Digest } from "@/lib/digest";

/** The round at a glance, above the match cards once mates' calls show. */
export function RoundDigest({ d, round, open }: { d: Digest; round: number; open: number }) {
  return (
    <section className="recap digest" aria-label={`Round ${round} at a glance`}>
      <div className="recaphead"><h3>Round {round} at a glance</h3></div>
      {(d.standing || d.rival) && <p className="digeststand">{d.standing} {d.rival}</p>}
      <dl>
        {d.swings.map((g) => (
          <div key={g.match_id}>
            <dt>{g.title}{g.tags.map((t) => <span key={t} className="pchip bank2">{t}</span>)}</dt>
            <dd>{g.text}</dd>
          </div>
        ))}
      </dl>
      {(d.agreed > 0 || open > 0) && (
        <p className="small muted" style={{ margin: "8px 0 0" }}>
          {d.agreed > 0 && <>Same winner as everyone in {d.agreed} game{d.agreed === 1 ? "" : "s"}. </>}
          {open > 0 && <>Lock your other {open} call{open === 1 ? "" : "s"} to see mates there too.</>}
        </p>
      )}
    </section>
  );
}
