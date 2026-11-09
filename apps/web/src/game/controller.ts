/**
 * Runs the state machine: dispatches events, and on each phase change starts
 * the timer or network call that produces the next one.
 *
 * Everything platform-specific is injected — the API, the clock, the timer,
 * reduced motion, the photo preloader — so the whole flow runs under test in
 * Node with fake timers. The island (Game.svelte) subscribes and renders; it
 * holds no rules.
 *
 * Photos are fetched the moment a round payload lands, never at reveal time
 * (ARCHITECTURE.md §9): each response brings one new card, and its photo loads
 * while the current reveal plays out. A run's first deal waits on round one's
 * two: after the title card the plaque holds at least `holdMin`, until both
 * have loaded or failed, and no more than `holdExtra` longer. A photo still
 * loading then develops in on its card when it arrives (Photo.svelte).
 *
 * Only one timer is ever pending. While a timed mode's question waits for the
 * player, that timer is its clock: when it runs out, the answer goes as
 * `timeout`. Starting a new run bumps a generation number, so a response or
 * timer from an abandoned run is ignored.
 *
 * In 1v1 the room drives what the API drives elsewhere: a pick is handed to
 * `onLock` as it is locked in (the page sends it to the room), and the room's
 * reveal comes in through `revealed()`, after which the API's `answer` only
 * hands over what the room already sent (game/duel/client.ts).
 */

import type {
  CardImage,
  Guess,
  NamedVariant,
  RoundPayload,
  RunEnd,
  StartResponse,
  TimedGuess,
} from "@bt/core";
import { classifyFailure } from "./api";
import type { GameApi } from "./api";
import {
  advanceDelay,
  dealDelay,
  initialState,
  wheelOf,
  newCards,
  offeredLink,
  reduce,
  retryDelay,
  slideDelay,
  slides,
  spinDelay,
  verdictAt,
} from "./machine";
import type { Challenge, GameEvent, GameMode, GameState, StreamSettings } from "./machine";
import type { StreamStarted } from "./stream/api";
import type { Timings } from "./timing";

export interface ControllerDeps {
  readonly api: GameApi;
  readonly timings: Timings;
  /** Monotonic milliseconds — `performance.now()` in the browser. */
  readonly now: () => number;
  /** Runs `fn` after `ms`; returns a cancel function. */
  readonly schedule: (fn: () => void, ms: number) => () => void;
  readonly reducedMotion: () => boolean;
  /** Best streak to show before any run. */
  readonly best?: number;
  /** Called whenever the best streak rises, to keep it (best.ts). */
  readonly saveBest?: (best: number) => void;
  /** Called once as each run ends, however it ended: the local board records it (device.ts). */
  readonly onOver?: (state: GameState) => void;
  /** A challenge link the first run starts from. */
  readonly challenge?: Challenge | null;
  /** The mode being played: whether questions have a clock. Friendly by default. */
  readonly mode?: GameMode;
  /** Endless only: the variant, when not general Endless (Instagram Endless). */
  readonly variant?: NamedVariant;
  /**
   * Starts fetching a card's photo into the browser cache. The promise, if
   * any, settles when it has loaded or failed.
   */
  readonly preload?: (image: CardImage | undefined) => Promise<void> | void;
  /**
   * 1v1: the player's pick on question `round` has been locked in, or their
   * clock has run out (`timeout`). The page sends it to the room.
   */
  readonly onLock?: (round: number, pick: TimedGuess) => void;
}

type Listener = (state: GameState) => void;

/**
 * A match's settings, when the start was a match's (stream/api.ts and
 * duel/client.ts add the pool), and in 1v1 when the room closes round one.
 */
function streamOf(res: StartResponse): {
  readonly stream?: StreamSettings;
  readonly capAt?: number;
} {
  const r = res as Partial<StreamStarted> & { readonly capAt?: number };
  return {
    ...(r.pool !== undefined && r.questions !== undefined && r.limit !== undefined
      ? { stream: { pool: r.pool, questions: r.questions, limit: r.limit } }
      : {}),
    ...(r.capAt !== undefined ? { capAt: r.capAt } : {}),
  };
}

export class GameController {
  #state: GameState;
  #listeners = new Set<Listener>();
  #cancelTimer: (() => void) | null = null;
  #generation = 0;
  #deps: ControllerDeps;
  /** Round one's photos, settling when both have loaded or failed. */
  #roundOnePhotos: Promise<void> = Promise.resolve();

