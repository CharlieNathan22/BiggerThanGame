import { describe, expect, it } from "vitest";
import { CORRELATED_PAIRS, STATS, STAT_KEYS, TIER_WEIGHT, ageAt, areCorrelated } from "../stats.js";
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
  });

  it("formats fees with a currency symbol", () => {
    expect(STATS.fee.format(60)).toBe("€60m");
    expect(STATS.fee.format(77.5)).toBe("€77.5m");
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
