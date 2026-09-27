/**
 * The challenger's number during the reveal, frame by frame.
 *
 * From the tap until the response lands the number holds at zero; once it
 * lands it counts up to the true value over `settleWindow` (machine.ts), along an
 * ease-out of power `countEase`. Pure: the
 * component calls `counterFrame` from `requestAnimationFrame` and renders the
 * result. ARCHITECTURE.md §9.
 */

import { settleWindow } from "./machine";
import type { CountClock } from "./machine";
import type { Timings } from "./timing";

export type CounterFrame =
  /** Reduced motion and no answer yet: keep the "?". */
  | { readonly kind: "hidden" }
  /** No answer yet: hold at the stat's zero, which gives nothing away. */
  | { readonly kind: "waiting" }
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
    return reducedMotion ? { kind: "hidden" } : { kind: "waiting" };
  }
  const span = window.end - window.start;
  if (span <= 0 || now >= window.end) return { kind: "done" };
  const k = Math.max(0, now - window.start) / span;
  // Ease out: most of the distance early, then a slow creep to the value.
  return { kind: "count", value: target * (1 - Math.pow(1 - k, timings.countEase)) };
}

/**
 * Formats the count-up in the final display's own shape — its prefix, unit
 * and decimals — so counting to `€100.5m` shows `€12.3m` and `€57.8m`, never
 * `€850k` or `€37.18m`. `value` is in the stat's stored units, as the round
 * sends it: millions for a fee or followers, so a `k` figure is scaled up.
 */
export function countFormat(display: string): (value: number) => string {
  const match = /^(\D*?)[\d,]+(?:\.(\d+))?(\D*)$/u.exec(display);
  if (match === null) return () => display;
  const prefix = match[1] ?? "";
  const places = (match[2] ?? "").length;
  const unit = match[3] ?? "";
  const scale = unit === "k" ? 1000 : 1;
  return (value) =>
    prefix +
    (value * scale).toLocaleString("en-GB", {
      minimumFractionDigits: places,
      maximumFractionDigits: places,
    }) +
    unit;
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
