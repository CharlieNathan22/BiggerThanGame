import { describe, expect, it } from "vitest";
import { iconicViability, rankCorrelation, statViability, viabilityReport } from "../viability.js";
import {
  HALF_GAP,
  ROUND_RANGES,
  SIM_MODES,
  pCorrect,
  rangeOf,
  simulate,
  simulationReport,
} from "../simulate.js";
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

  it("applies Instagram's volatility floor, exactly as the engine does", () => {
    // Six players spread across the whole deck in rank, but all within 1.5x of
    // each other: plenty of pairs on caps, none on followers.
    const close = [10, 11, 12, 13, 14, 15].map((n, i) =>
      toPlayer(
        playerSchema.parse({
          id: `v${i}`,
          name: `V${i}`,
          country: "T",
          position: "FW",
          dob: "1985-06-15",
          stats: { caps: n, apps: n, club_goals: n, ig: { value: n, as_of: "2026-09-01" } },
        }),
      ),
    );
    const caps = statViability(close, "caps", NOW);
    const ig = statViability(close, "ig", NOW);
    expect(caps.pairsByBand["opening"]!).toBeGreaterThan(0);
    for (const count of Object.values(ig.pairsByBand)) expect(count).toBe(0);
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
    // Only "a" (400) is iconic, at the top of the deck: percentile 1. The six
    // values sit at 0, 0.2 … 1, and the opening band wants 0.45 apart, so d, e
    // and f (0.4, 0.2, 0) qualify; b and c are too close and "a" can't face
    // itself.
    const v = iconicViability(onlyIconic(["a"]), "club_goals", NOW);
    expect(v.iconicEligible).toBe(1);
    expect(v.anchors).toBe(6);
    expect(v.anchorsWithIconic).toBe(3);
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
  it("is a coin flip for two players at the same point in the deck", () => {
    expect(pCorrect(0)).toBeCloseTo(0.5, 5);
  });

  it("rises with rank distance", () => {
    expect(pCorrect(0.5)).toBeGreaterThan(pCorrect(0.1));
  });

  it("is halfway to the ceiling at HALF_GAP", () => {
    expect(pCorrect(HALF_GAP)).toBeCloseTo(0.725, 5);
  });

  it("stays below the skill ceiling even at opposite ends of the deck", () => {
    expect(pCorrect(1)).toBeLessThan(0.95);
    expect(pCorrect(1)).toBeGreaterThan(0.85);
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

  it("places every round in exactly one range", () => {
    expect([1, 5, 6, 10, 11, 20, 21, 60].map(rangeOf)).toEqual([
      "1–5",
      "1–5",
      "6–10",
      "6–10",
      "11–20",
      "11–20",
      "21+",
      "21+",
    ]);
  });

  it("splits every round played across the round ranges", () => {
    const r = simulate({ deck: players, now: NOW, mode: "friendly", runs: 100 });
    let total = 0;
    for (const { label } of ROUND_RANGES) {
      for (const n of Object.values(r.statCountsByRange[label]!)) total += n;
    }
    expect(total).toBe(r.roundsDealt);
  });

  it("reports the per-range table for Friendly, with the rare tier's total", () => {
    const results = SIM_MODES.map((mode) => simulate({ deck: players, now: NOW, mode, runs: 50 }));
    const md = simulationReport(results, players.length, NOW);
    expect(md).toContain("### By round range (Friendly)");
    expect(md).toContain("| Stat | Tier | Rounds 1–5 | Rounds 6–10 | Rounds 11–20 | Rounds 21+ |");
    expect(md).toContain("**Rare, together**");
  });

  it("leaves the per-range table out when Friendly wasn't simulated", () => {
    const r = simulate({ deck: players, now: NOW, mode: "ranked", runs: 50 });
    expect(simulationReport([r], players.length, NOW)).not.toContain("By round range");
  });

  it("produces a report naming the model as an assumption", () => {
    const r = simulate({ deck: players, now: NOW, mode: "ranked", runs: 100 });
    const md = simulationReport([r], players.length, NOW);
    expect(md).toContain("modelled");
    expect(md).toContain("Streak distribution");
  });
});
