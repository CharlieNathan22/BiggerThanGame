/**
 * Strict request parsing for `POST /api/round/next`.
 *
 * Hand-written rather than zod: the Worker bundle stays small, and the shapes
 * are two flat objects. Anything unexpected — an unknown mode, an extra key, a
 * round that isn't a positive integer — is a 400, never a best guess.
 */

import { MAX_ROUNDS } from "@bt/core";
import type { AnswerRequest, Guess, NextRoundRequest } from "@bt/core";
import { runDate } from "./run-id.js";

export type Parsed<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly detail: string };

const GUESSES: readonly Guess[] = ["higher", "lower"];
const START_KEYS = ["mode"];
const ANSWER_KEYS = ["guess", "mode", "round", "runId"];

export function parseNextRoundRequest(body: unknown): Parsed<NextRoundRequest> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail("body must be a JSON object");
  }
  const record = body as Record<string, unknown>;
  if (record.mode !== "friendly") return fail('mode must be "friendly"');

  const keys = Object.keys(record).sort();
  if (sameKeys(keys, START_KEYS)) return { ok: true, value: { mode: "friendly" } };
  if (!sameKeys(keys, ANSWER_KEYS)) {
    return fail("expected { mode } to start, or { mode, runId, round, guess } to answer");
  }

  const { runId, round, guess } = record;
  if (typeof runId !== "string" || runDate(runId) === undefined) {
    return fail("runId is malformed");
  }
  if (typeof round !== "number" || !Number.isInteger(round) || round < 1 || round > MAX_ROUNDS) {
    return fail(`round must be an integer from 1 to ${MAX_ROUNDS}`);
  }
  if (typeof guess !== "string" || !(GUESSES as readonly string[]).includes(guess)) {
    return fail('guess must be "higher" or "lower"');
  }

  const answer: AnswerRequest = { mode: "friendly", runId, round, guess: guess as Guess };
  return { ok: true, value: answer };
}

export function isAnswer(req: NextRoundRequest): req is AnswerRequest {
  return "runId" in req;
}

function sameKeys(sorted: readonly string[], expected: readonly string[]): boolean {
  return sorted.length === expected.length && sorted.every((k, i) => k === expected[i]);
}

function fail(detail: string): Parsed<never> {
  return { ok: false, detail };
}
