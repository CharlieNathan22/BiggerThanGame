/**
 * simulation.md — how the ramp actually behaves.
 *
 * Runs the real engine thousands of times over the compiled deck and reports
 * what comes out. This is what turns the numbers in DESIGN.md §8 from a
 * considered guess into a measurement.
 *
 * Every mode is simulated over the same seeds, so the modes differ only by what
 * the mode itself changes: how many opening rounds prefer iconic challengers
 * (`ICONIC_ROUNDS`), the band schedule (`BAND_SCHEDULES`) and, for Friendly,
 * the twenty rounds that win the run (`WIN_ROUNDS`).
 *
 * **The streak distribution rests on a model of player skill** (`PlayerModel`),
 * and that model is an assumption, not data. Two are built in: `fan`, the
 * default, calibrated to a keen football fan, and `rank`, the original and much
 * weaker curve. A calibration file of observed accuracy by rank distance can
 * replace the fan's points (`calibratedModel`, `parseCalibration`). Treat the
 * absolute numbers as indicative until real play supplies that file (M5c).
 */

import {
  FINAL_STRETCH,
  ICONIC_ROUNDS,
  PAIR_RULES,
  STATS,
  STREAK_TITLES,
  STAT_KEYS,
  TIER_TARGET,
  WIN_ROUNDS,
  bandForRound,
  buildRun,
  createRng,
  percentiles,
  rankDistance,
  roundCap,
  valueOf,
} from "@bt/core";
import type { Mode, Player, Relaxation, Round, StatKey, ValueRule } from "@bt/core";

/**
 * Round ranges for the per-range firing table. The opening stat dominates the
 * first, so the overall rates hide how concentrated the later rounds are.
 */
export const ROUND_RANGES: ReadonlyArray<{ label: string; from: number; to: number }> = [
  { label: "1–5", from: 1, to: 5 },
  { label: "6–10", from: 6, to: 10 },
  { label: "11–20", from: 11, to: 20 },
  { label: "21+", from: 21, to: Infinity },
];

/** Which range a 1-based round falls in. */
export function rangeOf(index: number): string {
  return ROUND_RANGES.find((r) => index >= r.from && index <= r.to)!.label;
}

/** Every mode, in the order the report shows them. */
export const SIM_MODES = Object.keys(ICONIC_ROUNDS) as Mode[];

const RELAXATIONS: readonly Relaxation[] = ["none", "iconic", "band", "seen"];

function emptyRelaxationCounts(): Record<Relaxation, number> {
  return { none: 0, iconic: 0, band: 0, seen: 0 };
}

/**
 * The `rank` model's probability that a player answers a round correctly.
 *
 * Measured in **rank distance** (ramp.ts), the same scale the bands use: two
 * players at the same point in the deck's spread are a coin flip (0.5);
 * opposite ends of the deck, a distance of 1, reach `SKILL_CEILING` (0.95).
 * Between those, skill rises with the distance along `d / (d + HALF_GAP)`,
 * scaled so that it reaches the ceiling at 1 rather than only approaching it.
 * `HALF_GAP` sets how fast it rises: at a fifth of the deck apart the player is
 * 60% of the way from guessing to the ceiling (0.77), and halfway at about a
 * seventh.
 *
 * The model, and both constants, are an **assumption**, not data. The earlier
 * model measured a ratio, which scored every club-appearances pair as a near
 * coin flip because legends' figures sit within 2x of each other. Replace this
 * with the observed accuracy-by-band curve from real play (M5c) — the
 * telemetry in ARCHITECTURE.md §12 logs exactly that.
 */
export const SKILL_CEILING = 0.95;
export const HALF_GAP = 0.2;

export function pCorrect(distance: number): number {
  if (!(distance > 0)) return 0.5;
  // The unscaled curve only reaches 1 / (1 + HALF_GAP) at opposite ends; divide
  // by that so a distance of 1 is exactly the ceiling.
  const share = Math.min(distance, 1) / (Math.min(distance, 1) + HALF_GAP);
  return 0.5 + (SKILL_CEILING - 0.5) * share * (1 + HALF_GAP);
}

/**
 * A modelled player: the probability of answering a round correctly, given how
 * far apart the pair sits in the deck (rank distance, ramp.ts).
 */
