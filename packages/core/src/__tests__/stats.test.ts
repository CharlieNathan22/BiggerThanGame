import { describe, expect, it } from "vitest";
import {
  CORRELATED_PAIRS,
  STATS,
  STAT_KEYS,
  TIER_TARGET,
  TIER_WEIGHT,
  ageAt,
  areCorrelated,
  formatCollisions,
} from "../stats.js";
import { NOW, fixtureDeck } from "../__fixtures__/deck.js";

const byId = (id: string) => {
  const p = fixtureDeck.find((x) => x.id === id);
  if (!p) throw new Error(`no fixture ${id}`);
  return p;
};

describe("registry", () => {
  it("has exactly ten stats", () => {
    expect(STAT_KEYS).toHaveLength(10);
  });

  it("keys the record by its own key", () => {
    for (const key of STAT_KEYS) {
      expect(STATS[key].key).toBe(key);
    }
  });

  it("splits four basic, two uncommon, four rare", () => {
    const counts = { basic: 0, uncommon: 0, rare: 0 };
    for (const key of STAT_KEYS) counts[STATS[key].tier] += 1;
    expect(counts).toEqual({ basic: 4, uncommon: 2, rare: 4 });
  });

  it("weights the tiers to 100", () => {
    const total = TIER_WEIGHT.basic + TIER_WEIGHT.uncommon + TIER_WEIGHT.rare;
    expect(total).toBe(100);
  });

  it("sets per-stat targets that cover every round played, none below 5%", () => {
    const total = STAT_KEYS.reduce((sum, key) => sum + TIER_TARGET[STATS[key].tier], 0);
    expect(total).toBe(100);
    for (const key of STAT_KEYS) expect(TIER_TARGET[STATS[key].tier]).toBeGreaterThanOrEqual(5);
  });

  it("bands every stat: nothing is exempt any more", () => {
    for (const key of STAT_KEYS) expect(STATS[key]).not.toHaveProperty("bandExempt");
  });
});

describe("ageAt", () => {
  it("counts whole years", () => {
    expect(ageAt("1980-01-01", new Date("2026-09-17T00:00:00Z"))).toBe(46);
  });

  it("does not credit a birthday that has not happened", () => {
    expect(ageAt("1980-12-31", new Date("2026-09-17T00:00:00Z"))).toBe(45);
  });

  it("credits the birthday on the day", () => {
    expect(ageAt("1980-09-17", new Date("2026-09-17T00:00:00Z"))).toBe(46);
  });

  it("returns undefined for an unparseable date", () => {
    expect(ageAt("not-a-date", NOW)).toBeUndefined();
  });
});

describe("accessors", () => {
  it("reads nested values", () => {
    expect(STATS.ig.get(byId("alpha"), NOW)).toBe(80);
    expect(STATS.fee.get(byId("alpha"), NOW)).toBe(60);
  });

  it("returns undefined for an absent stat", () => {
    expect(STATS.ig.get(byId("golf"), NOW)).toBeUndefined();
    expect(STATS.club_goals.get(byId("echo"), NOW)).toBeUndefined();
  });

  it("returns zero, not undefined, for a legitimate zero", () => {
    expect(STATS.igoals.get(byId("foxtrot"), NOW)).toBe(0);
    expect(STATS.ct.get(byId("foxtrot"), NOW)).toBe(0);
  });

  it("withholds age from a deceased player", () => {
    expect(STATS.age.get(byId("golf"), NOW)).toBeUndefined();
  });
});

describe("formatters", () => {
  it("formats followers in millions", () => {
    expect(STATS.ig.format(80)).toBe("80m");
    expect(STATS.ig.format(1.5)).toBe("1.5m");
    expect(STATS.ig.format(10.9)).toBe("10.9m");
  });

  it("formats followers under a million in thousands", () => {
    expect(STATS.ig.format(0.093)).toBe("93k");
    expect(STATS.ig.format(0.566)).toBe("566k");
    expect(STATS.ig.format(1)).toBe("1m");
  });

  it("formats fees with a currency symbol", () => {
    expect(STATS.fee.format(60)).toBe("€60m");
    expect(STATS.fee.format(77.5)).toBe("€77.5m");
  });

  it("formats fees under a million in thousands", () => {
    expect(STATS.fee.format(0.014)).toBe("€14k");
    expect(STATS.fee.format(0.66)).toBe("€660k");
    expect(STATS.fee.format(0.0011)).toBe("€1k");
  });

  it("shows the one decimal a fee has, and none when it has none", () => {
    expect(STATS.fee.format(36.2)).toBe("€36.2m");
    expect(STATS.fee.format(36.0)).toBe("€36m");
  });

  it("never rounds a count-up frame just under a million to 1000k", () => {
    expect(STATS.fee.format(0.9996)).toBe("€1m");
    expect(STATS.ig.format(0.9996)).toBe("1m");
  });

  // Named pairs that collided under earlier rules: followers of 10m and more
  // were rounded to whole millions, so 10.9 and 11.3 both read "11m".
  it.each([
    ["ig", 10.9, 11.3],
    ["ig", 10.5, 10.9],
    ["ig", 0.093, 0.125],
    ["fee", 36.2, 36.0],
    ["fee", 0.014, 0.0011],
    ["fee", 0.94, 1],
  ] as const)("formats %s %d and %d differently", (key, a, b) => {
    expect(STATS[key].format(a)).not.toBe(STATS[key].format(b));
  });

  it("never formats two different fixture values the same way", () => {
    expect(formatCollisions(fixtureDeck, NOW)).toEqual([]);
  });

  it("reports values that would read the same", () => {
    const withIg = (id: string, value: number) => {
      const p = byId(id);
      return { ...p, stats: { ...p.stats, ig: { value, asOf: "2026-09-01" } } };
    };
    expect(formatCollisions([withIg("alpha", 10.9), withIg("bravo", 10.94)], NOW)).toEqual([
      { stat: "ig", values: [10.9, 10.94], shown: "10.9m" },
    ]);
  });

  it("groups large integers", () => {
    expect(STATS.apps.format(1234)).toBe("1,234");
  });
});

describe("qualifiers", () => {
  it("exposes the fee year", () => {
    expect(STATS.fee.qualifier?.(byId("alpha"))).toBe("2005");
  });

  it("exposes the follower snapshot date", () => {
    expect(STATS.ig.qualifier?.(byId("alpha"))).toBe("2026-09-01");
  });
});

describe("correlated pairs", () => {
  it("matches in both directions", () => {
    expect(areCorrelated("club_goals", "igoals")).toBe(true);
    expect(areCorrelated("igoals", "club_goals")).toBe(true);
  });

  it("pairs goals with goals and appearances with appearances", () => {
    // The first version of this list was crossed — caps with international
    // goals, club goals with appearances. viability.md showed the real pairs.
    expect(areCorrelated("caps", "apps")).toBe(true);
    expect(areCorrelated("caps", "igoals")).toBe(false);
    expect(areCorrelated("club_goals", "apps")).toBe(false);
  });

  it("does not match unrelated stats", () => {
    expect(areCorrelated("caps", "ig")).toBe(false);
  });

  it("only references real stat keys", () => {
    for (const [a, b] of CORRELATED_PAIRS) {
      expect(STAT_KEYS).toContain(a);
      expect(STAT_KEYS).toContain(b);
    }
  });
});
