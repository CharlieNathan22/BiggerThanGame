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

export type NextRoundRequest = StartRequest | AnswerRequest;

export interface StatPayload {
  readonly key: StatKey;
  readonly label: string;
  readonly tier: Tier;
  /** The wheel spins on round one and whenever this is true. */
  readonly statChanged: boolean;
}

/** What any card shows before a guess. Display data only. */
export interface PlayerCard {
  readonly id: string;
  readonly name: string;
  readonly country: string;
  readonly position: Position;
  /** Absent when the player has no synced photo; the card shows the monogram. */
  readonly image?: PlayerImage;
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

export interface StartResponse {
  readonly runId: string;
  readonly round: RoundPayload;
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
}

export type AnswerResponse = ContinueResponse | EndResponse;

export type ApiErrorCode =
  "bad_request" | "not_found" | "method_not_allowed" | "rate_limited" | "unavailable" | "internal";

export interface ApiError {
  readonly error: ApiErrorCode;
  /** Human-readable, for debugging. Never shown to players verbatim. */
  readonly detail?: string;
}