export interface PlayerModel {
  /** Short name, as `--model` takes it and the report's columns show it. */
  readonly id: string;
  /** One sentence for the report. */
  readonly summary: string;
  readonly pCorrect: (distance: number) => number;
}

/** One point of an accuracy curve: accuracy at a given rank distance. */
export interface CalibrationPoint {
  readonly rankDistance: number;
  readonly accuracy: number;
}

/**
 * The `fan` model's curve: a keen football fan, who knows the famous figures
 * and gets most mid-range gaps right. An **assumption**, set well above the
 * `rank` model because real players won Friendly on their first or second run
 * against bands tuned with it. Replace it with observed accuracy by rank
 * distance from real play via `--calibration`.
 */
export const FAN_POINTS: readonly CalibrationPoint[] = [
  { rankDistance: 0, accuracy: 0.55 },
  { rankDistance: 0.03, accuracy: 0.65 },
  { rankDistance: 0.08, accuracy: 0.78 },
  { rankDistance: 0.15, accuracy: 0.88 },
  { rankDistance: 0.3, accuracy: 0.95 },
  { rankDistance: 0.5, accuracy: 0.99 },
];

/**
 * Accuracy at `distance`, interpolated linearly between the points either side
 * of it and flat beyond the first and last. `points` must be sorted by rank
 * distance, as `parseCalibration` leaves them.
 */
export function interpolate(points: readonly CalibrationPoint[], distance: number): number {
  const first = points[0];
  if (first === undefined) throw new Error("interpolate: no calibration points");
  if (!(distance > first.rankDistance)) return first.accuracy; // also catches NaN
  for (let i = 1; i < points.length; i++) {
    const hi = points[i]!;
    if (distance <= hi.rankDistance) {
      const lo = points[i - 1]!;
      const t = (distance - lo.rankDistance) / (hi.rankDistance - lo.rankDistance);
      return lo.accuracy + (hi.accuracy - lo.accuracy) * t;
    }
  }
  return points[points.length - 1]!.accuracy;
}

/**
 * Validates a calibration file's contents: a non-empty list of
 * `{ rankDistance, accuracy }`, both from 0 to 1, with no rank distance given
 * twice. Returns the points sorted by rank distance; throws on anything else,
 * naming the offending entry.
 */
export function parseCalibration(json: unknown): CalibrationPoint[] {
  if (!Array.isArray(json) || json.length === 0) {
    throw new Error("calibration: expected a non-empty list of { rankDistance, accuracy }");
  }
  const unit = (v: unknown): v is number =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
  const points = json.map((entry: unknown, i): CalibrationPoint => {
    const { rankDistance, accuracy } = (entry ?? {}) as Record<string, unknown>;
    if (typeof entry !== "object" || !unit(rankDistance) || !unit(accuracy)) {
      throw new Error(
        `calibration: entry ${i} must be { rankDistance, accuracy }, both from 0 to 1`,
      );
    }
    return { rankDistance, accuracy };
  });
  points.sort((a, b) => a.rankDistance - b.rankDistance);
  for (let i = 1; i < points.length; i++) {
    if (points[i]!.rankDistance === points[i - 1]!.rankDistance) {
      throw new Error(`calibration: rank distance ${points[i]!.rankDistance} is given twice`);
    }
  }
  return points;
}

/** A model that follows an accuracy curve given as points, in any order. */
export function calibratedModel(
  id: string,
  summary: string,
  points: readonly CalibrationPoint[],
): PlayerModel {
  const sorted = parseCalibration(points);
  return { id, summary, pCorrect: (d) => interpolate(sorted, d) };
}

/** `points` as the report and a model summary show them: "0.55 at 0, 0.65 at 0.03, …". */
export function describePoints(points: readonly CalibrationPoint[]): string {
  return points.map((p) => `${p.accuracy} at ${p.rankDistance}`).join(", ");
}

export const FAN_MODEL: PlayerModel = calibratedModel(
  "fan",
  `a keen football fan, accurate ${describePoints(FAN_POINTS)} (rank distance), ` +
    "linear in between and flat beyond the last point",
  FAN_POINTS,
);

export const RANK_MODEL: PlayerModel = {
  id: "rank",
  summary:
    `the original, weaker curve: 0.5 at no gap rising to ${SKILL_CEILING} at opposite ends of ` +
    `the deck, along d / (d + ${HALF_GAP}) scaled to reach it`,
  pCorrect,
};

