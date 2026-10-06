import { describe, expect, it } from "vitest";
import { playerSchema, toPlayer } from "../schema.js";
import { IG_STALE_DAYS, formatStaleInstagram, staleInstagram, validateDeck } from "../validate.js";

const NOW = new Date("2026-09-18T00:00:00Z");

const make = (over: Record<string, unknown> = {}) =>
  playerSchema.parse({
    id: "a-player",
    name: "A Player",
    country: "Testland",
    position: "FW",
    dob: "1985-06-15",
    stats: { club_goals: 100, caps: 50, apps: 300, igoals: 10 },
    ...over,
  });

const check = (raws: ReturnType<typeof make>[]) => validateDeck(raws, raws.map(toPlayer), NOW);

describe("validateDeck", () => {
  it("passes a clean deck", () => {
    expect(check([make(), make({ id: "another" })])).toEqual([]);
  });

  it("catches duplicate ids", () => {
    const problems = check([make(), make()]);
    expect(problems.some((p) => p.message === "duplicate id")).toBe(true);
  });

  it("catches club goals on a goalkeeper", () => {
    const problems = check([
      make({ position: "GK", stats: { club_goals: 3, caps: 50, apps: 300, ct: 2 } }),
    ]);
    expect(problems.some((p) => p.field === "stats.club_goals")).toBe(true);
  });

  it("catches international goals on a goalkeeper", () => {
    const problems = check([
      make({ position: "GK", stats: { igoals: 1, caps: 50, apps: 300, ct: 2 } }),
    ]);
    expect(problems.some((p) => p.field === "stats.igoals")).toBe(true);
  });

  it("allows a goalkeeper with no goals stats", () => {
    expect(check([make({ position: "GK", stats: { caps: 50, apps: 300, ct: 2 } })])).toEqual([]);
  });

  it("catches a birth date in the future", () => {
    const problems = check([make({ dob: "2030-01-01" })]);
    expect(problems.some((p) => p.field === "dob")).toBe(true);
  });

  it("catches an implausible age", () => {
    const problems = check([make({ dob: "1850-01-01" })]);
    expect(problems.some((p) => p.message.includes("check the year"))).toBe(true);
  });

  it("catches a follower snapshot dated in the future", () => {
    const problems = check([
      make({
        stats: { caps: 50, apps: 300, club_goals: 10, ig: { value: 5, as_of: "2030-01-01" } },
      }),
    ]);
    expect(problems.some((p) => p.field === "stats.ig.as_of")).toBe(true);
  });

  it("catches a fee year before the player turned fifteen", () => {
    const problems = check([
      make({
        dob: "1990-01-01",
        stats: { caps: 50, apps: 300, club_goals: 10, fee: { value: 5, year: 1999 } },
      }),
    ]);
    expect(problems.some((p) => p.field === "stats.fee.year")).toBe(true);
  });

  it("accepts a plausible fee year", () => {
    expect(
      check([
        make({
          dob: "1990-01-01",
          stats: { caps: 50, apps: 300, club_goals: 10, fee: { value: 5, year: 2010 } },
        }),
      ]),
    ).toEqual([]);
  });

  it("catches a player with too few entered stats", () => {
    const problems = check([make({ stats: { caps: 50, apps: 300 } })]);
    expect(problems.some((p) => p.message.includes("entered stats"))).toBe(true);
  });

  it("does not count age towards the minimum", () => {
    // caps + apps + age would be three if age counted; it must not.
    const problems = check([make({ stats: { caps: 50, apps: 300 } })]);
    expect(problems.some((p) => p.field === "stats")).toBe(true);
  });

  it("collects every problem rather than stopping at the first", () => {
    const problems = check([make({ id: "dup", dob: "2030-01-01" }), make({ id: "dup" })]);
    expect(problems.length).toBeGreaterThan(1);
  });
});

describe("staleInstagram", () => {
  const withIg = (id: string, asOf: string) =>
    toPlayer(make({ id, stats: { caps: 50, apps: 300, ig: { value: 10, as_of: asOf } } }));
  // NOW is 2026-09-18: 44, 45 and 46 days back.
  const players = [
    withIg("fresh", "2026-08-05"),
    withIg("on-the-day", "2026-08-04"),
    withIg("stale", "2026-08-03"),
    withIg("older", "2026-06-01"),
    toPlayer(make({ id: "no-ig" })),
  ];

  it("lists figures more than 45 days old, oldest first, and skips players without one", () => {
    expect(IG_STALE_DAYS).toBe(45);
    expect(staleInstagram(players, NOW)).toEqual([
      { playerId: "older", asOf: "2026-06-01", days: 109 },
      { playerId: "stale", asOf: "2026-08-03", days: 46 },
    ]);
  });

  it("formats a warning block, and nothing when every figure is fresh", () => {
    const lines = formatStaleInstagram(staleInstagram(players, NOW));
    expect(lines[0]).toMatch(/^2 player\(s\) with Instagram figures over 45 days old/);
    expect(lines.slice(1)).toEqual([
      "  older: as of 2026-06-01 (109 days)",
      "  stale: as of 2026-08-03 (46 days)",
    ]);
    expect(formatStaleInstagram(staleInstagram(players.slice(0, 2), NOW))).toEqual([]);
  });

  it("is a warning only: validation passes a deck with stale figures", () => {
    const raws = [
      make({ id: "old", stats: { caps: 50, apps: 300, ig: { value: 10, as_of: "2025-01-01" } } }),
    ];
    expect(validateDeck(raws, raws.map(toPlayer), NOW)).toEqual([]);
  });
});
