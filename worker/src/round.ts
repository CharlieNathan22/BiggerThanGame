/**
 * `POST /api/round/next`, as a pure function of the request.
 *
 * Friendly only, and stateless: no storage, no tokens. Every call derives the
 * seed from the run id and replays the run from round one (ARCHITECTURE.md §7,
 * §8). The server decides correctness and releases the challenger's figure only
 * after the guess.
 *
 * Deck, images, secret, clock, uuid and the rate limits are all injected, so
 * tests drive this directly in Node with no Worker runtime.
 */

import { MAX_ROUNDS, buildRun } from "@bt/core";
import type {
  AnswerRequest,
  AnswerResponse,
  ApiError,
  ContinueResponse,
  EndResponse,
  Player,
  StartResponse,
} from "@bt/core";
import { isCorrect, toReveal, toRoundPayload } from "./payload.js";
import type { ImageLookup } from "./payload.js";
import type { RateDecision } from "./rate-limit.js";
import { isRunDateCurrent, mintRunId, parseRunId, verifyRunId } from "./run-id.js";
import { friendlySeed } from "./seed.js";
import { isAnswer, parseNextRoundRequest } from "./validate.js";

export interface RoundContext {
  readonly deck: readonly Player[];
  readonly images: ImageLookup;
  readonly secret: string;
  /** Server time. Used to mint run ids and to bound which runs are answered. */
  readonly clock: () => Date;
  readonly uuid: () => string;
  /** Rate limits that depend on what the request is. Absent: nothing is limited. */
  readonly limits?: RoundLimits;
}

/**
 * The limits the handler applies once it knows what the request is: run
 * starts per IP, and answers per run. app.ts wires them to the bindings.
 */
export interface RoundLimits {
  start(): Promise<RateDecision>;
  /** `run` is the run id's verified body, `YYYYMMDD-<uuid>`. */
  answer(run: string): Promise<RateDecision>;
}

export type RoundResult =
  | { readonly status: 200; readonly body: StartResponse | AnswerResponse }
  | { readonly status: 400 | 503; readonly body: ApiError }
  | { readonly status: 429; readonly body: ApiError; readonly retryAfter: number };

export async function handleNextRound(body: unknown, ctx: RoundContext): Promise<RoundResult> {
  const parsed = parseNextRoundRequest(body);
  if (!parsed.ok) return badRequest(parsed.detail);
  return isAnswer(parsed.value) ? answer(parsed.value, ctx) : start(ctx);
}

async function start(ctx: RoundContext): Promise<RoundResult> {
  const limited = await ctx.limits?.start();
  if (limited?.ok === false) return rateLimited(limited.retryAfter);

  const runId = await mintRunId(ctx.clock(), ctx.uuid(), ctx.secret);
  const run = parseRunId(runId);
  if (run === undefined) throw new Error(`minted a malformed run id: ${runId}`);
  const now = run.date;

  const seed = await friendlySeed(ctx.secret, run.body);
  const first = buildRun({ deck: ctx.deck, seed, mode: "friendly", now, maxRounds: 1 })[0];
  if (first === undefined) {
    return { status: 503, body: { error: "unavailable", detail: "the deck cannot deal a round" } };
  }

  const response: StartResponse = { runId, round: toRoundPayload(first, now, ctx.images) };
  return { status: 200, body: response };
}

async function answer(req: AnswerRequest, ctx: RoundContext): Promise<RoundResult> {
  const run = await verifyRunId(req.runId, ctx.secret);
  if (run === undefined) return badRequest("runId is not one this server issued");
  // `now` is the run's date, fixed for the whole run, never the server clock.
  const now = run.date;
  if (!isRunDateCurrent(now, ctx.clock())) return badRequest("runId is out of date");

  const limited = await ctx.limits?.answer(run.body);
  if (limited?.ok === false) return rateLimited(limited.retryAfter);

  const seed = await friendlySeed(ctx.secret, run.body);
  // One past the answered round, so the response can carry the next question.
  const maxRounds = Math.min(req.round + 1, MAX_ROUNDS);
  const rounds = buildRun({ deck: ctx.deck, seed, mode: "friendly", now, maxRounds });

  const round = rounds[req.round - 1];
  if (round === undefined) return badRequest(`this run has no round ${req.round}`);

  const correct = isCorrect(round, now, req.guess);
  const reveal = toReveal(round, now, correct);

  if (!correct) {
    const response: EndResponse = { reveal, end: "wrong" };
    return { status: 200, body: response };
  }

  const next = req.round < MAX_ROUNDS ? rounds[req.round] : undefined;
  if (next === undefined) {
    const response: EndResponse = { reveal, end: "deck-exhausted" };
    return { status: 200, body: response };
  }

  const response: ContinueResponse = { reveal, next: toRoundPayload(next, now, ctx.images) };
  return { status: 200, body: response };
}

function badRequest(detail: string): RoundResult {
  return { status: 400, body: { error: "bad_request", detail } };
}

function rateLimited(retryAfter: number): RoundResult {
  return { status: 429, body: { error: "rate_limited" }, retryAfter };
}