/** The built-in models, by `--model` name. `fan` is the default. */
export const PLAYER_MODELS: Readonly<Record<string, PlayerModel>> = {
  fan: FAN_MODEL,
  rank: RANK_MODEL,
};

export interface SimOptions {
  readonly deck: readonly Player[];
  readonly now: Date;
  readonly mode: Mode;
  readonly runs?: number;
  /** Defaults to the mode's own cap (`roundCap`): 20 for Friendly. */
  readonly maxRounds?: number;
  readonly seedPrefix?: string;
  /** Plays every run; its rounds played drive the deal statistics. Defaults to `fan`. */
  readonly model?: PlayerModel;
  /** Further models scored on the same rounds and skill draws, for comparison only. */
  readonly compare?: readonly PlayerModel[];
}

/** How one player model fared over a simulation's runs. */
export interface ModelOutcome {
  readonly model: PlayerModel;
  /** Streak lengths, ascending. */
  readonly streaks: readonly number[];
  /** Runs that reached the mode's win target (`WIN_ROUNDS`); 0 for a mode without one. */
  readonly wins: number;
  /** Per question, index 0 for question 1: runs that were dealt it. */
  readonly reached: readonly number[];
  /** Per question: runs that answered it correctly. */
  readonly correct: readonly number[];
}

