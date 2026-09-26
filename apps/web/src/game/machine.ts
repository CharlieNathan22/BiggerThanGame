/**
 * The game island's state machine, as a pure reducer.
 *
 *   idle → starting → dealing → [spinning] → awaiting → revealing → verdict
 *                        ↑                                             │
 *                        └──────────── correct, next round ────────────┤
 *                                                                      ↓
 *                                                                     over
 *
 * The server decides everything that matters — the pair, the stat, whether a
 * guess was right. This module only sequences what the player sees, so it holds
 * no game rules beyond "spin on round one and when the stat changes" (DESIGN.md
 * §7). Components render `GameState`; `controller.ts` runs the timers and the
 * network calls that produce events.
 *
 * Friendly Mode has no clock, so `awaiting` waits for the player indefinitely.
 */

import type {
  AnswerResponse,
  Guess,
  Reveal,
  RoundPayload,
  RunEnd,
  StatKey,
  StatPayload,
  Tier,
} from "@bt/core";
import type { Timings } from "./timing";

export type Phase =
  "idle" | "starting" | "dealing" | "spinning" | "awaiting" | "revealing" | "verdict" | "over";

/** Why a run stopped: the server's reasons, or the connection dropping. */
export type EndReason = RunEnd | "network";

/**
 * One answered round, for the share grid and share image (M5). Only what the
 * player has already seen — never a value.
 */
export interface RoundRecord {
  readonly index: number;
  readonly stat: StatKey;
  readonly tier: Tier;
  readonly correct: boolean;
}

/** When the guess went, and when the answer came back. `performance.now()` ms. */
export interface CountClock {
  readonly tappedAt: number;
  readonly arrivedAt: number | null;
}

export interface GameState {
  readonly phase: Phase;
  readonly runId: string | null;
  /** The question on screen. */
  readonly round: RoundPayload | null;
  /**
   * The stat on the plaque. While a spin is pending it is still the previous
   * one (null before the first spin), so the plaque never shows the new stat
   * before the wheel lands on it.
   */
  readonly plaque: StatPayload | null;
  readonly guess: Guess | null;
  readonly count: CountClock | null;
  /** The challenger's figure, once the server has judged the guess. */
  readonly reveal: Reveal | null;
  /** The next question, held until the verdict has been shown. */
  readonly next: RoundPayload | null;
  readonly streak: number;
  /** Best streak, including the run in progress. */
  readonly best: number;
  /** Best streak before this run started, so the game-over panel can say "new best". */
  readonly bestBefore: number;
  readonly history: readonly RoundRecord[];
  readonly end: EndReason | null;
  /** The last start attempt failed; the start panel says so. */
  readonly startFailed: boolean;
}

export type GameEvent =
  | { readonly type: "start" }
  | { readonly type: "started"; readonly runId: string; readonly round: RoundPayload }
  | { readonly type: "startFailed" }
  | { readonly type: "dealt" }
  | { readonly type: "spun" }
  | { readonly type: "guess"; readonly guess: Guess; readonly at: number }
  | { readonly type: "answered"; readonly response: AnswerResponse; readonly at: number }
  | { readonly type: "answerFailed" }
  | { readonly type: "settled" }
  | { readonly type: "advance" };

export function initialState(best = 0): GameState {
  return {
    phase: "idle",
    runId: null,
    round: null,
    plaque: null,
    guess: null,
    count: null,
    reveal: null,
    next: null,
    streak: 0,
    best,
    bestBefore: best,
    history: [],
    end: null,
    startFailed: false,
  };
}

/** The wheel spins on round one and whenever the stat changes (DESIGN.md §7). */
export function shouldSpin(round: RoundPayload): boolean {
  return round.index === 1 || round.stat.statChanged;
}

/**
 * The next state. An event that doesn't apply in the current phase — a second
 * tap, a timer from a finished run — returns the same state object unchanged.
 */
