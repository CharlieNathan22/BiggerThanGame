/**
 * Challenge links: `/?challenge=<runId>&score=<n>&sig=<sig>`. A friend replays
 * exactly that run, framed as "Beat <n>" (DESIGN.md §13).
 *
 * `sig` signs the run and the score together — the first 16 bytes of
 * `HMAC-SHA256(RUN_SECRET, "challenge:" + origin + ":" + score)`, unpadded
 * base64url — so neither the run nor the number can be edited. The server
 * issues it with every run's end (round.ts), for the score that run reached.
 *
 * What it does and doesn't prove: Friendly is stateless, so the server signs
 * the score any answer request implies. Someone who asks a late round directly
 * can hold a signed "Beat 40" they never played. That is acceptable for a
 * leaderboard-exempt mode; Ranked's token chain (Phase 5) is what proves a
 * score was earned in order. ARCHITECTURE.md §7.
 */

import type { ChallengeLink, ChallengeStartRequest } from "@bt/core";
import { hmacSha256, timingSafeEqual, toBase64Url } from "./hmac.js";
import { SIGNATURE_BYTES, isChallengeDateCurrent, signRunBody, verifyRunId } from "./run-id.js";
import type { RunId } from "./run-id.js";

/** A signed link to replay the run `origin` (`YYYYMMDD-<uuid>`) against `score`. */
export async function challengeLink(
  secret: string,
  origin: string,
  score: number,
): Promise<ChallengeLink> {
  return {
    runId: await signRunBody(secret, origin),
    score,
    sig: await challengeSignature(secret, origin, score),
  };
}

export type ChallengeCheck =
  | { readonly ok: true; readonly run: RunId }
  | { readonly ok: false; readonly reason: "invalid" | "expired" };

/**
 * Whether a challenge link may start a replay. `invalid` when the run id isn't
 * a genuine fresh one or the signature doesn't cover this run and score;
 * `expired` when it is genuine but older than `CHALLENGE_DAYS`.
 */
export async function checkChallenge(
  secret: string,
  req: ChallengeStartRequest,
  clock: Date,
): Promise<ChallengeCheck> {
  const run = await verifyRunId(req.challenge, secret);
  // A link always names the original run; a replay id in one was never issued.
  if (run === undefined || run.replay) return { ok: false, reason: "invalid" };
  const expected = await challengeSignature(secret, run.origin, req.score);
  if (!timingSafeEqual(req.sig, expected)) return { ok: false, reason: "invalid" };
  if (!isChallengeDateCurrent(run.date, clock)) return { ok: false, reason: "expired" };
  return { ok: true, run };
}

async function challengeSignature(secret: string, origin: string, score: number): Promise<string> {
  const mac = await hmacSha256(secret, `challenge:${origin}:${score}`);
  return toBase64Url(mac.subarray(0, SIGNATURE_BYTES));
}
