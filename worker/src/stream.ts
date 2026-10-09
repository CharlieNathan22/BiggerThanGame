/**
 * Twitch Mode's round protocol (`stream`), as pure functions of the request
 * (ARCHITECTURE.md §8): a start with `mode: "stream"` on `POST /api/run/start`,
 * and a guess carrying a match's token on `POST /api/round/guess`.
 *
 * The machinery is Endless's — a signed token per question, its nonce spent
 * once by the match's Durable Object, the server's own clock and deadline,
 * Turnstile at the start — around a match's rules (stream.ts in @bt/core):
 *
 * - the questions come from the chosen pool, dealt by Endless's engine under
 *   the match's own seed domain and cut at its length;
 * - **every question is scored and play goes on** to the last one: a wrong
 *   answer or a timeout is a point not won, and the match ends `finished`
 *   (`deck-exhausted` if the pool can deal no more first);
 * - the time limit is the one chosen at the start, on every question, and the
 *   server accepts only `STREAM_LIMITS`;
 * - a refused answer (spent, out of order) changes nothing and never voids the
 *   match (stream-ledger.ts);
 * - no boards, no challenge link, no result token: `/api/run/submit` refuses a
 *   match's token.
 *
 * Chat never reaches the server. The page may send what chat did on the
 * question — its pick and how many voted, counts only — which is recorded as
 * telemetry and never changes the match.
 *
 * Every response is a declared DTO built from payload.ts; a `Round` never
 * leaves, and the token carries only what is on screen (token.ts).
 */

import {
  buildStreamRun,
  isSquadVariantId,
  isStreamLength,
  isStreamLimit,
  isStreamPool,
  resolveVariant,
  streamDeadline,
  streamQuestions,
  valueOf,
  variantDeck,
} from "@bt/core";
import type {
  ApiError,
  BandRules,
  ChatPick,
  GuessContinueResponse,
  Player,
  Round,
  StreamChat,
  StreamGuessEndResponse,
  StreamGuessResponse,
  StreamPool,
  StreamStartRequest,
  StreamStartResponse,
  TimedGuess,
} from "@bt/core";
import { bandLabel, finalRound, pairRankDistance, shownRound } from "./analytics.js";
import type { ChatOutcome, EndEvent, GameEvent, ShownRound, StreamFacts } from "./analytics.js";
import { isCorrect, toReveal, toRoundPayload } from "./payload.js";
import type { ImageLookup } from "./payload.js";
import { mintStreamRunId, parseRunId, verifyStreamRunId } from "./run-id.js";
import type { RunId } from "./run-id.js";
import type { RunLimits } from "./run.js";
import { streamSeed } from "./seed.js";
import type {
  ChatTally,
  NewStreamRun,
  StreamAdvanceResult,
  StreamOutcome,
  StreamRefusal,
  StreamRunRecord,
  StreamStep,
} from "./stream-ledger.js";
import { MAX_TOKEN_CHARS, signStreamToken } from "./token.js";
import type { StreamPayload } from "./token.js";
import type { TurnstileOutcome } from "./turnstile.js";

/** The match's Durable Object, as the handlers use it (run-do.ts; a memory ledger in tests). */
export interface StreamStub {
  streamBegin(first: NewStreamRun): Promise<boolean>;
  streamAdvance(step: StreamStep): Promise<StreamAdvanceResult>;
}

export interface StreamContext {
  readonly deck: readonly Player[];
  readonly images: ImageLookup;
  readonly secret: string;
  readonly clock: () => Date;
  readonly uuid: () => string;
  readonly verifyTurnstile: (token: string) => Promise<TurnstileOutcome>;
  /** The Durable Object for the match with this key (the match id's body). */
  readonly runs: (key: string) => StreamStub;
  readonly limits?: RunLimits;
  /** Must not throw; app.ts's recorder swallows its own failures. */
  readonly record?: (event: GameEvent) => void;
  readonly country?: string;
  readonly deckVersion?: string;
}

