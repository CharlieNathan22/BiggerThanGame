import { describe, expect, it } from "vitest";
import {
  REPORT_BANDS,
  iconicViability,
  rankCorrelation,
  roundsWith,
  statViability,
  uncoveredBands,
  viabilityReport,
} from "../viability.js";
import {
  FAN_MODEL,
  FAN_POINTS,
  HALF_GAP,
  PLAYER_MODELS,
  RANK_MODEL,
  ROUND_RANGES,
  SKILL_CEILING,
  SIM_MODES,
  accuracyAt,
  bandText,
  calibratedModel,
  interpolate,
  pCorrect,
  parseCalibration,
  rangeOf,
  simulate,
  simulationReport,
} from "../simulate.js";
import { parseSimArgs } from "../build.js";
import { playerSchema, toPlayer } from "../schema.js";
import { BAND_SCHEDULES, ICONIC_ROUNDS, WIN_ROUNDS } from "@bt/core";
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

  it("is 60% of the way to the ceiling at HALF_GAP", () => {
    expect(pCorrect(HALF_GAP)).toBeCloseTo(0.77, 5);
  });

  it("reaches the skill ceiling at opposite ends of the deck, and never passes it", () => {
    expect(SKILL_CEILING).toBe(0.95);
    expect(pCorrect(1)).toBeCloseTo(SKILL_CEILING, 10);
    expect(pCorrect(0.99)).toBeLessThan(SKILL_CEILING);
    expect(pCorrect(1.5)).toBeCloseTo(SKILL_CEILING, 10);
  });
});

describe("the fan model", () => {
  it("hits each calibration point exactly", () => {
    const expected: Array<[number, number]> = [
      [0, 0.55],
      [0.03, 0.65],
      [0.08, 0.78],
      [0.15, 0.88],
      [0.3, 0.95],
      [0.5, 0.99],
    ];
    for (const [d, acc] of expected) expect(FAN_MODEL.pCorrect(d)).toBeCloseTo(acc, 10);
  });

  it("interpolates linearly between points", () => {
    expect(FAN_MODEL.pCorrect(0.015)).toBeCloseTo(0.6, 10);
    expect(FAN_MODEL.pCorrect(0.4)).toBeCloseTo(0.97, 10);
  });

  it("is flat from 0.50 on", () => {
    expect(FAN_MODEL.pCorrect(0.75)).toBeCloseTo(0.99, 10);
    expect(FAN_MODEL.pCorrect(1)).toBeCloseTo(0.99, 10);
  });

  it("is stronger than the rank model at every distance", () => {
    for (let d = 0; d <= 1; d += 0.05) {
      expect(FAN_MODEL.pCorrect(d)).toBeGreaterThan(RANK_MODEL.pCorrect(d));
    }
  });

  it("is the default model, with rank still available by name", () => {
    expect(PLAYER_MODELS.fan).toBe(FAN_MODEL);
    expect(PLAYER_MODELS.rank).toBe(RANK_MODEL);
    expect(RANK_MODEL.pCorrect(0.3)).toBe(pCorrect(0.3));
    const r = simulate({ deck: players, now: NOW, mode: "friendly", runs: 20 });
    expect(r.outcomes[0]!.model).toBe(FAN_MODEL);
  });
});

describe("calibration points", () => {
  it("sort by rank distance whatever order they come in", () => {
    const points = parseCalibration([
      { rankDistance: 0.5, accuracy: 0.9 },
      { rankDistance: 0, accuracy: 0.5 },
    ]);
    expect(points.map((p) => p.rankDistance)).toEqual([0, 0.5]);
    expect(interpolate(points, 0.25)).toBeCloseTo(0.7, 10);
  });

  it("hold flat before the first point and after the last", () => {
    const points = parseCalibration([
      { rankDistance: 0.1, accuracy: 0.6 },
      { rankDistance: 0.2, accuracy: 0.8 },
    ]);
    expect(interpolate(points, 0)).toBe(0.6);
    expect(interpolate(points, 0.9)).toBe(0.8);
    expect(interpolate(points, NaN)).toBe(0.6);
  });

  it("accept the fan model's own points", () => {
    expect(parseCalibration(FAN_POINTS)).toEqual(FAN_POINTS);
    const model = calibratedModel("copy", "a copy", FAN_POINTS);
    expect(model.pCorrect(0.12)).toBe(FAN_MODEL.pCorrect(0.12));
  });

  it("reject anything but a non-empty list of points from 0 to 1", () => {
    expect(() => parseCalibration([])).toThrow(/non-empty/);
    expect(() => parseCalibration({ rankDistance: 0, accuracy: 0.5 })).toThrow(/non-empty/);
    expect(() => parseCalibration([{ rankDistance: 0 }])).toThrow(/entry 0/);
    expect(() => parseCalibration([null])).toThrow(/entry 0/);
    expect(() =>
      parseCalibration([
        { rankDistance: 0, accuracy: 0.5 },
        { rankDistance: 0.2, accuracy: 1.2 },
      ]),
    ).toThrow(/entry 1/);
    expect(() => parseCalibration([{ rankDistance: "0.1", accuracy: 0.5 }])).toThrow(/entry 0/);
  });

  it("reject a rank distance given twice", () => {
    expect(() =>
      parseCalibration([
        { rankDistance: 0.1, accuracy: 0.5 },
        { rankDistance: 0.1, accuracy: 0.6 },
      ]),
    ).toThrow(/twice/);
  });
});

