/**
 * Runs the state machine: dispatches events, and on each phase change starts
 * the timer or network call that produces the next one.
 *
 * Everything platform-specific is injected — the API, the clock, the timer,
 * reduced motion — so the whole flow runs under test in Node with fake timers.
 * The island (Game.svelte) subscribes and renders; it holds no rules.
 *
 * Only one timer is ever pending. Starting a new run bumps a generation
 * number, so a response or timer from an abandoned run is ignored.
 */

import type { Guess } from "@bt/core";
import type { GameApi } from "./api";
import { advanceDelay, dealDelay, initialState, reduce, spinDelay, verdictAt } from "./machine";
import type { GameEvent, GameState } from "./machine";
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
    this.#state = initialState(deps.best ?? 0);
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

    switch (after.phase) {
      case "starting":
        if (before.phase === "starting") return;
        api.start().then(
          (res) =>
            current() && this.#dispatch({ type: "started", runId: res.runId, round: res.round }),
          () => current() && this.#dispatch({ type: "startFailed" }),
        );
        return;

      case "dealing":
        if (after.round === null) return;
        this.#after(dealDelay(after.round, timings), { type: "dealt" });
        return;

      case "spinning":
        this.#after(spinDelay(timings, reducedMotion()), { type: "spun" });
        return;

      case "revealing": {
        if (before.phase === "awaiting") {
          const { runId, round, guess } = after;
          if (runId === null || round === null || guess === null) return;
          api.answer(runId, round.index, guess).then(
            (response) =>
              current() && this.#dispatch({ type: "answered", response, at: this.#deps.now() }),
            () => current() && this.#dispatch({ type: "answerFailed" }),
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

  #after(ms: number, event: GameEvent): void {
    this.#clearTimer();
    const generation = this.#generation;
    this.#cancelTimer = this.#deps.schedule(() => {
      this.#cancelTimer = null;
      if (generation === this.#generation) this.#dispatch(event);
    }, ms);
  }

  #clearTimer(): void {
    this.#cancelTimer?.();
    this.#cancelTimer = null;
  }
}