export interface SimResult {
  readonly mode: Mode;
  readonly runs: number;
  /** The playing model's outcome first, then each `compare` model's. */
  readonly outcomes: readonly ModelOutcome[];
  /** The playing model's streaks, ascending. */
  readonly streaks: readonly number[];
  /** The playing model's wins. */
  readonly wins: number;
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
  /**
   * Longest run the engine could construct at all, ignoring player skill, over
   * the first `REACH_SAMPLE` seeds (dealt to the cap whatever the player did).
   */
  readonly maxConstructible: number;
  /** Relaxation rate per 10-round bucket. */
  readonly relaxationByBucket: Readonly<Record<string, number>>;
  /** Rounds played before the first stat change — the opening stat's share. */
  readonly openingStatRounds: number;
  /** Rounds played per round range (`ROUND_RANGES`), per stat. */
  readonly statCountsByRange: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /**
   * Rounds played from the mode's pair rules on (`PAIR_RULES`, round 16 in
   * Endless), per stat; empty for a mode without them.
   */
  readonly lateStatCounts: Readonly<Record<string, number>>;
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

function distanceOf(round: Round, deck: readonly Player[], now: Date): number {
  const a = valueOf(round.anchor, round.stat, now);
  const b = valueOf(round.challenger, round.stat, now);
  if (a === undefined || b === undefined) return 0;
  return rankDistance(percentiles(deck, round.stat, now), a, b);
}

/** Mutable tallies behind a `ModelOutcome`. */
interface Tally {
  readonly model: PlayerModel;
  readonly streaks: number[];
  wins: number;
  readonly reached: number[];
  readonly correct: number[];
}

/**
 * Plays one run's rounds, given as each pair's rank distance, and returns the
 * streak. Draws from its own skill stream so the model cannot perturb the
 * sequence; every model gets the same stream for a seed, so models are
 * compared on the same luck as well as the same rounds.
 */
function play(seed: string, distances: readonly number[], tally: Tally): number {
  const rng = createRng(`${seed}:skill`);
  let streak = 0;
  for (const [i, distance] of distances.entries()) {
    tally.reached[i] = (tally.reached[i] ?? 0) + 1;
    if (!(rng.next() < tally.model.pCorrect(distance))) break;
    tally.correct[i] = (tally.correct[i] ?? 0) + 1;
    streak += 1;
  }
  return streak;
}

/** The streak `play` would give, without tallying anything. */
function streakOf(seed: string, distances: readonly number[], model: PlayerModel): number {
  const rng = createRng(`${seed}:skill`);
  let streak = 0;
  for (const distance of distances) {
    if (!(rng.next() < model.pCorrect(distance))) break;
    streak += 1;
  }
  return streak;
}

/**
 * Rounds dealt up front for each run. Dealing is the slow part and most runs
 * end long before a long cap (Endless's is 150), so a run is dealt this far and
 * only dealt in full when a model answers all of it. The sequence doesn't
 * depend on answers, so the full run starts with exactly these rounds.
 */
export const PROBE_ROUNDS = 40;

/** Runs dealt to the full cap, whatever the player does, to measure the engine's reach. */
export const REACH_SAMPLE = 200;

export function simulate(opts: SimOptions): SimResult {
  const runs = opts.runs ?? 20_000;
  const maxRounds = opts.maxRounds ?? roundCap(opts.mode);
  const target = WIN_ROUNDS[opts.mode];
  const prefix = opts.seedPrefix ?? "sim";
  const tallies: Tally[] = [opts.model ?? FAN_MODEL, ...(opts.compare ?? [])].map((model) => ({
    model,
    streaks: [],
    wins: 0,
    reached: Array.from({ length: maxRounds }, () => 0),
    correct: Array.from({ length: maxRounds }, () => 0),
  }));

  const statCounts: Record<string, number> = {};
  const relaxationCounts = emptyRelaxationCounts();
  const iconicWindow = emptyRelaxationCounts();
  const windowEnd = ICONIC_ROUNDS[opts.mode];
  const bucketTotals = new Map<string, { relaxed: number; total: number }>();
  for (const key of STAT_KEYS) statCounts[key] = 0;

  let roundsDealt = 0;
  let openingStatRounds = 0;
  const statCountsByRange: Record<string, Record<string, number>> = {};
  for (const { label } of ROUND_RANGES) {
    statCountsByRange[label] = {};
    for (const key of STAT_KEYS) statCountsByRange[label]![key] = 0;
  }
  let exhausted = 0;
  let maxConstructible = 0;
  const lateFrom = PAIR_RULES[opts.mode]?.from ?? Infinity;
  const lateStatCounts: Record<string, number> = {};

  const deal = (seed: string, rounds: number): Round[] =>
    buildRun({ deck: opts.deck, seed, mode: opts.mode, now: opts.now, maxRounds: rounds });
  const probe = Math.min(maxRounds, PROBE_ROUNDS);

  for (let i = 0; i < runs; i++) {
    const seed = `${prefix}:${i}`;
    let rounds = deal(seed, i < REACH_SAMPLE ? maxRounds : probe);
    let distances = rounds.map((round) => distanceOf(round, opts.deck, opts.now));
    if (
      rounds.length === probe &&
      probe < maxRounds &&
      tallies.some((t) => streakOf(seed, distances, t.model) === probe)
    ) {
      rounds = deal(seed, maxRounds);
      distances = rounds.map((round) => distanceOf(round, opts.deck, opts.now));
    }
    if (i < REACH_SAMPLE) maxConstructible = Math.max(maxConstructible, rounds.length);
    for (const tally of tallies) {
      const n = play(seed, distances, tally);
      tally.streaks.push(n);
      if (target !== null && n >= target) tally.wins += 1;
    }
    // The deal statistics follow the playing model: every round it answered,
    // and the one it missed.
    const streak = tallies[0]!.streaks.at(-1)!;
    let stillOpening = true;

    for (const round of rounds.slice(0, streak + 1)) {
      roundsDealt += 1;
      if (round.statChanged) stillOpening = false;
      if (stillOpening) openingStatRounds += 1;
      statCounts[round.stat] = (statCounts[round.stat] ?? 0) + 1;
      const inRange = statCountsByRange[rangeOf(round.index)]!;
      inRange[round.stat] = (inRange[round.stat] ?? 0) + 1;
      if (round.index >= lateFrom) {
        lateStatCounts[round.stat] = (lateStatCounts[round.stat] ?? 0) + 1;
      }
      relaxationCounts[round.relaxation] += 1;
      if (round.index <= windowEnd) iconicWindow[round.relaxation] += 1;

      const bucket = `${Math.floor((round.index - 1) / 10) * 10 + 1}–${Math.floor((round.index - 1) / 10) * 10 + 10}`;
      const entry = bucketTotals.get(bucket) ?? { relaxed: 0, total: 0 };
      entry.total += 1;
      if (round.relaxation !== "none") entry.relaxed += 1;
      bucketTotals.set(bucket, entry);
    }

    const won = target !== null && streak >= target;
    // The run used every round the engine could build, so the engine ran out
    // rather than the player failing — or winning.
    if (!won && streak === rounds.length && rounds.length < maxRounds) exhausted += 1;
  }

  const relaxationByBucket: Record<string, number> = {};
  for (const [bucket, { relaxed, total }] of bucketTotals) {
    relaxationByBucket[bucket] = total === 0 ? 0 : relaxed / total;
  }

  const outcomes: ModelOutcome[] = tallies.map((t) => ({
    model: t.model,
    streaks: t.streaks.slice().sort((a, b) => a - b),
    wins: t.wins,
    reached: t.reached,
    correct: t.correct,
  }));

  return {
    mode: opts.mode,
    runs,
    outcomes,
    streaks: outcomes[0]!.streaks,
    wins: outcomes[0]!.wins,
    statCounts,
    relaxationCounts,
    iconicWindow,
    roundsDealt,
    exhausted,
    maxConstructible,
    relaxationByBucket,
    openingStatRounds,
    statCountsByRange,
    lateStatCounts,
  };
}

function pct(n: number, d: number): string {
  return `${((n / Math.max(d, 1)) * 100).toFixed(1)}%`;
}

function mean(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1);
}

