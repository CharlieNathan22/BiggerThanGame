/**
 * `POST /api/round/next`, as a pure function of the request.
 *
 * Friendly only, and stateless: no storage, no tokens. Every call derives the
 * seed from the run id and replays the run from round one (ARCHITECTURE.md §7,
 * §8). The server decides correctness and releases the challenger's figure only
 * after the guess.
 *
 * Deck, images, secret, clock and uuid are all injected, so tests drive this
 * directly in Node with no Worker runtime.
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
import { isRunDateCurrent, mintRunId, runDate } from "./run-id.js";
import { friendlySeed } from "./seed.js";
import { isAnswer, parseNextRoundRequest } from "./validate.js";

export interface RoundContext {
  readonly deck: readonly Player[];
  readonly images: ImageLookup;
  readonly secret: string;
  /** Server time. Used to mint run ids and to bound which runs are answered. */
  readonly clock: () => Date;
  readonly uuid: () => string;
}

export type RoundResult =
  | { readonly status: 200; readonly body: StartResponse | AnswerResponse }
  | { readonly status: 400 | 503; readonly body: ApiError };

export async function handleNextRound(body: unknown, ctx: RoundContext): Promise<RoundResult> {
  const parsed = parseNextRoundRequest(body);
  if (!parsed.ok) return badRequest(parsed.detail);
  return isAnswer(parsed.value) ? answer(parsed.value, ctx) : start(ctx);
}

async function start(ctx: RoundContext): Promise<RoundResult> {
  const runId = mintRunId(ctx.clock(), ctx.uuid());
  const now = runDate(runId);
  if (now === undefined) throw new Error(`minted a malformed run id: ${runId}`);

  const seed = await friendlySeed(ctx.secret, runId);
  const first = buildRun({ deck: ctx.deck, seed, now, maxRounds: 1 })[0];
  if (first === undefined) {
    return { status: 503, body: { error: "unavailable", detail: "the deck cannot deal a round" } };
  }

  const response: StartResponse = { runId, round: toRoundPayload(first, now, ctx.images) };
  return { status: 200, body: response };
}

async function answer(req: AnswerRequest, ctx: RoundContext): Promise<RoundResult> {
  // `now` is the run's date, fixed for the whole run, never the server clock.
  const now = runDate(req.runId);
  if (now === undefined) return badRequest("runId is malformed");
  if (!isRunDateCurrent(now, ctx.clock())) return badRequest("runId is out of date");

  const seed = await friendlySeed(ctx.secret, req.runId);
  // One past the answered round, so the response can carry the next question.
  const maxRounds = Math.min(req.round + 1, MAX_ROUNDS);
  const rounds = buildRun({ deck: ctx.deck, seed, now, maxRounds });

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