  constructor(deps: ControllerDeps) {
    this.#deps = deps;
    this.#state = initialState(
      deps.best ?? 0,
      deps.challenge ?? null,
      deps.mode ?? "friendly",
      deps.variant,
    );
  }

  get state(): GameState {
    return this.#state;
  }

  /** Calls `listener` now and after every change. Returns an unsubscribe. */
  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => this.#listeners.delete(listener);
  }

  /** Start a run — from the start panel, or "Play again". */
  start(): void {
    if (this.#state.phase !== "idle" && this.#state.phase !== "over") return;
    this.#generation++;
    this.#clearTimer();
    this.#dispatch({ type: "start" });
  }

  /** A pick: the answer, or in Twitch Mode the streamer's pick, locked in until voting closes. */
  guess(guess: Guess): void {
    this.#dispatch({ type: "guess", guess, at: this.#deps.now() });
  }

  /** Twitch Mode's "End voting": closes the window early, once the rules allow (`canEndVoting`). */
  endVoting(): void {
    this.#dispatch({ type: "close", at: this.#deps.now() });
  }

  /** 1v1: the room has revealed the question on screen. Its reveal is the API's to hand over. */
  revealed(): void {
    this.#dispatch({ type: "revealed", at: this.#deps.now() });
  }

  /** 1v1: the match is over with nothing to reveal (the other player forfeited). */
  stop(end: RunEnd): void {
    this.#dispatch({ type: "stopped", end });
  }

  /**
   * Daily Ranked: carries on a run after a refresh, at the question the
   * server hands back (`POST /api/run/resume`), straight to the cards. 1v1:
   * the same on coming back to a match, with its settings and the pick the
   * room already holds.
   */
  resume(run: {
    readonly runId: string;
    readonly round: RoundPayload;
    readonly results: readonly boolean[];
    readonly remainingMs: number | null;
    readonly stream?: StreamSettings;
    readonly locked?: TimedGuess;
  }): void {
    if (this.#state.phase !== "idle" && this.#state.phase !== "over") return;
    this.#generation++;
    this.#clearTimer();
    // Both cards are new to this page: their photos load as the cards come in.
    void this.#deps.preload?.(run.round.anchor.image);
    void this.#deps.preload?.(run.round.challenger.image);
    this.#dispatch({ type: "resumed", ...run, at: this.#deps.now() });
  }

  /** A tap or a key during the title card or the hold: straight to the cards. */
  skip(): void {
    this.#dispatch({ type: "skip" });
  }

  /** Stops every pending timer and ignores any response still in flight. */
  destroy(): void {
    this.#generation++;
    this.#clearTimer();
    this.#listeners.clear();
  }

  #dispatch(event: GameEvent): void {
    const before = this.#state;
    const after = reduce(before, event);
    if (after === before) return;
    this.#state = after;
    for (const listener of this.#listeners) listener(after);
    this.#effects(before, after, event);
  }

  #effects(before: GameState, after: GameState, event: GameEvent): void {
    const { api, timings, reducedMotion } = this.#deps;
    const generation = this.#generation;
    const current = (): boolean => generation === this.#generation;

    if (after.phase !== before.phase) this.#clearTimer();
    if (after.best > before.best) this.#deps.saveBest?.(after.best);
    if (after.phase === "over" && before.phase !== "over") this.#deps.onOver?.(after);
    // 1v1: a pick just locked in goes to the room. Not one the room handed back on a return.
    if (
      after.mode === "duel" &&
      after.locked !== null &&
      before.locked === null &&
      event.type !== "resumed" &&
      after.round !== null
    ) {
      this.#deps.onLock?.(after.round.index, after.locked);
    }

    if (event.type === "answered" && "next" in event.response) {
      void this.#preload(event.response.next);
    }
    // Once a round is on screen (round one from its intro), the photo of the
    // challenger after it: a whole round's head start on a cold resize
    // (ARCHITECTURE.md §9).
    // Round one's comes from the intro case below, after its own two photos.
    if (after.phase === "dealing" && before.phase !== "dealing" && before.phase !== "intro") {
      void this.#deps.preload?.(after.round?.upcoming);
    }

    // A request that has to go again: wait, then retry.
    if (event.type === "startFailed" || event.type === "answerFailed") {
      const wait = retryDelay(after, this.#deps.now());
      if (wait !== null) this.#after(wait, () => ({ type: "retry", at: this.#deps.now() }));
      return;
    }

    switch (after.phase) {
      case "starting":
        if (before.phase === "starting" && event.type !== "retry") return;
        api.start(offeredLink(after)).then(
          (res) =>
            current() &&
            this.#dispatch({
              type: "started",
              runId: res.runId,
              round: res.round,
              ...(res.challenge !== undefined ? { challenge: res.challenge } : {}),
              ...streamOf(res),
            }),
          (err: unknown) =>
            current() &&
            this.#dispatch({
              type: "startFailed",
              failure: classifyFailure(err),
              at: this.#deps.now(),
            }),
        );
        return;

      case "title":
        if (before.phase === "title" || after.round === null) return;
        // Round one's photos, then the next round's challenger's, fetched
        // while the title card plays; the hold after it waits on the first two.
        this.#roundOnePhotos = this.#preload(after.round);
        void this.#deps.preload?.(after.round.upcoming);
        this.#after(after.repeat ? timings.titleQuick : timings.title, { type: "titled" });
        return;

      case "holding": {
        if (before.phase === "holding") return;
        // At least `holdMin`; longer while round one's photos load, but no
        // more than `holdExtra` longer.
        const began = this.#deps.now();
        this.#after(timings.holdMin + timings.holdExtra, { type: "held" });
        void this.#roundOnePhotos.then(() => {
          if (!current() || this.#state.phase !== "holding") return;
          const wait = Math.max(0, timings.holdMin - (this.#deps.now() - began));
          this.#after(wait, { type: "held" });
        });
        return;
      }

      case "intro":
        if (before.phase === "intro") return;
        this.#after(timings.introMin, { type: "introDone" });
        return;

      case "dealing":
        if (after.round === null) return;
        this.#after(dealDelay(after.round, timings, wheelOf(after)), () => ({
          type: "dealt",
          at: this.#deps.now(),
        }));
        return;

      case "spinning":
        this.#after(spinDelay(timings), () => ({
          type: "spun",
          at: this.#deps.now(),
        }));
        return;

      case "awaiting":
        // A timed mode's clock: out of time, the answer goes as a timeout.
        if (after.clock !== null && before.phase !== "awaiting") {
          this.#after(after.clock.limitMs, () => ({ type: "timeout", at: this.#deps.now() }));
        }
        return;

      case "revealing": {
        if (before.phase !== "revealing" || event.type === "retry") {
          const { runId, round, guess } = after;
          if (runId === null || round === null || guess === null) return;
          api.answer(runId, round.index, guess).then(
            (response) =>
              current() && this.#dispatch({ type: "answered", response, at: this.#deps.now() }),
            (err: unknown) =>
              current() &&
              this.#dispatch({
                type: "answerFailed",
                failure: classifyFailure(err),
                at: this.#deps.now(),
              }),
          );
          return;
        }
        if (event.type === "answered" && after.count !== null) {
          const at = verdictAt(after.count, timings);
          this.#after(Math.max(0, at - this.#deps.now()), { type: "settled" });
        }
        return;
      }

      case "verdict":
        // A right answer slides to the next pair in the last part of the gap.
        if (slides(after, reducedMotion())) {
          this.#after(slideDelay(timings), { type: "slide" });
        } else {
          this.#after(advanceDelay(after, timings), { type: "advance" });
        }
        return;

      case "sliding":
        this.#after(Math.min(timings.slide, timings.next), { type: "advance" });
        return;

      case "idle":
      case "over":
        return;
    }
  }

  /** Fetches the round's new cards' photos; settles when all have loaded or failed. */
  #preload(round: RoundPayload): Promise<void> {
    const { preload } = this.#deps;
    if (preload === undefined) return Promise.resolve();
    return Promise.all(newCards(round).map((card) => preload(card.image))).then(() => {});
  }

  /** Dispatches `event` after `ms`; a function is called then, to read the clock. */
  #after(ms: number, event: GameEvent | (() => GameEvent)): void {
    this.#clearTimer();
    const generation = this.#generation;
    this.#cancelTimer = this.#deps.schedule(() => {
      this.#cancelTimer = null;
      if (generation !== this.#generation) return;
      this.#dispatch(typeof event === "function" ? event() : event);
    }, ms);
  }

  #clearTimer(): void {
    this.#cancelTimer?.();
    this.#cancelTimer = null;
  }
}
