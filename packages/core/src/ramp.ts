/**
 * Difficulty bands and the relaxation ladder.
 *
 * Gap is **rank distance**: how far apart the two values sit in the deck's own
 * spread for that stat, as a fraction of it. Each value's percentile is its
 * mid-rank among eligible players (tied values share one), so 0 is the lowest
 * figure in the deck, 1 the highest, and a gap of 0.45 means the two players
 * are nearly half the deck apart. It replaced a raw ratio (`max / min - 1`),
 * which made a stat with a narrow range — every legend has 478 to 985 club
 * appearances — impossible to deal as an easy question. See DESIGN.md §8.
 *
 * A **floor alone does not create a ramp** — it only removes pairs that are too
 * close, so a late round with a low floor still admits every blowout that
 * qualified at round one. The ceiling is what makes a late round hard.
 */

import type { Band, Mode, Player, StatKey, ValueRule } from "./types.js";
import { STATS } from "./stats.js";
import { isEligible } from "./eligibility.js";

export interface BandRow {
  readonly upTo: number;
  readonly band: Band;
}

/**
 * The long schedule, Ranked's (Endless has had its own since its retune), in
 * rank distance. `upTo` is inclusive; the final row catches everything after.
 *
 * Tuned against simulation.md on the 77-player legends deck. Re-check it
 * there after substantial deck growth — the floors are fractions of the deck,
 * so they scale with it, but the knife-edge band's absolute width shrinks as
 * the deck grows.
 */
const LONG_SCHEDULE: readonly BandRow[] = [
  { upTo: 10, band: { floor: 0.45, ceiling: null } },
  { upTo: 18, band: { floor: 0.25, ceiling: 0.7 } },
  { upTo: 26, band: { floor: 0.15, ceiling: 0.5 } },
  { upTo: 34, band: { floor: 0.1, ceiling: 0.35 } },
  { upTo: 42, band: { floor: 0.05, ceiling: 0.25 } },
  { upTo: Infinity, band: { floor: 0.02, ceiling: 0.12 } },
];

/**
 * Friendly's schedule: twenty questions (`WIN_ROUNDS`). Uncapped for the five
 * rounds that prefer iconic challengers (`ICONIC_ROUNDS`) and the five after,
 * then capped and **never easier**: from round 5 each band is at least as hard
 * as the one before (floor and ceiling never rise). Rounds 18–20 also carry the
 * final stretch's ratio floor (`FINAL_STRETCH`). Round 20, the **final
 * question**, is the hardest band in the run. DESIGN.md §8.
 *
 * The last rows are narrow because the ratio floor already rules out the
 * closest pairs: for dense stats (appearances, age, caps) no pair 10% apart
 * fits a narrow band, and relaxation lifts the ceiling, so a wide band there
 * only lets in easier pairs for the stats that can go close.
 *
 * Tuned against simulation.md on the 131-player legends deck with the `fan`
 * player model, for a win rate of 3–5%; re-tune when observed accuracy from
 * real play replaces the model's calibration points.
 */
const FRIENDLY_SCHEDULE: readonly BandRow[] = [
  { upTo: 5, band: { floor: 0.45, ceiling: null } },
  { upTo: 10, band: { floor: 0.35, ceiling: null } },
  { upTo: 13, band: { floor: 0.06, ceiling: 0.16 } },
  { upTo: 17, band: { floor: 0.02, ceiling: 0.08 } },
  { upTo: 19, band: { floor: 0.02, ceiling: 0.04 } },
  { upTo: Infinity, band: { floor: 0.01, ceiling: 0.03 } },
];

/**
 * Endless's schedule: a bit harder than Friendly, with no finish line. Rounds
 * 1–5 are Friendly's opening exactly (the rounds that prefer iconic
 * challengers). From there it is **never easier** — floor and ceiling never
 * rise — reaching the hard zone by round 16, two rounds before Friendly's
 * final stretch, and still tightening gently after round 20 towards a knife
 * edge rather than levelling off. From round 16 the pair rules also apply
 * (`PAIR_RULES`): narrow stats use a value rule instead of these bands, wide
 * ones a 10% ratio floor on top. DESIGN.md §8.
 *
 * Tuned against simulation.md on the 131-player legends deck with the `fan`
 * model: about 3–4% of runs reach 20, the median streak is 9–12, and rounds
 * 16–20 are answered right about 65–72% of the time. The fan model has no
 * clock, so real Endless plays harder still.
 */
