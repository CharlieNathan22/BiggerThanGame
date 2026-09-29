/**
 * `POST /api/round/next`, as a pure function of the request.
 *
 * Friendly only, and stateless: no storage, no tokens. Every call derives the
 * seed from the run id and replays the run from round one (ARCHITECTURE.md §7,
 * §8). The server decides correctness and releases the challenger's figure only
 * after the guess.
 *
 * Friendly is a 20-question challenge (`WIN_ROUNDS`): answering the last round
 * correctly ends the run, won.
 *
 * Challenge links are off in Friendly (`CHALLENGES`, @bt/core): a stateless
 * score can be inflated by resending a round, so "Beat n" would mislead. A
 * start carrying one is refused, as is a replay id from before they moved to
 * Endless (validate.ts, run-id.ts), and an end carries no link.
 *
 * Deck, images, secret, clock, uuid and the rate limits are all injected, so
 * tests drive this directly in Node with no Worker runtime. So is `record`,
 * which receives a `GameEvent` for each run start, each judged answer and each
 * run end (analytics.ts); app.ts writes them to Analytics Engine and Workers Logs.
 */

import { WIN_ROUNDS, buildRun, roundCap } from "@bt/core";
import type {
  AnswerRequest,
  AnswerResponse,
  ApiError,
  ContinueResponse,
  EndResponse,
  Player,
  RunEnd,
  StartRequest,
  StartResponse,
} from "@bt/core";
import { finalRound, pairRankDistance } from "./analytics.js";
import type { GameEvent } from "./analytics.js";
import { isCorrect, toReveal, toRoundPayload } from "./payload.js";
import type { ImageLookup } from "./payload.js";
import type { RateDecision } from "./rate-limit.js";
import { isRunAnswerable, mintRunId, parseRunId, verifyRunId } from "./run-id.js";
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
  /**
   * Told what happened, once the response is settled: a run began, an answer
   * was judged, a run ended. Must not throw; app.ts's recorder swallows its
   * own failures. Absent: nothing is recorded.
   */
  readonly record?: (event: GameEvent) => void;
}

/**
 * The limits the handler applies once it knows what the request is: run
 * starts per IP, and answers per run. app.ts wires them to the bindings.
 */
export interface RoundLimits {
  start(): Promise<RateDecision>;
  /** `run` is the run id's verified body: `YYYYMMDD-<uuid>`. */
  answer(run: string): Promise<RateDecision>;
}

export type RoundResult =
  | { readonly status: 200; readonly body: StartResponse | AnswerResponse }
  | { readonly status: 400 | 503; readonly body: ApiError }
  | {
      readonly status: 429;
      readonly body: ApiError;
      readonly retryAfter: number;
      /** Which limit said no, for the log line. Never in the response. */
      readonly limit: "starts" | "answers";
    };

export async function handleNextRound(body: unknown, ctx: RoundContext): Promise<RoundResult> {
  const parsed = parseNextRoundRequest(body);
  if (!parsed.ok) return badRequest(parsed.detail);
  return isAnswer(parsed.value) ? answer(parsed.value, ctx) : start(parsed.value, ctx);
}

async function start(_req: StartRequest, ctx: RoundContext): Promise<RoundResult> {
  const limited = await ctx.limits?.start();
  if (limited?.ok === false) return rateLimited(limited.retryAfter, "starts");

  const runId = await mintRunId(ctx.clock(), ctx.uuid(), ctx.secret);
  const run = parseRunId(runId);
  // Never the id itself in the message: it reaches the logs.
  if (run === undefined) throw new Error("minted a malformed run id");
  const now = run.date;

  const seed = await friendlySeed(ctx.secret, run.origin);
  // Round two too, for the photo round one carries as `upcoming`.
  const [first, second] = buildRun({ deck: ctx.deck, seed, mode: "friendly", now, maxRounds: 2 });
  if (first === undefined) {
    return { status: 503, body: { error: "unavailable", detail: "the deck cannot deal a round" } };
  }

  const response: StartResponse = { runId, round: toRoundPayload(first, now, ctx.images, second) };
  ctx.record?.({ type: "start", mode: "friendly", run: run.body, runKind: "fresh" });
  return { status: 200, body: response };
}

async function answer(req: AnswerRequest, ctx: RoundContext): Promise<RoundResult> {
  const run = await verifyRunId(req.runId, ctx.secret);
  if (run === undefined) return badRequest("runId is not one this server issued");
  if (run.replay) return badRequest("replay ids are refused: challenge links are off in Friendly");
  // `now` is the run's date, fixed for the whole run, never the server clock.
  const now = run.date;
  if (!isRunAnswerable(run, ctx.clock())) return badRequest("runId is out of date");

  const limited = await ctx.limits?.answer(run.body);
  if (limited?.ok === false) return rateLimited(limited.retryAfter, "answers");

  const seed = await friendlySeed(ctx.secret, run.origin);
  // Two past the answered round: the next question, and the round after it,
  // whose challenger's photo the next question carries as `upcoming`.
  const maxRounds = Math.min(req.round + 2, roundCap("friendly"));
  const rounds = buildRun({ deck: ctx.deck, seed, mode: "friendly", now, maxRounds });

  const round = rounds[req.round - 1];
  if (round === undefined) return badRequest(`this run has no round ${req.round}`);

  const correct = isCorrect(round, now, req.guess);
  const reveal = toReveal(round, now, correct);

  // Recorded once the response is built, so a failure after the judgement
  // can't record an answer the player never saw.
  const facts = { mode: "friendly", run: run.body, runKind: "fresh" } as const;
  const recordAnswer = (): void =>
    ctx.record?.({
      type: "answer",
      ...facts,
      round: req.round,
      stat: round.stat,
      correct,
      streak: correct ? req.round : req.round - 1,
      relaxation: round.relaxation,
      rankDistance: pairRankDistance(ctx.deck, round, now),
    });

  const ended = (end: RunEnd, score: number): RoundResult => {
    const response: EndResponse = { reveal, end };
    recordAnswer();
    // Every end follows an answer, so there's always a final round to log.
    ctx.record?.({ type: "end", ...facts, end, score, final: finalRound(round, now, req.guess) });
    return { status: 200, body: response };
  };

  // The score is the rounds answered correctly: every one before this, and this
  // one too if it was right.
  if (!correct) return ended("wrong", req.round - 1);
  if (req.round === WIN_ROUNDS.friendly) return ended("won", req.round);

  const next = rounds[req.round];
  if (next === undefined) return ended("deck-exhausted", req.round);

  const response: ContinueResponse = {
    reveal,
    next: toRoundPayload(next, now, ctx.images, rounds[req.round + 1]),
  };
  recordAnswer();
  return { status: 200, body: response };
}

function badRequest(detail: string): RoundResult {
  return { status: 400, body: { error: "bad_request", detail } };
}

function rateLimited(retryAfter: number, limit: "starts" | "answers"): RoundResult {
  return { status: 429, body: { error: "rate_limited" }, retryAfter, limit };
}
