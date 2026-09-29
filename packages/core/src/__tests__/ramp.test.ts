import { describe, expect, it } from "vitest";
import {
  BAND_SCHEDULES,
  FINAL_STRETCH,
  FINE_CEILING_STEP,
  PAIR_RULES,
  RELAXATION_LADDERS,
  VOLATILE_FLOOR,
  bandFor,
  bandForRound,
  gap,
  meetsValueRule,
  pairFits,
  percentiles,
  rankDistance,
  relaxations,
  withinBand,
} from "../ramp.js";
import { STATS, STAT_KEYS } from "../stats.js";
import { NOW } from "../__fixtures__/deck.js";
import { WIN_ROUNDS } from "../sequence.js";
import type { Player, StatKey } from "../types.js";

const forward = (id: string, caps: number, extra: Partial<Player> = {}): Player => ({
  id,
  name: id,
  country: "T",
  position: "FW",
  dob: "1990-01-01",
  stats: { caps, club_goals: caps },
  ...extra,
});

describe("bandForRound, the long schedule (Ranked)", () => {
  const band = (round: number) => bandForRound(round, "ranked");

  it("is Ranked's alone: Endless has its own", () => {
    expect(BAND_SCHEDULES.endless).not.toBe(BAND_SCHEDULES.ranked);
  });

  it("opens uncapped so blowouts can be dealt", () => {
    expect(band(1).ceiling).toBeNull();
    expect(band(10).ceiling).toBeNull();
  });

  it("opens at least 45% of the deck apart", () => {
    expect(band(1).floor).toBe(0.45);
  });

  it("caps from round 11", () => {
    expect(band(11).ceiling).toBe(0.7);
  });

  it("tightens monotonically across every boundary", () => {
    const rounds = [1, 10, 11, 18, 19, 26, 27, 34, 35, 42, 43, 100];
    const floors = rounds.map((r) => band(r).floor);
    const ceilings = rounds.map((r) => band(r).ceiling ?? 1);
    for (let i = 1; i < rounds.length; i++) {
      expect(floors[i]!).toBeLessThanOrEqual(floors[i - 1]!);
      expect(ceilings[i]!).toBeLessThanOrEqual(ceilings[i - 1]!);
    }
  });

  it("stays within the 0–1 scale of rank distance", () => {
    for (const r of [1, 11, 19, 27, 35, 43]) {
      const b = band(r);
      expect(b.floor).toBeGreaterThanOrEqual(0);
      expect(b.ceiling ?? 1).toBeLessThanOrEqual(1);
    }
  });

  it("reaches the knife edge and stays there", () => {
    expect(band(43)).toEqual({ floor: 0.02, ceiling: 0.12 });
    expect(band(500)).toEqual({ floor: 0.02, ceiling: 0.12 });
  });
});

describe("bandForRound, Friendly's twenty rounds", () => {
  const rounds = Array.from({ length: WIN_ROUNDS.friendly! }, (_, i) => i + 1);
  const band = (round: number) => bandForRound(round, "friendly");

  it("opens as generously as the long schedule", () => {
    expect(band(1)).toEqual(bandForRound(1, "ranked"));
  });

  it("keeps rounds 1–5 on the opening band and 6–10 uncapped", () => {
    for (const r of rounds.slice(0, 5)) expect(band(r)).toEqual({ floor: 0.45, ceiling: null });
    for (const r of rounds.slice(5, 10)) expect(band(r)).toEqual({ floor: 0.35, ceiling: null });
  });

  it("never gets easier from round 5 on", () => {
    for (const r of rounds.slice(4)) {
      expect(band(r).floor).toBeLessThanOrEqual(band(r - 1).floor);
      expect(band(r).ceiling ?? 1).toBeLessThanOrEqual(band(r - 1).ceiling ?? 1);
    }
  });

  it("makes the final question strictly the hardest band in the run, and capped", () => {
    const last = band(WIN_ROUNDS.friendly!);
    expect(last.ceiling).not.toBeNull();
    for (const r of rounds.slice(0, -1)) {
      expect(last.floor).toBeLessThan(band(r).floor);
      expect(last.ceiling!).toBeLessThan(band(r).ceiling ?? 1);
    }
  });

  it("stays within the 0–1 scale of rank distance", () => {
    for (const r of rounds) {
      expect(band(r).floor).toBeGreaterThan(0);
      expect(band(r).ceiling ?? 1).toBeLessThanOrEqual(1);
    }
  });
});

