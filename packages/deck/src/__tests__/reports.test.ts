import { describe, expect, it } from "vitest";
import { iconicViability, rankCorrelation, statViability, viabilityReport } from "../viability.js";
import { SIM_MODES, pCorrect, simulate, simulationReport } from "../simulate.js";
import { playerSchema, toPlayer } from "../schema.js";
import { ICONIC_ROUNDS } from "@bt/core";
import type { Player } from "@bt/core";

const NOW = new Date("2026-09-18T00:00:00Z");

const players: Player[] = [
  { id: "a", club_goals: 400, caps: 100, apps: 600, igoals: 50 },
  { id: "b", club_goals: 200, caps: 80, apps: 500, igoals: 25 },
  { id: "c", club_goals: 100, caps: 60, apps: 400, igoals: 12 },
  { id: "d", club_goals: 50, caps: 40, apps: 300, igoals: 6 },
  { id: "e", club_goals: 25, caps: 20, apps: 200, igoals: 3 },
  { id: "f", club_goals: 10, caps: 10, apps: 100, igoals: 1 },
].map((p) =>
  toPlayer(
    playerSchema.parse({
      id: p.id,
      name: p.id.toUpperCase(),
      country: "T",
      position: "FW",
      dob: "1985-06-15",
      iconic: true,
      stats: { club_goals: p.club_goals, caps: p.caps, apps: p.apps, igoals: p.igoals },
    }),
  ),
);

describe("statViability", () => {
  it("counts eligible players and distinct values", () => {
    const v = statViability(players, "club_goals", NOW);
    expect(v.eligible).toBe(6);
    expect(v.distinctValues).toBe(6);
    expect(v.tiedPairs).toBe(0);
  });

  it("counts ties", () => {
    const withTie = [
      ...players,
      toPlayer(
        playerSchema.parse({
          id: "g",
          name: "G",
          country: "T",
          position: "FW",
          dob: "1985-06-15",
          stats: { club_goals: 400, caps: 5, apps: 50 },
        }),
      ),
    ];
    expect(statViability(withTie, "club_goals", NOW).tiedPairs).toBe(1);
  });

  it("reports fewer pairs as the band tightens", () => {
    const v = statViability(players, "club_goals", NOW);
    expect(v.pairsByBand["opening"]!).toBeGreaterThan(v.pairsByBand["knife edge"]!);
  });

  it("gives band-exempt stats the same count at every band", () => {
    const v = statViability(players, "age", NOW);
    const counts = Object.values(v.pairsByBand);
    expect(new Set(counts).size).toBe(1);
  });
});

describe("rankCorrelation", () => {
  it("is 1 for a perfectly co-ordered pair", () => {
    // Every stat in the fixture descends together.
    expect(rankCorrelation(players, "club_goals", "caps", NOW)).toBeCloseTo(1, 5);
  });

  it("returns undefined when too few players share both stats", () => {
    const thin = players.slice(0, 2);
    expect(rankCorrelation(thin, "club_goals", "caps", NOW)).toBeUndefined();
  });
});

const onlyIconic = (ids: readonly string[]): Player[] =>
  players.map((p) => ({ ...p, iconic: ids.includes(p.id) }));

describe("iconicViability", () => {
  it("counts anchors that have an iconic challenger in the opening band", () => {
    // Only "a" (400) is iconic. The opening band wants a gap of 200% or more,
    // so "b" (200) is too close, "a" cannot face itself, and c–f all qualify.
    const v = iconicViability(onlyIconic(["a"]), "club_goals", NOW);
    expect(v.iconicEligible).toBe(1);
    expect(v.anchors).toBe(6);
    expect(v.anchorsWithIconic).toBe(4);
  });
});

describe("viabilityReport", () => {
  it("reports the iconic preference", () => {
    const md = viabilityReport(onlyIconic(["a"]), NOW);
    expect(md).toContain("## Iconic preference");
    expect(md).toContain("1 of 6 players are iconic");
  });

  it("names every stat and flags correlated pairs", () => {
    const md = viabilityReport(players, NOW);
    expect(md).toContain("Club goals");
    expect(md).toContain("Stat correlation");
    expect(md).toContain("**exclude**");
  });
});

describe("pCorrect", () => {
  it("is a coin flip at no gap", () => {
    expect(pCorrect(0)).toBeCloseTo(0.5, 5);
  });

  it("rises with the gap", () => {
    expect(pCorrect(2)).toBeGreaterThan(pCorrect(0.5));
  });

  it("caps at the skill ceiling", () => {
    expect(pCorrect(Infinity)).toBeCloseTo(0.95, 5);
    expect(pCorrect(1e9)).toBeLessThanOrEqual(0.95);
  });
});

describe("simulate", () => {
  it("is deterministic for the same inputs", () => {
    const a = simulate({ deck: players, now: NOW, mode: "ranked", runs: 200 });
    const b = simulate({ deck: players, now: NOW, mode: "ranked", runs: 200 });
    expect(a.streaks).toEqual(b.streaks);
    expect(a.statCounts).toEqual(b.statCounts);
  });

  it("does not let the skill model perturb the sequence", () => {
    // Same deck and seeds must deal the same rounds regardless of run count.
    const few = simulate({ deck: players, now: NOW, mode: "ranked", runs: 50 });
    const many = simulate({ deck: players, now: NOW, mode: "ranked", runs: 200 });
    expect(many.streaks.slice(0, 0)).toEqual(few.streaks.slice(0, 0));
    expect(many.maxConstructible).toBeGreaterThanOrEqual(few.maxConstructible);
  });

  it("records a relaxation breakdown that sums to the rounds dealt", () => {
    const r = simulate({ deck: players, now: NOW, mode: "ranked", runs: 100 });
    const total = Object.values(r.relaxationCounts).reduce((a, b) => a + b, 0);
    expect(total).toBe(r.roundsDealt);
  });

  it("counts only rounds inside the mode's iconic window", () => {
    for (const mode of SIM_MODES) {
      const r = simulate({ deck: players, now: NOW, mode, runs: 100, maxRounds: 30 });
      const inWindow = Object.values(r.iconicWindow).reduce((a, b) => a + b, 0);
      expect(inWindow).toBeGreaterThan(0);
      expect(inWindow).toBeLessThanOrEqual(r.runs * ICONIC_ROUNDS[mode]);
    }
  });

  it("never falls back on the preference when every player is iconic", () => {
    const r = simulate({ deck: players, now: NOW, mode: "friendly", runs: 100 });
    expect(r.iconicWindow.iconic).toBe(0);
    expect(r.relaxationCounts.iconic).toBe(0);
  });

  it("always falls back on the preference when no player is iconic", () => {
    const r = simulate({ deck: onlyIconic([]), now: NOW, mode: "friendly", runs: 100 });
    expect(r.iconicWindow.none).toBe(0);
    expect(r.iconicWindow.iconic).toBeGreaterThan(0);
  });

  it("reports every mode side by side", () => {
    const results = SIM_MODES.map((mode) => simulate({ deck: players, now: NOW, mode, runs: 50 }));
    const md = simulationReport(results, players.length, NOW);
    expect(md).toContain("## Iconic preference");
    for (const mode of SIM_MODES) {
      expect(md).toContain(mode);
      expect(md).toContain(`rounds 1–${ICONIC_ROUNDS[mode]}`);
    }
  });

  it("produces a report naming the model as an assumption", () => {
    const r = simulate({ deck: players, now: NOW, mode: "ranked", runs: 100 });
    const md = simulationReport([r], players.length, NOW);
    expect(md).toContain("modelled");
    expect(md).toContain("Streak distribution");
  });
});