export function reduce(state: GameState, event: GameEvent): GameState {
  switch (event.type) {
    case "start":
      if (state.phase !== "idle" && state.phase !== "over") return state;
      return { ...initialState(state.best), phase: "starting" };

    case "started":
      if (state.phase !== "starting") return state;
      return deal({ ...state, runId: event.runId }, event.round);

    case "startFailed":
      if (state.phase !== "starting") return state;
      return { ...state, phase: "idle", startFailed: true };

    case "dealt":
      if (state.phase !== "dealing" || state.round === null) return state;
      return shouldSpin(state.round)
        ? { ...state, phase: "spinning" }
        : { ...state, phase: "awaiting" };

    case "spun":
      if (state.phase !== "spinning" || state.round === null) return state;
      return { ...state, phase: "awaiting", plaque: state.round.stat };

    case "guess":
      if (state.phase !== "awaiting") return state;
      return {
        ...state,
        phase: "revealing",
        guess: event.guess,
        count: { tappedAt: event.at, arrivedAt: null },
      };

    case "answered": {
      if (state.phase !== "revealing" || state.reveal !== null || state.count === null) {
        return state;
      }
      const { response } = event;
      // A reveal for some other round means client and server disagree about
      // where the run is. Nothing sensible can follow, so bank the streak.
      if (state.round === null || response.reveal.round !== state.round.index) {
        return over(state, "network");
      }
      return {
        ...state,
        count: { ...state.count, arrivedAt: event.at },
        reveal: response.reveal,
        next: "next" in response ? response.next : null,
        end: "end" in response ? response.end : null,
      };
    }

    case "answerFailed":
      if (state.phase !== "revealing" || state.reveal !== null) return state;
      return over(state, "network");

    case "settled": {
      if (state.phase !== "revealing" || state.reveal === null || state.round === null) {
        return state;
      }
      const { correct } = state.reveal;
      const streak = correct ? state.streak + 1 : state.streak;
      const record: RoundRecord = {
        index: state.round.index,
        stat: state.round.stat.key,
        tier: state.round.stat.tier,
        correct,
      };
      return {
        ...state,
        phase: "verdict",
        streak,
        best: Math.max(state.best, streak),
        history: [...state.history, record],
      };
    }

    case "advance":
      if (state.phase !== "verdict") return state;
      if (state.reveal?.correct === true && state.next !== null) {
        return deal(
          { ...state, guess: null, count: null, reveal: null, next: null, end: null },
          state.next,
        );
      }
      return { ...state, phase: "over", end: state.end ?? "deck-exhausted" };
  }
}

function deal(state: GameState, round: RoundPayload): GameState {
  return {
    ...state,
    phase: "dealing",
    round,
    // Without a spin the plaque shows the stat straight away; with one it keeps
    // the previous stat until the wheel lands.
    plaque: shouldSpin(round) ? state.plaque : round.stat,
  };
}

function over(state: GameState, end: EndReason): GameState {
  return { ...state, phase: "over", end, next: null };
}

// ---------------------------------------------------------------- timings

/** How long the players are on screen before the wheel, or before the value if there's no spin. */
export function dealDelay(round: RoundPayload, timings: Timings): number {
  return shouldSpin(round) ? timings.beat : timings.hold;
}

/** How long the wheel runs. With reduced motion it lands at once. */
export function spinDelay(timings: Timings, reducedMotion: boolean): number {
  return reducedMotion ? 0 : timings.spin + timings.land;
}

/**
 * When the challenger's count-up runs, once the answer has arrived.
 *
 * It starts from zero the moment the response lands and ends at whichever is
 * later: the nominal count (`count` after the tap), or `settle` after arrival.
 * An on-time response therefore looks exactly like the plain count-up, and a
 * late one still counts for at least `settle` — the number never snaps. Until
 * the response lands, the number scrambles; it never freezes. ARCHITECTURE.md §9.
 */
export function settleWindow(
  count: CountClock,
  timings: Timings,
  reducedMotion: boolean,
): { readonly start: number; readonly end: number } | null {
  if (count.arrivedAt === null) return null;
  const start = count.arrivedAt;
  if (reducedMotion) return { start, end: start };
  return { start, end: Math.max(count.tappedAt + timings.count, start + timings.settle) };
}

/**
 * When the verdict colour shows: the same distance after the count settles as
 * the nominal timings put it (`verdict - count`). With reduced motion there's
 * no count, so it's the nominal time after the tap, or the arrival if later.
 */
export function verdictAt(count: CountClock, timings: Timings, reducedMotion: boolean): number {
  const window = settleWindow(count, timings, reducedMotion);
  if (window === null) throw new Error("verdictAt: the answer hasn't arrived");
  if (reducedMotion) return Math.max(count.tappedAt + timings.verdict, window.end);
  return window.end + Math.max(0, timings.verdict - timings.count);
}

/** From the verdict colour to the next deal, or to the game-over panel. */
export function advanceDelay(state: GameState, timings: Timings): number {
  return state.reveal?.correct === true && state.next !== null ? timings.next : timings.over;
}
