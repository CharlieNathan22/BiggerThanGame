import { describe, expect, it } from "vitest";
import {
  VOLATILE_FLOOR,
  bandFor,
  bandForRound,
  gap,
  pairFits,
  percentiles,
  rankDistance,
  relaxations,
  withinBand,
} from "../ramp.js";
import { NOW } from "../__fixtures__/deck.js";
import type { Player } from "../types.js";

const forward = (id: string, caps: number, extra: Partial<Player> = {}): Player => ({
  id,
  name: id,
  country: "T",
  position: "FW",
  dob: "1990-01-01",
  stats: { caps, club_goals: caps },
  ...extra,
});

describe("bandForRound", () => {
  it("opens uncapped so blowouts can be dealt", () => {
    expect(bandForRound(1).ceiling).toBeNull();
    expect(bandForRound(10).ceiling).toBeNull();
  });

  it("opens at least 45% of the deck apart", () => {
    expect(bandForRound(1).floor).toBe(0.45);
  });

  it("caps from round 11", () => {
    expect(bandForRound(11).ceiling).toBe(0.7);
  });

  it("tightens monotonically across every boundary", () => {
    const rounds = [1, 10, 11, 18, 19, 26, 27, 34, 35, 42, 43, 100];
    const floors = rounds.map((r) => bandForRound(r).floor);
    const ceilings = rounds.map((r) => bandForRound(r).ceiling ?? 1);
    for (let i = 1; i < rounds.length; i++) {
      expect(floors[i]!).toBeLessThanOrEqual(floors[i - 1]!);
      expect(ceilings[i]!).toBeLessThanOrEqual(ceilings[i - 1]!);
    }
  });

  it("stays within the 0–1 scale of rank distance", () => {
    for (const r of [1, 11, 19, 27, 35, 43]) {
      const b = bandForRound(r);
      expect(b.floor).toBeGreaterThanOrEqual(0);
      expect(b.ceiling ?? 1).toBeLessThanOrEqual(1);
    }
  });

  it("reaches the knife edge and stays there", () => {
    expect(bandForRound(43)).toEqual({ floor: 0.02, ceiling: 0.12 });
    expect(bandForRound(500)).toEqual({ floor: 0.02, ceiling: 0.12 });
  });
});

