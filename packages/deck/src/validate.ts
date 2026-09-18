/**
 * Deck-level validation — the rules a single player can't be judged against in
 * isolation, plus the cross-field rules that need the engine's own definitions.
 *
 * Every problem is collected rather than thrown on first sight. Hand-entering
 * 300 players means fixing them in batches, and a validator that stops at the
 * first error turns that into 300 round trips.
 */

import { eligibleStats } from "@bt/core";
import type { Player } from "@bt/core";
import type { RawPlayer } from "./schema.js";

export interface Problem {
  readonly playerId: string;
  readonly field: string;
  readonly message: string;
}

/**
 * Minimum *entered* stats before a player is too thin to be worth dealing.
 *
 * `age` is excluded from the count deliberately. It is derived from `dob`, so
 * every living player has it for free — counting it would let a player through
 * on two real figures plus a freebie, which is not a card worth dealing.
 */
export const MIN_ELIGIBLE_STATS = 3;

/**
 * Rules that need more than the schema.
 *
 * Note `now` is passed in rather than read from the clock: age eligibility
 * depends on it, and a build must be reproducible from a checkout.
 */
export function validateDeck(
  raws: readonly RawPlayer[],
  players: readonly Player[],
  now: Date,
): Problem[] {
  const problems: Problem[] = [];
  const seenIds = new Set<string>();

  for (const [index, raw] of raws.entries()) {
    const player = players[index];
    if (player === undefined) continue;

    // Duplicate ids — the deck is keyed by id everywhere downstream.
    if (seenIds.has(raw.id)) {
      problems.push({ playerId: raw.id, field: "id", message: "duplicate id" });
    }
    seenIds.add(raw.id);

    // Goalkeepers are excluded from both goals stats (DESIGN.md §5). A figure
    // here means either the position or the stat is wrong, and we can't tell
    // which — so fail rather than silently dropping it.
    if (raw.position === "GK") {
      if (raw.stats.club_goals !== undefined) {
        problems.push({
          playerId: raw.id,
          field: "stats.club_goals",
          message: "goalkeepers are not eligible for club goals",
        });
      }
      if (raw.stats.igoals !== undefined) {
        problems.push({
          playerId: raw.id,
          field: "stats.igoals",
          message: "goalkeepers are not eligible for international goals",
        });
      }
    }

    // A birth date in the future, or one implying an implausible age, is almost
    // always a typo in the year.
    const born = new Date(`${raw.dob}T00:00:00Z`).getTime();
    if (born > now.getTime()) {
      problems.push({ playerId: raw.id, field: "dob", message: "date of birth is in the future" });
    }
    const years = (now.getTime() - born) / (365.25 * 24 * 3600 * 1000);
    if (years > 120) {
      problems.push({
        playerId: raw.id,
        field: "dob",
        message: `implies an age of ${Math.floor(years)} — check the year`,
      });
    }

    // A follower snapshot dated in the future is a typo; one that is very old
    // is a refresh that never happened.
    if (raw.stats.ig !== undefined) {
      const asOf = new Date(`${raw.stats.ig.as_of}T00:00:00Z`).getTime();
      if (asOf > now.getTime()) {
        problems.push({
          playerId: raw.id,
          field: "stats.ig.as_of",
          message: "snapshot date is in the future",
        });
      }
    }

    // A transfer fee predating the player's 15th birthday is a mis-keyed year.
    if (raw.stats.fee !== undefined) {
      const bornYear = new Date(`${raw.dob}T00:00:00Z`).getUTCFullYear();
      if (raw.stats.fee.year < bornYear + 15) {
        problems.push({
          playerId: raw.id,
          field: "stats.fee.year",
          message: `fee year ${raw.stats.fee.year} is before the player turned 15`,
        });
      }
    }

    // Too few stats to be a useful card. Age does not count — see above.
    const entered = eligibleStats(player, now).filter((k) => k !== "age");
    if (entered.length < MIN_ELIGIBLE_STATS) {
      problems.push({
        playerId: raw.id,
        field: "stats",
        message: `only ${entered.length} entered stats (age excluded), need ${MIN_ELIGIBLE_STATS}`,
      });
    }
  }

  return problems;
}

export function formatProblems(problems: readonly Problem[]): string {
  const byPlayer = new Map<string, Problem[]>();
  for (const p of problems) {
    const bucket = byPlayer.get(p.playerId);
    if (bucket) bucket.push(p);
    else byPlayer.set(p.playerId, [p]);
  }

  const lines: string[] = [];
  for (const [id, list] of byPlayer) {
    lines.push(`  ${id}`);
    for (const p of list) lines.push(`    ${p.field}: ${p.message}`);
  }
  return lines.join("\n");
}