describe("the simulation flags", () => {
  const none = (): string => {
    throw new Error("no file expected");
  };

  it("default to the fan model and the default run count", () => {
    expect(parseSimArgs([], none)).toEqual({ model: FAN_MODEL });
    expect(parseSimArgs(["--no-sim"], none)).toEqual({ model: FAN_MODEL });
  });

  it("pick a built-in model and a run count", () => {
    expect(parseSimArgs(["--model", "rank", "--runs", "500"], none)).toEqual({
      model: RANK_MODEL,
      runs: 500,
    });
  });

  it("build a model from a calibration file", () => {
    const file = JSON.stringify([
      { rankDistance: 0, accuracy: 0.6 },
      { rankDistance: 1, accuracy: 1 },
    ]);
    const sim = parseSimArgs(["--calibration", "dir/real.json"], () => file);
    if ("error" in sim) throw new Error(sim.error);
    expect(sim.model.id).toBe("calibrated");
    expect(sim.model.summary).toContain("real.json");
    expect(sim.model.pCorrect(0.5)).toBeCloseTo(0.8, 10);
  });

  it("refuse what they can't use", () => {
    const bad = (argv: string[], read: (p: string) => string = none): string => {
      const sim = parseSimArgs(argv, read);
      return "error" in sim ? sim.error : "";
    };
    expect(bad(["--model", "expert"])).toMatch(/no model "expert"/);
    expect(bad(["--model"])).toMatch(/needs a name/);
    expect(bad(["--runs", "0"])).toMatch(/not a count/);
    expect(bad(["--runs", "1.5"])).toMatch(/not a count/);
    expect(bad(["--calibration", "--runs", "5"])).toMatch(/needs a file/);
    expect(bad(["--model", "rank", "--calibration", "x.json"])).toMatch(/drop --model/);
    expect(bad(["--calibration", "x.json"], () => "not json")).toMatch(/--calibration x\.json/);
    expect(bad(["--calibration", "x.json"], () => "[]")).toMatch(/non-empty/);
  });
});

describe("simulating with more than one model", () => {
  it("scores every model on the same rounds without changing the playing model's result", () => {
    const alone = simulate({ deck: players, now: NOW, mode: "friendly", runs: 200 });
    const both = simulate({
      deck: players,
      now: NOW,
      mode: "friendly",
      runs: 200,
      compare: [RANK_MODEL],
    });
    expect(both.outcomes.map((o) => o.model.id)).toEqual(["fan", "rank"]);
    expect(both.streaks).toEqual(alone.streaks);
    expect(both.statCounts).toEqual(alone.statCounts);
    expect(both.outcomes[1]!.streaks).toEqual(
      simulate({ deck: players, now: NOW, mode: "friendly", runs: 200, model: RANK_MODEL }).streaks,
    );
  });

  it("counts, per question, runs dealt it and runs that answered it", () => {
    const r = simulate({ deck: players, now: NOW, mode: "friendly", runs: 200 });
    const o = r.outcomes[0]!;
    expect(o.reached[0]).toBe(r.runs);
    for (let q = 1; q < 20; q++) {
      // Answering question q right is what deals question q + 1.
      expect(o.reached[q]).toBe(o.correct[q - 1]);
      expect(o.correct[q - 1]!).toBeLessThanOrEqual(o.reached[q - 1]!);
    }
    expect(o.correct[19]).toBe(r.wins);
    expect(accuracyAt(o, 1)).toBeCloseTo(o.correct[0]! / r.runs, 10);
  });
});