export type StreamResult =
  | { readonly status: 200; readonly body: StreamStartResponse | StreamGuessResponse }
  | { readonly status: 400 | 403 | 409 | 502 | 503; readonly body: ApiError }
  | {
      readonly status: 429;
      readonly body: ApiError;
      readonly retryAfter: number;
      readonly limit: "starts" | "answers";
    };

/** Turnstile's own ceiling on a token's length. */
const MAX_TURNSTILE_CHARS = 2048;

/** The longest pool id a request may name: `squad:` and a theme id (variants.ts). */
const MAX_POOL_CHARS = 90;

/** A ceiling on a reported voter count: telemetry, so only its type and range are checked. */
export const MAX_VOTERS = 10_000_000;

// ------------------------------------------------------------------ start

export async function handleStreamStart(body: unknown, ctx: StreamContext): Promise<StreamResult> {
  const limited = await ctx.limits?.start();
  if (limited?.ok === false) return rateLimited(limited.retryAfter, "starts");

  const parsed = parseStreamStart(body);
  if (!parsed.ok) return badRequest(parsed.detail);
  const req = parsed.value;
  // A squad names a theme, which only the deck can vouch for.
  const questions = streamQuestions(req.pool, req.questions, ctx.deck);
  if (questions === undefined || resolveVariant(req.pool, ctx.deck) === undefined) {
    return badRequest("pool names no theme in this deck");
  }

  const verdict = await ctx.verifyTurnstile(req.turnstileToken);
  if (verdict === "fail") return { status: 403, body: { error: "verification_failed" } };
  if (verdict === "error") {
    return { status: 502, body: { error: "unavailable", detail: "turnstile" } };
  }

  const runId = await mintStreamRunId(ctx.clock(), ctx.uuid(), ctx.secret, req.pool);
  const run = parseRunId(runId);
  // Never the id itself in the message: it reaches the logs.
  if (run === undefined) throw new Error("minted a malformed match id");

  const facts: StreamFacts = { pool: req.pool, questions, limit: req.limit };
  const rounds = await dealTo(ctx, run, facts, 2);
  const first = rounds[0];
  if (first === undefined) {
    return { status: 503, body: { error: "unavailable", detail: "the deck cannot deal a round" } };
  }

  const issuedAt = ctx.clock().getTime();
  const nonce = ctx.uuid();
  const deadline = streamDeadline(issuedAt, 1, first.statChanged, req.limit, req.pool);
  const begun = await ctx.runs(run.body).streamBegin({
    key: run.body,
    runId,
    ...facts,
    country: ctx.country ?? "XX",
    deckVersion: ctx.deckVersion ?? "unknown",
    startedAt: issuedAt,
    nonce,
    issuedAt,
    deadline,
  });
  if (!begun) throw new Error("the match's ledger already existed");

  const token = await signStreamToken(
    ctx.secret,
    payload(runId, facts, first, run.date, 0, issuedAt, deadline, nonce),
  );
  const response: StreamStartResponse = {
    runId,
    round: toRoundPayload(first, run.date, ctx.images, rounds[1], req.pool),
    token,
    questions,
    limit: req.limit,
  };
  ctx.record?.({ type: "start", mode: "stream", stream: facts, run: run.body, runKind: "fresh" });
  return { status: 200, body: response };
}

// ------------------------------------------------------------------ guess

/**
 * A guess whose token has already verified as a match's (app.ts routes on it).
 * `request` is the guess's body, parsed by `parseStreamGuess`.
 */
