import { describe, expect, it } from "vitest";
import { playerSchema, toPlayer } from "../schema.js";
import { validateDeck } from "../validate.js";

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
