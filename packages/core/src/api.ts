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
import type { StreamLength, StreamLimit, StreamPool } from "./stream.js";
import type { NamedVariant } from "./variants.js";

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
 * - `finished`: Daily Ranked, question 20 answered without all twenty right
 *   (a perfect run goes on into the bonus, where `wrong` or `timeout` ends it);
 *   and Twitch Mode, the match's last question answered, right or wrong;
 * - `abandoned`: Daily Ranked, a run with no activity for `IDLE_FINISH_MS`,
 *   finished by the server with every unanswered question counted wrong.
 */
export type RunEnd =
  "wrong" | "deck-exhausted" | "won" | "timeout" | "disconnected" | "finished" | "abandoned";

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
  readonly mode: "friendly" | "endless" | "ranked";
  /** An Endless run's variant, when not general Endless. */
  readonly variant?: NamedVariant;
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
  /** An Endless variant other than general Endless (variants.ts); absent for general. */
  readonly variant?: NamedVariant;
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
  /**
   * The flag's country code for this connection (Cloudflare's), or null: what
   * the publish dialog shows will appear if the player keeps "Show my country
   * flag" ticked. Only the code, never anything finer.
   */
  readonly country: string | null;
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
  /**
   * "Show my country flag": when true, the server keeps the flag's country
   * code for its connection (Cloudflare's `request.cf.country`, if there is a
   * flag for it); when false, none.
   */
  readonly showCountry: boolean;
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
  /** That entry's streak: the device's best in the period, shadowed runs included. */
  readonly best: number;
  /**
   * Whether this run is now the device's entry in the period. False when an
   * earlier run of the device's still beats it (a higher streak, or an equal
   * one in less time): the board keeps that one and nothing on it moved.
   */
  readonly improved: boolean;
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

/**
 * `POST /api/board/endless/me`: where this device stands now, in each current
 * period. Live, never cached: other players publish after you, so the rank
 * your own publish came back with goes out of date.
 */
export interface MineRequest {
  /** The random id this browser keeps; the server only ever uses a keyed hash of it. */
  readonly deviceId: string;
}

/** This device's best entry in a period, ranked as its owner sees it (shadowed runs included). */
export interface MineEntry {
  /** The period's key: `2026-09-29`, `2026-W40`, `2026-09`. */
  readonly key: string;
  readonly entryId: string;
  readonly rank: number;
  /** Devices on the board, this one counted. */
  readonly total: number;
  readonly streak: number;
  /** Null for a name that has been retired. */
  readonly nickname: string | null;
  /** As on the board: another public best in the period has the same streak. */
  readonly tied: boolean;
  /** Thinking time, ms; null unless `tied`. */
  readonly thinkMs: number | null;
  /** The flag's country code, or null. */
  readonly country: string | null;
}

export interface MineResponse {
  /** Null for a period this device has nothing in. */
  readonly periods: {
    readonly day: MineEntry | null;
    readonly week: MineEntry | null;
    readonly month: MineEntry | null;
  };
}

export interface BoardEntry {
  readonly id: string;
  readonly rank: number;
  /** Null for a name that has been retired: shown as "Retired name", the score kept. */
  readonly nickname: string | null;
  readonly streak: number;
  /**
   * Another entry on the period's public board, anywhere in it, has the same
   * streak: the page shows the thinking time that orders them.
   */
  readonly tied: boolean;
  /** Thinking time, ms, the tiebreak on equal streaks; null unless `tied`. */
  readonly thinkMs: number | null;
  /** The flag's ISO 3166-1 alpha-2 code, or null: no flag. Nothing finer, ever. */
  readonly country: string | null;
}

/** `GET /api/board/endless/:period` — the current period's top `BOARD_SIZE` (50). */
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
    readonly winner: {
      readonly nickname: string | null;
      readonly streak: number;
      /** The winner's flag's country code, or null. */
      readonly country: string | null;
    } | null;
  };
}

// ------------------------------------------------------------ Daily Ranked

/**
 * `POST /api/run/start` for Daily Ranked: the name, the flag choice and
 * Turnstile travel with the start, so pressing Play is the whole commitment.
 * A name that is refused or taken starts nothing and uses no attempt.
 */
export interface DailyStartRequest {
  readonly mode: "ranked";
  /** Checked with `checkNickname`, the blocklist, and for uniqueness within the game. */
  readonly nickname: string;
  /** "Show my country flag", as in publishing. */
  readonly showCountry: boolean;
  /** The random id this browser keeps; the server keeps only a keyed hash of it. */
  readonly deviceId: string;
  readonly turnstileToken: string;
}

export interface DailyStartResponse {
  readonly runId: string;
  readonly gameNo: number;
  readonly round: RoundPayload;
  readonly token: string;
  /** The flag's country code, or null: the flag the board will show, if any. */
  readonly country: string | null;
  /** As stored: cleaned (`cleanNickname`). */
  readonly nickname: string;
}

/**
 * A finished Daily run, as its player sees it. `results` is right or wrong
 * for each question answered, in order — the twenty, then the bonus rounds —
 * which the player has already seen; never a value.
 */
export interface DailyResult {
  readonly gameNo: number;
  readonly score: number;
  /** Right answers out of the twenty. */
  readonly correct: number;
  /** Bonus rounds answered right after a perfect twenty. */
  readonly bonus: number;
  readonly results: readonly boolean[];
  readonly end: RunEnd;
  /** Null for a name that has been retired. */
  readonly nickname: string | null;
  /** Where the run stands on the game's board, as its owner sees it; null until it is posted. */
  readonly rank: number | null;
  readonly total: number | null;
}

/** A Daily run is over: the reveal, and the run's result, already on the board. */
export interface DailyGuessEndResponse {
  readonly reveal: Reveal;
  readonly end: RunEnd;
  readonly result: DailyResult;
}