const ENDLESS_SCHEDULE: readonly BandRow[] = [
  { upTo: 5, band: { floor: 0.45, ceiling: null } },
  { upTo: 10, band: { floor: 0.12, ceiling: 0.25 } },
  { upTo: 15, band: { floor: 0.03, ceiling: 0.1 } },
  { upTo: 20, band: { floor: 0.02, ceiling: 0.04 } },
  { upTo: 30, band: { floor: 0.01, ceiling: 0.04 } },
  { upTo: Infinity, band: { floor: 0.01, ceiling: 0.03 } },
];

/**
 * The band schedule per mode. Changing one changes every run of that mode —
 * and every golden fingerprint for it.
 */
export const BAND_SCHEDULES: Readonly<Record<Mode, readonly BandRow[]>> = {
  friendly: FRIENDLY_SCHEDULE,
  endless: ENDLESS_SCHEDULE,
  ranked: LONG_SCHEDULE,
};

/**
 * Volatile stats (followers) also need the two values at least this far apart
 * as a ratio, whatever the band. Rank distance says how far apart two players
 * sit in the deck; it says nothing about whether a refresh could swap them.
 * Two players on 41m and 43m can be a fifth of the deck apart and still flip.
 */
export const VOLATILE_FLOOR = 1.0;

/**
 * Friendly's final stretch: from round `from`, the two values must also be at
 * least `minRatio` apart as a ratio (0.1: the larger at least 1.10 times the
 * smaller). Rank distance alone can pair two figures a few percent apart, and
 * the last questions of a won run should be hard, not a coin flip. Unlike the
 * volatility floor this is **never relaxed** (`strictMinRatio`); it applies on
 * top of the volatility floor and tie exclusion. Null for a mode without one.
 */
export interface FinalStretch {
  readonly from: number;
  readonly minRatio: number;
}

export const FINAL_STRETCH: Readonly<Record<Mode, FinalStretch | null>> = {
  friendly: { from: 18, minRatio: 0.1 },
  endless: null,
  ranked: null,
};

/**
 * Endless's late-round pair rules (DESIGN.md §8). From round `from`:
 *
 * - a **narrow** stat — one whose figures cluster on a few values, so a rank
 *   band means little — is paired by a rule on the values instead of the band
 *   (`narrow`): age within 10% and different, trophies and clubs 1–2 apart.
 *   The rule is the whole test, so an age or trophies question stays genuinely
 *   hard rather than relaxing to an easy pair, and a stat with any such pair
 *   can always be dealt;
 * - every other (**wide**) stat keeps its band and must also be at least
 *   `wideMinRatio` apart as a ratio, like Friendly's final stretch.
 *
 * Neither is ever relaxed: only the band's ceiling and floor (wide stats) and
 * the recently-seen queue give. Null for a mode without them.
 */
export interface PairRules {
  readonly from: number;
  readonly wideMinRatio: number;
  readonly narrow: Readonly<Partial<Record<StatKey, ValueRule>>>;
}

export const PAIR_RULES: Readonly<Record<Mode, PairRules | null>> = {
  friendly: null,
  endless: {
    from: 16,
    wideMinRatio: 0.1,
    narrow: {
      age: { kind: "relative", max: 0.1 },
      it: { kind: "difference", min: 1, max: 2 },
      clubs: { kind: "difference", min: 1, max: 2 },
      // Club trophies stay banded: their figures spread widely enough that the
      // band still holds pairs 10% apart in every late round (viability.md).
    },
  },
  ranked: null,
};

/** How the ceiling relaxes when a band holds no pair (`relaxations`). */
export type RelaxationLadder = "coarse" | "fine";

/**
 * Per mode. Friendly and Ranked keep the original coarse ladder (their runs
 * are unchanged); Endless lifts its ceiling gently, so a dense stat whose
 * nearest neighbours its 10% floor rules out is dealt the next-closest pair
 * rather than any pair at all.
 */
