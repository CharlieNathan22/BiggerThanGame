import { describe, expect, it } from "vitest";
import { buildEligibilityMap, eligibleStats, isEligible } from "../eligibility.js";
import { NOW, fixtureDeck } from "../__fixtures__/deck.js";

const byId = (id: string) => {
  const p = fixtureDeck.find((x) => x.id === id);
  if (!p) throw new Error(`no fixture ${id}`);
  return p;
};

describe("isEligible", () => {
  it("excludes goalkeepers from both goals stats", () => {
    const gk = byId("echo");
    expect(isEligible(gk, "club_goals", NOW)).toBe(false);
    expect(isEligible(gk, "igoals", NOW)).toBe(false);
  });

  it("keeps goalkeepers eligible for appearances and caps", () => {
    const gk = byId("echo");
    expect(isEligible(gk, "apps", NOW)).toBe(true);
    expect(isEligible(gk, "caps", NOW)).toBe(true);
  });

  it("excludes deceased players from age only", () => {
    const dead = byId("golf");
    expect(isEligible(dead, "age", NOW)).toBe(false);
    expect(isEligible(dead, "caps", NOW)).toBe(true);
  });

  it("treats a legitimate zero as eligible", () => {
    const p = byId("foxtrot");
    expect(isEligible(p, "igoals", NOW)).toBe(true);
    expect(isEligible(p, "ct", NOW)).toBe(true);
  });

  it("excludes an absent stat", () => {
    expect(isEligible(byId("golf"), "ig", NOW)).toBe(false);
  });
});

describe("eligibleStats", () => {
  it("omits the goalkeeper's goals stats", () => {
    const keys = eligibleStats(byId("echo"), NOW);
    expect(keys).not.toContain("club_goals");
    expect(keys).not.toContain("igoals");
    expect(keys).toContain("apps");
  });
});

describe("buildEligibilityMap", () => {
  it("covers every player in the deck", () => {
    const map = buildEligibilityMap(fixtureDeck, NOW);
    expect(map.size).toBe(fixtureDeck.length);
  });

  it("agrees with isEligible", () => {
    const map = buildEligibilityMap(fixtureDeck, NOW);
    for (const player of fixtureDeck) {
      const set = map.get(player.id);
      expect(set).toBeDefined();
      expect(set!.has("club_goals")).toBe(isEligible(player, "club_goals", NOW));
    }
  });
});