describe("bandFor", () => {
  it("bands every stat, the former band-exempt ones included", () => {
    for (const stat of ["it", "clubs", "age"] as const) {
      expect(bandFor(stat, 30)).toEqual(bandForRound(30));
    }
  });

  it("adds the volatility floor to volatile stats at every round", () => {
    for (const r of [1, 11, 43]) {
      expect(bandFor("ig", r)).toEqual({ ...bandForRound(r), minRatio: VOLATILE_FLOOR });
    }
  });

  it("leaves other stats without a ratio floor", () => {
    expect(bandFor("caps", 1).minRatio).toBeUndefined();
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

describe("percentiles", () => {
  it("spreads distinct values evenly from 0 to 1", () => {
    const deck = [10, 20, 30, 40, 50].map((c) => forward(`p${c}`, c));
    const table = percentiles(deck, "caps", NOW);
    expect([...table.entries()]).toEqual([
      [10, 0],
      [20, 0.25],
      [30, 0.5],
      [40, 0.75],
      [50, 1],
    ]);
  });

  it("gives tied values their shared mid-rank", () => {
    const deck = [10, 20, 20, 30].map((c, i) => forward(`p${i}`, c));
    const table = percentiles(deck, "caps", NOW);
    // Positions 0..3; the two 20s occupy 1 and 2, so both sit at 1.5 / 3.
    expect(table.get(20)).toBeCloseTo(0.5);
    expect(table.get(10)).toBe(0);
    expect(table.get(30)).toBe(1);
  });

  it("counts only players eligible for the stat", () => {
    const deck = [
      forward("a", 10),
      forward("b", 20),
      forward("keeper", 999, { position: "GK" }), // no club goals for goalkeepers
    ];
    const table = percentiles(deck, "club_goals", NOW);
    expect(table.has(999)).toBe(false);
    expect(table.get(20)).toBe(1);
  });

  it("is memoised per deck, and a different deck gets its own table", () => {
    const deck = [10, 20, 30].map((c) => forward(`p${c}`, c));
    expect(percentiles(deck, "caps", NOW)).toBe(percentiles(deck, "caps", NOW));
    const other = [10, 20, 30, 40].map((c) => forward(`p${c}`, c));
    expect(percentiles(other, "caps", NOW).get(30)).toBeCloseTo(2 / 3);
  });
});

describe("rankDistance", () => {
  const table = new Map([
    [10, 0],
    [20, 0.5],
    [30, 1],
  ]);

  it("is the distance between percentiles, whatever the raw figures", () => {
    expect(rankDistance(table, 10, 30)).toBe(1);
    expect(rankDistance(table, 30, 20)).toBe(0.5);
  });

  it("is NaN for a value the table doesn't hold", () => {
    expect(rankDistance(table, 10, 99)).toBeNaN();
  });
});

describe("withinBand", () => {
  it("rejects below the floor", () => {
    expect(withinBand(0.2, { floor: 0.3, ceiling: 0.8 })).toBe(false);
  });

  it("rejects above the ceiling", () => {
    expect(withinBand(0.9, { floor: 0.3, ceiling: 0.8 })).toBe(false);
  });

  it("accepts inside", () => {
    expect(withinBand(0.5, { floor: 0.3, ceiling: 0.8 })).toBe(true);
  });

  it("rejects NaN, whatever the band", () => {
    expect(withinBand(NaN, { floor: 0, ceiling: null })).toBe(false);
  });
});

describe("pairFits", () => {
  const table = new Map([
    [10, 0],
    [15, 0.25],
    [40, 0.5],
    [90, 1],
  ]);

  it("never fits a tie, even in a fully open band", () => {
    expect(pairFits(table, 40, 40, { floor: 0, ceiling: null })).toBe(false);
  });

  it("measures the band in rank distance", () => {
    expect(pairFits(table, 10, 90, { floor: 0.45, ceiling: null })).toBe(true);
    expect(pairFits(table, 10, 15, { floor: 0.45, ceiling: null })).toBe(false);
  });

  it("also demands the ratio floor when the band carries one", () => {
    // 10 v 15: far enough apart in rank for a 0.2 floor, but only 50% apart as a ratio.
    const band = { floor: 0.2, ceiling: null, minRatio: VOLATILE_FLOOR };
    expect(pairFits(table, 10, 15, band)).toBe(false);
    expect(pairFits(table, 10, 40, band)).toBe(true);
  });
});

describe("relaxations", () => {
  it("starts with the requested band", () => {
    const band = { floor: 0.1, ceiling: 0.35 };
    expect(relaxations(band)[0]).toEqual(band);
  });

  it("lifts the ceiling before touching the floor", () => {
    const ladder = relaxations({ floor: 0.1, ceiling: 0.35 });
    const firstUncapped = ladder.findIndex((b) => b.ceiling === null);
    const firstLowerFloor = ladder.findIndex((b) => b.floor < 0.1);
    expect(firstUncapped).toBeGreaterThan(-1);
    expect(firstUncapped).toBeLessThan(firstLowerFloor);
  });

  it("never lifts a ceiling past the top of the scale", () => {
    for (const band of relaxations({ floor: 0.25, ceiling: 0.7 })) {
      expect(band.ceiling ?? 1).toBeLessThanOrEqual(1);
    }
  });

  it("ends fully open, volatility floor included, so a pair can always be dealt", () => {
    const ladder = relaxations({ floor: 0.45, ceiling: null, minRatio: VOLATILE_FLOOR });
    expect(ladder[ladder.length - 1]).toEqual({ floor: 0, ceiling: null });
    // Every step before the last keeps the volatility floor.
    for (const band of ladder.slice(0, -1)) expect(band.minRatio).toBe(VOLATILE_FLOOR);
  });

  it("never widens above the requested floor", () => {
    for (const band of relaxations({ floor: 0.15, ceiling: 0.5 })) {
      expect(band.floor).toBeLessThanOrEqual(0.15);
    }
  });
});
