/**
 * Deterministic run construction.
 *
 * Same seed, same deck, same reference date → identical rounds, in every
 * runtime. This is the property Daily Ranked rests on, and the one the Worker
 * relies on to re-derive a round and verify a guess without storing it.
 *
 * Replay is from round one every time. That is O(n) per lookup, but n is a few
 * dozen and the work is microseconds, so the server recomputes rather than
 * keeping per-round state.
 */

import { createRng } from "./prng.js";
import { isEligible } from "./eligibility.js";
import { candidates, remember, selectChallenger } from "./engine.js";
import { bandFor, statAllowedAtRound } from "./ramp.js";
import { STATS, STAT_KEYS } from "./stats.js";
import { chooseStat, nextDwell } from "./wheel.js";
import type { Player, Round, StatKey } from "./types.js";

export interface RunOptions {
  readonly deck: readonly Player[];
  readonly seed: string;
  /** Reference date — age is derived from it, so it must be fixed per run. */
  readonly now: Date;
  /** Hard cap on rounds generated. */
  readonly maxRounds?: number;
}

/** Stats that could open a run: basic tier, banded, genuinely easy to read. */
const OPENING_STATS: readonly StatKey[] = ["club_goals", "ig", "caps"];

/**
 * Most people who open the link play one run and never come back, so round one
 * is curated rather than random: a recognisable name and a question they can
 * answer. The `iconic` flag marks the names recognisable enough to open on.
 */
function openingAnchor(deck: readonly Player[], stat: StatKey, now: Date): Player | undefined {
  const eligible = deck.filter((p) => isEligible(p, stat, now));
  const famous = eligible.filter((p) => p.iconic === true);
  return famous[0] ?? eligible[0];
}

export function buildRun(opts: RunOptions): Round[] {
  const { deck, seed, now } = opts;
  const maxRounds = opts.maxRounds ?? 60;
  const rng = createRng(seed);

  let stat: StatKey | undefined;
  let anchor: Player | undefined;

  // Opening round: curated anchor on an easy stat.
  for (const candidateStat of rng.shuffle(OPENING_STATS)) {
    const pick = openingAnchor(deck, candidateStat, now);
    if (pick === undefined) continue;
    const pool = candidates(pick, candidateStat, bandFor(candidateStat, 1), {
      deck,
      now,
      seen: [],
    });
    if (pool.length > 0) {
      stat = candidateStat;
      anchor = pick;
      break;
    }
  }

  if (stat === undefined || anchor === undefined) return [];

  const rounds: Round[] = [];
  let seen: string[] = [];
  let dwell = nextDwell(rng);
  let heldFor = 0;

  for (let index = 1; index <= maxRounds; index++) {
    const previousStat = stat;

    if (heldFor >= dwell && index > 1) {
      const viable = STAT_KEYS.filter((key) => {
        if (!isEligible(anchor as Player, key, now)) return false;
        if (!statAllowedAtRound(key, index)) return false;
        return (
          candidates(anchor as Player, key, bandFor(key, index), { deck, now, seen }).length > 0
        );
      });
      const next = chooseStat({ current: stat, round: index, viable, rng });
      if (next !== undefined) {
        stat = next;
        dwell = nextDwell(rng);
        heldFor = 0;
      }
    }

    const match = selectChallenger(anchor, stat, index, { deck, now, seen }, rng);
    if (match === undefined) break;

    rounds.push({
      index,
      stat,
      anchor,
      challenger: match.challenger,
      band: match.band,
      relaxation: match.relaxation,
      statChanged: index > 1 && stat !== previousStat,
    });

    seen = remember(seen, anchor.id);
    anchor = match.challenger;
    heldFor += 1;
  }

  return rounds;
}

/** One round, without materialising the whole run for the caller. */
export function roundAt(opts: RunOptions, index: number): Round | undefined {
  const rounds = buildRun({ ...opts, maxRounds: Math.max(index, 1) });
  return rounds[index - 1];
}

/** Convenience for display code. */
export function labelFor(stat: StatKey): string {
  return STATS[stat].label;
}
