import { describe, expect, it } from "vitest";
import { scorePlayer, scorePoolPick, type PlayerStatLine } from "../src/lib/scoring";
import { buildLog } from "../src/lib/standings";
import { toPositionGroup } from "../src/lib/positions";

// A real round 7 result: Boland Cavaliers 17 - 48 Griquas.
const bolandGriquas = {
  home_team_id: "142063", away_team_id: "142070",
  home_score: 17, away_score: 48,
};

describe("union pool scoring", () => {
  it("pays the winner for the win, the points and the margin", () => {
    const b = scorePoolPick("142070", bolandGriquas, false);
    expect(b.result).toBe(10);      // win
    expect(b.attack).toBe(9);       // 48 / 5
    expect(b.defence).toBe(-1);     // 17 / 10
    expect(b.bonus).toBe(5);        // won by 31
    expect(b.total).toBe(23);
  });

  it("still pays the loser for points scored", () => {
    const b = scorePoolPick("142063", bolandGriquas, false);
    expect(b.result).toBe(0);
    expect(b.attack).toBe(3);       // 17 / 5
    expect(b.defence).toBe(-4);     // 48 / 10
    expect(b.bonus).toBe(0);        // lost by 31, no narrow-loss bonus
    expect(b.total).toBe(-1);
  });

  it("gives a narrow loser the consolation bonus", () => {
    // Round 1: Pumas 24 - 26 Sharks XV, a two-point margin.
    const b = scorePoolPick("142072", {
      home_team_id: "142072", away_team_id: "142073", home_score: 24, away_score: 26,
    }, false);
    expect(b.bonus).toBe(3);
  });

  it("doubles the captain", () => {
    const plain = scorePoolPick("142070", bolandGriquas, false);
    const capped = scorePoolPick("142070", bolandGriquas, true);
    expect(capped.total).toBe(plain.base * 2);
  });

  it("refuses a union that was not in the match", () => {
    expect(() => scorePoolPick("142062", bolandGriquas, false)).toThrow();
  });
});

const blank: PlayerStatLine = {
  minutes: 0, tries: 0, try_assists: 0, conversions: 0, penalties: 0, drop_goals: 0,
  tackles: 0, carries: 0, metres: 0, turnovers_won: 0, yellow_cards: 0, red_cards: 0,
};

describe("player scoring", () => {
  it("scores a full game with two tries and the boot", () => {
    const b = scorePlayer(
      { ...blank, minutes: 80, tries: 2, conversions: 4, penalties: 1, tackles: 10, carries: 8, metres: 50 },
      true, false,
    );
    // 1 + 2 appearance, 10 + 8 + 3 scoring, 1 + 0.8 + 1 work, 2 team win
    expect(b.appearance).toBe(3);
    expect(b.scoring).toBe(21);
    expect(b.work).toBe(2.8);
    expect(b.teamResult).toBe(2);
    expect(b.total).toBe(28.8);
  });

  it("gives an unused replacement nothing, captain or not", () => {
    expect(scorePlayer(blank, true, true).total).toBe(0);
  });

  it("subtracts for cards", () => {
    const b = scorePlayer({ ...blank, minutes: 60, yellow_cards: 1, red_cards: 1 }, false, false);
    expect(b.discipline).toBe(-7);
  });
});

