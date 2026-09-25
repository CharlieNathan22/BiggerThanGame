/**
 * simulation.md — how the ramp actually behaves.
 *
 * Runs the real engine thousands of times over the compiled deck and reports
 * what comes out. This is what turns the numbers in DESIGN.md §8 from a
 * considered guess into a measurement.
 *
 * Every mode is simulated over the same seeds, so the modes differ only by what
 * the mode itself changes — today, how many opening rounds prefer iconic
 * challengers (`ICONIC_ROUNDS`).
 *
 * **The streak distribution rests on a model of player skill**, and that model
 * is an assumption, not data. See `pCorrect` below. Treat the shape of the
 * distribution as informative and the absolute numbers as indicative until real
 * play replaces them.
 */

import { ICONIC_ROUNDS, STATS, STAT_KEYS, buildRun, createRng, valueOf } from "@bt/core";
import type { Mode, Player, Relaxation, Round } from "@bt/core";

/** Every mode, in the order the report shows them. */
export const SIM_MODES = Object.keys(ICONIC_ROUNDS) as Mode[];

const RELAXATIONS: readonly Relaxation[] = ["none", "iconic", "band", "seen"];

function emptyRelaxationCounts(): Record<Relaxation, number> {
  return { none: 0, iconic: 0, band: 0, seen: 0 };
}

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
  readonly mode: Mode;
  readonly runs?: number;
  readonly maxRounds?: number;
  readonly seedPrefix?: string;
}

export interface SimResult {
  readonly mode: Mode;
  readonly runs: number;
  /** Streak lengths, ascending. */
  readonly streaks: readonly number[];
  readonly statCounts: Readonly<Record<string, number>>;
  readonly relaxationCounts: Readonly<Record<Relaxation, number>>;
  /**
   * Relaxation for rounds inside the mode's iconic window only. `none` there
   * means an iconic challenger was dealt; anything else means the preference
   * fell back.
   */
  readonly iconicWindow: Readonly<Record<Relaxation, number>>;
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
  const relaxationCounts = emptyRelaxationCounts();
  const iconicWindow = emptyRelaxationCounts();
  const windowEnd = ICONIC_ROUNDS[opts.mode];
  const bucketTotals = new Map<string, { relaxed: number; total: number }>();
  for (const key of STAT_KEYS) statCounts[key] = 0;

  let roundsDealt = 0;
  let exhausted = 0;
  let maxConstructible = 0;

  for (let i = 0; i < runs; i++) {
    const seed = `${prefix}:${i}`;
    const rounds = buildRun({ deck: opts.deck, seed, mode: opts.mode, now: opts.now, maxRounds });
    maxConstructible = Math.max(maxConstructible, rounds.length);

    // A separate stream for the skill model, so it cannot perturb the sequence.
    const rng = createRng(`${seed}:skill`);
    let streak = 0;

    for (const round of rounds) {
      roundsDealt += 1;
      statCounts[round.stat] = (statCounts[round.stat] ?? 0) + 1;
      relaxationCounts[round.relaxation] += 1;
      if (round.index <= windowEnd) iconicWindow[round.relaxation] += 1;

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
    mode: opts.mode,
    runs,
    streaks: streaks.slice().sort((a, b) => a - b),
    statCounts,
    relaxationCounts,
    iconicWindow,
    roundsDealt,
    exhausted,
    maxConstructible,
    relaxationByBucket,
  };
}

function pct(n: number, d: number): string {
  return `${((n / Math.max(d, 1)) * 100).toFixed(1)}%`;
}

function mean(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1);
}

function windowTotal(r: SimResult): number {
  return RELAXATIONS.reduce((sum, k) => sum + r.iconicWindow[k], 0);
}