export const RELAXATION_LADDERS: Readonly<Record<Mode, RelaxationLadder>> = {
  friendly: "coarse",
  endless: "fine",
  ranked: "coarse",
};

/** Each step of the fine ladder lifts the ceiling to this many times the last. */
export const FINE_CEILING_STEP = 1.5;

/** 1-based round number and mode in, band out. */
export function bandForRound(round: number, mode: Mode): Band {
  const schedule = BAND_SCHEDULES[mode];
  const row = schedule.find((r) => round <= r.upTo);
  return row ? row.band : schedule[schedule.length - 1]!.band;
}

/**
 * The band actually applied to a given stat at a given round: the round's band,
 * plus the volatility floor for a volatile stat, the final stretch's ratio
 * floor in its rounds, and in Endless's late rounds its pair rules — a value
 * rule for a narrow stat, in place of the band, or a ratio floor for a wide
 * one. Everything that asks "is this pair dealable" — the engine and
 * viability.md alike — goes through this, so they can't disagree.
 */
export function bandFor(stat: StatKey, round: number, mode: Mode): Band {
  const rules = PAIR_RULES[mode];
  if (rules !== null && round >= rules.from) {
    const rule = rules.narrow[stat];
    if (rule !== undefined) return { floor: 0, ceiling: null, valueRule: rule };
  }
  let band = bandForRound(round, mode);
  if (STATS[stat].volatile === true) band = { ...band, minRatio: VOLATILE_FLOOR };
  const stretch = FINAL_STRETCH[mode];
  if (stretch !== null && round >= stretch.from) {
    band = { ...band, strictMinRatio: stretch.minRatio };
  }
  if (rules !== null && round >= rules.from) {
    band = { ...band, strictMinRatio: rules.wideMinRatio };
  }
  return band;
}

/** Whether two different values satisfy a value rule (ties never do). */
export function meetsValueRule(a: number, b: number, rule: ValueRule): boolean {
  if (a === b) return false;
  switch (rule.kind) {
    case "relative":
      // A hair of tolerance: 55 / 50 - 1 is 0.10000000000000009 in floats.
      return gap(a, b) <= rule.max + 1e-9;
    case "difference": {
      const diff = Math.abs(a - b);
      return diff >= rule.min && diff <= rule.max;
    }
  }
}

/**
 * Relative distance between two values, `max / min - 1`. No longer what the
 * bands measure — see `rankDistance` — but still the right measure for the
 * volatility floor, and for "how different are these figures" in reports.
 *
 * Zero against a positive value is an infinite gap. Two zeroes are a tie.
 */
export function gap(a: number, b: number): number {
  if (a === b) return 0;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  if (lo <= 0) return hi > 0 ? Infinity : 0;
  return hi / lo - 1;
}

/** Each distinct value of one stat → its percentile in the deck, 0 to 1. */
export type Percentiles = ReadonlyMap<number, number>;

/**
 * Memoised per deck array and stat. The deck is fixed for the life of a Worker
 * isolate and of a run, so this is computed once, not per round. Keyed on the
 * array itself: a different deck is a different table.
 */
const tables = new WeakMap<readonly Player[], Map<string, Percentiles>>();

/**
 * Percentile of every distinct value of `stat` among the deck's eligible
 * players: the mean of the positions the value occupies in the sorted list,
 * divided by the last position. Ties share a percentile, so a tie is always a
 * distance of 0.
 *
 * Pure arithmetic on the deck and `now` (which fixes everyone's age), so the
 * browser, the Worker and Node compute identical tables — the sequence stays a
 * function of seed and mode.
 */
