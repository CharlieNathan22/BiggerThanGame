/**
 * Per-mode switches that aren't about the sequence: which modes offer
 * challenge links.
 */

import type { Mode } from "./types.js";

/**
 * Whether a mode's finished runs offer a "Beat n" challenge link (DESIGN.md
 * §13). Endless only: its runs are proven by the token chain. Friendly is
 * stateless, so a score there can be inflated by resending a round, which
 * made "Beat n" unreliable; the server refuses challenge links in it. Daily
 * Ranked needs none, since everyone plays the same run.
 */
export const CHALLENGES: Readonly<Record<Mode, boolean>> = {
  friendly: false,
  endless: true,
  ranked: false,
};
