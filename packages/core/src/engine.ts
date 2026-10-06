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
import { RELAXATION_LADDERS, bandFor, pairFits, percentiles, relaxations } from "./ramp.js";
import { STATS } from "./stats.js";
import type { BandRules } from "./ramp.js";
import type { Band, Mode, Player, Relaxation, StatKey } from "./types.js";
import type { Rng } from "./prng.js";

/** How many recent players are excluded from selection. */
export const SEEN_DEPTH = 12;

export interface MatchContext {
  /** What rank distance is measured against (`percentiles`), and, without `pool`, who can be dealt. */
  readonly deck: readonly Player[];
  readonly now: Date;
  /** Player ids used recently, most recent first. */
  readonly seen: readonly string[];
  /**
   * "Clear the squad": who can be dealt, when not the whole of `deck`. Distance
   * is still measured against `deck`, so a gap means the same in any squad.
   */
  readonly pool?: readonly Player[];
  /**
   * "Clear the squad": `seen` is every player dealt so far, and it is never
   * ignored — no player appears twice in a run.
   */
  readonly unique?: boolean;
  /**
   * "Clear the squad": challengers to draw from first, at each step, when any
   * qualifies (the players who would otherwise be stranded, sequence.ts).
   */
  readonly prefer?: (player: Player) => boolean;
}

/**
 * What had to give to deal this pair. Always the furthest step taken.
 *
 * - `none`   — the round's band was met outright (by an iconic challenger, when
 *              the iconic preference applied).
 * - `iconic` — the iconic preference applied but no iconic player could be
 *              dealt, so the band was met from the whole deck instead.
 * - `band`   — the band was widened (ceiling first, then floor).
 * - `seen`   — the band was fine but the recently-seen queue had to be ignored,
 *              so a player reappears sooner than SEEN_DEPTH would allow.
 *
 * Kept distinct because simulation.md needs to tell them apart: a deck that
 * relaxes on `iconic` is short of recognisable names, one that relaxes on
 * `band` is too sparse in the tails, and one that relaxes on `seen` is simply
 * too small.
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
 * serving the pair would be unanswerable rather than merely hard. Distance is
 * measured against the whole deck in `ctx.deck`, never the seen-filtered pool,
 * so what a round asks doesn't shift with who was dealt recently.
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

  const table = percentiles(ctx.deck, stat, ctx.now);
  const out: Player[] = [];
  const keepSeen = !ignoreSeen || ctx.unique === true;
  for (const player of ctx.pool ?? ctx.deck) {
    if (player.id === anchor.id) continue;
    if (keepSeen && ctx.seen.includes(player.id)) continue;
    if (!isEligible(player, stat, ctx.now)) continue;

    const value = valueOf(player, stat, ctx.now);
    if (value === undefined) continue;
    if (!pairFits(table, anchorValue, value, band)) continue; // includes tie exclusion
    out.push(player);
  }
  return out;
}

/**
 * Pick a challenger, widening the band rather than ever failing to deal. The
 * requested band is the round's in `mode`'s schedule (`BAND_SCHEDULES`).
 *
 * Order: when `preferIconic` is set, iconic players only at the requested band;
 * then the whole deck at the requested band; then each relaxation in turn; then
 * the same ladder again with the recently-seen queue ignored. The iconic
 * preference is the first thing to give — it is never held at the cost of a
 * wider band or a repeated player. Returns undefined only when the deck
 * genuinely cannot produce a non-tied opponent.
 *
 * `variant` is an Endless variant's band rules (variants.ts), when it has its own.
 */
export function selectChallenger(
  anchor: Player,
  stat: StatKey,
  round: number,
  mode: Mode,
  ctx: MatchContext,
  rng: Rng,
  preferIconic = false,
  variant?: BandRules,
): Match | undefined {
  const target = bandFor(stat, round, mode, variant);
  const ladder = relaxations(target, RELAXATION_LADDERS[mode]);

  // The preferred challengers when any qualify; everyone otherwise.
  const pick = (pool: readonly Player[]): Player | undefined => {
    const { prefer } = ctx;
    if (prefer === undefined) return rng.pick(pool);
    const first = pool.filter(prefer);
    return rng.pick(first.length > 0 ? first : pool);
  };

  if (preferIconic) {
    const pool = candidates(anchor, stat, target, ctx).filter((p) => p.iconic === true);
    const chosen = pick(pool);
    if (chosen !== undefined) return { challenger: chosen, band: target, relaxation: "none" };
  }

  for (const [index, band] of ladder.entries()) {
    const pool = candidates(anchor, stat, band, ctx);
    const chosen = pick(pool);
    if (chosen !== undefined) {
      const relaxation = index > 0 ? "band" : preferIconic ? "iconic" : "none";
      return { challenger: chosen, band, relaxation };
    }
  }

  // Still nothing: drop the seen queue before giving up. Note this is reported
  // as "seen" even when the band itself was met, so the two causes stay
  // distinguishable in the simulation report. A run that deals each player
  // once has nobody to bring back.
  if (ctx.unique === true) return undefined;
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
