import { describe, expect, it } from "vitest";
import { clampOffset, coverScale, sourceRect } from "../src/lib/avatar-crop";

describe("profile picture crop", () => {
  const landscape = { w: 4000, h: 3000 };

  it("scales the short side to fill the frame", () => {
    expect(coverScale(landscape, 240)).toBeCloseTo(240 / 3000);
    expect(coverScale({ w: 1000, h: 2000 }, 240)).toBeCloseTo(240 / 1000);
  });

  it("takes the centre square when nothing is moved", () => {
    expect(sourceRect(landscape, 240, 1, { x: 0, y: 0 })).toEqual({ x: 500, y: 0, side: 3000 });
  });

  it("never lets a drag show an empty edge", () => {
    // At zoom 1 the landscape photo is 320 x 240 on screen: 40px spare each side, none vertically.
    expect(clampOffset({ x: 500, y: 90 }, landscape, 240, 1)).toEqual({ x: 40, y: 0 });
    const r = sourceRect(landscape, 240, 1, { x: 40, y: 0 });
    expect(r.x).toBeCloseTo(0);
  });

  it("zooming in crops a smaller part of the photo", () => {
    const r = sourceRect(landscape, 240, 2, { x: 0, y: 0 });
    expect(r.side).toBeCloseTo(1500);
    expect(r.x).toBeCloseTo(1250);
    expect(r.y).toBeCloseTo(750);
  });
});
