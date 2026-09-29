/**
 * Streak titles: a name for a run that reached a milestone, shown on the
 * game-over panel and in what the player shares.
 *
 * One table per mode, easy to retune. Each entry is the lowest streak that
 * earns the title; below the first there is none. Friendly's run to twenty
 * (`WIN_ROUNDS`) has its own, ending on the win; the open-ended modes keep the
 * long one. The words themselves are player-facing text and live in the web
 * app's language files, keyed by `id`.
 */

import type { Mode } from "./types.js";

export type StreakTitleId =
  | "squad"
  | "starter"
  | "favourite"
  | "captain"
  | "clubLegend"
  | "worldClass"
  | "legend"
  | "immortal"
  | "goat";

export interface StreakTitle {
  readonly id: StreakTitleId;
  /** The lowest streak that earns this title. */
  readonly min: number;
}

/** Ranked: no finish line. Ascending by `min`. */
const LONG_TITLES: readonly StreakTitle[] = [
  { id: "squad", min: 5 },
  { id: "starter", min: 10 },
  { id: "captain", min: 20 },
  { id: "legend", min: 30 },
  { id: "goat", min: 45 },
];

/**
 * Endless: no finish line, and harder than Friendly, so the titles come closer
 * together early and keep going past 30. Ascending by `min`; edit freely.
 */
const ENDLESS_TITLES: readonly StreakTitle[] = [
  { id: "squad", min: 5 },
  { id: "starter", min: 10 },
  { id: "favourite", min: 15 },
  { id: "captain", min: 20 },
  { id: "clubLegend", min: 30 },
  { id: "worldClass", min: 40 },
  { id: "immortal", min: 50 },
];

/** Friendly: twenty questions, Legend for the win. Ascending by `min`. */
const FRIENDLY_TITLES: readonly StreakTitle[] = [
  { id: "squad", min: 5 },
  { id: "starter", min: 10 },
  { id: "captain", min: 15 },
  { id: "legend", min: 20 },
];

/** The titles per mode, each table ascending by `min`. DESIGN.md §13. */
export const STREAK_TITLES: Readonly<Record<Mode, readonly StreakTitle[]>> = {
  friendly: FRIENDLY_TITLES,
  endless: ENDLESS_TITLES,
  ranked: LONG_TITLES,
};

/** The highest title `streak` has earned in `mode`, or undefined below the first. */
export function streakTitle(streak: number, mode: Mode): StreakTitle | undefined {
  let earned: StreakTitle | undefined;
  for (const title of STREAK_TITLES[mode]) if (streak >= title.min) earned = title;
  return earned;
}

/** How a replayed run compares with the score it was challenged to beat. */
export type ChallengeOutcome = "beat" | "matched" | "short";

export function challengeOutcome(score: number, target: number): ChallengeOutcome {
  if (score > target) return "beat";
  return score === target ? "matched" : "short";
}