export async function handleStreamGuess(
  token: StreamPayload,
  request: { readonly guess: TimedGuess; readonly chat?: StreamChat },
  ctx: StreamContext,
): Promise<StreamResult> {
  const { guess } = request;
  const facts: StreamFacts = { pool: token.pool, questions: token.questions, limit: token.limit };
  const run = await verifyStreamRunId(token.runId, ctx.secret, token.pool);
  if (run === undefined) return badRequest("token names no match");
  // A genuine token for a theme the deck no longer has: the deck changed mid-match.
  const config = resolveVariant(token.pool, ctx.deck);
  if (config === undefined) return conflict("token_mismatch");

  const limited = await ctx.limits?.answer(run.body);
  if (limited?.ok === false) return rateLimited(limited.retryAfter, "answers");

  // The server's clock, the moment the answer arrived. Nothing the client says counts.
  const receivedAt = ctx.clock().getTime();
  const now = run.date;

  // Two past the answered round, within the match: the next question, and the
  // one after it, whose challenger's photo the next question carries as `upcoming`.
  const rounds = await dealTo(ctx, run, facts, Math.min(token.round + 2, token.questions));
  const round = rounds[token.round - 1];
  if (round === undefined || !matches(token, round, now)) return conflict("token_mismatch");

  const timedOut = guess === "timeout" || receivedAt > token.deadline;
  const correct = !timedOut && isCorrect(round, now, guess as "higher" | "lower");
  const next = token.round < token.questions ? rounds[token.round] : undefined;
  const outcome: StreamOutcome =
    token.round >= token.questions
      ? { kind: "end", end: "finished", endedAt: receivedAt }
      : next === undefined
        ? { kind: "end", end: "deck-exhausted", endedAt: receivedAt }
        : {
            kind: "next",
            nonce: ctx.uuid(),
            issuedAt: receivedAt,
            deadline: streamDeadline(
              receivedAt,
              next.index,
              next.statChanged,
              token.limit,
              token.pool,
            ),
          };
  const chat = request.chat === undefined ? undefined : chatOf(request.chat, round, now);

  const advanced = await ctx.runs(run.body).streamAdvance({
    nonce: token.nonce,
    round: token.round,
    guess,
    issuedAt: token.issuedAt,
    receivedAt,
    correct,
    ...(chat !== undefined ? { chat: chat.tally } : {}),
    outcome,
  });
  if (!advanced.ok) return conflict(advanced.reason);

  // A resend of the latest step is answered exactly as before, from what the
  // ledger kept: the same verdict, next token, issue time and deadline.
  const settled = advanced.outcome;
  const reveal = toReveal(round, now, advanced.correct);
  let response: StreamGuessResponse;
  if (settled.kind === "next") {
    const following = rounds[token.round];
    if (following === undefined) throw new Error("a next token for a round the match can't deal");
    const continued: GuessContinueResponse = {
      reveal,
      next: toRoundPayload(following, now, ctx.images, rounds[token.round + 1], token.pool),
      token: await signStreamToken(
        ctx.secret,
        payload(
          token.runId,
          facts,
          following,
          now,
          advanced.score,
          settled.issuedAt,
          settled.deadline,
          settled.nonce,
        ),
      ),
    };
    response = continued;
  } else {
    const ended: StreamGuessEndResponse = { reveal, end: settled.end, score: advanced.score };
    response = ended;
  }

  // Recorded once, when the answer is first accepted — never for a resend.
  if (advanced.fresh && ctx.record !== undefined) {
    const common = { mode: "stream", stream: facts, run: run.body, runKind: "fresh" } as const;
    const rules: BandRules = isSquadVariantId(token.pool)
      ? { ...config, questions: token.questions }
      : config;
    ctx.record({
      type: "answer",
      ...common,
      round: token.round,
      stat: round.stat,
      correct: advanced.correct,
      streak: advanced.score,
      relaxation: round.relaxation,
      band: bandLabel(token.round, "endless", rules),
      // On the deck the match measured closeness against: a squad's is the whole deck.
      rankDistance: pairRankDistance(
        config.format === "squad" ? ctx.deck : variantDeck(ctx.deck, config),
        round,
        now,
      ),
      answerMs: advanced.ms,
      ...(chat !== undefined ? { chat: chat.outcome, voters: chat.tally.voters } : {}),
    });
    if (settled.kind === "end") {
      ctx.record({
        type: "end",
        ...common,
        end: settled.end,
        score: advanced.score,
        chatScore: advanced.chatScore,
        peakVoters: advanced.peakVoters,
        final: finalRound(round, now, guess),
      });
    }
  }
  return { status: 200, body: response };
}

// ------------------------------------------------------------ disconnect

/**
 * The end of a match its ledger closed as `disconnected` (no answer came by the
 * deadline): the streamer's score so far, and the round left open as it was
 * on screen — the anchor's figure, never the challenger's (`shownRound`).
 */
