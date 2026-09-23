import { describe, expect, it } from "vitest";
import { isRugbyScore, scoreInput } from "../src/lib/rugby";

describe("rugby scores", () => {
  it("allows every total a side can reach", () => {
    for (const n of [0, 3, 5, 6, 7, 8, 9, 10, 11, 22, 99]) expect(isRugbyScore(n)).toBe(true);
  });
  it("refuses 1, 2, 4 and three digits", () => {
    for (const n of [1, 2, 4, 100, 226, -3]) expect(isRugbyScore(n)).toBe(false);
  });
  it("keeps at most two digits", () => {
    expect(scoreInput("226")).toBe("22");
    expect(scoreInput("07")).toBe("7");
    expect(scoreInput("1a5")).toBe("15");
  });
});
