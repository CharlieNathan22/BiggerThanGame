import { describe, expect, it } from "vitest";
import { DWELL_MAX, DWELL_MIN, chooseStat, nextDwell, weightedPick } from "../wheel.js";
import { createRng } from "../prng.js";
import { STAT_KEYS } from "../stats.js";
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
    // One basic against two uncommon. Weights are 70 / 11 / 11, renormalised
    // over the 92 actually present — so basic takes 70/92, not a flat 70%.
    const rng = createRng("weights");
    const keys: StatKey[] = ["caps", "fee", "igoals"];
    const counts: Record<string, number> = { caps: 0, fee: 0, igoals: 0 };
    const n = 60_000;
    for (let i = 0; i < n; i++) {
      const k = weightedPick(keys, rng);
      if (k) counts[k] = (counts[k] ?? 0) + 1;
    }
    expect(counts.caps! / n).toBeCloseTo(70 / 92, 2);
    expect(counts.fee! / n).toBeCloseTo(11 / 92, 2);
    expect(counts.igoals! / n).toBeCloseTo(11 / 92, 2);
  });

  it("hits the documented percentages when every stat is viable", () => {
    // DESIGN.md §6: basic ~17% each, uncommon ~11% each, rare ~2% each.
    const rng = createRng("full");
    const counts = new Map<StatKey, number>();
    const n = 200_000;
    for (let i = 0; i < n; i++) {
      const k = weightedPick(STAT_KEYS, rng);
      if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    expect((counts.get("caps") ?? 0) / n).toBeCloseTo(0.175, 2);
    expect((counts.get("fee") ?? 0) / n).toBeCloseTo(0.11, 2);
    expect((counts.get("clubs") ?? 0) / n).toBeCloseTo(0.02, 2);
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
        round: 20,
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
        round: 20,
        viable: ["igoals", "apps", "ig"],
        rng: createRng(`corr-${i}`),
      });
      expect(next).not.toBe("igoals");
    }
  });

  it("bars band-exempt stats from the opening rounds", () => {
    for (let i = 0; i < 300; i++) {
      const next = chooseStat({
        current: "caps",
        round: 3,
        viable: ["clubs", "age", "it", "apps"],
        rng: createRng(`early-${i}`),
      });
      expect(next).toBe("apps");
    }
  });

  it("allows band-exempt stats later", () => {
    const picks = new Set<StatKey>();
    for (let i = 0; i < 300; i++) {
      const next = chooseStat({
        current: "caps",
        round: 30,
        viable: ["clubs", "age", "it"],
        rng: createRng(`late-${i}`),
      });
      if (next) picks.add(next);
    }
    expect(picks.size).toBeGreaterThan(0);
  });

  it("falls back to a correlated stat rather than stalling", () => {
    const next = chooseStat({
      current: "caps",
      round: 20,
      viable: ["igoals"],
      rng: rng(),
    });
    expect(next).toBe("igoals");
  });

  it("returns undefined when nothing at all is viable", () => {
    expect(chooseStat({ current: "caps", round: 20, viable: [], rng: rng() })).toBeUndefined();
  });

  it("returns undefined when only barred stats are viable early", () => {
    expect(
      chooseStat({ current: "caps", round: 2, viable: ["clubs"], rng: rng() }),
    ).toBeUndefined();
  });
});