/** `POST /api/round/guess` with a Daily token: the next question, or the end. */
export type DailyGuessResponse = GuessContinueResponse | DailyGuessEndResponse;

/**
 * `POST /api/run/resume`: carries on this device's Daily run after a refresh.
 * The server finds the run from the device; `runId` is only a hint.
 */
export interface DailyResumeRequest {
  readonly deviceId: string;
  readonly runId?: string;
}

export type DailyResumeResponse =
  | {
      readonly state: "playing";
      readonly runId: string;
      readonly gameNo: number;
      /** The question on screen, with a fresh token. Its clock has kept running. */
      readonly round: RoundPayload;
      readonly token: string;
      /**
       * Time left on the question, ms, when it was already open; null for a
       * question dealt fresh by this resume, which gets its whole limit.
       */
      readonly remainingMs: number | null;
      /** Right or wrong for each question answered so far. */
      readonly results: readonly boolean[];
      readonly nickname: string;
      readonly country: string | null;
    }
  | { readonly state: "finished"; readonly result: DailyResult }
  | { readonly state: "none" };

/** One row of a Daily board. */
export interface DailyBoardEntry {
  readonly id: string;
  readonly rank: number;
  /** Null for a retired name. */
  readonly nickname: string | null;
  readonly score: number;
  /** Twenty out of twenty: the score includes `bonus` bonus rounds. */
  readonly perfect: boolean;
  readonly bonus: number;
  /** Another entry on the game's public board has the same score: the thinking time is shown. */
  readonly tied: boolean;
  /** Thinking time, ms, the tiebreak on equal scores; null unless `tied`. */
  readonly thinkMs: number | null;
  readonly country: string | null;
}

/**
 * `GET /api/board/daily`: today's game, its top `BOARD_SIZE` (50). Before
 * launch day `gameNo` is 0, with no entries and `nextGameAt` Game 1's start.
 */
export interface DailyBoardResponse {
  readonly mode: "ranked";
  readonly gameNo: number;
  /** When the next game starts, ms. */
  readonly nextGameAt: number;
  /** Players with a finished run in the game. */
  readonly total: number;
  readonly entries: readonly DailyBoardEntry[];
  /** The game before and its winner, from its snapshot; null before Game 2. */
  readonly previous: {
    readonly gameNo: number;
    readonly winner: {
      readonly nickname: string | null;
      readonly score: number;
      readonly perfect: boolean;
      readonly bonus: number;
      readonly country: string | null;
    } | null;
  } | null;
}

/** `POST /api/board/daily/me`: this device and today's game. */
export interface DailyMineRequest {
  readonly deviceId: string;
}

/**
 * Every answer also carries `country`: the flag's code for this connection
 * (Cloudflare's), or null, so the start panel can show the flag "Show my
 * country flag" will put on the board. Only the code, never anything finer.
 */
export type DailyMineResponse =
  | {
      readonly gameNo: number;
      readonly nextGameAt: number;
      readonly country: string | null;
      readonly state: "none";
    }
  | {
      readonly gameNo: number;
      readonly nextGameAt: number;
      readonly country: string | null;
      readonly state: "playing";
      readonly nickname: string;
    }
  | {
      readonly gameNo: number;
      readonly nextGameAt: number;
      readonly country: string | null;
      readonly state: "finished";
      readonly result: DailyResult;
      /** The device's row as its owner sees it, for the board's pinned row. */
      readonly standing: DailyBoardEntry;
    };

// ------------------------------------------------------------ Twitch Mode

/**
 * Chat's answer to a question, as the streamer's page counted the votes: the
 * majority, `split` on a tie, `none` with no votes. Telemetry for the server;
 * it never changes the match.
 */
export type ChatPick = "higher" | "lower" | "split" | "none";

/**
 * `POST /api/run/start` for Twitch Mode (`stream`). The questions and the
 * limit are chosen at setup; the server accepts only `STREAM_LENGTHS` and
 * `STREAM_LIMITS`, and caps a squad's length at its size less one.
 */
export interface StreamStartRequest {
  readonly mode: "stream";
  readonly pool: StreamPool;
  readonly questions: StreamLength;
  /** The voting window, seconds: the limit on every question. */
  readonly limit: StreamLimit;
  readonly turnstileToken: string;
}

export interface StreamStartResponse extends StartResponse {
  readonly token: string;
  /** The match's questions, after the pool's cap. */
  readonly questions: number;
  readonly limit: StreamLimit;
}

/**
 * What chat did on the question just answered: counts only, never a message,
 * a name or an id. The voters are that question's alone.
 */
export interface StreamChat {
  readonly pick: ChatPick;
  readonly voters: number;
}

/** `POST /api/round/guess` with a match's token: the streamer's pick, and chat's as telemetry. */
export interface StreamGuessRequest extends GuessRequest {
  readonly chat?: StreamChat;
}

/** The match is over: its last question answered, or the pool could deal no more. */
export interface StreamGuessEndResponse {
  readonly reveal: Reveal;
  readonly end: "finished" | "deck-exhausted";
  /** The streamer's right answers. */
  readonly score: number;
}

export type StreamGuessResponse = GuessContinueResponse | StreamGuessEndResponse;

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
   * is over. The run is void; nothing more is taken for it. Daily Ranked and
   * Twitch Mode: the same refusals without voiding the run (the first answer
   * stands), and Daily's start `name_taken`, `already_played` or
   * `not_started` (as the detail).
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
  /** Endless or Daily Ranked for their runs' reports; absent for Friendly's, as before. */
  readonly mode?: "endless" | "ranked";
  /** An Endless run's variant, when not general Endless. */
  readonly variant?: NamedVariant;
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