describe("the final stretch", () => {
  it("is Friendly's rounds 18–20, at least 10% apart", () => {
    expect(FINAL_STRETCH).toEqual({
      friendly: { from: 18, minRatio: 0.1 },
      endless: null,
      ranked: null,
    });
  });

  it("adds a strict ratio floor to Friendly's rounds 18–20 only", () => {
    for (let r = 1; r <= 20; r++) {
      expect(bandFor("caps", r, "friendly").strictMinRatio).toBe(r >= 18 ? 0.1 : undefined);
    }
  });

  it("is on top of the volatility floor, not instead of it", () => {
    expect(bandFor("ig", 20, "friendly")).toEqual({
      ...bandForRound(20, "friendly"),
      minRatio: VOLATILE_FLOOR,
      strictMinRatio: 0.1,
    });
  });

  it("never touches Endless or Ranked", () => {
    for (const r of [1, 18, 19, 20, 43]) {
      expect(bandFor("caps", r, "ranked")).toEqual(bandForRound(r, "ranked"));
      expect(bandFor("ig", r, "ranked")).toEqual({
        ...bandForRound(r, "ranked"),
        minRatio: VOLATILE_FLOOR,
      });
    }
    // Endless's late rounds have their own rules (PAIR_RULES), tested below.
    for (const r of [1, 5, 10, 15]) {
      expect(bandFor("caps", r, "endless")).toEqual(bandForRound(r, "endless"));
    }
  });
});

describe("Endless's schedule", () => {
  const rows = BAND_SCHEDULES.endless;
  const band = (round: number) => bandForRound(round, "endless");

  it("opens exactly as Friendly for the five rounds that prefer iconic names", () => {
    for (let r = 1; r <= 5; r++) {
      for (const key of STAT_KEYS) {
        expect(bandFor(key, r, "endless")).toEqual(bandFor(key, r, "friendly"));
      }
      expect(band(r)).toEqual({ floor: 0.45, ceiling: null });
    }
  });

  it("never gets easier from round 5 on: floor and ceiling never rise", () => {
    for (let r = 5; r < 200; r++) {
      const a = band(r);
      const b = band(r + 1);
      expect(b.floor).toBeLessThanOrEqual(a.floor);
      expect(b.ceiling ?? Infinity).toBeLessThanOrEqual(a.ceiling ?? Infinity);
    }
  });

  it("is capped from round 6", () => {
    for (let r = 6; r <= 150; r++) expect(band(r).ceiling).not.toBeNull();
  });

  it("keeps tightening after round 20 rather than levelling off", () => {
    const after20 = rows.filter((row, i) => i > 0 && rows[i - 1]!.upTo >= 20);
    expect(after20.length).toBeGreaterThanOrEqual(2);
    expect(band(150).ceiling!).toBeLessThan(band(20).ceiling!);
  });

  it("is written to two decimals, so the analytics labels are exact", () => {
    for (const { band: b } of rows) {
      for (const v of [b.floor, b.ceiling ?? 0]) {
        expect(Math.round(v * 100) / 100).toBe(v);
      }
    }
  });
});

