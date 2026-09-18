/**
 * Which stat comes next.
 *
 * Three rules beyond the weighting, all from DESIGN.md §7 and §10:
 *   - a stat holds for 2–5 rounds, randomised, so players settle into a rhythm
 *     before it changes (a fixed cadence lets them pre-load their answer);
 *   - the wheel never switches directly between a correlated pair;
 *   - band-exempt stats are barred from the opening rounds.
 */

import { STATS, TIER_WEIGHT, areCorrelated } from "./stats.js";
import { statAllowedAtRound } from "./ramp.js";
import type { StatKey } from "./types.js";
import type { Rng } from "./prng.js";

export const DWELL_MIN = 2;
export const DWELL_MAX = 5;

/** How many rounds the next stat should hold for. */
export function nextDwell(rng: Rng): number {
  return DWELL_MIN + rng.int(DWELL_MAX - DWELL_MIN + 1);
}

/**
 * Weighted pick, with each tier's share divided across the members present.
 *
 * Applying the tier weight per stat instead would give a four-member tier four
 * times its intended share — the prototype bug that made uncommon stats
 * effectively invisible.
 */
export function weightedPick(keys: readonly StatKey[], rng: Rng): StatKey | undefined {
  if (keys.length === 0) return undefined;

  const byTier = new Map<string, StatKey[]>();
  for (const key of keys) {
    const tier = STATS[key].tier;
    const bucket = byTier.get(tier);
    if (bucket) bucket.push(key);
    else byTier.set(tier, [key]);
  }

  let total = 0;
  const weights: Array<{ key: StatKey; weight: number }> = [];
  for (const [tier, members] of byTier) {
    const share = TIER_WEIGHT[tier as keyof typeof TIER_WEIGHT] / members.length;
    for (const key of members) {
      weights.push({ key, weight: share });
      total += share;
    }
  }

  let roll = rng.next() * total;
  for (const entry of weights) {
    roll -= entry.weight;
    if (roll <= 0) return entry.key;
  }
  return weights[weights.length - 1]?.key;
}

export interface WheelOptions {
  /** The stat being replaced. Undefined on the opening round. */
  readonly current: StatKey | undefined;
  /** 1-based round the new stat will be dealt at. */
  readonly round: number;
  /** Stats that can actually produce a pair right now. */
  readonly viable: readonly StatKey[];
  readonly rng: Rng;
}

/**
 * Pick the next stat, or undefined if nothing qualifies.
 *
 * The caller decides what to do with undefined — sequence.ts keeps the current
 * stat rather than stalling the run.
 */
export function chooseStat(opts: WheelOptions): StatKey | undefined {
  const { current, round, viable, rng } = opts;

  const allowed = viable.filter(
    (key) =>
      key !== current &&
      statAllowedAtRound(key, round) &&
      (current === undefined || !areCorrelated(current, key)),
  );

  if (allowed.length > 0) return weightedPick(allowed, rng);

  // Nothing but a correlated stat is available — better a correlated switch
  // than no switch at all, but still never a band-exempt stat too early.
  const fallback = viable.filter(
    (key) => key !== current && statAllowedAtRound(key, round),
  );
  return weightedPick(fallback, rng);
}
