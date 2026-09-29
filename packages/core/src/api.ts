/**
 * The round endpoints' wire format: Friendly's stateless `POST /api/round/next`;
 * Endless's `POST /api/run/start` and `POST /api/round/guess`, which carry a
 * signed progress token; and the beacon a run sends when the player leaves,
 * `POST /api/run/leave`.
 *
 * Shared by the Worker, which builds these, and the web app, which reads them.
 * Types only — no runtime code — so importing it costs the client nothing.
 *
 * Every response type here is declared, never inferred. That matters more than
 * it looks: a `Round` from `buildRun` holds `anchor` and `challenger` as full
 * `Player` objects with every stat on them, and a handler whose return type is
 * inferred would happily serialise one. ARCHITECTURE.md §4, invariant 1.
 *
 * Both paths share the round, reveal and end shapes; Endless adds the token
 * (and, at a run's end, a signed result) alongside them.
 */

import type { PlayerImage } from "./images.js";
import type { Position, StatKey, Tier } from "./types.js";

export type Guess = "higher" | "lower";

/**
 * An answer in a timed mode: a pick, or `timeout` when the client's clock ran
 * out, so the player still sees the reveal. The server's own deadline decides
 * whether time was up; `timeout` only ends a run early.
 */
export type TimedGuess = Guess | "timeout";

/**
 * Why a run stopped:
 *
 * - `wrong`: a wrong guess;
 * - `deck-exhausted`: no further round could be dealt;
 * - `won`: in a mode with a finish line (`WIN_ROUNDS`), its last round
 *   answered correctly;
 * - `timeout`: in a timed mode, the answer came after the question's deadline,
 *   or the client's clock ran out;
 * - `disconnected`: in a timed mode, no answer came at all — the server closes
 *   the run a little after the deadline, keeping the streak it had verified.
 *   Only ever in the server's own records; the client banks the run itself.
 */
export type RunEnd = "wrong" | "deck-exhausted" | "won" | "timeout" | "disconnected";

/** Starts a Friendly run. The server mints the run id; the client never picks a seed. */
export interface StartRequest {
  readonly mode: "friendly";
}

/** Answers round `round` of Friendly run `runId`. */
export interface AnswerRequest {
  readonly mode: "friendly";
  readonly runId: string;
  /** 1-based. */
  readonly round: number;
  readonly guess: Guess;
}

export type NextRoundRequest = StartRequest | AnswerRequest;

/**
 * Where a run was when the player left: the title card and the cards sliding
 * in (`intro`), a question waiting for an answer (`question`), the answer
 * shown (`reveal`), or between those, dealing or spinning (`other`).
 */
export type LeavePhase = "intro" | "question" | "reveal" | "other";

/** What told the page the player was going: the tab hidden, or the page closed. */
export type LeaveTrigger = "hidden" | "pagehide";

/**
 * `POST /api/run/leave`, sent as a beacon when the page is hidden or closed
 * mid-run. Telemetry only: the answer is an empty 204 and changes nothing about
 * the run. The server looks the round up for itself; nothing else is sent.
 */
export interface LeaveRequest {
  readonly mode: "friendly" | "endless";
  readonly runId: string;
  /** The round on screen, 1-based; 0 during the title card and the intro. */
  readonly round: number;
  readonly phase: LeavePhase;
  readonly trigger: LeaveTrigger;
}

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
  /**
   * The photo of the challenger in the round after this one, so it loads a
   * round early (ARCHITECTURE.md §9). The run doesn't depend on answers, so the
   * server knows it now. The image only — no name, no value, no qualifier.
   * Absent on the last round the run can deal, and when that player has no photo.
   */
  readonly upcoming?: CardImage;
}

/**
 * What became of a challenge link a run was started from (Endless only). Either
 * way the run is a fresh one, with its own random rounds: a link sets the
 * score to beat, never the sequence.
 */
export type ChallengeStatus =
  /** The link checked out: the run is framed as "Beat <score>". */
  | { readonly accepted: true; readonly score: number }
  /** The link didn't check out, or is too old: a plain run, with a note. */
  | { readonly accepted: false; readonly reason: "invalid" | "expired" };

/**
 * A run's first round, as the game reads it in every mode. Friendly's start
 * answers exactly this; Endless's adds the first progress token
 * (`RunStartResponse`), which the web app keeps to itself.
 */
export interface StartResponse {
  readonly runId: string;
  readonly round: RoundPayload;
  /** Present only when the start came from a challenge link (Endless). */
  readonly challenge?: ChallengeStatus;
}

/**
 * A signed challenge for the run just played, at the score it reached: the
 * three query parameters of the game page's
 * `?challenge=<runId>&score=<score>&sig=<sig>`. The client builds the URL. The
 * signature covers the run and the score together, so the number can't be
 * edited; the friend who opens it plays a fresh run against that score.
 */
