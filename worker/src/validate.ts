/**
 * Strict request parsing for `POST /api/round/next`.
 *
 * Hand-written rather than zod: the Worker bundle stays small, and the shapes
 * are two flat objects. Anything unexpected — an unknown mode, an extra key, a
 * round that isn't a positive integer — is a 400, never a best guess.
 *
 * This checks the run id's shape only. Whether the server signed it needs the
 * secret, and is checked in round.ts.
 *
 * A challenge start is held to its types here, but not its contents: a link
 * that has been mangled on its way through a chat app still starts a run, a
 * fresh one, with a note saying the link didn't check out (challenge.ts).
 */

import { roundCap } from "@bt/core";
import type { AnswerRequest, ChallengeStartRequest, Guess, NextRoundRequest } from "@bt/core";
import { parseRunId } from "./run-id.js";

export type Parsed<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly detail: string };

const GUESSES: readonly Guess[] = ["higher", "lower"];
const START_KEYS = ["mode"];
const CHALLENGE_KEYS = ["challenge", "mode", "score", "sig"];
const ANSWER_KEYS = ["guess", "mode", "round", "runId"];

/** Friendly's last round, and the highest score a Friendly run can reach. */
const FRIENDLY_CAP = roundCap("friendly");

/** Far past a real run id (84 characters) or signature (22): anything longer is not a link. */
const MAX_CHALLENGE_FIELD = 128;

export function parseNextRoundRequest(body: unknown): Parsed<NextRoundRequest> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail("body must be a JSON object");
  }
  const record = body as Record<string, unknown>;
  if (record.mode !== "friendly") return fail('mode must be "friendly"');

  const keys = Object.keys(record).sort();
  if (sameKeys(keys, START_KEYS)) return { ok: true, value: { mode: "friendly" } };
  if (sameKeys(keys, CHALLENGE_KEYS)) return parseChallengeStart(record);
  if (!sameKeys(keys, ANSWER_KEYS)) {
    return fail(
      "expected { mode } to start, { mode, challenge, score, sig } to replay a challenge, " +
        "or { mode, runId, round, guess } to answer",
    );
  }

  const { runId, round, guess } = record;
  if (typeof runId !== "string" || parseRunId(runId) === undefined) {
    return fail("runId is malformed");
  }
  if (typeof round !== "number" || !Number.isInteger(round) || round < 1 || round > FRIENDLY_CAP) {
    return fail(`round must be an integer from 1 to ${FRIENDLY_CAP}`);
  }
  if (typeof guess !== "string" || !(GUESSES as readonly string[]).includes(guess)) {
    return fail('guess must be "higher" or "lower"');
  }

  const answer: AnswerRequest = { mode: "friendly", runId, round, guess: guess as Guess };
  return { ok: true, value: answer };
}

function parseChallengeStart(record: Record<string, unknown>): Parsed<ChallengeStartRequest> {
  const { challenge, score, sig } = record;
  if (typeof challenge !== "string" || challenge.length > MAX_CHALLENGE_FIELD) {
    return fail("challenge must be a run id");
  }
  if (typeof score !== "number" || !Number.isInteger(score) || score < 0 || score > FRIENDLY_CAP) {
    return fail(`score must be an integer from 0 to ${FRIENDLY_CAP}`);
  }
  if (typeof sig !== "string" || sig.length > MAX_CHALLENGE_FIELD) {
    return fail("sig must be a signature");
  }
  return { ok: true, value: { mode: "friendly", challenge, score, sig } };
}

export function isAnswer(req: NextRoundRequest): req is AnswerRequest {
  return "runId" in req;
}

export function isChallengeStart(req: NextRoundRequest): req is ChallengeStartRequest {
  return "challenge" in req;
}

function sameKeys(sorted: readonly string[], expected: readonly string[]): boolean {
  return sorted.length === expected.length && sorted.every((k, i) => k === expected[i]);
}

function fail(detail: string): Parsed<never> {
  return { ok: false, detail };
}
