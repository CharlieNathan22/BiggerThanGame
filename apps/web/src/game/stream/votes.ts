/**
 * Chat's votes on one question (DESIGN.md §3, Twitch Mode).
 *
 * One vote per viewer, keyed on Twitch's user id; a later vote replaces an
 * earlier one. Only votes that arrive while the box is open count. The counts
 * are kept as each vote comes in, so a big chat costs a map write per message
 * and nothing more; the page reads `counts()` a few times a second.
 *
 * The box holds user ids for the open question only: `open()` empties it, and
 * nothing in it is stored or sent anywhere. What leaves is `result()`: chat's
 * pick and how many voted.
 */

import type { ChatPick, Guess, StreamChat } from "@bt/core";

export interface VoteCounts {
  readonly higher: number;
  readonly lower: number;
  /** Viewers with a vote in: `higher + lower`. */
  readonly voters: number;
}

export const NO_VOTES: VoteCounts = { higher: 0, lower: 0, voters: 0 };

export class VoteBox {
  #votes = new Map<string, Guess>();
  #higher = 0;
  #lower = 0;
  #open = false;

  get isOpen(): boolean {
    return this.#open;
  }

  /** Opens voting on a new question, with no votes in. */
  open(): void {
    this.#votes.clear();
    this.#higher = 0;
    this.#lower = 0;
    this.#open = true;
  }

  /** Closes voting: the counts stand until the next `open()`. */
  close(): void {
    this.#open = false;
  }

  /** A viewer's vote; ignored while closed. A second vote replaces the first. */
  add(userId: string, pick: Guess): void {
    if (!this.#open || userId === "") return;
    const before = this.#votes.get(userId);
    if (before === pick) return;
    if (before === "higher") this.#higher -= 1;
    else if (before === "lower") this.#lower -= 1;
    this.#votes.set(userId, pick);
    if (pick === "higher") this.#higher += 1;
    else this.#lower += 1;
  }

  counts(): VoteCounts {
    return { higher: this.#higher, lower: this.#lower, voters: this.#higher + this.#lower };
  }

  /** Chat's answer and turnout, as the server's telemetry takes it. */
  result(): StreamChat {
    const counts = this.counts();
    return { pick: pickOf(counts), voters: counts.voters };
  }
}

/** The majority; `split` on a tie; `none` with no votes. */
export function pickOf(counts: VoteCounts): ChatPick {
  if (counts.voters === 0) return "none";
  if (counts.higher === counts.lower) return "split";
  return counts.higher > counts.lower ? "higher" : "lower";
}

/** The split as whole percentages that add up to 100 (higher's rounded, lower's the rest). */
export function splitPercent(counts: VoteCounts): {
  readonly higher: number;
  readonly lower: number;
} {
  if (counts.voters === 0) return { higher: 0, lower: 0 };
  const higher = Math.round((100 * counts.higher) / counts.voters);
  return { higher, lower: 100 - higher };
}