export interface ChallengeLink {
  /** The run that set the score, `YYYYMMDD-<uuid>.<sig>`. */
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
  /**
   * A link challenging a friend to beat this run's score, in a mode that has
   * them (`CHALLENGES`: Endless). Friendly's ends carry none.
   */
  readonly challenge?: ChallengeLink;
}

export type AnswerResponse = ContinueResponse | EndResponse;

// ------------------------------------------------------------ Endless

/**
 * `POST /api/run/start`: starts a run in a timed mode. Turnstile is checked
 * first; a challenge link, if the page came from one, only sets the score to
 * beat.
 */
export interface RunStartRequest {
  readonly mode: "endless";
  readonly turnstileToken: string;
  readonly challenge?: ChallengeLink;
}

/**
 * Round one, and the first progress token: the only way to answer it. The
 * token is signed, not encrypted, and carries only what is on screen
 * (ARCHITECTURE.md §8); the web app holds it in memory and sends it back with
 * the guess.
 */
export interface RunStartResponse extends StartResponse {
  readonly token: string;
}

/**
 * `POST /api/round/guess`: answers the round the token names. `clientElapsedMs`
 * is telemetry at most — the server measures the time itself and never trusts
 * the client's clock.
 */
export interface GuessRequest {
  readonly token: string;
  readonly guess: TimedGuess;
  readonly clientElapsedMs?: number;
}

/** The run goes on: the next round and the token to answer it with. */
export interface GuessContinueResponse extends ContinueResponse {
  readonly token: string;
}

/**
 * The run is over. `result` is a signed record of it — score, how it ended,
 * the day it started and the time the server measured — for publishing it
 * later (part 2); the client keeps it in memory and never reads it.
 */
export interface GuessEndResponse extends EndResponse {
  readonly challenge: ChallengeLink;
  readonly result: string;
}

export type GuessResponse = GuessContinueResponse | GuessEndResponse;

// ------------------------------------------------------------ boards

/**
 * `POST /api/run/submit`: publishes a finished Endless run to the boards.
 * Opt-in — nothing reaches it unless the player presses Publish.
 */
export interface SubmitRequest {
  /**
   * The run's signed result (`GuessEndResponse.result`), or, for a run banked
   * after the connection dropped, its latest progress token.
   */
  readonly token: string;
  /** Checked with `checkNickname`, then against the blocklist. */
  readonly nickname: string;
  /**
   * A random id this browser keeps (a v4 uuid). The server stores only a keyed
   * hash of it, which is what "one entry per device" counts.
   */
  readonly deviceId: string;
  readonly turnstileToken: string;
}

/** Where a published run stands in one of its periods, as its owner sees it. */
export interface PeriodRank {
  /** `2026-09-29`, `2026-W40` or `2026-09`. */
  readonly key: string;
  /** False when the period has already closed: a run started before a reset, published after. */
  readonly current: boolean;
  /** The device's best in the period, ranked among every device's best. */
  readonly rank: number;
  /** How many devices have an entry in the period. */
  readonly total: number;
  /** When the period resets, ms since the epoch. */
  readonly resetsAt: number;
  /** The device's best entry in the period: this run, or a better one already published. */
  readonly entryId: string;
  readonly streak: number;
}

export interface SubmitResponse {
  /** The new entry's id. */
  readonly id: string;
  /** As stored: cleaned (`cleanNickname`). */
  readonly nickname: string;
  readonly streak: number;
  readonly periods: {
    readonly day: PeriodRank;
    readonly week: PeriodRank;
    readonly month: PeriodRank;
  };
}

export interface BoardEntry {
  readonly id: string;
  readonly rank: number;
  /** Null for a name that has been retired: shown as "Retired name", the score kept. */
  readonly nickname: string | null;
  readonly streak: number;
}

/** `GET /api/board/endless/:period` — the current period's top 100. */
export interface BoardResponse {
  readonly mode: "endless";
  readonly period: "day" | "week" | "month";
  readonly key: string;
  readonly resetsAt: number;
  /** Devices with an entry this period. */
  readonly total: number;
  readonly entries: readonly BoardEntry[];
  /** The period before: yesterday, last week, last month. */
  readonly previous: {
    readonly key: string;
    readonly winner: { readonly nickname: string | null; readonly streak: number } | null;
  };
}

export type ApiErrorCode =
  | "bad_request"
  | "not_found"
  | "method_not_allowed"
  | "rate_limited"
  | "unavailable"
  | "internal"
  /** Feedback and run starts: the Turnstile check didn't pass. */
  | "verification_failed"
  /**
   * Endless: the progress token was already spent, is out of order, or its run
   * is over. The run is void; nothing more is taken for it.
   */
  | "conflict"
  /** Feedback only: the message couldn't be sent on. */
  | "send_failed"
  /** Publishing: the nickname didn't pass moderation. "Try another name." */
  | "nickname_rejected";

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
  /** Endless for an Endless run's report; absent for Friendly's, as before. */
  readonly mode?: "endless";
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
