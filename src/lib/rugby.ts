/**
 * A score a rugby side can actually post. Points come in 3s (penalty, drop
 * goal), 5s (try), 7s (converted try) and 2s (conversion, only after a try),
 * so every total is reachable except 1, 2 and 4. Mirrors is_rugby_score() in
 * the database, which has the final say.
 */
export function isRugbyScore(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 99 && n !== 1 && n !== 2 && n !== 4;
}

/** What a score box keeps of what was typed: up to two digits. */
export function scoreInput(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 2).replace(/^0(\d)/, "$1");
}
