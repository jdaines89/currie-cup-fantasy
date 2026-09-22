import type { PositionGroup } from "./positions";

/**
 * With no per-player stats to value players on, price is built from the two
 * things we do know for certain: what position someone plays, and how well
 * their union is actually going this season.
 *
 * Re-run `npm run score` after an ingest and prices move with the log.
 */
const GROUP_BASE: Record<PositionGroup, number> = {
  FRONT_ROW: 4.2,
  LOCK: 4.2,
  LOOSE: 4.8,
  HALVES: 5.5,
  CENTRE: 4.8,
  BACK_THREE: 5.2,
};

const SPREAD = 2.0; // best union's players cost this much more than the worst

/*
 * These are set so a nineteen-man squad from the weakest unions comes in around
 * seventy credits and one built entirely from the strongest runs past a hundred.
 * The cap has to bite somewhere, and that is where.
 */

export function priceFor(group: PositionGroup, teamStrength: number): number {
  const price = GROUP_BASE[group] + SPREAD * (teamStrength - 0.5);
  return Math.round(price * 10) / 10;
}

/**
 * Where a union sits between worst (0) and best (1) on points difference.
 * A league with no results yet puts everyone in the middle.
 */
export function teamStrengths(diffs: Map<string, number>): Map<string, number> {
  const values = [...diffs.values()];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  return new Map(
    [...diffs].map(([id, d]) => [id, span === 0 ? 0.5 : (d - min) / span]),
  );
}
