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

export { STATS, STAT_KEYS, TIER_WEIGHT, CORRELATED_PAIRS, areCorrelated, ageAt } from "./stats.js";
export type { StatDef } from "./stats.js";

export { isEligible, eligibleStats, buildEligibilityMap } from "./eligibility.js";
export type { EligibilityMap } from "./eligibility.js";

export {
  BAND_EXEMPT_MIN_ROUND,
  VOLATILE_FLOOR,
  bandFor,
  bandForRound,
  gap,
  relaxations,
  statAllowedAtRound,
  withinBand,
} from "./ramp.js";

export { SEEN_DEPTH, candidates, remember, selectChallenger, valueOf } from "./engine.js";
export type { Match, MatchContext } from "./engine.js";

export { DWELL_MAX, DWELL_MIN, chooseStat, nextDwell, weightedPick } from "./wheel.js";
export type { WheelOptions } from "./wheel.js";

export { MAX_ROUNDS, buildRun, labelFor, roundAt } from "./sequence.js";
export type { RunOptions } from "./sequence.js";

export { DISPLAY_WIDTHS, IMAGE_QUALITY, imageUrl, originalUrl, srcsetFor } from "./images.js";
export type { DisplayWidth, PlayerImage } from "./images.js";

export type {
  AnchorCard,
  AnswerRequest,
  AnswerResponse,
  ApiError,
  ApiErrorCode,
  ContinueResponse,
  EndResponse,
  Guess,
  NextRoundRequest,
  PlayerCard,
  Reveal,
  RoundPayload,
  RunEnd,
  StartRequest,
  StartResponse,
  StatPayload,
} from "./api.js";
