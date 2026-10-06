/**
 * Challenge links on the client: reading one from the game page's URL, and
 * writing one for the player to share. Endless only (`CHALLENGES` in
 * @bt/core):
 * `/football-higher-or-lower/legends/endless?challenge=<runId>&score=<n>&sig=<sig>`.
 * A link sets the score to beat; the friend plays a fresh run of their own.
 *
 * The client can't tell a genuine link from a forged one — only the server
 * holds the secret — so this checks shape only. A link that is plainly broken
 * (a parameter missing or mangled) never reaches the server: the run starts
 * as a plain one with the same polite note the server's refusal gets.
 *
 * Friendly used to have challenge links too. One arriving there now is
 * `retired`: never sent, with a note that it has expired.
 *
 * Each Endless variant's links open its own page (`PLAY_PATHS`): Instagram
 * Endless's "Beat n" is played on Instagram Endless.
 */

import { CHALLENGES, roundCap } from "@bt/core";
import type { ChallengeLink } from "@bt/core";
import type { GameMode } from "./machine";
import { PLAY_PATHS } from "./variant";
import type { PlayId } from "./variant";

export const CHALLENGE_PARAMS = ["challenge", "score", "sig"] as const;

/** Generous bounds on the parts, so a truncated or padded link is caught here. */
const RUN_ID = /^\d{8}-[0-9a-f-]{36}\.[A-Za-z0-9_-]{22}$/;
const SIG = /^[A-Za-z0-9_-]{22}$/;

/**
 * What the URL says: no challenge, a well-formed one to try, one too broken to
 * send, or (in a mode without challenges) one from before they moved.
 */
export type ChallengeParam =
  | { readonly kind: "none" }
  | { readonly kind: "link"; readonly link: ChallengeLink }
  | { readonly kind: "broken" }
  | { readonly kind: "retired" };

/** A score above `mode`'s cap (150 in Endless) can't have been played, so the link is broken. */
export function readChallenge(search: string, mode: GameMode): ChallengeParam {
  const params = new URLSearchParams(search);
  if (!CHALLENGE_PARAMS.some((name) => params.has(name))) return { kind: "none" };
  if (!CHALLENGES[mode]) return { kind: "retired" };
  const runId = params.get("challenge") ?? "";
  const scoreText = params.get("score") ?? "";
  const sig = params.get("sig") ?? "";
  const score = /^\d{1,3}$/.test(scoreText) ? Number(scoreText) : NaN;
  if (!RUN_ID.test(runId) || !SIG.test(sig) || !(score >= 0 && score <= roundCap(mode))) {
    return { kind: "broken" };
  }
  return { kind: "link", link: { runId, score, sig } };
}

/** The shareable URL for `link`: `play`'s game page on `site` (an origin, no trailing slash). */
export function challengeUrl(site: string, link: ChallengeLink, play: PlayId = "endless"): string {
  const params = new URLSearchParams({
    challenge: link.runId,
    score: String(link.score),
    sig: link.sig,
  });
  return `${site}${PLAY_PATHS[play]}?${params.toString()}`;
}

/** `search` without the challenge parameters, for `history.replaceState` once a link is used. */
export function withoutChallenge(search: string): string {
  const params = new URLSearchParams(search);
  for (const name of CHALLENGE_PARAMS) params.delete(name);
  const rest = params.toString();
  return rest === "" ? "" : `?${rest}`;
}