describe("Endless's pair rules", () => {
  const rules = PAIR_RULES.endless!;
  const narrow = Object.keys(rules.narrow) as StatKey[];
  const wide = STAT_KEYS.filter((k) => !narrow.includes(k));
  const band = (round: number) => bandForRound(round, "endless");

  it("start at round 16 for age, international trophies and clubs played for", () => {
    expect(rules.from).toBe(16);
    expect(rules.wideMinRatio).toBe(0.1);
    expect(rules.narrow).toEqual({
      age: { kind: "relative", max: 0.1 },
      it: { kind: "difference", min: 1, max: 2 },
      clubs: { kind: "difference", min: 1, max: 2 },
    });
    expect(PAIR_RULES.friendly).toBeNull();
    expect(PAIR_RULES.ranked).toBeNull();
  });

  it("pair a narrow stat by value in place of the band from round 16, and not before", () => {
    for (const key of narrow) {
      expect(bandFor(key, 15, "endless").valueRule).toBeUndefined();
      for (const r of [16, 20, 30, 150]) {
        expect(bandFor(key, r, "endless")).toEqual({
          floor: 0,
          ceiling: null,
          valueRule: rules.narrow[key],
        });
      }
    }
  });

  it("add a 10% floor to every wide stat from round 16, on top of Instagram's", () => {
    for (const key of wide) {
      expect(bandFor(key, 15, "endless").strictMinRatio).toBeUndefined();
      for (const r of [16, 25, 150]) {
        const b = bandFor(key, r, "endless");
        expect(b.strictMinRatio).toBe(0.1);
        expect(b.floor).toBe(band(r).floor);
        expect(b.minRatio).toBe(STATS[key].volatile === true ? VOLATILE_FLOOR : undefined);
      }
    }
  });

  it("are kept at every relaxation step", () => {
    for (const key of STAT_KEYS) {
      for (const r of [16, 21, 31]) {
        const b = bandFor(key, r, "endless");
        for (const step of relaxations(b, RELAXATION_LADDERS.endless)) {
          if (b.valueRule !== undefined) expect(step).toEqual(b);
          else expect(step.strictMinRatio).toBe(0.1);
        }
      }
    }
  });
});

describe("value rules", () => {
  const age = { kind: "relative", max: 0.1 } as const;
  const small = { kind: "difference", min: 1, max: 2 } as const;

  it("never admit a tie", () => {
    expect(meetsValueRule(50, 50, age)).toBe(false);
    expect(meetsValueRule(2, 2, small)).toBe(false);
  });

  it("take ages within 10% of each other, 50 against 54 or 55, not 56", () => {
    expect(meetsValueRule(50, 54, age)).toBe(true);
    expect(meetsValueRule(55, 50, age)).toBe(true);
    expect(meetsValueRule(50, 56, age)).toBe(false);
  });

  it("take small counts one or two apart", () => {
    expect(meetsValueRule(0, 1, small)).toBe(true);
    expect(meetsValueRule(3, 1, small)).toBe(true);
    expect(meetsValueRule(1, 4, small)).toBe(false);
  });

  it("replace the rank band in pairFits, and need both values in the deck", () => {
    const table = new Map([
      [1, 0],
      [2, 0.5],
      [5, 1],
    ]);
    const b = { floor: 0.9, ceiling: 0.95, valueRule: small };
    expect(pairFits(table, 1, 2, b)).toBe(true); // rank 0.5, far outside the band
    expect(pairFits(table, 2, 5, b)).toBe(false); // 3 apart
    expect(pairFits(table, 1, 3, b)).toBe(false); // 3 isn't in the table
  });

  it("can't relax: a value-rule band's ladder is the band alone", () => {
    const b = { floor: 0, ceiling: null, valueRule: age };
    expect(relaxations(b)).toEqual([b]);
    expect(relaxations(b, "fine")).toEqual([b]);
  });
});

