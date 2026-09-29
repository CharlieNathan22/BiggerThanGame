/**
 * Challenge links, Endless only (`CHALLENGES` in @bt/core):
 * `/football-higher-or-lower/legends/endless?challenge=<runId>&score=<n>&sig=<sig>`.
 * A friend who opens one plays an ordinary fresh Endless run — its own random
 * rounds — framed as "Beat <n>" (DESIGN.md §13). The link sets the score to
 * beat, never the sequence. The server issues only the three signed parts; the
 * client builds the URL.
 *
 * `sig` signs the run and the score together — the first 16 bytes of
 * `HMAC-SHA256(RUN_SECRET, "challenge:endless:" + runBody + ":" + score)`,
 * unpadded base64url — so neither the run nor the number can be edited. The
 * server issues one with every Endless run's end (run.ts), for the score that
 * run reached, and the token chain behind it means the run really got there.
 *
 * Friendly used to issue these too (signed `"challenge:" + …`) and replayed
 * the challenged run. It no longer does: its stateless scores can be inflated
 * by resending a round, which made "Beat n" misleading. Its links are refused.
 */

import type { ChallengeLink } from "@bt/core";
import { hmacSha256, timingSafeEqual, toBase64Url } from "./hmac.js";
import { SIGNATURE_BYTES, isChallengeDateCurrent, signRunBody, verifyRunId } from "./run-id.js";

/** A signed link challenging a friend to beat `score`, set by the Endless run `body`. */
export async function challengeLink(
  secret: string,
  body: string,
  score: number,
): Promise<ChallengeLink> {
  return {
    runId: await signRunBody(secret, body, "endless"),
    score,
    sig: await challengeSignature(secret, body, score),
  };
}

export type ChallengeCheck =
  | { readonly ok: true; readonly score: number }
  | { readonly ok: false; readonly reason: "invalid" | "expired" };

/**
 * Whether a challenge link may set a score to beat. `invalid` when the run id
 * isn't a genuine Endless one or the signature doesn't cover this run and
 * score; `expired` when it is genuine but older than `CHALLENGE_DAYS`.
 */
export async function checkChallenge(
  secret: string,
  link: ChallengeLink,
  clock: Date,
): Promise<ChallengeCheck> {
  const run = await verifyRunId(link.runId, secret, "endless");
  if (run === undefined || run.replay) return { ok: false, reason: "invalid" };
  const expected = await challengeSignature(secret, run.body, link.score);
  if (!timingSafeEqual(link.sig, expected)) return { ok: false, reason: "invalid" };
  if (!isChallengeDateCurrent(run.date, clock)) return { ok: false, reason: "expired" };
  return { ok: true, score: link.score };
}

async function challengeSignature(secret: string, body: string, score: number): Promise<string> {
  const mac = await hmacSha256(secret, `challenge:endless:${body}:${score}`);
  return toBase64Url(mac.subarray(0, SIGNATURE_BYTES));
}
