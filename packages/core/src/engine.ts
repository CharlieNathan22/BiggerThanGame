/**
 * The matching engine: given an anchor and a stat, find a challenger.
 *
 * Pure. No hidden state — the recently-seen queue is passed in and a new one
 * comes back. That is what lets sequence.ts replay a run deterministically and
 * the Worker re-derive any round to verify a guess.
 *
 * See DESIGN.md §10.
 */

import { isEligible } from "./eligibility.js";
import { bandFor, gap, relaxations, withinBand } from "./ramp.js";
import { STATS } from "./stats.js";
import type { Band, Player, Relaxation, StatKey } from "./types.js";
import type { Rng } from "./prng.js";

/** How many recent players are excluded from selection. */
export const SEEN_DEPTH = 12;

export interface MatchContext {
  readonly deck: readonly Player[];
  readonly now: Date;
  /** Player ids used recently, most recent first. */
  readonly seen: readonly string[];
}

/**
 * What had to give to deal this pair.
 *
 * - `none`  — the round's band was met outright.
 * - `band`  — the band was widened (ceiling first, then floor).
 * - `seen`  — the band was fine but the recently-seen queue had to be ignored,
 *             so a player reappears sooner than SEEN_DEPTH would allow.
 *
 * Kept distinct because simulation.md needs to tell them apart: a deck that
 * relaxes on `band` is too sparse in the tails, whereas one that relaxes on
 * `seen` is simply too small.
 */
export interface Match {
  readonly challenger: Player;
  readonly band: Band;
  readonly relaxation: Relaxation;
}

export function valueOf(player: Player, stat: StatKey, now: Date): number | undefined {
  return STATS[stat].get(player, now);
}

/**
 * Everyone who could legally face `anchor` on `stat` within `band`.
 *
 * Ties are excluded and never relaxed: equal values have no right answer, so
 * serving the pair would be unanswerable rather than merely hard.
 */
export function candidates(
  anchor: Player,
  stat: StatKey,
  band: Band,
  ctx: MatchContext,
  ignoreSeen = false,
): Player[] {
  const anchorValue = valueOf(anchor, stat, ctx.now);
  if (anchorValue === undefined) return [];

  const out: Player[] = [];
  for (const player of ctx.deck) {
    if (player.id === anchor.id) continue;
    if (!ignoreSeen && ctx.seen.includes(player.id)) continue;
    if (!isEligible(player, stat, ctx.now)) continue;

    const value = valueOf(player, stat, ctx.now);
    if (value === undefined) continue;
    if (value === anchorValue) continue; // tie — never relaxed

    if (!withinBand(gap(anchorValue, value), band)) continue;
    out.push(player);
  }
  return out;
}

/**
 * Pick a challenger, widening the band rather than ever failing to deal.
 *
 * Order: the requested band, then each relaxation in turn, then the same
 * ladder again with the recently-seen queue ignored. Returns undefined only
 * when the deck genuinely cannot produce a non-tied opponent.
 */
export function selectChallenger(
  anchor: Player,
  stat: StatKey,
  round: number,
  ctx: MatchContext,
  rng: Rng,
): Match | undefined {
  const target = bandFor(stat, round);
  const ladder = relaxations(target);

  for (const [index, band] of ladder.entries()) {
    const pool = candidates(anchor, stat, band, ctx);
    const chosen = rng.pick(pool);
    if (chosen !== undefined) {
      return { challenger: chosen, band, relaxation: index > 0 ? "band" : "none" };
    }
  }

  // Still nothing: drop the seen queue before giving up. Note this is reported
  // as "seen" even when the band itself was met, so the two causes stay
  // distinguishable in the simulation report.
  for (const band of ladder) {
    const pool = candidates(anchor, stat, band, ctx, true);
    const chosen = rng.pick(pool);
    if (chosen !== undefined) {
      return { challenger: chosen, band, relaxation: "seen" };
    }
  }

  return undefined;
}

/** Push an id onto the recently-seen queue, keeping it at SEEN_DEPTH. */
export function remember(seen: readonly string[], id: string): string[] {
  return [id, ...seen.filter((x) => x !== id)].slice(0, SEEN_DEPTH);
}
