export function kickoff(iso: string): string {
  // Kickoffs are stored in UTC; the competition is played in SAST (UTC+2).
  const d = new Date(iso);
  return d.toLocaleString("en-ZA", {
    timeZone: "Africa/Johannesburg",
    weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

export function matchDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-ZA", {
    timeZone: "Africa/Johannesburg", day: "numeric", month: "short",
  });
}

export function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

export function pts(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, "");
}
