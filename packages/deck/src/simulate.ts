/**
 * simulation.md — how the ramp actually behaves.
 *
 * Runs the real engine thousands of times over the compiled deck and reports
 * what comes out. This is what turns the numbers in DESIGN.md §8 from a
 * considered guess into a measurement.
 *
 * **The streak distribution rests on a model of player skill**, and that model
 * is an assumption, not data. See `pCorrect` below. Treat the shape of the
 * distribution as informative and the absolute numbers as indicative until real
 * play replaces them.
 */

import { STATS, STAT_KEYS, buildRun, createRng, valueOf } from "@bt/core";
import type { Player, Relaxation, Round, StatKey } from "@bt/core";

/**
 * Modelled probability that a player answers a round correctly.
 *
 * A pair with no gap is a coin flip; a blowout is near-certain. Between those,
 * skill rises with the relative gap. `HALF_GAP` is the gap at which the player
 * is halfway between guessing and their ceiling.
 *
 * Both constants are guesses. Tune them once real play gives an observed
 * accuracy-by-band curve — the telemetry in ARCHITECTURE.md §12 logs exactly
 * that.
 */
export const SKILL_CEILING = 0.95;
export const HALF_GAP = 1.0;

export function pCorrect(gapRatio: number): number {
  if (!Number.isFinite(gapRatio)) return SKILL_CEILING;
  const share = gapRatio / (gapRatio + HALF_GAP);
  return 0.5 + (SKILL_CEILING - 0.5) * share;
}

export interface SimOptions {
  readonly deck: readonly Player[];
  readonly now: Date;
  readonly runs?: number;
  readonly maxRounds?: number;
  readonly seedPrefix?: string;
}

export interface SimResult {
  readonly runs: number;
  /** Streak lengths, ascending. */
  readonly streaks: readonly number[];
  readonly statCounts: Readonly<Record<string, number>>;
  readonly relaxationCounts: Readonly<Record<Relaxation, number>>;
  /** Rounds dealt in total, across all runs. */
  readonly roundsDealt: number;
  /** Runs that ended because the engine could not deal another pair. */
  readonly exhausted: number;
  /** Longest run the engine could construct at all, ignoring player skill. */
  readonly maxConstructible: number;
  /** Relaxation rate per 10-round bucket. */
  readonly relaxationByBucket: Readonly<Record<string, number>>;
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] ?? 0;
  const b = sorted[hi] ?? a;
  return a + (b - a) * (pos - lo);
}

function gapOf(round: Round, now: Date): number {
  const a = valueOf(round.anchor, round.stat, now);
  const b = valueOf(round.challenger, round.stat, now);
  if (a === undefined || b === undefined) return 0;
  if (a === b) return 0;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  if (lo <= 0) return Infinity;
  return hi / lo - 1;
}

export function simulate(opts: SimOptions): SimResult {
  const runs = opts.runs ?? 10_000;
  const maxRounds = opts.maxRounds ?? 60;
  const prefix = opts.seedPrefix ?? "sim";

  const streaks: number[] = [];
  const statCounts: Record<string, number> = {};
  const relaxationCounts: Record<Relaxation, number> = { none: 0, band: 0, seen: 0 };
  const bucketTotals = new Map<string, { relaxed: number; total: number }>();
  for (const key of STAT_KEYS) statCounts[key] = 0;

  let roundsDealt = 0;
  let exhausted = 0;
  let maxConstructible = 0;

  for (let i = 0; i < runs; i++) {
    const seed = `${prefix}:${i}`;
    const rounds = buildRun({ deck: opts.deck, seed, now: opts.now, maxRounds });
    maxConstructible = Math.max(maxConstructible, rounds.length);

    // A separate stream for the skill model, so it cannot perturb the sequence.
    const rng = createRng(`${seed}:skill`);
    let streak = 0;

    for (const round of rounds) {
      roundsDealt += 1;
      statCounts[round.stat] = (statCounts[round.stat] ?? 0) + 1;
      relaxationCounts[round.relaxation] += 1;

      const bucket = `${Math.floor((round.index - 1) / 10) * 10 + 1}–${Math.floor((round.index - 1) / 10) * 10 + 10}`;
      const entry = bucketTotals.get(bucket) ?? { relaxed: 0, total: 0 };
      entry.total += 1;
      if (round.relaxation !== "none") entry.relaxed += 1;
      bucketTotals.set(bucket, entry);

      if (rng.next() < pCorrect(gapOf(round, opts.now))) {
        streak += 1;
      } else {
        break;
      }
    }

    // The run used every round the engine could build, so the engine ran out
    // rather than the player failing.
    if (streak === rounds.length && rounds.length < maxRounds) exhausted += 1;

    streaks.push(streak);
  }

  const relaxationByBucket: Record<string, number> = {};
  for (const [bucket, { relaxed, total }] of bucketTotals) {
    relaxationByBucket[bucket] = total === 0 ? 0 : relaxed / total;
  }

  return {
    runs,
    streaks: streaks.slice().sort((a, b) => a - b),
    statCounts,
    relaxationCounts,
    roundsDealt,
    exhausted,
    maxConstructible,
    relaxationByBucket,
  };
}