export async function streamDisconnectedEnd(
  run: StreamRunRecord,
  deck: readonly Player[],
  secret: string,
): Promise<EndEvent> {
  const id = parseRunId(run.runId);
  const facts: StreamFacts = { pool: run.pool, questions: run.questions, limit: run.limit };
  let shown: ShownRound | undefined;
  if (id !== undefined && resolveVariant(run.pool, deck) !== undefined) {
    const ctx = { deck, secret };
    const rounds = await dealTo(ctx, id, facts, run.round);
    const open = rounds[run.round - 1];
    if (open !== undefined) shown = shownRound(open, id.date, "question");
  }
  return {
    type: "end",
    mode: "stream",
    stream: facts,
    run: run.key,
    runKind: "fresh",
    end: "disconnected",
    score: run.results.filter(Boolean).length,
    chatScore: run.chatScore,
    peakVoters: run.peakVoters,
    ...(shown !== undefined ? { shown } : {}),
  };
}

// --------------------------------------------------------------- helpers

/** The match's rounds up to `maxRounds`, from its seed and date. */
async function dealTo(
  ctx: { readonly deck: readonly Player[]; readonly secret: string },
  run: RunId,
  facts: StreamFacts,
  maxRounds: number,
): Promise<Round[]> {
  const seed = await streamSeed(ctx.secret, run.origin, facts.pool);
  return buildStreamRun({
    deck: ctx.deck,
    seed,
    now: run.date,
    pool: facts.pool,
    questions: facts.questions,
    maxRounds,
  });
}

/** How chat did, judged by the server against the answer: a tally for the ledger, an outcome for analytics. */
function chatOf(
  chat: StreamChat,
  round: Round,
  now: Date,
): { readonly tally: ChatTally; readonly outcome: ChatOutcome } {
  const answer: ChatPick = isCorrect(round, now, "higher") ? "higher" : "lower";
  const outcome: ChatOutcome =
    chat.pick === "split" || chat.pick === "none"
      ? chat.pick
      : chat.pick === answer
        ? "right"
        : "wrong";
  return { tally: { right: outcome === "right", voters: chat.voters }, outcome };
}

function payload(
  runId: string,
  facts: StreamFacts,
  round: Round,
  now: Date,
  correct: number,
  issuedAt: number,
  deadline: number,
  nonce: string,
): StreamPayload {
  // The anchor's figure is already on screen, so it is safe in the token.
  const anchorValue = valueOf(round.anchor, round.stat, now);
  if (anchorValue === undefined) throw new Error("dealt an anchor with no figure");
  return {
    v: 1,
    runId,
    mode: "stream",
    pool: facts.pool,
    questions: facts.questions,
    limit: facts.limit,
    round: round.index,
    correct,
    anchorId: round.anchor.id,
    challengerId: round.challenger.id,
    stat: round.stat,
    anchorValue,
    issuedAt,
    deadline,
    nonce,
  };
}

/** The token names exactly the round the sequence deals. */
function matches(token: StreamPayload, round: Round, now: Date): boolean {
  return (
    round.index === token.round &&
    round.stat === token.stat &&
    round.anchor.id === token.anchorId &&
    round.challenger.id === token.challengerId &&
    valueOf(round.anchor, round.stat, now) === token.anchorValue
  );
}

// ------------------------------------------------------------ validation

type Parsed<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly detail: string };

function keysOf(record: Record<string, unknown>): string[] {
  return Object.keys(record).sort();
}

function same(sorted: readonly string[], expected: readonly string[]): boolean {
  return sorted.length === expected.length && sorted.every((k, i) => k === expected[i]);
}

/** Whether a start's body says it is a match's: app.ts routes on it. */
export function isStreamStart(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    !Array.isArray(body) &&
    (body as { mode?: unknown }).mode === "stream"
  );
}