describe("the log", () => {
  it("matches the published table over the real 2026 season", () => {
    // Every completed 2026 match, home team first.
    const results = [
      ["142072", "142073", 24, 26], ["142075", "142070", 25, 19],
      ["142067", "142068", 29, 27], ["142063", "142062", 24, 10],
      ["142067", "142073", 43, 21], ["142068", "142072", 52, 29],
      ["142070", "142062", 56, 26], ["142063", "142075", 41, 3],
      ["142070", "142067", 24, 21], ["142075", "142073", 36, 28],
      ["142068", "142062", 42, 19], ["142063", "142072", 15, 20],
      ["142070", "142068", 31, 19], ["142062", "142072", 31, 33],
      ["142073", "142063", 19, 12], ["142075", "142067", 26, 31],
      ["142068", "142063", 29, 38], ["142070", "142073", 55, 21],
      ["142072", "142075", 29, 7],  ["142062", "142067", 52, 62],
      ["142072", "142070", 14, 38], ["142062", "142075", 26, 50],
      ["142073", "142068", 22, 22], ["142067", "142063", 33, 24],
      ["142068", "142075", 36, 12], ["142073", "142062", 53, 22],
      ["142072", "142067", 52, 26], ["142063", "142070", 17, 48],
    ].map(([h, a, hs, as_]) => ({
      home_team_id: h as string, away_team_id: a as string,
      home_score: hs as number, away_score: as_ as number,
    }));

    const ids = ["142062", "142063", "142067", "142068", "142070", "142072", "142073", "142075"];
    const log = buildLog(ids, results);
    const byId = new Map(log.map((r) => [r.team_id, r]));

    // Won/drawn/lost as published for the 2026 Currie Cup after seven rounds.
    const published: Record<string, [number, number, number]> = {
      "142070": [6, 0, 1], // Griquas
      "142067": [5, 0, 2], // Cheetahs
      "142072": [4, 0, 3], // Pumas
      "142068": [3, 1, 3], // Lions
      "142073": [3, 1, 3], // Sharks XV
      "142063": [3, 0, 4], // Boland
      "142075": [3, 0, 4], // Stormers XXIII
      "142062": [0, 0, 7], // Bulls XV
    };

    for (const [id, [w, d, l]] of Object.entries(published)) {
      const row = byId.get(id)!;
      expect([row.won, row.drawn, row.lost], `union ${id}`).toEqual([w, d, l]);
      expect(row.played).toBe(7);
    }

    // The full published 2026 final order, top to bottom -- not just the
    // ends. Sharks XV (three wins, a draw) has to outrank Boland Cavaliers
    // (three wins, no draw) despite a worse points difference, because the
    // draw is worth more log points than the difference is worth as a
    // tiebreaker. A sort keyed on win count alone, ignoring draws, gets that
    // pair backwards.
    expect(log.map((r) => r.team_id)).toEqual([
      "142070", // Griquas
      "142067", // Cheetahs
      "142072", // Pumas
      "142068", // Lions
      "142073", // Sharks XV
      "142063", // Boland Cavaliers
      "142075", // Stormers XXIII
      "142062", // Bulls XV
    ]);

    // Without a published bonus table (a season still in progress), the
    // points column falls back to exact win/draw/losing-bonus math -- below
    // the real total by whatever the try bonus would have added.
    expect(byId.get("142070")!.points_exact).toBe(false);
    expect(byId.get("142070")!.estimated_points).toBe(25); // Griquas: 24 + a 2-point loss
    expect(byId.get("142062")!.estimated_points).toBe(1);  // Bulls XV: one narrow loss, nothing else

    // With the season's real bonus-point totals supplied (read off the
    // published 2026 table, data/seed/currie-cup-2026.json), the points
    // column is exact throughout and matches that table exactly.
    const publishedBonus: Record<string, number> = {
      "142070": 7, "142067": 7, "142072": 6, "142068": 6,
      "142073": 4, "142063": 4, "142075": 4, "142062": 6,
    };
    const exactLog = buildLog(ids, results, publishedBonus);
    const exactById = new Map(exactLog.map((r) => [r.team_id, r]));
    const publishedPoints: Record<string, number> = {
      "142070": 31, "142067": 27, "142072": 22, "142068": 20,
      "142073": 18, "142063": 16, "142075": 16, "142062": 6,
    };
    for (const [id, pts] of Object.entries(publishedPoints)) {
      expect(exactById.get(id)!.estimated_points, `union ${id}`).toBe(pts);
      expect(exactById.get(id)!.points_exact, `union ${id}`).toBe(true);
    }
    expect(exactLog.map((r) => r.team_id)).toEqual([
      "142070", "142067", "142072", "142068",
      "142073", "142063", "142075", "142062",
    ]);
  });
});

describe("position mapping", () => {
  it("reads the shapes the unions actually publish", () => {
    expect(toPositionGroup("Loosehead Prop")).toBe("FRONT_ROW");
    expect(toPositionGroup("Hooker")).toBe("FRONT_ROW");
    expect(toPositionGroup("Lock/Flank")).toBe("LOCK");
    expect(toPositionGroup("8th Man")).toBe("LOOSE");
    expect(toPositionGroup("Openside Flank")).toBe("LOOSE");
    expect(toPositionGroup("Scrumhalf")).toBe("HALVES");
    expect(toPositionGroup("Flyhalf")).toBe("HALVES");
    expect(toPositionGroup("Inside Centre")).toBe("CENTRE");
    expect(toPositionGroup("Wing")).toBe("BACK_THREE");
    expect(toPositionGroup("Fullback")).toBe("BACK_THREE");
  });
});
