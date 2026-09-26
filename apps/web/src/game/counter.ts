/**
 * The challenger's number during the reveal, frame by frame.
 *
 * From the tap until the response lands the number scrambles; once it lands it
 * counts up to the true value over `settleWindow` (machine.ts). Pure: the
 * component calls `counterFrame` from `requestAnimationFrame` and renders the
 * result. ARCHITECTURE.md §9.
 */

import { STATS } from "@bt/core";
import type { StatKey } from "@bt/core";
import { settleWindow } from "./machine";
import type { CountClock } from "./machine";
import type { Timings } from "./timing";

export type CounterFrame =
  /** Reduced motion and no answer yet: keep the "?" rather than scramble. */
  | { readonly kind: "hidden" }
  /** No answer yet. `tick` changes every `timings.scramble` ms; draw a new number when it does. */
  | { readonly kind: "scramble"; readonly tick: number }
  /** Counting up towards the answer. */
  | { readonly kind: "count"; readonly value: number }
  /** Settled: show the server's display string exactly. */
  | { readonly kind: "done" };

export function counterFrame(
  count: CountClock,
  target: number | null,
  now: number,
  timings: Timings,
  reducedMotion: boolean,
): CounterFrame {
  const window = settleWindow(count, timings, reducedMotion);
  if (window === null || target === null) {
    if (reducedMotion) return { kind: "hidden" };
    const elapsed = Math.max(0, now - count.tappedAt);
    return { kind: "scramble", tick: Math.floor(elapsed / Math.max(1, timings.scramble)) };
  }
  const span = window.end - window.start;
  const k = span <= 0 ? 1 : Math.min(1, Math.max(0, (now - window.start) / span));
  if (k >= 1) return { kind: "done" };
  // Ease-out cubic, as the prototype's count-up.
  return { kind: "count", value: target * (1 - Math.pow(1 - k, 3)) };
}

/**
 * A stand-in number while the answer is in flight, from a random draw in
 * [0, 1). It says nothing about the hidden value: it's scaled from the anchor's
 * figure, which is already on screen.
 */
export function scrambleValue(anchorValue: number, random: number): number {
  return random * Math.max(anchorValue * 2, 10);
}

/** An in-between figure, formatted as the stat formats its real values. */
export function formatFigure(stat: StatKey, value: number): string {
  return STATS[stat].format(value);
}

/**
 * A display string split for styling: `"€77.5m"` → `€77.5` and a smaller `m`,
 * as the prototype sets the unit. Figures with no trailing unit have no suffix.
 */
export function splitDisplay(display: string): { readonly main: string; readonly suffix: string } {
  const match = /^(.*\d)([^\d\s]+)$/u.exec(display);
  return match
    ? { main: match[1] ?? display, suffix: match[2] ?? "" }
    : { main: display, suffix: "" };
}