/**
 * Round `round`'s scheduled band in `mode`, as the report shows it: `≥0.45` or
 * `0.20–0.60`, plus the final stretch's ratio floor where it applies, and in
 * Endless's late rounds its pair rules: wide stats also ≥10% apart, narrow ones
 * paired by value instead (`PAIR_RULES`, listed under the table).
 */
export function bandText(round: number, mode: Mode): string {
  const band = bandForRound(round, mode);
  const range = band.ceiling === null ? `≥${band.floor}` : `${band.floor}–${band.ceiling}`;
  const stretch = FINAL_STRETCH[mode];
  if (stretch !== null && round >= stretch.from) {
    return `${range}, ≥${Math.round(stretch.minRatio * 100)}% apart`;
  }
  const rules = PAIR_RULES[mode];
  if (rules !== null && round >= rules.from) {
    return `${range}, ≥${Math.round(rules.wideMinRatio * 100)}% apart; narrow by value`;
  }
  return range;
}

/** A value rule in words: "within 10%, not equal", "1–2 apart". */
export function valueRuleText(rule: ValueRule): string {
  return rule.kind === "relative"
    ? `different, and within ${Math.round(rule.max * 100)}% of each other`
    : `${rule.min}–${rule.max} apart`;
}

/** Share of the answers in rounds `from`–`to` (inclusive) that were right. */
export function accuracyOver(o: ModelOutcome, from: number, to: number): number {
  let reached = 0;
  let correct = 0;
  for (let q = from; q <= Math.min(to, o.reached.length); q++) {
    reached += o.reached[q - 1] ?? 0;
    correct += o.correct[q - 1] ?? 0;
  }
  return reached === 0 ? NaN : correct / reached;
}

/** Round ranges for a no-finish-line mode's accuracy table. */
export const OPEN_RANGES: ReadonlyArray<{ label: string; from: number; to: number }> = [
  { label: "1–5", from: 1, to: 5 },
  { label: "6–10", from: 6, to: 10 },
  { label: "11–15", from: 11, to: 15 },
  { label: "16–20", from: 16, to: 20 },
  { label: "21–30", from: 21, to: 30 },
  { label: "31+", from: 31, to: Infinity },
];

/**
 * A mode with no finish line (Endless): how far runs get, how accurate the
 * player is by round range under every model, the pair rules and each stat's
 * share of the late rounds.
 */
