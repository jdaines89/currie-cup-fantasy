"use client";

import { useMemo, useState } from "react";
import {
  BENCH_SIZE, GROUP_LABELS, POSITION_GROUPS, SALARY_CAP, STARTING_XV,
  type PositionGroup,
} from "@/lib/positions";

export interface PickerPlayer {
  id: number;
  name: string;
  position: string;
  position_group: PositionGroup;
  price: number;
  team: string;
}

export function SquadPicker({ players, initialStarters, initialBench, initialCaptain, locked }: {
  players: PickerPlayer[];
  initialStarters: number[];
  initialBench: number[];
  initialCaptain: number | null;
  locked: boolean;
}) {
  const [starters, setStarters] = useState<number[]>(initialStarters);
  const [bench, setBench] = useState<number[]>(initialBench);
  const [captain, setCaptain] = useState<number | null>(initialCaptain);
  const [union, setUnion] = useState<string>("");

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const unions = useMemo(
    () => [...new Set(players.map((p) => p.team))].sort(),
    [players],
  );

  const chosen = [...starters, ...bench];
  const spend = chosen.reduce((sum, id) => sum + (byId.get(id)?.price ?? 0), 0);
  const remaining = Math.round((SALARY_CAP - spend) * 10) / 10;

  const counts = POSITION_GROUPS.reduce((acc, g) => {
    acc[g] = starters.filter((id) => byId.get(id)?.position_group === g).length;
    return acc;
  }, {} as Record<PositionGroup, number>);

  const shortfalls = POSITION_GROUPS.filter((g) => counts[g] !== STARTING_XV[g]);
  const valid =
    !locked &&
    shortfalls.length === 0 &&
    bench.length === BENCH_SIZE &&
    remaining >= 0 &&
    captain !== null &&
    starters.includes(captain);

  function toggleStarter(id: number) {
    setStarters((prev) => {
      if (prev.includes(id)) {
        if (captain === id) setCaptain(null);
        return prev.filter((x) => x !== id);
      }
      const group = byId.get(id)!.position_group;
      const inGroup = prev.filter((x) => byId.get(x)?.position_group === group).length;
      if (inGroup >= STARTING_XV[group]) return prev;
      setBench((b) => b.filter((x) => x !== id));
      return [...prev, id];
    });
  }

  function toggleBench(id: number) {
    setBench((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= BENCH_SIZE) return prev;
      setStarters((s) => {
        if (captain === id) setCaptain(null);
        return s.filter((x) => x !== id);
      });
      return [...prev, id];
    });
  }

  const visible = union ? players.filter((p) => p.team === union) : players;

  return (
    <>
      <div className="card">
        <div className="cap">
          <span className={`big ${remaining < 0 ? "over" : ""}`}>{remaining.toFixed(1)}</span>
          <span className="muted">credits left of {SALARY_CAP}</span>
          <span className="muted" style={{ marginLeft: "auto" }}>
            {starters.length}/15 starters &middot; {bench.length}/{BENCH_SIZE} bench
          </span>
        </div>

        <div className="rounds">
          {POSITION_GROUPS.map((g) => (
            <span key={g} className={`badge ${counts[g] === STARTING_XV[g] ? "win" : ""}`}>
              {GROUP_LABELS[g]} {counts[g]}/{STARTING_XV[g]}
            </span>
          ))}
        </div>

        {!locked && !valid && (
          <p className="sub" style={{ marginTop: 12, marginBottom: 0 }}>
            {remaining < 0
              ? "Over the cap."
              : shortfalls.length
                ? `Still to fill: ${shortfalls.map((g) => GROUP_LABELS[g]).join(", ")}.`
                : bench.length !== BENCH_SIZE
                  ? `Pick ${BENCH_SIZE - bench.length} more on the bench.`
                  : "Nominate a captain from your starting XV."}
          </p>
        )}
      </div>

      {starters.map((id) => <input key={`s${id}`} type="hidden" name="starter" value={id} />)}
      {bench.map((id) => <input key={`b${id}`} type="hidden" name="bench" value={id} />)}
      {captain !== null && <input type="hidden" name="captain" value={captain} />}

      <div className="card">
        <h2>Players</h2>
        <p className="sub">
          Tick to start, B for the bench, star for captain. Bench players do not score.
        </p>

        <div className="rounds">
          <a href="#" onClick={(e) => { e.preventDefault(); setUnion(""); }} className={union === "" ? "on" : ""}>
            All unions
          </a>
          {unions.map((u) => (
            <a key={u} href="#" onClick={(e) => { e.preventDefault(); setUnion(u); }} className={union === u ? "on" : ""}>
              {u}
            </a>
          ))}
        </div>

        {POSITION_GROUPS.map((group) => {
          const rows = visible.filter((p) => p.position_group === group);
          if (!rows.length) return null;
          return (
            <div key={group} style={{ marginBottom: 18 }}>
              <h3 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--muted)" }}>
                {GROUP_LABELS[group]} &middot; need {STARTING_XV[group]}
              </h3>
              {rows.map((p) => {
                const isStarter = starters.includes(p.id);
                const isBench = bench.includes(p.id);
                return (
                  <div key={p.id} className={`pickrow ${isStarter ? "on" : ""}`}>
                    <input
                      type="checkbox" checked={isStarter} disabled={locked}
                      onChange={() => toggleStarter(p.id)} aria-label={`Start ${p.name}`}
                    />
                    <span className="grow">
                      <span className="name">{p.name}</span>{" "}
                      <span className="muted small">{p.team} &middot; {p.position}</span>
                    </span>
                    <span className="score">{p.price.toFixed(1)}</span>
                    <button
                      type="button" className="ghost" disabled={locked}
                      style={isBench ? { borderColor: "var(--gold)", color: "var(--gold)" } : undefined}
                      onClick={() => toggleBench(p.id)}
                    >
                      B
                    </button>
                    <button
                      type="button" className="ghost" disabled={locked || !isStarter}
                      style={captain === p.id ? { borderColor: "var(--gold)", color: "var(--gold)" } : undefined}
                      onClick={() => setCaptain(p.id)}
                    >
                      ★
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}

        <button type="submit" disabled={!valid}>Save squad</button>
      </div>
    </>
  );
}
