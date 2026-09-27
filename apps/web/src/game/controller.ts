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
 * while the current reveal plays out. Round one's two photos are what the
 * first deal's intro waits on: at least `introMin`, until both have loaded or
 * failed, and never more than `introMax`.
 *
 * Only one timer is ever pending. Starting a new run bumps a generation
 * number, so a response or timer from an abandoned run is ignored.
 */

import type { CardImage, Guess, RoundPayload } from "@bt/core";
import { classifyFailure } from "./api";
import type { GameApi } from "./api";
import {
  advanceDelay,
  dealDelay,
  initialState,
  newCards,
  offeredLink,
  reduce,
  retryDelay,
  spinDelay,
  verdictAt,
} from "./machine";
import type { Challenge, GameEvent, GameState } from "./machine";
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
  /** A challenge link the first run starts from. */
  readonly challenge?: Challenge | null;
  /**
   * Starts fetching a card's photo into the browser cache. The promise, if
   * any, settles when it has loaded or failed.
   */
  readonly preload?: (image: CardImage | undefined) => Promise<void> | void;
}

type Listener = (state: GameState) => void;

export class GameController {
  #state: GameState;
  #listeners = new Set<Listener>();
  #cancelTimer: (() => void) | null = null;
  #generation = 0;
  #deps: ControllerDeps;

  constructor(deps: ControllerDeps) {
    this.#deps = deps;
    this.#state = initialState(deps.best ?? 0, deps.challenge ?? null);
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

  guess(guess: Guess): void {
    this.#dispatch({ type: "guess", guess, at: this.#deps.now() });
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

      case "intro": {
        if (before.phase === "intro" || after.round === null) return;
        // Round one's photos, fetched now. The intro ends at `introMax` at the
        // latest; once they're in, at `introMin` from its start, or at once
        // if that has passed.
        const began = this.#deps.now();
        const photos = this.#preload(after.round);
        void this.#deps.preload?.(after.round.upcoming);
        this.#after(timings.introMax, { type: "introDone" });
        void photos.then(() => {
          if (!current() || this.#state.phase !== "intro") return;
          const wait = Math.max(0, timings.introMin - (this.#deps.now() - began));
          this.#after(wait, { type: "introDone" });
        });
        return;
      }

      case "dealing":
        if (after.round === null) return;
        this.#after(dealDelay(after.round, timings), { type: "dealt" });
        return;

      case "spinning":
        this.#after(spinDelay(timings, reducedMotion()), { type: "spun" });
        return;

      case "revealing": {
        if (before.phase === "awaiting" || event.type === "retry") {
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
          const at = verdictAt(after.count, timings, reducedMotion());
          this.#after(Math.max(0, at - this.#deps.now()), { type: "settled" });
        }
        return;
      }

      case "verdict":
        this.#after(advanceDelay(after, timings), { type: "advance" });
        return;

      case "idle":
      case "awaiting":
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
