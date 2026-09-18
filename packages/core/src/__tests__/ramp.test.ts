import { describe, expect, it } from "vitest";
import {
  BAND_EXEMPT_MIN_ROUND,
  VOLATILE_FLOOR,
  bandFor,
  bandForRound,
  gap,
  relaxations,
  statAllowedAtRound,
  withinBand,
} from "../ramp.js";

describe("bandForRound", () => {
  it("opens uncapped so blowouts can be dealt", () => {
    expect(bandForRound(1).ceiling).toBeNull();
    expect(bandForRound(10).ceiling).toBeNull();
  });

  it("caps from round 11", () => {
    expect(bandForRound(11).ceiling).toBe(8);
  });

  it("tightens monotonically across every boundary", () => {
    const rounds = [1, 10, 11, 18, 19, 26, 27, 34, 35, 42, 43, 100];
    const floors = rounds.map((r) => bandForRound(r).floor);
    for (let i = 1; i < floors.length; i++) {
      expect(floors[i]!).toBeLessThanOrEqual(floors[i - 1]!);
    }
  });

  it("reaches the knife edge and stays there", () => {
    expect(bandForRound(43)).toEqual({ floor: 0.3, ceiling: 0.8 });
    expect(bandForRound(500)).toEqual({ floor: 0.3, ceiling: 0.8 });
  });
});

describe("bandFor", () => {
  it("removes the band entirely for band-exempt stats", () => {
    expect(bandFor("clubs", 30)).toEqual({ floor: 0, ceiling: null });
    expect(bandFor("age", 50)).toEqual({ floor: 0, ceiling: null });
  });

  it("holds volatile stats above the volatility floor", () => {
    // Round 43's floor is 0.3, below the volatility floor.
    expect(bandFor("ig", 43).floor).toBe(VOLATILE_FLOOR);
  });

  it("leaves volatile stats alone when the band is already wider", () => {
    expect(bandFor("ig", 1).floor).toBe(2);
  });
});

describe("statAllowedAtRound", () => {
  it("bars band-exempt stats from the opening rounds", () => {
    expect(statAllowedAtRound("clubs", 1)).toBe(false);
    expect(statAllowedAtRound("clubs", BAND_EXEMPT_MIN_ROUND - 1)).toBe(false);
    expect(statAllowedAtRound("clubs", BAND_EXEMPT_MIN_ROUND)).toBe(true);
  });

  it("allows banded stats from round one", () => {
    expect(statAllowedAtRound("club_goals", 1)).toBe(true);
  });
});

describe("gap", () => {
  it("is zero for equal values", () => {
    expect(gap(10, 10)).toBe(0);
  });

  it("is symmetric", () => {
    expect(gap(10, 30)).toBe(gap(30, 10));
  });

  it("expresses a ratio minus one", () => {
    expect(gap(100, 300)).toBe(2);
    expect(gap(100, 150)).toBeCloseTo(0.5);
  });

  it("treats zero against a positive value as infinite", () => {
    expect(gap(0, 5)).toBe(Infinity);
    expect(gap(5, 0)).toBe(Infinity);
  });

  it("treats two zeroes as a tie, not infinity", () => {
    expect(gap(0, 0)).toBe(0);
  });
});

describe("withinBand", () => {
  it("rejects below the floor", () => {
    expect(withinBand(0.2, { floor: 0.3, ceiling: 0.8 })).toBe(false);
  });

  it("rejects above the ceiling", () => {
    expect(withinBand(1.2, { floor: 0.3, ceiling: 0.8 })).toBe(false);
  });

  it("accepts inside", () => {
    expect(withinBand(0.5, { floor: 0.3, ceiling: 0.8 })).toBe(true);
  });

  it("accepts an infinite gap only when uncapped", () => {
    expect(withinBand(Infinity, { floor: 2, ceiling: null })).toBe(true);
    expect(withinBand(Infinity, { floor: 0.3, ceiling: 0.8 })).toBe(false);
  });
});

describe("relaxations", () => {
  it("starts with the requested band", () => {
    const band = { floor: 0.5, ceiling: 1.5 };
    expect(relaxations(band)[0]).toEqual(band);
  });

  it("lifts the ceiling before touching the floor", () => {
    const ladder = relaxations({ floor: 0.5, ceiling: 1.5 });
    // Ceiling reaches null before any floor drops below the original.
    const firstUncapped = ladder.findIndex((b) => b.ceiling === null);
    const firstLowerFloor = ladder.findIndex((b) => b.floor < 0.5);
    expect(firstUncapped).toBeGreaterThan(-1);
    expect(firstUncapped).toBeLessThan(firstLowerFloor);
  });

  it("ends fully open so a pair can always be dealt", () => {
    const ladder = relaxations({ floor: 2, ceiling: null });
    expect(ladder[ladder.length - 1]).toEqual({ floor: 0, ceiling: null });
  });

  it("never widens above the requested floor", () => {
    for (const band of relaxations({ floor: 1, ceiling: 4 })) {
      expect(band.floor).toBeLessThanOrEqual(1);
    }
  });
});
