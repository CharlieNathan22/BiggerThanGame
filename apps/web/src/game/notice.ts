/**
 * A short-lived note: the game-over panel's share result ("Copied — paste it
 * anywhere", "Image saved", or a failure). It shows for `notice`, fades out
 * over `noticeFade`, then is cleared. With reduced motion there's no fade:
 * it clears at `notice`.
 *
 * The note sits in a `role="status"` live region. It is announced when its text
 * appears; the fade keeps the same text, and clearing only removes it, which
 * screen readers don't announce. So each note is announced once.
 *
 * The clock is injected, so this runs under test in Node.
 */

import type { Timings } from "./timing";

export interface NoticeState {
  /** Empty when there's nothing to say. */
  readonly text: string;
  /** Fading out: still the same text, on its way to being cleared. */
  readonly fading: boolean;
}

export const NO_NOTICE: NoticeState = { text: "", fading: false };

export interface NoticeDeps {
  /** Runs `fn` after `ms`; returns a cancel function. */
  readonly schedule: (fn: () => void, ms: number) => () => void;
  readonly timings: () => Pick<Timings, "notice" | "noticeFade">;
  readonly reducedMotion: () => boolean;
  readonly onChange: (state: NoticeState) => void;
}

export class TimedNotice {
  #state: NoticeState = NO_NOTICE;
  #cancel: (() => void) | null = null;
  #generation = 0;
  #deps: NoticeDeps;

  constructor(deps: NoticeDeps) {
    this.#deps = deps;
  }

  get state(): NoticeState {
    return this.#state;
  }

  /**
   * Starts an action whose outcome is a note — a tap on a share button. Any
   * note on screen goes at once, and the function returned shows the outcome
   * with a fresh timer. It does nothing if the note is cleared again before
   * the outcome arrives: a new run started, or the button was tapped again.
   */
  begin(): (text: string) => void {
    this.clear();
    const generation = this.#generation;
    return (text) => {
      if (generation === this.#generation) this.#show(text);
    };
  }

  /** Clears the note now, and cancels anything waiting to show or clear one. */
  clear(): void {
    this.#generation += 1;
    this.#stop();
    this.#set(NO_NOTICE);
  }

  destroy(): void {
    this.#generation += 1;
    this.#stop();
  }

  #show(text: string): void {
    this.#stop();
    this.#set({ text, fading: false });
    if (text === "") return;
    const { notice, noticeFade } = this.#deps.timings();
    const fade = this.#deps.reducedMotion() ? 0 : noticeFade;
    this.#after(notice, () => {
      if (fade === 0) return this.#set(NO_NOTICE);
      this.#set({ text, fading: true });
      this.#after(fade, () => this.#set(NO_NOTICE));
    });
  }

  #after(ms: number, fn: () => void): void {
    this.#cancel = this.#deps.schedule(() => {
      this.#cancel = null;
      fn();
    }, ms);
  }

  #stop(): void {
    this.#cancel?.();
    this.#cancel = null;
  }

  #set(state: NoticeState): void {
    if (state.text === this.#state.text && state.fading === this.#state.fading) return;
    this.#state = state;
    this.#deps.onChange(state);
  }
}
