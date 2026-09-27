/**
 * @bt/core — the game, as pure TypeScript.
 *
 * Framework-free by construction: this package's tsconfig sets `types: []` and
 * `lib: ["ES2022"]`, so `window`, `fetch` and Cloudflare globals do not compile
 * here. The same code runs in the browser, in the Worker and in Node tests, and
 * server-side verification depends on all three agreeing exactly.
 */

export type {
  Band,
  FeeValue,
  IgValue,
  Mode,
  Player,
  PlayerStats,
  Position,
  Relaxation,
  Round,
  StatKey,
  Tier,
} from "./types.js";

export { createRng, hashSeed } from "./prng.js";
export type { Rng } from "./prng.js";

export {
  STATS,
  STAT_KEYS,
  TIER_TARGET,
  TIER_WEIGHT,
  CORRELATED_PAIRS,
  areCorrelated,
  ageAt,
  formatCollisions,
} from "./stats.js";
export type { StatDef } from "./stats.js";

export { isEligible, eligibleStats, buildEligibilityMap } from "./eligibility.js";
export type { EligibilityMap } from "./eligibility.js";

export {
  BAND_SCHEDULES,
  VOLATILE_FLOOR,
  bandFor,
  bandForRound,
  gap,
  pairFits,
  percentiles,
  rankDistance,
  relaxations,
  withinBand,
} from "./ramp.js";
export type { BandRow, Percentiles } from "./ramp.js";

export { SEEN_DEPTH, candidates, remember, selectChallenger, valueOf } from "./engine.js";
export type { Match, MatchContext } from "./engine.js";

export { DWELL_MAX, DWELL_MIN, chooseStat, nextDwell, weightedPick } from "./wheel.js";
export type { WheelOptions } from "./wheel.js";

export {
  ICONIC_ROUNDS,
  MAX_ROUNDS,
  OPENING_DWELL,
  WIN_ROUNDS,
  buildRun,
  isFinalRound,
  labelFor,
  roundAt,
  roundCap,
} from "./sequence.js";
export type { RunOptions } from "./sequence.js";

export { DISPLAY_WIDTHS, IMAGE_QUALITY, imageUrl, originalUrl, srcsetFor } from "./images.js";
export type { DisplayWidth, PlayerImage } from "./images.js";

export { STREAK_TITLES, challengeOutcome, streakTitle } from "./titles.js";
export type { ChallengeOutcome, StreakTitle, StreakTitleId } from "./titles.js";

export type {
  AnchorCard,
  AnswerRequest,
  AnswerResponse,
  ApiError,
  ApiErrorCode,
  CardImage,
  ChallengeLink,
  ChallengeStartRequest,
  ChallengeStatus,
  ContinueResponse,
  CorrectionRequest,
  EndResponse,
  FeedbackRequest,
  FeedbackResponse,
  Guess,
  NextRoundRequest,
  PlayerCard,
  ProblemRequest,
  Reveal,
  RoundPayload,
  RunEnd,
  StartRequest,
  StartResponse,
  StatPayload,
  SuggestRequest,
} from "./api.js";

export { FEEDBACK_LIMITS, SITE_PAGES, isSitePage, textLength } from "./feedback.js";
export type { SitePage } from "./feedback.js";
