/**
 * Twitch Mode in simulation.md: how a match plays on each pool (DESIGN.md §3,
 * §8). Each simulated match is dealt by the real match dealer
 * (`buildStreamRun`, @bt/core) under a seed of its own, and the modelled
 * player answers every question whatever happened before, as a match is
 * scored. Two independent players of the same model play each match, standing
 * for chat's majority and the streamer: both "a fan", with no clock. Their
 * scores give the mean, the spread, and how often a match is drawn.
 *
 * The stream schedule (`streamBands`, ramp.ts) was tuned against this to a
 * mean of about 12–15 out of 20 and 6–8 out of 10 on every pool.
 */

import {
  STREAM_LENGTHS,
  buildStreamRun,
  createRng,
  percentiles,
  rankDistance,
  squadThemes,
  squadVariantId,
  streamQuestions,
  valueOf,
} from "@bt/core";
import type { Player, Round, StreamPool } from "@bt/core";
import { FAN_MODEL } from "./simulate.js";
import type { PlayerModel } from "./simulate.js";

export interface StreamSimOptions {
  readonly deck: readonly Player[];
  readonly now: Date;
  /** Matches per pool and length. */
  readonly runs?: number;
  readonly model?: PlayerModel;
}

export interface StreamSimRow {
  readonly pool: StreamPool;
  readonly name: string;
  readonly questions: number;
  readonly matches: number;
  /** Right answers per player per match (two a match), ascending. */
  readonly scores: readonly number[];
  /** Matches the two players drew. */
  readonly draws: number;
  /** Right answers on the last three questions, over every match. */
  readonly lastRight: number;
  readonly lastAsked: number;
}

/**
 * How far apart the pair sits, on the scale the engine dealt it by: the whole
 * deck for All legends and the squads, the players with a figure for Instagram.
 */
function distanceOf(round: Round, scale: readonly Player[], now: Date): number {
  const a = valueOf(round.anchor, round.stat, now);
  const b = valueOf(round.challenger, round.stat, now);
  if (a === undefined || b === undefined) return 0;
  return rankDistance(percentiles(scale, round.stat, now), a, b);
}

export function simulateStream(opts: StreamSimOptions): StreamSimRow[] {
  const runs = opts.runs ?? 5000;
  const model = opts.model ?? FAN_MODEL;
  const pools: { pool: StreamPool; name: string }[] = [
    { pool: "endless", name: "All legends" },
    { pool: "endless-instagram", name: "Instagram" },
    ...squadThemes(opts.deck).map((theme) => ({ pool: squadVariantId(theme), name: theme.name })),
  ];
  const rows: StreamSimRow[] = [];
  const withFigure = opts.deck.filter((p) => p.stats.ig !== undefined);
  for (const { pool, name } of pools) {
    const scale = pool === "endless-instagram" ? withFigure : opts.deck;
    const seen = new Set<number>();
    for (const length of STREAM_LENGTHS) {
      const questions = streamQuestions(pool, length, opts.deck);
      if (questions === undefined || seen.has(questions)) continue;
      seen.add(questions);
      const scores: number[] = [];
      let draws = 0;
      let lastRight = 0;
      let lastAsked = 0;
      for (let i = 0; i < runs; i++) {
        const seed = `stream-sim:${pool}:${questions}:${i}`;
        const players = [createRng(`${seed}:chat`), createRng(`${seed}:streamer`)];
        const rounds = buildStreamRun({ deck: opts.deck, seed, now: opts.now, pool, questions });
        const right = [0, 0];
        for (const round of rounds) {
          const p = model.pCorrect(distanceOf(round, scale, opts.now));
          players.forEach((rng, side) => {
            const ok = rng.next() < p;
            if (ok) right[side] = (right[side] ?? 0) + 1;
            if (round.index > questions - 3) {
              lastAsked += 1;
              if (ok) lastRight += 1;
            }
          });
        }
        scores.push(...right);
        if (right[0] === right[1]) draws += 1;
      }
      rows.push({
        pool,
        name,
        questions,
        matches: runs,
        scores: scores.sort((a, b) => a - b),
        draws,
        lastRight,
        lastAsked,
      });
    }
  }
  return rows;
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))] ?? 0;
}

/** The Twitch Mode section of simulation.md. */
export function streamSection(rows: readonly StreamSimRow[]): string[] {
  if (rows.length === 0) return [];
  const runs = rows[0]?.matches ?? 0;
  return [
    "",
    "## Twitch Mode: matches by pool",
    "",
    `${runs.toLocaleString("en-GB")} matches per pool and length, each its own seed, dealt by the ` +
      "match dealer (`buildStreamRun`) by the stream schedule (`streamBands`) and played by two " +
      "independent `fan`-model players, every question answered whatever happened before. A " +
      "squad's match is capped at its size less one. Tuned to a mean of about 12–15 out of 20 and " +
      "6–8 out of 10. A draw is the two players level at full time.",
    "",
    "| Pool | Questions | Mean | Median | 10th–90th | Last three right | Draws |",
    "| ---- | --------- | ---- | ------ | --------- | ---------------- | ----- |",
    ...rows.map((r) => {
      const mean = r.scores.reduce((s, n) => s + n, 0) / Math.max(r.scores.length, 1);
      const last = r.lastAsked === 0 ? "–" : `${((100 * r.lastRight) / r.lastAsked).toFixed(1)}%`;
      return (
        `| ${r.name} | ${r.questions} | ${mean.toFixed(1)} | ${quantile(r.scores, 0.5)} | ` +
        `${quantile(r.scores, 0.1)}–${quantile(r.scores, 0.9)} | ${last} | ` +
        `${((100 * r.draws) / Math.max(r.matches, 1)).toFixed(1)}% |`
      );
    }),
    "",
  ];
}
