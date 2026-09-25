import { describe, expect, it } from "vitest";
import { buildDigest, type DigestMate } from "../src/lib/digest";

const matches = [
  { id: "a", home: "Lions", away: "Sharks", finished: false },
  { id: "b", home: "Bulls", away: "Stormers", finished: false },
  { id: "c", home: "Pumas", away: "Griquas", finished: false },
  { id: "d", home: "Boland", away: "Cheetahs", finished: true },
];
const call = (entry_id: number, match_id: string, h: number, a: number, is_banker = false) =>
  ({ entry_id, match_id, home_score: h, away_score: a, is_banker });
const mate = (entry_id: number, name: string, match_id: string, h: number, a: number, is_banker = false): DigestMate =>
  ({ ...call(entry_id, match_id, h, a, is_banker), name });

const mine = [call(1, "a", 24, 17, true), call(1, "b", 20, 13), call(1, "c", 15, 30), call(1, "d", 10, 20)];
const mates = [
  mate(2, "Reeves", "a", 13, 20), mate(3, "Christo", "a", 10, 25),
  mate(2, "Reeves", "b", 27, 10, true), mate(3, "Christo", "b", 10, 12),
  mate(2, "Reeves", "c", 12, 33), mate(3, "Christo", "c", 13, 28),
  mate(2, "Reeves", "d", 30, 10),
];
const table = [
  { entry_id: 1, manager: "Justin", total_points: 40 },
  { entry_id: 2, manager: "Reeves", total_points: 45 },
  { entry_id: 3, manager: "Christo", total_points: 30 },
];

describe("buildDigest", () => {
  const d = buildDigest({ myEntry: 1, mine, mates, matches, table, poolName: "The Originals" })!;

  it("leads with the games where you split, lone calls first", () => {
    expect(d.swings.map((s) => s.match_id)).toEqual(["a", "b"]);
    expect(d.swings[0].text).toBe("You're on your own with Lions by 7. Both mates went Sharks.");
    expect(d.swings[0].tags).toEqual(["Your Banker"]);
    expect(d.swings[1].text).toBe("You've got Bulls by 7. Christo went the other way.");
    expect(d.swings[1].tags).toEqual(["Reeves' Banker"]);
  });

  it("skips finished games and counts the agreed ones", () => {
    expect(d.swings.some((s) => s.match_id === "d")).toBe(false);
    expect(d.agreed).toBe(1);
  });

  it("says where you stand and who you're chasing", () => {
    expect(d.standing).toBe("You're 2nd in The Originals on 40 pts, 5 behind Reeves.");
    expect(d.rival).toBe("You and Reeves split on 1 of 3 games, so this round could swing it.");
  });

  it("falls back to margins when everyone agrees", () => {
    const x = buildDigest({ myEntry: 1, mine, mates: mates.filter((m) => m.match_id === "c"), matches, table: [], poolName: null })!;
    expect(x.swings[0].text).toBe("Everyone has Griquas. You say by 15, mates by 15 to 21.");
    expect(x.standing).toBeNull();
  });

  it("says when you lead", () => {
    const x = buildDigest({ myEntry: 2, mine: mates.filter((m) => m.entry_id === 2), mates: mates.filter((m) => m.entry_id === 3), matches, table, poolName: "The Originals" })!;
    expect(x.standing).toBe("You lead The Originals on 45 pts, 5 clear of Justin.");
  });

  it("returns nothing before any mate's call shows", () => {
    expect(buildDigest({ myEntry: 1, mine, mates: [], matches, table, poolName: "P" })).toBeNull();
  });
});
