/**
 * "Clear the squad"'s simulation: every theme the deck has (themes.ts in
 * @bt/core), played by the same modelled player as the other modes, over the
 * same number of runs. What it measures is what the themes are tuned on
 * (DESIGN.md §8): how often a squad is cleared, how far a run gets, how hard
 * each stretch of the squad plays, and how close the last questions' pairs
 * are. The pairs themselves — names beside figures — go to the terminal only
 * (`squadPairsText`), never to the committed simulation.md.
 */

import {
  STATS,
  buildRun,
  createRng,
  gap,
  percentiles,
  rankDistance,
  resolveVariant,
  squadThemes,
  squadVariantId,
  statLabel,
  valueOf,
} from "@bt/core";
import type { Player, Round, SquadTheme } from "@bt/core";
import { FAN_MODEL, ratioText } from "./simulate.js";
import type { PlayerModel } from "./simulate.js";

/** Stretches of the squad the report reads accuracy over: the schedule's own rows. */
export const SQUAD_STRETCHES: ReadonlyArray<{ readonly label: string; readonly upTo: number }> = [
  { label: "first 20%", upTo: 0.2 },
  { label: "to 45%", upTo: 0.45 },
  { label: "to 70%", upTo: 0.7 },
  { label: "to 85%", upTo: 0.85 },
  { label: "last 15%", upTo: 1 },
];

/** The questions at a run's end whose pairs the report measures. */
export const SQUAD_LAST = 3;

/** How many of the closest final pairs are kept for the terminal. */
export const SQUAD_CLOSEST_KEPT = 5;

export interface SquadPair {
  readonly stat: string;
  readonly anchor: string;
  readonly challenger: string;
  readonly anchorValue: string;
  readonly challengerValue: string;
  readonly gap: number;
}

