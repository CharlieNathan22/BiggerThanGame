/**
 * Daily Ranked in simulation.md: twenty questions, mistakes and all, then
 * sudden-death bonus rounds for a perfect twenty (DESIGN.md §3).
 *
 * Each simulated game is a different day's: its own seed, dealt by the real
 * engine in mode `ranked` (Endless's ramp, three iconic rounds) up to
 * Endless's cap. The modelled player answers every one of the twenty
 * whatever happened before — a miss doesn't end the run — and, after twenty
 * right, keeps going until the first miss. The model is the same assumption
 * as everywhere else in the report: a player with no memory and no clock.
 *
 * Reported, not tuned: the spread of the score out of twenty, the 20/20 rate,
 * the bonus rounds' spread, and accuracy by question.
 */

import {
  DAILY_QUESTIONS,
  buildRun,
  createRng,
  percentiles,
  rankDistance,
  roundCap,
  valueOf,
} from "@bt/core";
import type { Player, Round } from "@bt/core";
import { FAN_MODEL, bandText } from "./simulate.js";
import type { PlayerModel } from "./simulate.js";

export interface DailySimOptions {
  readonly deck: readonly Player[];
  readonly now: Date;
  readonly runs?: number;
  readonly model?: PlayerModel;
  readonly seedPrefix?: string;
}

export interface DailySimResult {
  readonly runs: number;
  readonly model: PlayerModel;
  /** Right answers out of twenty, per game, ascending. */
  readonly correct: readonly number[];
  /** Bonus rounds answered right, per perfect game, ascending. */
  readonly bonus: readonly number[];
  /** Per question 1–20: games answering it right. */
  readonly rightAt: readonly number[];
  /** Games the engine couldn't deal twenty questions for. */
  readonly short: number;
}

function distanceOf(round: Round, deck: readonly Player[], now: Date): number {
  const a = valueOf(round.anchor, round.stat, now);
  const b = valueOf(round.challenger, round.stat, now);
  if (a === undefined || b === undefined) return 0;
  return rankDistance(percentiles(deck, round.stat, now), a, b);
}