function openSection(r: SimResult, cap: number): string[] {
  const name = r.mode.charAt(0).toUpperCase() + r.mode.slice(1);
  const share = (x: number): string => (Number.isNaN(x) ? "—" : `${(x * 100).toFixed(1)}%`);
  const reach = (o: ModelOutcome, n: number): string =>
    pct(o.streaks.filter((s) => s >= n).length, o.streaks.length);
  const models = r.outcomes;
  const cells = ["Measure", ...models.map((o) => `\`${o.model.id}\``)];
  const row = (label: string, cell: (o: ModelOutcome) => string): string =>
    `| ${[label, ...models.map(cell)].join(" | ")} |`;
  const lines: string[] = [
    `## ${name}: a streak with no finish line`,
    "",
    "The same runs and skill draws under each model; the first column played the runs",
    "the rest of this report describes.",
    "",
    `| ${cells.join(" | ")} |`,
    `|${cells.map(() => "---").join("|")}|`,
    row("Mean streak", (o) => mean(o.streaks).toFixed(1)),
    ...[0.5, 0.75, 0.9, 0.99].map((p) =>
      row(`${p === 0.5 ? "Median" : `${p * 100}th percentile`}`, (o) =>
        quantile(o.streaks, p).toFixed(0),
      ),
    ),
    ...[10, 20, 30, 40].map((n) => row(`Reached ${n}`, (o) => reach(o, n))),
    row(`Reached the cap (${cap})`, (o) => reach(o, cap)),
    ...OPEN_RANGES.map((g) =>
      row(`Correct, rounds ${g.label}`, (o) => share(accuracyOver(o, g.from, g.to))),
    ),
    "",
  ];

  const rules = PAIR_RULES[r.mode];
  if (rules !== null) {
    lines.push(`From round ${rules.from}, the pair rules (\`PAIR_RULES\`):`);
    lines.push("");
    lines.push(
      `- **Wide stats** keep their band and must also be at least ` +
        `${Math.round(rules.wideMinRatio * 100)}% apart, whatever relaxes.`,
    );
    for (const [key, rule] of Object.entries(rules.narrow)) {
      if (rule === undefined) continue;
      lines.push(
        `- **${STATS[key as StatKey].label}**: ${valueRuleText(rule)}, instead of the band.`,
      );
    }
    lines.push("");
  }

  const o = r.outcomes[0]!;
  lines.push("By round: the scheduled band, the share of runs dealt it, and the share of those");
  lines.push("that answered it right.");
  lines.push("");
  lines.push("| Round | Band | Reached | Correct |", "|---|---|---|---|");
  const last = Math.min(cap, 40);
  for (let q = 1; q <= last; q++) {
    lines.push(
      `| ${q} | ${bandText(q, r.mode)} | ${pct(o.reached[q - 1] ?? 0, r.runs)} | ` +
        `${share(accuracyAt(o, q))} |`,
    );
  }
  lines.push("");

  if (rules !== null) {
    const total = STAT_KEYS.reduce((sum, key) => sum + (r.lateStatCounts[key] ?? 0), 0);
    lines.push(`### Stats from round ${rules.from}`);
    lines.push("");
    lines.push("Share of the rounds played from the pair rules on, against the stat's target.");
    lines.push("Every stat should still fire: the wheel never skips a stat it can deal.");
    lines.push("");
    lines.push("| Stat | Tier | Target | Share |", "|---|---|---|---|");
    for (const key of STAT_KEYS) {
      const tier = STATS[key].tier;
      lines.push(
        `| ${STATS[key].label} | ${tier} | ${TIER_TARGET[tier]}% | ` +
          `${pct(r.lateStatCounts[key] ?? 0, total)} |`,
      );
    }
    lines.push(`| _Rounds played_ |  |  | ${total} |`);
    lines.push("");
  }
  return lines;
}

/** Share of runs that answered question `q` right, of those dealt it. */
export function accuracyAt(o: ModelOutcome, q: number): number {
  return (o.correct[q - 1] ?? 0) / Math.max(o.reached[q - 1] ?? 0, 1);
}

/** Share of runs that were dealt question `q`: answered the `q - 1` before it. */
export function reachedShare(o: ModelOutcome, q: number, runs: number): number {
  return (o.reached[q - 1] ?? 0) / Math.max(runs, 1);
}

/**
 * A mode with a finish line: how many runs win, and where the rest stop,
 * bucketed at the mode's streak titles.
 */
