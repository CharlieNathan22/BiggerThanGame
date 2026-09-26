import { describe, expect, it } from "vitest";
import { DWELL_MAX, DWELL_MIN, chooseStat, nextDwell, weightedPick } from "../wheel.js";
import { createRng } from "../prng.js";
import { STAT_KEYS, TIER_WEIGHT } from "../stats.js";
import type { StatKey } from "../types.js";

describe("nextDwell", () => {
  it("stays within the configured range", () => {
    const rng = createRng("dwell");
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const d = nextDwell(rng);
      expect(d).toBeGreaterThanOrEqual(DWELL_MIN);
      expect(d).toBeLessThanOrEqual(DWELL_MAX);
      seen.add(d);
    }
    expect(seen.size).toBe(DWELL_MAX - DWELL_MIN + 1);
  });
});

describe("weightedPick", () => {
  it("returns undefined for an empty list", () => {
    expect(weightedPick([], createRng("x"))).toBeUndefined();
  });

  it("divides a tier's share across its members rather than per stat", () => {
    // One basic against two uncommon: the basic weight whole, the uncommon
    // weight halved, renormalised over what is actually present.
    const rng = createRng("weights");
    const keys: StatKey[] = ["caps", "fee", "igoals"];
    const counts: Record<string, number> = { caps: 0, fee: 0, igoals: 0 };
    const n = 60_000;
    for (let i = 0; i < n; i++) {
      const k = weightedPick(keys, rng);
      if (k) counts[k] = (counts[k] ?? 0) + 1;
    }
    const total = TIER_WEIGHT.basic + TIER_WEIGHT.uncommon;
    expect(counts.caps! / n).toBeCloseTo(TIER_WEIGHT.basic / total, 2);
    expect(counts.fee! / n).toBeCloseTo(TIER_WEIGHT.uncommon / 2 / total, 2);
    expect(counts.igoals! / n).toBeCloseTo(TIER_WEIGHT.uncommon / 2 / total, 2);
  });

  it("gives each stat its tier weight divided by the tier's size, when every stat is viable", () => {
    // Per spin, not per round played: the opening stat and dwell reshape the
    // per-round mix, which simulation.md measures against TIER_TARGET.
    const rng = createRng("full");
    const counts = new Map<StatKey, number>();
    const n = 200_000;
    for (let i = 0; i < n; i++) {
      const k = weightedPick(STAT_KEYS, rng);
      if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    expect((counts.get("caps") ?? 0) / n).toBeCloseTo(TIER_WEIGHT.basic / 4 / 100, 2);
    expect((counts.get("fee") ?? 0) / n).toBeCloseTo(TIER_WEIGHT.uncommon / 2 / 100, 2);
    expect((counts.get("clubs") ?? 0) / n).toBeCloseTo(TIER_WEIGHT.rare / 4 / 100, 2);
  });

  it("gives every member of a tier the same share", () => {
    const rng = createRng("even");
    const keys: StatKey[] = ["caps", "apps"];
    const counts: Record<string, number> = { caps: 0, apps: 0 };
    const n = 40_000;
    for (let i = 0; i < n; i++) {
      const k = weightedPick(keys, rng);
      if (k) counts[k] = (counts[k] ?? 0) + 1;
    }
    expect(counts.caps! / n).toBeCloseTo(0.5, 1);
  });
});

describe("chooseStat", () => {
  const rng = () => createRng("choose");

  it("never returns the current stat", () => {
    for (let i = 0; i < 200; i++) {
      const next = chooseStat({
        current: "caps",
        viable: STAT_KEYS,
        rng: createRng(`seed-${i}`),
      });
      expect(next).not.toBe("caps");
    }
  });

  it("never switches directly between a correlated pair", () => {
    for (let i = 0; i < 500; i++) {
      const next = chooseStat({
        current: "caps",
        viable: ["apps", "igoals", "ig"],
        rng: createRng(`corr-${i}`),
      });
      expect(next).not.toBe("apps");
    }
    for (let i = 0; i < 500; i++) {
      const next = chooseStat({
        current: "club_goals",
        viable: ["igoals", "caps", "ig"],
        rng: createRng(`corr2-${i}`),
      });
      expect(next).not.toBe("igoals");
    }
  });

  it("may switch to a rare stat — no stat is barred by round any more", () => {
    const picks = new Set<StatKey>();
    for (let i = 0; i < 300; i++) {
      const next = chooseStat({
        current: "caps",
        viable: ["clubs", "age", "it"],
        rng: createRng(`r-${i}`),
      });
      if (next) picks.add(next);
    }
    expect(picks).toEqual(new Set(["clubs", "age", "it"]));
  });

  it("never follows a rare stat with another rare stat while an alternative exists", () => {
    for (let i = 0; i < 500; i++) {
      const next = chooseStat({
        current: "ct",
        viable: ["it", "clubs", "age", "caps"],
        rng: createRng(`rare-${i}`),
      });
      expect(next).toBe("caps");
    }
  });

  it("falls back to another rare stat when nothing else is viable", () => {
    const picks = new Set<StatKey>();
    for (let i = 0; i < 300; i++) {
      const next = chooseStat({
        current: "ct",
        viable: ["ct", "it", "clubs"],
        rng: createRng(`rare-only-${i}`),
      });
      expect(next).toBeDefined();
      picks.add(next!);
    }
    expect(picks).toEqual(new Set(["it", "clubs"]));
  });

  it("still switches from a basic or uncommon stat to a rare one", () => {
    const picks = new Set<StatKey>();
    for (let i = 0; i < 300; i++) {
      const next = chooseStat({
        current: "fee",
        viable: ["ct", "caps"],
        rng: createRng(`to-${i}`),
      });
      if (next) picks.add(next);
    }
    expect(picks).toContain("ct");
  });

  it("falls back to a correlated stat rather than stalling", () => {
    const next = chooseStat({
      current: "caps",
      viable: ["apps"],
      rng: rng(),
    });
    expect(next).toBe("apps");
  });

  it("returns undefined when nothing at all is viable", () => {
    expect(chooseStat({ current: "caps", viable: [], rng: rng() })).toBeUndefined();
  });
});