/** One simulation per mode, over the same seeds, reported side by side. */
export function simulationReport(
  results: readonly SimResult[],
  deckSize: number,
  now: Date,
): string {
  const runs = results[0]?.runs ?? 0;
  const modes = results.map((r) => r.mode);
  const header = (...first: string[]): string[] => {
    const cells = [...first, ...modes];
    return [`| ${cells.join(" | ")} |`, `|${cells.map(() => "---").join("|")}|`];
  };
  const row = (...cells: string[]): string => `| ${cells.join(" | ")} |`;
  const perMode = (label: string, cell: (r: SimResult) => string): string =>
    row(label, ...results.map(cell));

  const lines: string[] = [];
  lines.push("# Simulation");
  lines.push("");
  lines.push(
    `${runs.toLocaleString("en-GB")} runs per mode over ${deckSize} players, ` +
      `generated ${now.toISOString().slice(0, 10)}. Every mode uses the same seeds, so the ` +
      `columns differ only by what the mode changes.`,
  );
  lines.push("");
  lines.push("> Streaks come from a **modelled** player: correct with probability rising from");
  lines.push("> 0.5 at no gap to 0.95 at a blowout. That model is an assumption. The shape is");
  lines.push("> informative; the absolute numbers are not, until real play replaces them.");
  lines.push("");

  lines.push("## Streak distribution");
  lines.push("");
  lines.push(...header("Measure"));
  lines.push(perMode("Mean", (r) => mean(r.streaks).toFixed(1)));
  lines.push(perMode("Median", (r) => quantile(r.streaks, 0.5).toFixed(0)));
  lines.push(perMode("75th percentile", (r) => quantile(r.streaks, 0.75).toFixed(0)));
  lines.push(perMode("90th percentile", (r) => quantile(r.streaks, 0.9).toFixed(0)));
  lines.push(perMode("99th percentile", (r) => quantile(r.streaks, 0.99).toFixed(0)));
  lines.push(perMode("Best", (r) => String(r.streaks[r.streaks.length - 1] ?? 0)));
  lines.push("");

  const buckets: Array<[string, (n: number) => boolean]> = [
    ["0", (n) => n === 0],
    ["1–4", (n) => n >= 1 && n <= 4],
    ["5–9", (n) => n >= 5 && n <= 9],
    ["10–19", (n) => n >= 10 && n <= 19],
    ["20–29", (n) => n >= 20 && n <= 29],
    ["30+", (n) => n >= 30],
  ];
  lines.push(...header("Streak"));
  for (const [label, test] of buckets) {
    lines.push(perMode(label, (r) => pct(r.streaks.filter(test).length, r.streaks.length)));
  }
  lines.push("");

  lines.push("## Stat firing rates");
  lines.push("");
  lines.push("What the wheel actually produced, after tie exclusion and band filtering had");
  lines.push("their say. Compare against the intended 17.5 / 11 / 2 per stat.");
  lines.push("");
  lines.push(...header("Stat", "Tier", "Intended"));
  const intended = { basic: 17.5, uncommon: 11, rare: 2 } as const;
  for (const key of STAT_KEYS) {
    const tier = STATS[key].tier;
    lines.push(
      row(
        STATS[key].label,
        tier,
        `${intended[tier]}%`,
        ...results.map((r) => pct(r.statCounts[key] ?? 0, r.roundsDealt)),
      ),
    );
  }
  lines.push("");

  lines.push("## Iconic preference");
  lines.push("");
  lines.push("For the first N rounds of a run the challenger is drawn from iconic players when");
  lines.push("one can be dealt within the band; otherwise the whole deck is used before any");
  lines.push("other relaxation. These rows cover only rounds inside that window. A high");
  lines.push("fallback rate means the deck is short of iconic players at the opening band.");
  lines.push("");
  lines.push(...header("Measure"));
  lines.push(perMode("Window", (r) => `rounds 1–${ICONIC_ROUNDS[r.mode]}`));
  lines.push(perMode("Rounds dealt in window", (r) => String(windowTotal(r))));
  lines.push(perMode("Iconic challenger", (r) => pct(r.iconicWindow.none, windowTotal(r))));
  lines.push(
    perMode("Fell back", (r) => pct(windowTotal(r) - r.iconicWindow.none, windowTotal(r))),
  );
  lines.push(perMode("… to the whole deck", (r) => pct(r.iconicWindow.iconic, windowTotal(r))));
  lines.push(perMode("… and widened the band", (r) => pct(r.iconicWindow.band, windowTotal(r))));
  lines.push(
    perMode("… and ignored the seen queue", (r) => pct(r.iconicWindow.seen, windowTotal(r))),
  );
  lines.push("");

  lines.push("## Relaxation");
  lines.push("");
  lines.push("Each round counts once, under the furthest step it needed. `iconic` means the");
  lines.push("iconic preference fell back to the whole deck at the round's band. `band` means");
  lines.push("the pool was too sparse and the band had to be widened — the deck is thin in the");
  lines.push("tails. `seen` means the band was fine but every eligible opponent was recently");
  lines.push("used — the deck is simply too small. They need different fixes.");
  lines.push("");
  lines.push(...header("Cause"));
  for (const cause of RELAXATIONS) {
    lines.push(perMode(cause, (r) => pct(r.relaxationCounts[cause], r.roundsDealt)));
  }
  lines.push("");
  lines.push("Any relaxation, by round:");
  lines.push("");
  lines.push(...header("Rounds"));
  const bucketLabels = [...new Set(results.flatMap((r) => Object.keys(r.relaxationByBucket)))];
  bucketLabels.sort((a, b) => Number(a.split("–")[0]) - Number(b.split("–")[0]));
  for (const bucket of bucketLabels) {
    lines.push(
      perMode(bucket, (r) => {
        const share = r.relaxationByBucket[bucket];
        return share === undefined ? "—" : `${(share * 100).toFixed(1)}%`;
      }),
    );
  }
  lines.push("");

  lines.push("## Engine reach");
  lines.push("");
  lines.push(...header("Measure"));
  lines.push(perMode("Longest constructible run", (r) => `${r.maxConstructible} rounds`));
  lines.push(perMode("Runs the engine ran out on", (r) => pct(r.exhausted, r.runs)));
  lines.push("");
  lines.push("The second row counts runs that ended because the engine could not deal another");
  lines.push("pair, rather than because the modelled player failed.");
  lines.push("");
  if (results.some((r) => r.exhausted / Math.max(r.runs, 1) > 0.01)) {
    lines.push("> A non-trivial share of runs hit the end of what the deck can produce. That is a");
    lines.push("> deck-size finding, not a difficulty finding — add players before tuning bands.");
    lines.push("");
  }

  return lines.join("\n");
}
