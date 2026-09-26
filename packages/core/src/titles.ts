/**
 * Streak titles: a name for a run that reached a milestone, shown on the
 * game-over panel and in what the player shares.
 *
 * One table, easy to retune. Each entry is the lowest streak that earns the
 * title; below the first there is none. The words themselves are
 * player-facing text and live in the web app's language files, keyed by `id`.
 */

export type StreakTitleId = "squad" | "starter" | "captain" | "legend" | "goat";

export interface StreakTitle {
  readonly id: StreakTitleId;
  /** The lowest streak that earns this title. */
  readonly min: number;
}

/** Ascending by `min`. */
export const STREAK_TITLES: readonly StreakTitle[] = [
  { id: "squad", min: 5 },
  { id: "starter", min: 10 },
  { id: "captain", min: 20 },
  { id: "legend", min: 30 },
  { id: "goat", min: 45 },
];

/** The highest title `streak` has earned, or undefined below the first. */
export function streakTitle(streak: number): StreakTitle | undefined {
  let earned: StreakTitle | undefined;
  for (const title of STREAK_TITLES) if (streak >= title.min) earned = title;
  return earned;
}

/** How a replayed run compares with the score it was challenged to beat. */
export type ChallengeOutcome = "beat" | "matched" | "short";

export function challengeOutcome(score: number, target: number): ChallengeOutcome {
  if (score > target) return "beat";
  return score === target ? "matched" : "short";
}
