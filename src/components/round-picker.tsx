"use client";

export function RoundPicker({ rounds, round, onPick, locked }: {
  rounds: number[]; round: number; onPick: (r: number) => void; locked?: Set<number>;
}) {
  return (
    <div className="rounds">
      {rounds.map((r) => (
        <button key={r} type="button" className={`chip ${r === round ? "on" : ""}`} onClick={() => onPick(r)}>
          R{r}{locked?.has(r) ? " ✓" : ""}
        </button>
      ))}
    </div>
  );
}