export function percentiles(deck: readonly Player[], stat: StatKey, now: Date): Percentiles {
  let byDeck = tables.get(deck);
  if (byDeck === undefined) {
    byDeck = new Map();
    tables.set(deck, byDeck);
  }
  const key = `${stat}@${now.getTime()}`;
  const hit = byDeck.get(key);
  if (hit !== undefined) return hit;

  const values: number[] = [];
  for (const p of deck) {
    if (!isEligible(p, stat, now)) continue;
    const v = STATS[stat].get(p, now);
    if (v !== undefined) values.push(v);
  }
  values.sort((a, b) => a - b);

  const table = new Map<number, number>();
  const last = values.length - 1;
  let i = 0;
  while (i <= last) {
    let j = i;
    while (j < last && values[j + 1] === values[i]) j += 1;
    table.set(values[i]!, last > 0 ? (i + j) / 2 / last : 0.5);
    i = j + 1;
  }
  byDeck.set(key, table);
  return table;
}

/**
 * How far apart two values sit in the deck, 0 to 1. NaN for a value the table
 * doesn't hold (a player not eligible for the stat), which no band admits.
 */
export function rankDistance(table: Percentiles, a: number, b: number): number {
  const pa = table.get(a);
  const pb = table.get(b);
  if (pa === undefined || pb === undefined) return NaN;
  return Math.abs(pa - pb);
}

export function withinBand(distance: number, band: Band): boolean {
  if (!(distance >= band.floor)) return false; // also rejects NaN
  if (band.ceiling !== null && distance > band.ceiling) return false;
  return true;
}

/**
 * The single test for "may these two values be paired in this band": not
 * tied, rank distance within the band, and far enough apart as a ratio when
 * the band carries a `minRatio` or a `strictMinRatio`.
 */
export function pairFits(table: Percentiles, a: number, b: number, band: Band): boolean {
  if (a === b) return false; // tie — never relaxed
  // A value rule replaces the rank band, and both values must be in the deck.
  if (band.valueRule !== undefined) {
    return Number.isFinite(rankDistance(table, a, b)) && meetsValueRule(a, b, band.valueRule);
  }
  if (!withinBand(rankDistance(table, a, b), band)) return false;
  if (band.minRatio !== undefined && gap(a, b) < band.minRatio) return false;
  if (band.strictMinRatio !== undefined && gap(a, b) < band.strictMinRatio) return false;
  return true;
}

/**
 * Progressively looser bands, tried in order when the candidate pool is empty.
 *
 * Ceiling first — a too-easy question beats a repeated player. Then the floor,
 * in steps. The volatility floor holds through every step but the last, which
 * drops it so a pair can always be dealt. Shortening the recently-seen queue is
 * the engine's next move after this list is exhausted. Tie exclusion, the
 * `strictMinRatio` of Friendly's final stretch and Endless's wide stats, and a
 * narrow stat's value rule are never relaxed: a value-rule band has nothing
 * else to give, so its list is the band alone.
 *
 * How far the ceiling lifts at each step is the mode's `RELAXATION_LADDERS`:
 * `coarse` doubles it once and then drops it; `fine` lifts it by half again at
 * each step until it reaches the top of the scale, so the pair dealt is the
 * closest one the deck has rather than a random blowout — what keeps a dense
 * stat hard once a ratio floor rules out its nearest neighbours.
 */
export function relaxations(band: Band, ladder: RelaxationLadder = "coarse"): Band[] {
  if (band.valueRule !== undefined) return [band];
  const strict = band.strictMinRatio !== undefined ? { strictMinRatio: band.strictMinRatio } : {};
  const keep = band.minRatio !== undefined ? { minRatio: band.minRatio, ...strict } : strict;
  const out: Band[] = [band];
  if (band.ceiling !== null) {
    if (ladder === "coarse") {
      out.push({ floor: band.floor, ceiling: Math.min(band.ceiling * 2, 1), ...keep });
    } else {
      let ceiling = band.ceiling;
      while (ceiling < 1) {
        ceiling = Math.min(ceiling * FINE_CEILING_STEP, 1);
        out.push({ floor: band.floor, ceiling, ...keep });
      }
    }
    out.push({ floor: band.floor, ceiling: null, ...keep });
  }
  let floor = band.floor;
  for (let i = 0; i < 4 && floor > 0.01; i++) {
    floor = floor * 0.6;
    out.push({ floor, ceiling: null, ...keep });
  }
  out.push({ floor: 0, ceiling: null, ...strict });
  return out;
}