describe("relaxation ladders", () => {
  it("are coarse for Friendly and Ranked, fine for Endless", () => {
    expect(RELAXATION_LADDERS).toEqual({ friendly: "coarse", endless: "fine", ranked: "coarse" });
  });

  it("fine lifts the ceiling by half again at each step up to 1, then drops it, then the floor", () => {
    const steps = relaxations({ floor: 0.02, ceiling: 0.04, strictMinRatio: 0.1 }, "fine");
    const ceilings = steps.map((s) => s.ceiling);
    const lifted = ceilings.slice(1, ceilings.indexOf(null));
    expect(lifted[0]).toBeCloseTo(0.04 * FINE_CEILING_STEP);
    for (let i = 1; i < lifted.length; i++) {
      expect(lifted[i]!).toBeGreaterThan(lifted[i - 1]!);
    }
    expect(lifted.at(-1)).toBe(1);
    expect(steps.at(-1)).toEqual({ floor: 0, ceiling: null, strictMinRatio: 0.1 });
    for (const s of steps) expect(s.strictMinRatio).toBe(0.1);
  });

  it("coarse is the ladder every existing run was dealt with", () => {
    expect(relaxations({ floor: 0.25, ceiling: 0.7 })).toEqual(
      relaxations({ floor: 0.25, ceiling: 0.7 }, "coarse"),
    );
    expect(relaxations({ floor: 0.25, ceiling: 0.7 }).map((b) => b.ceiling)).toEqual([
      0.7,
      1,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });
});

describe("bandFor", () => {
  it("bands every stat, the former band-exempt ones included", () => {
    for (const stat of ["it", "clubs", "age"] as const) {
      expect(bandFor(stat, 30, "ranked")).toEqual(bandForRound(30, "ranked"));
      expect(bandFor(stat, 15, "friendly")).toEqual(bandForRound(15, "friendly"));
    }
  });

  it("adds the volatility floor to volatile stats at every round, in every mode", () => {
    for (const mode of ["friendly", "endless", "ranked"] as const) {
      for (const r of [1, 11, 20, 43]) {
        const band = bandFor("ig", r, mode);
        expect(band).toMatchObject(bandForRound(r, mode));
        expect(band.minRatio).toBe(VOLATILE_FLOOR);
      }
    }
  });

  it("leaves other stats without a ratio floor", () => {
    expect(bandFor("caps", 1, "ranked").minRatio).toBeUndefined();
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

  it("also demands the strict ratio floor when the band carries one", () => {
    const close = new Map([
      [100, 0],
      [105, 0.5],
      [112, 1],
    ]);
    const band = { floor: 0, ceiling: null, strictMinRatio: 0.1 };
    expect(pairFits(close, 100, 105, band)).toBe(false); // 5% apart
    expect(pairFits(close, 100, 112, band)).toBe(true); // 12% apart
    expect(pairFits(close, 100, 105, { floor: 0, ceiling: null })).toBe(true);
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

  it("keeps the strict ratio floor at every step, the last included", () => {
    const ladder = relaxations({ floor: 0.01, ceiling: 0.04, strictMinRatio: 0.1 });
    expect(ladder[ladder.length - 1]).toEqual({ floor: 0, ceiling: null, strictMinRatio: 0.1 });
    for (const band of ladder) expect(band.strictMinRatio).toBe(0.1);
  });

  it("drops the volatility floor at the last step but keeps the strict one", () => {
    const ladder = relaxations({
      floor: 0.01,
      ceiling: 0.04,
      minRatio: VOLATILE_FLOOR,
      strictMinRatio: 0.1,
    });
    for (const band of ladder.slice(0, -1)) expect(band.minRatio).toBe(VOLATILE_FLOOR);
    expect(ladder[ladder.length - 1]).toEqual({ floor: 0, ceiling: null, strictMinRatio: 0.1 });
  });

  it("never widens above the requested floor", () => {
    for (const band of relaxations({ floor: 0.15, ceiling: 0.5 })) {
      expect(band.floor).toBeLessThanOrEqual(0.15);
    }
  });
});