export interface SquadResult {
  readonly theme: SquadTheme;
  /** Squad size − 1. */
  readonly questions: number;
  readonly runs: number;
  /** Questions answered per run, ascending. */
  readonly progress: readonly number[];
  /** Runs that answered every question dealt. */
  readonly cleared: number;
  /** Runs the dealer ended early, because the players left couldn't be dealt (cleared there). */
  readonly shortDeals: number;
  /**
   * Follower pairs dealt under 2× apart: the volatility floor giving way, the
   * dealer's last resort once no other stat could be dealt (sequence.ts).
   */
  readonly closeFollowers: number;
  /** Per stretch (`SQUAD_STRETCHES`): questions reached and answered right. */
  readonly reached: readonly number[];
  readonly correct: readonly number[];
  /** Rounds played that widened the band (any relaxation but the iconic fallback). */
  readonly relaxed: number;
  readonly played: number;
  /** Ratio gaps of every pair dealt in a run's last `SQUAD_LAST` questions, ascending. */
  readonly lastGaps: readonly number[];
  /** Those pairs' rank distances (the fan model's scale), ascending. */
  readonly lastDistances: readonly number[];
  /** The closest distinct final pairs: names and figures, for the terminal. */
  readonly closest: readonly SquadPair[];
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

function stretchOf(index: number, questions: number): number {
  const at = index / questions;
  const i = SQUAD_STRETCHES.findIndex((s) => at <= s.upTo + 1e-9);
  return i === -1 ? SQUAD_STRETCHES.length - 1 : i;
}

export interface SquadSimOptions {
  readonly deck: readonly Player[];
  readonly now: Date;
  readonly runs?: number;
  readonly model?: PlayerModel;
  readonly seedPrefix?: string;
  /** Only these theme ids; every theme when absent. */
  readonly only?: readonly string[];
}

/** Every theme's runs, dealt in full (a squad run is short) and played by `model`. */
export function simulateSquads(opts: SquadSimOptions): SquadResult[] {
  const themes = squadThemes(opts.deck).filter(
    (theme) => opts.only === undefined || opts.only.includes(theme.id),
  );
  return themes.map((theme) => simulateSquad(theme, opts));
}

function simulateSquad(theme: SquadTheme, opts: SquadSimOptions): SquadResult {
  const runs = opts.runs ?? 20_000;
  const model = opts.model ?? FAN_MODEL;
  const variant = squadVariantId(theme);
  const questions = resolveVariant(variant, opts.deck)?.questions ?? theme.players - 1;
  const progress: number[] = [];
  const reached = SQUAD_STRETCHES.map(() => 0);
  const correct = SQUAD_STRETCHES.map(() => 0);
  const lastGaps: number[] = [];
  const lastDistances: number[] = [];
  const pairs = new Map<string, SquadPair>();
  let cleared = 0;
  let shortDeals = 0;
  let closeFollowers = 0;
  let relaxed = 0;
  let played = 0;

  for (let i = 0; i < runs; i++) {
    const seed = `${opts.seedPrefix ?? "squad"}:${theme.id}:${i}`;
    const rounds = buildRun({ deck: opts.deck, seed, mode: "endless", now: opts.now, variant });
    if (rounds.length < questions) shortDeals += 1;

    // The model's own skill stream, as in simulate.ts, so it can't perturb the deal.
    const rng = createRng(`${seed}:skill`);
    let streak = 0;
    for (const round of rounds) {
      if (round.stat === "ig") {
        const a = valueOf(round.anchor, "ig", opts.now);
        const b = valueOf(round.challenger, "ig", opts.now);
        if (a !== undefined && b !== undefined && gap(a, b) < 1) closeFollowers += 1;
      }
    }
    for (const round of rounds) {
      const stretch = stretchOf(round.index, questions);
      reached[stretch]! += 1;
      played += 1;
      if (round.relaxation === "band" || round.relaxation === "seen") relaxed += 1;
      if (!(rng.next() < model.pCorrect(distanceOf(round, opts.deck, opts.now)))) break;
      correct[stretch]! += 1;
      streak += 1;
    }
    progress.push(streak);
    if (rounds.length > 0 && streak === rounds.length) cleared += 1;

    for (const round of rounds.slice(-SQUAD_LAST)) {
      const a = valueOf(round.anchor, round.stat, opts.now);
      const b = valueOf(round.challenger, round.stat, opts.now);
      if (a === undefined || b === undefined) continue;
      const g = gap(a, b);
      lastGaps.push(g);
      lastDistances.push(distanceOf(round, opts.deck, opts.now));
      const key = `${round.stat}|${[round.anchor.id, round.challenger.id].sort().join("|")}`;
      if (!pairs.has(key)) {
        const format = STATS[round.stat].format;
        pairs.set(key, {
          stat: statLabel(round.stat, variant),
          anchor: round.anchor.name,
          challenger: round.challenger.name,
          anchorValue: format(a),
          challengerValue: format(b),
          gap: g,
        });
      }
    }
  }

  return {
    theme,
    questions,
    runs,
    progress: progress.sort((a, b) => a - b),
    cleared,
    shortDeals,
    closeFollowers,
    reached,
    correct,
    relaxed,
    played,
    lastGaps: lastGaps.sort((a, b) => a - b),
    lastDistances: lastDistances.sort((a, b) => a - b),
    closest: [...pairs.values()].sort((x, y) => x.gap - y.gap).slice(0, SQUAD_CLOSEST_KEPT),
  };
}

function pct(n: number, d: number): string {
  return `${((n / Math.max(d, 1)) * 100).toFixed(1)}%`;
}

/** simulation.md's "Clear the squad" section: one row per theme. No names, no figures. */
export function squadSection(results: readonly SquadResult[]): string[] {
  if (results.length === 0) return [];
  const runs = results[0]!.runs;
  const lines: string[] = [];
  lines.push("## Clear the squad");
  lines.push("");
  lines.push(
    `${runs.toLocaleString("en-GB")} runs per theme. A run deals each of the theme's players ` +
      "once and is cleared by answering every question. Bands ramp by progress through the " +
      "squad, blended by its size (`squadSchedule`, ramp.ts). Targets: cleared 4–8% for small " +
      "squads, 2–5% for big leagues.",
  );
  lines.push("");
  lines.push(
    "| Theme | Players | Cleared | Short deals | Followers under 2× | Median progress | 90th percentile | Relaxed |",
    "|---|---|---|---|---|---|---|---|",
  );
  for (const r of results) {
    lines.push(
      `| ${r.theme.name} | ${r.theme.players} | ${pct(r.cleared, r.runs)} | ` +
        `${pct(r.shortDeals, r.runs)} | ${r.closeFollowers} | ` +
        `${quantile(r.progress, 0.5).toFixed(0)}/${r.questions} | ` +
        `${quantile(r.progress, 0.9).toFixed(0)}/${r.questions} | ${pct(r.relaxed, r.played)} |`,
    );
  }
  lines.push("");
  lines.push(
    "Short deals are runs the dealer ended before the last player because the players left " +
      "couldn't be dealt under any stat; they count as cleared. Followers under 2× counts the " +
      "follower pairs dealt closer than the 2× floor, over every run dealt in full: the floor " +
      "gives way only when no other stat can be dealt.",
  );
  lines.push("");
  lines.push("### Accuracy by stretch of the squad");
  lines.push("");
  const cells = ["Theme", ...SQUAD_STRETCHES.map((s) => s.label)];
  lines.push(`| ${cells.join(" | ")} |`, `|${cells.map(() => "---").join("|")}|`);
  for (const r of results) {
    lines.push(
      `| ${r.theme.name} | ${SQUAD_STRETCHES.map((_, i) => pct(r.correct[i]!, r.reached[i]!)).join(" | ")} |`,
    );
  }
  lines.push("");
  lines.push(`### The last ${SQUAD_LAST} questions`);
  lines.push("");
  lines.push(
    "Every pair dealt in a run's last three questions, whether or not the player got there: " +
      "rank distance (the fan model's scale) and the larger figure as a multiple of the " +
      "smaller. Names and figures of the closest are printed by `pnpm simulate`, not kept here.",
  );
  lines.push("");
  lines.push(
    "| Theme | Median distance | Closest ratio | Median ratio | Under 1.25× |",
    "|---|---|---|---|---|",
  );
  for (const r of results) {
    lines.push(
      `| ${r.theme.name} | ${quantile(r.lastDistances, 0.5).toFixed(3)} | ` +
        `${ratioText(r.lastGaps[0] ?? NaN)} | ${ratioText(quantile(r.lastGaps, 0.5))} | ` +
        `${pct(r.lastGaps.filter((g) => g < 0.25).length, r.lastGaps.length)} |`,
    );
  }
  lines.push("");
  return lines;
}

/** For the terminal only: each theme's closest final pairs, names and figures. */
export function squadPairsText(results: readonly SquadResult[]): string[] {
  const lines: string[] = [];
  for (const r of results) {
    lines.push(
      `  ${r.theme.name} (${r.theme.players}): cleared ${pct(r.cleared, r.runs)}, ` +
        `median ${quantile(r.progress, 0.5).toFixed(0)}/${r.questions}; closest final pairs:`,
    );
    for (const p of r.closest) {
      lines.push(
        `    ${ratioText(p.gap)}  ${p.stat}: ${p.anchor} ${p.anchorValue} v ${p.challenger} ${p.challengerValue}`,
      );
    }
  }
  return lines;
}
