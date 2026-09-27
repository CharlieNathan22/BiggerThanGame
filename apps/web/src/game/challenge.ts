/**
 * Challenge links on the client: reading one from the game page's URL, and
 * writing one for the player to share:
 * `/football-higher-or-lower/legends/friendly?challenge=<runId>&score=<n>&sig=<sig>`.
 *
 * The client can't tell a genuine link from a forged one — only the server
 * holds the secret — so this checks shape only. A link that is plainly broken
 * (a parameter missing or mangled) never reaches the server: the run starts
 * fresh with the same polite note the server's refusal gets.
 */

import { MAX_ROUNDS } from "@bt/core";
import type { ChallengeLink } from "@bt/core";
import { FRIENDLY_PATH } from "../lib/paths";

export const CHALLENGE_PARAMS = ["challenge", "score", "sig"] as const;

/** Generous bounds on the parts, so a truncated or padded link is caught here. */
const RUN_ID = /^\d{8}-[0-9a-f-]{36}\.[A-Za-z0-9_-]{22}$/;
const SIG = /^[A-Za-z0-9_-]{22}$/;

/**
 * What the URL says: no challenge, a well-formed one to try, or one too
 * broken to send.
 */
export type ChallengeParam =
  | { readonly kind: "none" }
  | { readonly kind: "link"; readonly link: ChallengeLink }
  | { readonly kind: "broken" };

export function readChallenge(search: string): ChallengeParam {
  const params = new URLSearchParams(search);
  if (!CHALLENGE_PARAMS.some((name) => params.has(name))) return { kind: "none" };
  const runId = params.get("challenge") ?? "";
  const scoreText = params.get("score") ?? "";
  const sig = params.get("sig") ?? "";
  const score = /^\d{1,2}$/.test(scoreText) ? Number(scoreText) : NaN;
  if (!RUN_ID.test(runId) || !SIG.test(sig) || !(score >= 0 && score <= MAX_ROUNDS)) {
    return { kind: "broken" };
  }
  return { kind: "link", link: { runId, score, sig } };
}

/** The shareable URL for `link`: the game page on `site` (an origin, no trailing slash). */
export function challengeUrl(site: string, link: ChallengeLink): string {
  const params = new URLSearchParams({
    challenge: link.runId,
    score: String(link.score),
    sig: link.sig,
  });
  return `${site}${FRIENDLY_PATH}?${params.toString()}`;
}

/** `search` without the challenge parameters, for `history.replaceState` once a link is used. */
export function withoutChallenge(search: string): string {
  const params = new URLSearchParams(search);
  for (const name of CHALLENGE_PARAMS) params.delete(name);
  const rest = params.toString();
  return rest === "" ? "" : `?${rest}`;
}