function challengeSection(r: SimResult, goal: number): string[] {
  const lines: string[] = [];
  const name = r.mode.charAt(0).toUpperCase() + r.mode.slice(1);
  lines.push(`## ${name}: the ${goal}-question challenge`);
  lines.push("");
  lines.push(`A run that answers all ${goal} rounds correctly is won. Share of runs:`);
  lines.push("");
  const cuts = [0, 1, ...STREAK_TITLES[r.mode].map((t) => t.min).filter((m) => m < goal), goal];
  const rows: Array<[string, (n: number) => boolean]> = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const from = cuts[i]!;
    const to = cuts[i + 1]! - 1;
    rows.push([from === to ? String(from) : `${from}–${to}`, (n) => n >= from && n <= to]);
  }
  rows.push([`**${goal} (won)**`, (n) => n >= goal]);
  lines.push("| Streak | Runs |", "|---|---|");
  for (const [label, test] of rows) {
    lines.push(`| ${label} | ${pct(r.streaks.filter(test).length, r.streaks.length)} |`);
  }
  lines.push("");
  lines.push("Reached at least:");
  lines.push("");
  const marks = [...new Set([5, 10, 15, 18, goal].filter((m) => m <= goal))];
  lines.push(`| ${["Streak", ...marks.map(String)].join(" | ")} |`);
  lines.push(`|${["", ...marks].map(() => "---").join("|")}|`);
  lines.push(
    `| Runs | ${marks.map((m) => pct(r.streaks.filter((n) => n >= m).length, r.runs)).join(" | ")} |`,
  );
  lines.push("");
  lines.push(`**Win rate: ${pct(r.wins, r.runs)}.**`);
  lines.push("");
  const reachedFinal = r.streaks.filter((n) => n >= goal - 1).length;
  lines.push(
    `Reached the final question (round ${goal}): ${pct(reachedFinal, r.runs)} of runs, ` +
      `and ${pct(r.wins, reachedFinal)} of those won.`,
  );
  lines.push("");
  lines.push("By question: the round's scheduled band, the share of runs dealt the question,");
  lines.push("and the share of those that answered it right.");
  lines.push("");
  const o = r.outcomes[0]!;
  lines.push("| Question | Band | Reached | Correct |", "|---|---|---|---|");
  for (let q = 1; q <= goal; q++) {
    lines.push(
      `| ${q} | ${bandText(q, r.mode)} | ${pct(o.reached[q - 1] ?? 0, r.runs)} | ` +
        `${(accuracyAt(o, q) * 100).toFixed(1)}% |`,
    );
  }
  lines.push("");
  return lines;
}

/**
 * The same runs scored by every model the simulation carried: same rounds, same
 * skill draws, so the columns differ only by the model.
 */
function modelComparison(r: SimResult, goal: number): string[] {
  const name = r.mode.charAt(0).toUpperCase() + r.mode.slice(1);
  const cells = ["Measure", ...r.outcomes.map((o) => `\`${o.model.id}\``)];
  const row = (label: string, cell: (o: ModelOutcome) => string): string =>
    `| ${[label, ...r.outcomes.map(cell)].join(" | ")} |`;
  const share = (x: number): string => `${(x * 100).toFixed(1)}%`;
  const lastThree = [goal - 2, goal - 1, goal].filter((q) => q >= 1);
  return [
    `## ${name} under each player model`,
    "",
    "The same runs and the same skill draws, scored by each model. The first column",
    "is the model that played the runs above.",
    "",
    `| ${cells.join(" | ")} |`,
    `|${cells.map(() => "---").join("|")}|`,
    row("Mean streak", (o) => mean(o.streaks).toFixed(1)),
    row("Median streak", (o) => quantile(o.streaks, 0.5).toFixed(0)),
    ...lastThree.map((q) => row(`Reached question ${q}`, (o) => share(reachedShare(o, q, r.runs)))),
    ...lastThree.map((q) => row(`Correct on question ${q}`, (o) => share(accuracyAt(o, q)))),
    row("**Win rate**", (o) => `**${pct(o.wins, r.runs)}**`),
    "",
  ];
}

