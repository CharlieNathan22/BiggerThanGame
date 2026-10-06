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
 * unpadded base64url — so neither the run nor the number can be edited.
 * Instagram Endless signs under `"challenge:endless:instagram:"` and points at
 * its own page. The
 * server issues one with every Endless run's end (run.ts), for the score that
 * run reached, and the token chain behind it means the run really got there.
 *
 * Friendly used to issue these too (signed `"challenge:" + …`) and replayed
 * the challenged run. It no longer does: its stateless scores can be inflated
 * by resending a round, which made "Beat n" misleading. Its links are refused.
 */

import type { ChallengeLink, EndlessVariantId } from "@bt/core";
import { hmacSha256, timingSafeEqual, toBase64Url } from "./hmac.js";
import { SIGNATURE_BYTES, isChallengeDateCurrent, signRunBody, verifyRunId } from "./run-id.js";

/**
 * What each Endless variant's challenge signature covers, before the run and
 * score. A link only ever checks out in the variant it was set in: Instagram
 * Endless's "Beat 12" can't be played as general Endless's.
 */
const CHALLENGE_PREFIX: Readonly<Record<EndlessVariantId, string>> = {
  endless: "challenge:endless:",
  "endless-instagram": "challenge:endless:instagram:",
};

/** A signed link challenging a friend to beat `score`, set by the Endless run `body`. */
export async function challengeLink(
  secret: string,
  body: string,
  score: number,
  variant: EndlessVariantId = "endless",
): Promise<ChallengeLink> {
  return {
    runId: await signRunBody(secret, body, variant),
    score,
    sig: await challengeSignature(secret, body, score, variant),
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
  variant: EndlessVariantId = "endless",
): Promise<ChallengeCheck> {
  const run = await verifyRunId(link.runId, secret, variant);
  if (run === undefined || run.replay) return { ok: false, reason: "invalid" };
  const expected = await challengeSignature(secret, run.body, link.score, variant);
  if (!timingSafeEqual(link.sig, expected)) return { ok: false, reason: "invalid" };
  if (!isChallengeDateCurrent(run.date, clock)) return { ok: false, reason: "expired" };
  return { ok: true, score: link.score };
}

async function challengeSignature(
  secret: string,
  body: string,
  score: number,
  variant: EndlessVariantId,
): Promise<string> {
  const mac = await hmacSha256(secret, `${CHALLENGE_PREFIX[variant]}${body}:${score}`);
  return toBase64Url(mac.subarray(0, SIGNATURE_BYTES));
}