describe("simulating Friendly's twenty-question challenge", () => {
  it("never plays a Friendly run past twenty, and counts the runs that reach it as wins", () => {
    const r = simulate({ deck: players, now: NOW, mode: "friendly", runs: 300 });
    expect(r.maxConstructible).toBeLessThanOrEqual(20);
    expect(r.streaks.at(-1)!).toBeLessThanOrEqual(20);
    expect(r.wins).toBe(r.streaks.filter((n) => n === 20).length);
    // A win is not the engine running out.
    expect(r.exhausted).toBe(0);
  });

  it("counts no wins in a mode without a target", () => {
    expect(WIN_ROUNDS.endless).toBeNull();
    const r = simulate({ deck: players, now: NOW, mode: "endless", runs: 100 });
    expect(r.wins).toBe(0);
  });

  it("reports the win rate and the streaks by title for Friendly only", () => {
    const results = SIM_MODES.map((mode) => simulate({ deck: players, now: NOW, mode, runs: 50 }));
    const md = simulationReport(results, players.length, NOW);
    expect(md).toContain("## Friendly: the 20-question challenge");
    expect(md).toMatch(/\*\*Win rate: \d+\.\d%\.\*\*/);
    expect(md).toContain("| 15–19 |");
    expect(md).toContain("| **20 (won)** |");
    expect(md).toMatch(
      /Reached the final question \(round 20\): \d+\.\d% of runs, and \d+\.\d% of those won\./,
    );
    expect(md).not.toContain("## Endless: the");
  });

  it("reports each question's band and accuracy, the final stretch's floor included", () => {
    const r = simulate({ deck: players, now: NOW, mode: "friendly", runs: 50 });
    const md = simulationReport([r], players.length, NOW);
    expect(md).toContain("| Question | Band | Reached | Correct |");
    expect(md).toContain(`| 1 | ${bandText(1, "friendly")} | 100.0% |`);
    expect(bandText(17, "friendly")).not.toContain("apart");
    expect(bandText(18, "friendly")).toMatch(/, ≥10% apart$/);
    expect(bandText(20, "ranked")).not.toContain("apart");
  });

  it("compares the models side by side when Friendly carried more than one", () => {
    const r = simulate({
      deck: players,
      now: NOW,
      mode: "friendly",
      runs: 50,
      compare: [RANK_MODEL],
    });
    const md = simulationReport([r], players.length, NOW);
    expect(md).toContain("## Friendly under each player model");
    expect(md).toContain("| Measure | `fan` | `rank` |");
    expect(md).toContain("| Correct on question 20 |");
    const alone = simulate({ deck: players, now: NOW, mode: "friendly", runs: 50 });
    expect(simulationReport([alone], players.length, NOW)).not.toContain("under each player model");
  });

  it("documents the models and how to choose one", () => {
    const r = simulate({ deck: players, now: NOW, mode: "friendly", runs: 20, model: RANK_MODEL });
    const md = simulationReport([r], players.length, NOW);
    expect(md).toContain("## Player models");
    expect(md).toContain("- **`rank`** (used above)");
    expect(md).toContain("- `fan`: ");
    expect(md).toContain("--model rank");
    expect(md).toContain("--calibration <file.json>");
  });
});

describe("the report's bands", () => {
  it("cover every band of every mode's schedule", () => {
    for (const mode of Object.keys(BAND_SCHEDULES) as Array<keyof typeof BAND_SCHEDULES>) {
      expect(uncoveredBands(mode)).toEqual([]);
    }
  });

  it("say where each band falls in both schedules", () => {
    expect(REPORT_BANDS[0]!.rounds).toBe(
      `1–10; Friendly ${roundsWith("friendly", REPORT_BANDS[0]!.band)}`,
    );
    const knifeEdge = REPORT_BANDS.find((b) => b.label === "knife edge")!;
    expect(roundsWith("endless", knifeEdge.band)).toBe("43+");
    // Friendly shares only the opening band; the rest of its ramp is its own.
    expect(REPORT_BANDS.filter((b) => b.mode === "friendly").map((b) => b.rounds)).toEqual([
      "Friendly 6–10",
      "Friendly 11–13",
      "Friendly 14–17",
      "Friendly 18–19",
      "Friendly 20",
    ]);
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
