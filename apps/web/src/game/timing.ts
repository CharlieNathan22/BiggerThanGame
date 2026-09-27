/**
 * The game's clock, in milliseconds.
 *
 * The values live in `styles/tokens.css` as `--dur-*` custom properties, so a
 * restyle edits one file and CSS transitions and script timers agree. At
 * runtime the island reads them from the computed style (`readTimings`); the
 * numbers below are the fallback, and a test parses tokens.css so the two
 * can't drift.
 */

export interface Timings {
  /**
   * The first deal's kick-off, the cards sliding in, before round one's
   * usual beat and spin. It doesn't wait for photos.
   */
  readonly introMin: number;
  /** Players shown, then a beat before the wheel (DESIGN.md §4). */
  readonly beat: number;
  /** No spin when the stat holds: the pause before the anchor's value shows. */
  readonly hold: number;
  /** The wheel (DESIGN.md §7). */
  readonly spin: number;
  /** From the reel stopping to the plaque's pop and the anchor's value. */
  readonly land: number;
  /** The plaque's settle pop. */
  readonly pop: number;
  /** Fraction of the spin after which the plaque takes the new tier colour. */
  readonly spinTintAt: number;
  /** The reveal count-up that masks the round trip (ARCHITECTURE.md §9). */
  readonly count: number;
  /**
   * The count-up's ease-out, as a power: the value is `1 - (1 - t)^countEase`
   * of the way at `t`. Higher brakes harder at the end.
   */
  readonly countEase: number;
  /**
   * The shortest count once the response lands. A late response still counts
   * up for this long rather than snapping to the value.
   */
  readonly settle: number;
  /** From tap to the correct/incorrect colour, when the response is on time. */
  readonly verdict: number;
  /** From the verdict colour to the next deal. */
  readonly next: number;
  /**
   * The carousel slide to the next pair: the last part of `next`, so rounds
   * take no longer. None with reduced motion.
   */
  readonly slide: number;
  /** From a run's last verdict colour to the game-over panel. */
  readonly over: number;
  /** The feedback modal's fade, in and out. None with reduced motion. */
  readonly modal: number;
  /** How long the feedback modal's "Thanks" shows before it closes itself. */
  readonly thanks: number;
  /** How long a share result note ("Copied", "Image saved") shows before it fades. */
  readonly notice: number;
  /** That note's fade out. None with reduced motion. */
  readonly noticeFade: number;
}

export const TIMINGS: Timings = {
  introMin: 1000,
  beat: 700,
  hold: 340,
  spin: 1800,
  land: 40,
  pop: 420,
  spinTintAt: 0.62,
  count: 2500,
  countEase: 3,
  settle: 380,
  verdict: 2540,
  next: 1400,
  slide: 600,
  over: 1400,
  modal: 180,
  thanks: 5000,
  notice: 5000,
  noticeFade: 300,
};

/** The custom property behind each timing. */
export const TIMING_TOKENS: Readonly<Record<keyof Timings, string>> = {
  introMin: "--dur-intro-min",
  beat: "--dur-beat",
  hold: "--dur-hold",
  spin: "--dur-spin",
  land: "--dur-land",
  pop: "--dur-pop",
  spinTintAt: "--spin-tint-at",
  count: "--dur-count",
  countEase: "--count-ease",
  settle: "--dur-settle",
  verdict: "--dur-verdict",
  next: "--dur-next",
  slide: "--dur-slide",
  over: "--dur-over",
  modal: "--dur-modal",
  thanks: "--dur-thanks",
  notice: "--dur-notice",
  noticeFade: "--dur-notice-fade",
};

/**
 * A token's value as a number: `480ms` and `0.48s` are milliseconds, a bare
 * number is taken as it is. Anything else is undefined.
 */
export function parseTokenValue(raw: string): number | undefined {
  const match = /^\s*(-?\d*\.?\d+)(ms|s)?\s*$/.exec(raw);
  if (!match) return undefined;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return match[2] === "s" ? n * 1000 : n;
}

/**
 * Timings from custom properties, via `read` (the computed style in the
 * browser). A token that is missing or unreadable keeps its fallback.
 */
export function readTimings(read: (property: string) => string): Timings {
  const out: Record<string, number> = { ...TIMINGS };
  for (const [name, property] of Object.entries(TIMING_TOKENS)) {
    const value = parseTokenValue(read(property));
    if (value !== undefined) out[name] = value;
  }
  return out as unknown as Timings;
}
