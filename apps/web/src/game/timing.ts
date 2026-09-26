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
   * The shortest count once the response lands. A late response still counts
   * up for this long rather than snapping to the value.
   */
  readonly settle: number;
  /** How often the scrambling number changes while the response is in flight. */
  readonly scramble: number;
  /** From tap to the correct/incorrect colour, when the response is on time. */
  readonly verdict: number;
  /** From the verdict colour to the next deal. */
  readonly next: number;
  /** From a run's last verdict colour to the game-over panel. */
  readonly over: number;
}

export const TIMINGS: Timings = {
  beat: 480,
  hold: 340,
  spin: 1300,
  land: 40,
  pop: 420,
  spinTintAt: 0.62,
  count: 640,
  settle: 240,
  scramble: 60,
  verdict: 680,
  next: 760,
  over: 820,
};

/** The custom property behind each timing. */
export const TIMING_TOKENS: Readonly<Record<keyof Timings, string>> = {
  beat: "--dur-beat",
  hold: "--dur-hold",
  spin: "--dur-spin",
  land: "--dur-land",
  pop: "--dur-pop",
  spinTintAt: "--spin-tint-at",
  count: "--dur-count",
  settle: "--dur-settle",
  scramble: "--dur-scramble",
  verdict: "--dur-verdict",
  next: "--dur-next",
  over: "--dur-over",
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