export function parseStreamStart(body: unknown): Parsed<StreamStartRequest> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, detail: "body must be a JSON object" };
  }
  const record = body as Record<string, unknown>;
  if (!same(keysOf(record), ["limit", "mode", "pool", "questions", "turnstileToken"])) {
    return { ok: false, detail: "expected { mode, pool, questions, limit, turnstileToken }" };
  }
  const { mode, pool, questions, limit, turnstileToken } = record;
  if (mode !== "stream") return { ok: false, detail: 'mode must be "stream"' };
  if (typeof pool !== "string" || pool.length > MAX_POOL_CHARS || !isStreamPool(pool)) {
    return {
      ok: false,
      detail: 'pool must be "endless", "endless-instagram" or "squad:<theme>"',
    };
  }
  if (!isStreamLength(questions)) return { ok: false, detail: "questions must be 10 or 20" };
  if (!isStreamLimit(limit)) return { ok: false, detail: "limit must be 10, 20, 30 or 60" };
  if (
    typeof turnstileToken !== "string" ||
    turnstileToken === "" ||
    turnstileToken.length > MAX_TURNSTILE_CHARS
  ) {
    return { ok: false, detail: "turnstileToken must be a Turnstile token" };
  }
  return {
    ok: true,
    value: { mode: "stream", pool: pool as StreamPool, questions, limit, turnstileToken },
  };
}

const GUESSES: readonly TimedGuess[] = ["higher", "lower", "timeout"];
const CHAT_PICKS: readonly ChatPick[] = ["higher", "lower", "split", "none"];

/**
 * A match's guess: `{ token, guess, clientElapsedMs?, chat? }`, strictly.
 * `clientElapsedMs` is checked for type and dropped, as Endless's is; `chat`
 * is telemetry, held to its shape and range.
 */
export function parseStreamGuess(
  body: unknown,
): Parsed<{ readonly token: string; readonly guess: TimedGuess; readonly chat?: StreamChat }> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, detail: "body must be a JSON object" };
  }
  const record = body as Record<string, unknown>;
  const keys = keysOf(record).filter((k) => k !== "clientElapsedMs" && k !== "chat");
  if (!same(keys, ["guess", "token"])) {
    return { ok: false, detail: "expected { token, guess, clientElapsedMs?, chat? }" };
  }
  const { token, guess, clientElapsedMs, chat } = record;
  if (typeof token !== "string" || token === "" || token.length > MAX_TOKEN_CHARS) {
    return { ok: false, detail: "token must be a progress token" };
  }
  if (typeof guess !== "string" || !(GUESSES as readonly string[]).includes(guess)) {
    return { ok: false, detail: 'guess must be "higher", "lower" or "timeout"' };
  }
  if (
    clientElapsedMs !== undefined &&
    (typeof clientElapsedMs !== "number" || !Number.isFinite(clientElapsedMs))
  ) {
    return { ok: false, detail: "clientElapsedMs must be a number" };
  }
  if (!("chat" in record)) return { ok: true, value: { token, guess: guess as TimedGuess } };
  const parsedChat = parseChat(chat);
  if (parsedChat === undefined) {
    return {
      ok: false,
      detail: 'chat must be { pick: "higher" | "lower" | "split" | "none", voters }',
    };
  }
  return { ok: true, value: { token, guess: guess as TimedGuess, chat: parsedChat } };
}

function parseChat(value: unknown): StreamChat | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (!same(keysOf(record), ["pick", "voters"])) return undefined;
  const { pick, voters } = record;
  if (typeof pick !== "string" || !(CHAT_PICKS as readonly string[]).includes(pick)) {
    return undefined;
  }
  if (typeof voters !== "number" || !Number.isInteger(voters) || voters < 0) return undefined;
  if (voters > MAX_VOTERS) return undefined;
  // No votes is no pick, and a pick needs a vote.
  if ((pick === "none") !== (voters === 0)) return undefined;
  return { pick: pick as ChatPick, voters };
}

function badRequest(detail: string): StreamResult {
  return { status: 400, body: { error: "bad_request", detail } };
}

function conflict(reason: StreamRefusal | "token_mismatch"): StreamResult {
  return { status: 409, body: { error: "conflict", detail: reason } };
}

function rateLimited(retryAfter: number, limit: "starts" | "answers"): StreamResult {
  return { status: 429, body: { error: "rate_limited" }, retryAfter, limit };
}