/** What the report says about the models: the one used, the others, and how to switch. */
function modelsSection(results: readonly SimResult[]): string[] {
  const used = results[0]?.outcomes[0]?.model ?? FAN_MODEL;
  const others = Object.values(PLAYER_MODELS).filter((m) => m.id !== used.id);
  return [
    "## Player models",
    "",
    "A modelled player answers each round correctly with a probability set by how far",
    "apart the pair sits in the deck, in rank distance like the bands.",
    "",
    `- **\`${used.id}\`** (used above): ${used.summary}.`,
    ...others.map((m) => `- \`${m.id}\`: ${m.summary}.`),
    "",
    "`fan` is the default and the model Friendly and Endless are tuned with. `rank` was",
    "the only model until Friendly's retune; it is far weaker than a real football fan,",
    "so bands tuned with it proved too soft in real play. Ranked was tuned with it. The",
    "fan model has no clock, so Endless, with ten seconds a question, plays harder still.",
    "",
    "- `pnpm simulate` uses `fan`; `pnpm simulate --model rank` uses `rank`.",
    "- `pnpm simulate --calibration <file.json>` replaces the fan's points with a list",
    '  of `{ "rankDistance": 0.1, "accuracy": 0.8 }` points (any order, each from 0 to',
    "  1), interpolated linearly and flat beyond the first and last. Build it from real",
    "  play: `pnpm stats distance` gives correct rate by rank distance.",
    "- `--runs <n>` sets the runs per mode (default 20,000).",
    "",
    "**Every model is an assumption** until a calibration file from real play replaces",
    "it. The shape of the results is informative; the absolute numbers are indicative.",
    "",
  ];
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
  const used = results[0]?.outcomes[0]?.model ?? FAN_MODEL;
  lines.push(
    `> Streaks come from a **modelled** player, \`${used.id}\`: ${used.summary}. ` +
      "**That model is an assumption** (see Player models below), to be replaced by the " +
      "accuracy curve observed in real play.",
  );
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

  for (const r of results) {
    const goal = WIN_ROUNDS[r.mode];
    if (goal === null) continue;
    lines.push(...challengeSection(r, goal));
    if (r.outcomes.length > 1) lines.push(...modelComparison(r, goal));
  }
  const endless = results.find((r) => r.mode === "endless");
  if (endless !== undefined) lines.push(...openSection(endless, roundCap("endless")));

  lines.push(...modelsSection(results));

  lines.push("## Stat firing rates");
  lines.push("");
  lines.push("Share of rounds played on each stat, after tie exclusion and band filtering had");
  lines.push("their say, against the per-stat target for its tier (`TIER_TARGET`). The wheel's");
  lines.push("tier weights are tuned to land within about two points of it.");
  lines.push("");
  lines.push(...header("Stat", "Tier", "Target"));
  for (const key of STAT_KEYS) {
    const tier = STATS[key].tier;
    lines.push(
      row(
        STATS[key].label,
        tier,
        `${TIER_TARGET[tier]}%`,
        ...results.map((r) => pct(r.statCounts[key] ?? 0, r.roundsDealt)),
      ),
    );
  }
  lines.push(
    row(
      "_Rounds on the opening stat_",
      "",
      "",
      ...results.map((r) => pct(r.openingStatRounds, r.roundsDealt)),
    ),
  );
  lines.push("");
  lines.push("The opening stat — basic or uncommon, never rare — always holds for rounds 1 and");
  lines.push("2, and most runs are short, so it covers a large share of all rounds. That is why");
  lines.push("rare stats need a much larger wheel weight than their target suggests.");
  lines.push("");

  const friendly = results.find((r) => r.mode === "friendly");
  if (friendly !== undefined) {
    lines.push("### By round range (Friendly)");
    lines.push("");
    lines.push("Share of the rounds played in each range. Rare stats never open a run, so they");
    lines.push("are absent from rounds 1–2 and would concentrate later without the wheel's");
    lines.push("no-rare-after-rare rule. The rare row is the tier together, which should stay");
    lines.push("under about 30% in every range.");
    lines.push("");
    const rangeTotal = (label: string): number =>
      STAT_KEYS.reduce((sum, key) => sum + (friendly.statCountsByRange[label]?.[key] ?? 0), 0);
    const cells = ["Stat", "Tier", ...ROUND_RANGES.map((r) => `Rounds ${r.label}`)];
    lines.push(`| ${cells.join(" | ")} |`, `|${cells.map(() => "---").join("|")}|`);
    for (const key of STAT_KEYS) {
      lines.push(
        row(
          STATS[key].label,
          STATS[key].tier,
          ...ROUND_RANGES.map((r) =>
            pct(friendly.statCountsByRange[r.label]?.[key] ?? 0, rangeTotal(r.label)),
          ),
        ),
      );
    }
    const rare = STAT_KEYS.filter((key) => STATS[key].tier === "rare");
    lines.push(
      row(
        "**Rare, together**",
        "",
        ...ROUND_RANGES.map((r) =>
          pct(
            rare.reduce((sum, key) => sum + (friendly.statCountsByRange[r.label]?.[key] ?? 0), 0),
            rangeTotal(r.label),
          ),
        ),
      ),
    );
    lines.push(row("_Rounds played_", "", ...ROUND_RANGES.map((r) => String(rangeTotal(r.label)))));
    lines.push("");
  }

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