export function simulateDaily(opts: DailySimOptions): DailySimResult {
  const runs = opts.runs ?? 20_000;
  const model = opts.model ?? FAN_MODEL;
  const prefix = opts.seedPrefix ?? "daily";
  const correct: number[] = [];
  const bonus: number[] = [];
  const rightAt = Array.from({ length: DAILY_QUESTIONS }, () => 0);
  let short = 0;
  const deal = (seed: string, rounds: number): Round[] =>
    buildRun({ deck: opts.deck, seed, mode: "ranked", now: opts.now, maxRounds: rounds });

  for (let i = 0; i < runs; i++) {
    const seed = `${prefix}:${i}`;
    const rng = createRng(`${seed}:skill`);
    const answer = (round: Round): boolean =>
      rng.next() < model.pCorrect(distanceOf(round, opts.deck, opts.now));
    const twenty = deal(seed, DAILY_QUESTIONS);
    if (twenty.length < DAILY_QUESTIONS) short += 1;
    let right = 0;
    for (const [q, round] of twenty.entries()) {
      if (answer(round)) {
        right += 1;
        rightAt[q] = (rightAt[q] ?? 0) + 1;
      }
    }
    correct.push(right);
    if (right === DAILY_QUESTIONS) {
      // Dealt in full only for a perfect twenty: the sequence doesn't depend
      // on answers, so it starts with exactly these twenty.
      const all = deal(seed, roundCap("ranked"));
      let streak = 0;
      for (const round of all.slice(DAILY_QUESTIONS)) {
        if (!answer(round)) break;
        streak += 1;
      }
      bonus.push(streak);
    }
  }
  const up = (a: number, b: number) => a - b;
  return {
    runs,
    model,
    correct: correct.sort(up),
    bonus: bonus.sort(up),
    rightAt,
    short,
  };
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

function pct(n: number, d: number): string {
  return d === 0 ? "—" : `${((100 * n) / d).toFixed(1)}%`;
}

/** The Daily Ranked section of simulation.md. */
export function dailySection(r: DailySimResult): string[] {
  const mean = r.correct.reduce((s, n) => s + n, 0) / Math.max(r.correct.length, 1);
  const perfect = r.bonus.length;
  const lines: string[] = [
    "## Daily Ranked: twenty questions and the bonus",
    "",
    `${r.runs.toLocaleString("en-GB")} games, each a different day's seed, played by the ` +
      `\`${r.model.id}\` model. Every one of the twenty is answered whatever happened before; ` +
      "a perfect twenty goes on into the bonus rounds until the first miss. The ramp is " +
      "Endless's (`BAND_SCHEDULES.ranked`), with three iconic rounds. Reported, not tuned.",
    "",
    "### Right answers out of twenty",
    "",
    "| Measure | Correct |",
    "|---|---|",
    `| Mean | ${mean.toFixed(1)} |`,
    `| Median | ${quantile(r.correct, 0.5).toFixed(0)} |`,
    `| 10th percentile | ${quantile(r.correct, 0.1).toFixed(0)} |`,
    `| 25th percentile | ${quantile(r.correct, 0.25).toFixed(0)} |`,
    `| 75th percentile | ${quantile(r.correct, 0.75).toFixed(0)} |`,
    `| 90th percentile | ${quantile(r.correct, 0.9).toFixed(0)} |`,
    `| **20/20** | **${pct(perfect, r.runs)}** |`,
    "",
    "| Correct | Games |",
    "|---|---|",
  ];
  for (let n = DAILY_QUESTIONS; n >= 0; n--) {
    const games = r.correct.filter((c) => c === n).length;
    if (games === 0 && n < quantile(r.correct, 0.01)) continue;
    lines.push(`| ${n} | ${pct(games, r.runs)} |`);
  }
  lines.push("");
  lines.push("### The bonus rounds");
  lines.push("");
  lines.push(
    `Of the ${perfect.toLocaleString("en-GB")} perfect games: how many bonus rounds they ` +
      "answered right before the first miss (the score is twenty plus these).",
  );
  lines.push("");
  lines.push("| Measure | Bonus |", "|---|---|");
  lines.push(`| Median | ${quantile(r.bonus, 0.5).toFixed(0)} |`);
  lines.push(`| 90th percentile | ${quantile(r.bonus, 0.9).toFixed(0)} |`);
  lines.push(`| Best | ${r.bonus.at(-1) ?? 0} |`);
  lines.push("");
  lines.push("| Bonus | Perfect games |", "|---|---|");
  const buckets: Array<[string, (n: number) => boolean]> = [
    ["0", (n) => n === 0],
    ["1–2", (n) => n >= 1 && n <= 2],
    ["3–5", (n) => n >= 3 && n <= 5],
    ["6–10", (n) => n >= 6 && n <= 10],
    ["11–20", (n) => n >= 11 && n <= 20],
    ["21+", (n) => n >= 21],
  ];
  for (const [label, test] of buckets) {
    lines.push(`| ${label} | ${pct(r.bonus.filter(test).length, perfect)} |`);
  }
  lines.push("");
  lines.push("### By question");
  lines.push("");
  lines.push("Every game answers all twenty, so each question is the share of games right on it.");
  lines.push("");
  lines.push("| Question | Band | Correct |", "|---|---|---|");
  for (let q = 1; q <= DAILY_QUESTIONS; q++) {
    lines.push(`| ${q} | ${bandText(q, "ranked")} | ${pct(r.rightAt[q - 1] ?? 0, r.runs)} |`);
  }
  lines.push("");
  if (r.short > 0) {
    lines.push(`The engine couldn't deal twenty questions for ${pct(r.short, r.runs)} of games.`);
    lines.push("");
  }
  return lines;
}
