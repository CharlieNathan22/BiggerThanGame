/**
 * The round endpoint's wire format: `POST /api/round/next`.
 *
 * Shared by the Worker, which builds these, and the web app, which reads them.
 * Types only — no runtime code — so importing it costs the client nothing.
 *
 * Every response type here is declared, never inferred. That matters more than
 * it looks: a `Round` from `buildRun` holds `anchor` and `challenger` as full
 * `Player` objects with every stat on them, and a handler whose return type is
 * inferred would happily serialise one. ARCHITECTURE.md §4, invariant 1.
 *
 * Phase 5 hardens this same endpoint for Ranked and Endless by adding a
 * progress token; the payload shapes stay as they are.
 */

import type { PlayerImage } from "./images.js";
import type { Position, StatKey, Tier } from "./types.js";

export type Guess = "higher" | "lower";

/** Why a run stopped. A wrong guess, or no further round could be dealt. */
export type RunEnd = "wrong" | "deck-exhausted";

/** Starts a run. The server mints the run id; the client never picks a seed. */
export interface StartRequest {
  readonly mode: "friendly";
}

/** Answers round `round` of run `runId`. */
export interface AnswerRequest {
  readonly mode: "friendly";
  readonly runId: string;
  /** 1-based. */
  readonly round: number;
  readonly guess: Guess;
}

/**
 * Starts a replay of someone else's run, from a challenge link
 * (`/football-higher-or-lower/legends/friendly?challenge=<runId>&score=<n>&sig=<sig>`).
 * The fields are the link's own. If the server can't verify the link it starts
 * a fresh run instead, and says why in `StartResponse.challenge`.
 */
export interface ChallengeStartRequest {
  readonly mode: "friendly";
  /** The challenged run's id, `YYYYMMDD-<uuid>.<sig>`. */
  readonly challenge: string;
  /** The score to beat. */
  readonly score: number;
  /** Signs `challenge` and `score` together, so neither can be edited. */
  readonly sig: string;
}

export type NextRoundRequest = StartRequest | ChallengeStartRequest | AnswerRequest;

export interface StatPayload {
  readonly key: StatKey;
  readonly label: string;
  readonly tier: Tier;
  /** The wheel spins on round one and whenever this is true. */
  readonly statChanged: boolean;
}

/**
 * A card's photo: the manifest entry, plus where to centre the crop when the
 * default (`50% 25%`) cuts the face off. Display data, like the rest of the card.
 */
export interface CardImage extends PlayerImage {
  /** `"x y"`, whole percentages 0–100, as the deck's `image.focus`. */
  readonly focus?: string;
}

/** What any card shows before a guess. Display data only. */
export interface PlayerCard {
  readonly id: string;
  readonly name: string;
  readonly country: string;
  readonly position: Position;
  /** Absent when the player has no synced photo; the card shows the monogram. */
  readonly image?: CardImage;
}

/** The anchor's value is already on screen, so it travels with the round. */
export interface AnchorCard extends PlayerCard {
  readonly value: number;
  /** Formatted by `STATS[key].format`, so client and server can't disagree. */
  readonly display: string;
  /** The fee's year or the follower snapshot date, where the stat has one. */
  readonly qualifier?: string;
}

/**
 * One question. The challenger is a bare `PlayerCard`: its value, display and
 * qualifier are all withheld until the guess, and arrive in `Reveal`.
 */
export interface RoundPayload {
  /** 1-based. */
  readonly index: number;
  readonly stat: StatPayload;
  readonly anchor: AnchorCard;
  readonly challenger: PlayerCard;
}

/** What became of a challenge link a run was started from. */
export type ChallengeStatus =
  /** The run is a replay of the challenged one: the same rounds, in the same order. */
  | { readonly accepted: true; readonly score: number }
  /** The link didn't check out, or is too old; the run is a fresh one. */
  | { readonly accepted: false; readonly reason: "invalid" | "expired" };

export interface StartResponse {
  readonly runId: string;
  readonly round: RoundPayload;
  /** Present only when the start came from a challenge link. */
  readonly challenge?: ChallengeStatus;
}

/**
 * A signed challenge for the run just played, at the score it reached: the
 * three query parameters of the game page's
 * `?challenge=<runId>&score=<score>&sig=<sig>`. The client builds the URL.
 */
export interface ChallengeLink {
  /** The run to replay, `YYYYMMDD-<uuid>.<sig>` — the original, even after a replay. */
  readonly runId: string;
  readonly score: number;
  readonly sig: string;
}

/** The challenger's figure, released only after the guess. */
export interface Reveal {
  readonly round: number;
  readonly value: number;
  readonly display: string;
  readonly qualifier?: string;
  /** Decided by the server, never the client. */
  readonly correct: boolean;
}

/** The run continues: `next`'s anchor is the challenger just revealed. */
export interface ContinueResponse {
  readonly reveal: Reveal;
  readonly next: RoundPayload;
}

export interface EndResponse {
  readonly reveal: Reveal;
  readonly end: RunEnd;
  /** A link challenging a friend to beat this run's score on the same rounds. */
  readonly challenge: ChallengeLink;
}

export type AnswerResponse = ContinueResponse | EndResponse;

export type ApiErrorCode =
  | "bad_request"
  | "not_found"
  | "method_not_allowed"
  | "rate_limited"
  | "unavailable"
  | "internal"
  /** Feedback only: the Turnstile check didn't pass. */
  | "verification_failed"
  /** Feedback only: the message couldn't be sent on. */
  | "send_failed";

export interface ApiError {
  readonly error: ApiErrorCode;
  /** Human-readable, for debugging. Never shown to players verbatim. */
  readonly detail?: string;
}

// ------------------------------------------------------------ feedback

/**
 * `POST /api/feedback`: the two feedback forms. Nothing personal travels here —
 * no email field, no name of the sender — and the Worker sends the message on
 * as a plain-text email; it stores nothing. Length limits are `FEEDBACK_LIMITS`
 * (feedback.ts).
 */
export interface SuggestRequest {
  readonly kind: "suggest";
  /** The legend's name. */
  readonly name: string;
  readonly note?: string;
  readonly turnstileToken: string;
}

/**
 * A report about the round that ended a run. It carries the run id and round
 * index only: the server rebuilds the round from the seed and puts the two
 * players, the stat and both values into the email itself. Values never come
 * from the client, and none are sent back to it.
 */
export interface CorrectionRequest {
  readonly kind: "correction";
  readonly runId: string;
  /** 1-based. */
  readonly round: number;
  readonly note?: string;
  readonly turnstileToken: string;
}

/**
 * "Report a problem": anything about the site that isn't a card — a bug, a
 * typo. The page it was sent from is one of `SITE_PAGES`, and nothing else
 * about the sender travels with it.
 */
export interface ProblemRequest {
  readonly kind: "problem";
  /** Required: the problem itself. */
  readonly note: string;
  /** The page it was sent from, e.g. `/about`. One of `SITE_PAGES`. */
  readonly page: string;
  readonly turnstileToken: string;
}

export type FeedbackRequest = SuggestRequest | CorrectionRequest | ProblemRequest;

/** The whole success response: nothing is echoed back. */
export interface FeedbackResponse {
  readonly ok: true;
}