export function simulationReport(result: SimResult, deckSize: number, now: Date): string {
  const { streaks, runs } = result;
  const mean = streaks.reduce((a, b) => a + b, 0) / Math.max(streaks.length, 1);

  const lines: string[] = [];
  lines.push("# Simulation");
  lines.push("");
  lines.push(
    `${runs.toLocaleString("en-GB")} runs over ${deckSize} players, ` +
      `generated ${now.toISOString().slice(0, 10)}.`,
  );
  lines.push("");
  lines.push(
    "> Streaks come from a **modelled** player: correct with probability rising from",
  );
  lines.push(
    "> 0.5 at no gap to 0.95 at a blowout. That model is an assumption. The shape is",
  );
  lines.push("> informative; the absolute numbers are not, until real play replaces them.");
  lines.push("");

  lines.push("## Streak distribution");
  lines.push("");
  lines.push("| Measure | Rounds |");
  lines.push("|---|---|");
  lines.push(`| Mean | ${mean.toFixed(1)} |`);
  lines.push(`| Median | ${quantile(streaks, 0.5).toFixed(0)} |`);
  lines.push(`| 75th percentile | ${quantile(streaks, 0.75).toFixed(0)} |`);
  lines.push(`| 90th percentile | ${quantile(streaks, 0.9).toFixed(0)} |`);
  lines.push(`| 99th percentile | ${quantile(streaks, 0.99).toFixed(0)} |`);
  lines.push(`| Best | ${streaks[streaks.length - 1] ?? 0} |`);
  lines.push("");

  const buckets: Array<[string, (n: number) => boolean]> = [
    ["0", (n) => n === 0],
    ["1–4", (n) => n >= 1 && n <= 4],
    ["5–9", (n) => n >= 5 && n <= 9],
    ["10–19", (n) => n >= 10 && n <= 19],
    ["20–29", (n) => n >= 20 && n <= 29],
    ["30+", (n) => n >= 30],
  ];
  lines.push("| Streak | Share |");
  lines.push("|---|---|");
  for (const [label, test] of buckets) {
    const share = streaks.filter(test).length / Math.max(streaks.length, 1);
    const bar = "█".repeat(Math.round(share * 40));
    lines.push(`| ${label} | ${(share * 100).toFixed(1)}% ${bar} |`);
  }
  lines.push("");

  lines.push("## Stat firing rates");
  lines.push("");
  lines.push(
    "What the wheel actually produced, after tie exclusion and band filtering had",
  );
  lines.push("their say. Compare against the intended 17.5 / 11 / 2 per stat.");
  lines.push("");
  lines.push("| Stat | Tier | Share | Intended |");
  lines.push("|---|---|---|---|");
  const intended = { basic: 17.5, uncommon: 11, rare: 2 } as const;
  for (const key of STAT_KEYS) {
    const share = (result.statCounts[key] ?? 0) / Math.max(result.roundsDealt, 1);
    const tier = STATS[key].tier;
    lines.push(
      `| ${STATS[key].label} | ${tier} | ${(share * 100).toFixed(1)}% | ${intended[tier]}% |`,
    );
  }
  lines.push("");

  lines.push("## Relaxation");
  lines.push("");
  lines.push(
    "`band` means the pool was too sparse and the band had to be widened — the deck",
  );
  lines.push(
    "is thin in the tails. `seen` means the band was fine but every eligible opponent",
  );
  lines.push("was recently used — the deck is simply too small. They need different fixes.");
  lines.push("");
  const total = Math.max(result.roundsDealt, 1);
  lines.push("| Cause | Share |");
  lines.push("|---|---|");
  lines.push(`| none | ${((result.relaxationCounts.none / total) * 100).toFixed(1)}% |`);
  lines.push(`| band | ${((result.relaxationCounts.band / total) * 100).toFixed(1)}% |`);
  lines.push(`| seen | ${((result.relaxationCounts.seen / total) * 100).toFixed(1)}% |`);
  lines.push("");
  lines.push("| Rounds | Relaxed |");
  lines.push("|---|---|");
  for (const [bucket, share] of Object.entries(result.relaxationByBucket).sort(
    (a, b) => Number(a[0].split("–")[0]) - Number(b[0].split("–")[0]),
  )) {
    lines.push(`| ${bucket} | ${(share * 100).toFixed(1)}% |`);
  }
  lines.push("");

  lines.push("## Engine reach");
  lines.push("");
  lines.push(
    `Longest run the engine could construct: **${result.maxConstructible} rounds**.`,
  );
  lines.push(
    `Runs that ended because the engine ran out rather than the player failing: ` +
      `**${((result.exhausted / Math.max(runs, 1)) * 100).toFixed(1)}%**.`,
  );
  lines.push("");
  if (result.exhausted / Math.max(runs, 1) > 0.01) {
    lines.push(
      "> A non-trivial share of runs hit the end of what the deck can produce. That is a",
    );
    lines.push("> deck-size finding, not a difficulty finding — add players before tuning bands.");
    lines.push("");
  }

  return lines.join("\n");
}
