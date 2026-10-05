/**
 * Endless's round protocol, as pure functions of the request
 * (ARCHITECTURE.md §8): `POST /api/run/start` and `POST /api/round/guess`.
 *
 * - **Start**: the run-start rate limit, then Turnstile, then a fresh signed run id, round one and its progress token.
 *   The run's Durable Object is told about the token before it is handed out.
 * - **Guess**: the token's signature, the per-run answer limit, then the
 *   server's own clock against the token's deadline, the sequence recomputed
 *   from the seed and checked against the token, the answer judged — and only
 *   then the Durable Object, which spends the token's nonce once and records
 *   the answer time. The reveal and, when the answer was right, the next round
 *   and its token go back **in the same response**, so there is one round trip
 *   per question.
 *
 * The server owns the clock. A token's deadline is set when it is issued
 * (`deadlineFor`, @bt/core); an answer received after it ends the run as
 * `timeout` whatever it says, and the client's own `timeout` ends it early so
 * the player still sees the reveal. `clientElapsedMs` is accepted and ignored.
 *
 * Every response is a declared DTO built in payload.ts and here; a `Round`
 * never leaves. The token carries only what is on screen (token.ts).
 *
 * Deck, images, secret, clock, uuid, Turnstile, rate limits, the Durable
 * Object and `record` are all injected, so tests drive this in Node.
 */

import { buildRun, deadlineFor, flagCountry, roundCap, valueOf } from "@bt/core";
import type {
  ApiError,
  ChallengeLink,
  ChallengeStatus,
  GuessContinueResponse,
  GuessEndResponse,
  GuessRequest,
  GuessResponse,
  Player,
  Round,
  RunEnd,
  RunStartRequest,
  RunStartResponse,
  TimedGuess,
} from "@bt/core";
import { finalRound, pairRankDistance, shownRound } from "./analytics.js";
import type { EndEvent, GameEvent, RunKind, ShownRound } from "./analytics.js";
import { challengeLink, checkChallenge } from "./challenge.js";
import { isCorrect, toReveal, toRoundPayload } from "./payload.js";
import type { ImageLookup } from "./payload.js";
import type { RateDecision } from "./rate-limit.js";
import type { AdvanceResult, NewRun, Refusal, RunRecord, Step, StepOutcome } from "./run-ledger.js";
import { mintRunId, parseRunId, verifyRunId } from "./run-id.js";
import type { RunId } from "./run-id.js";
import { endlessSeed } from "./seed.js";
import { MAX_TOKEN_CHARS, signResult, signToken, verifyToken } from "./token.js";
import type { ProgressPayload } from "./token.js";
import type { TurnstileOutcome } from "./turnstile.js";

/** The run's Durable Object, as the handlers use it (run-do.ts; a memory ledger in tests). */
export interface RunStub {
  begin(first: NewRun): Promise<boolean>;
  advance(step: Step): Promise<AdvanceResult>;
}

export interface RunContext {
  readonly deck: readonly Player[];
  readonly images: ImageLookup;
  readonly secret: string;
  readonly clock: () => Date;
  readonly uuid: () => string;
  readonly verifyTurnstile: (token: string) => Promise<TurnstileOutcome>;
  /** The Durable Object for the run with this key (the run id's body). */
  readonly runs: (key: string) => RunStub;
  readonly limits?: RunLimits;
  /** Must not throw; app.ts's recorder swallows its own failures. */
  readonly record?: (event: GameEvent) => void;
  /** For the run's own record of its start, so a silent run's end can be logged alike. */
  readonly country?: string;
  readonly deckVersion?: string;
}

export interface RunLimits {
  start(): Promise<RateDecision>;
  /** `run` is the verified run key, `YYYYMMDD-<uuid>`. */
  answer(run: string): Promise<RateDecision>;
}

export type RunResult =
  | { readonly status: 200; readonly body: RunStartResponse | GuessResponse }
  | { readonly status: 400 | 403 | 409 | 502 | 503; readonly body: ApiError }
  | {
      readonly status: 429;
      readonly body: ApiError;
      readonly retryAfter: number;
      readonly limit: "starts" | "answers";
    };

const ENDLESS_CAP = roundCap("endless");

/** Turnstile's own ceiling on a token's length. */
const MAX_TURNSTILE_CHARS = 2048;

/** Far past a real run id (84 characters) or signature (22). */
const MAX_LINK_FIELD = 128;

// ------------------------------------------------------------------ start

export async function handleRunStart(body: unknown, ctx: RunContext): Promise<RunResult> {
  const limited = await ctx.limits?.start();
  if (limited?.ok === false) return rateLimited(limited.retryAfter, "starts");

  const parsed = parseRunStart(body);
  if (!parsed.ok) return badRequest(parsed.detail);
  const req = parsed.value;

  const verdict = await ctx.verifyTurnstile(req.turnstileToken);
  if (verdict === "fail") return { status: 403, body: { error: "verification_failed" } };
  if (verdict === "error") {
    return { status: 502, body: { error: "unavailable", detail: "turnstile" } };
  }

  // A link sets the score to beat, never the rounds: the run is fresh either way.
  const check =
    req.challenge === undefined
      ? undefined
      : await checkChallenge(ctx.secret, req.challenge, ctx.clock());
  const challenge: ChallengeStatus | undefined =
    check === undefined
      ? undefined
      : check.ok
        ? { accepted: true, score: check.score }
        : { accepted: false, reason: check.reason };

  const runId = await mintRunId(ctx.clock(), ctx.uuid(), ctx.secret, "endless");
  const run = parseRunId(runId);
  // Never the id itself in the message: it reaches the logs.
  if (run === undefined) throw new Error("minted a malformed run id");

  const rounds = await dealTo(ctx, run, 2);
  const first = rounds[0];
  if (first === undefined) {
    return { status: 503, body: { error: "unavailable", detail: "the deck cannot deal a round" } };
  }

  const issuedAt = ctx.clock().getTime();
  const nonce = ctx.uuid();
  const deadline = requireDeadline(issuedAt, first);
  const runKind: RunKind = challenge?.accepted === true ? "challenge" : "fresh";
  const begun = await ctx.runs(run.body).begin({
    key: run.body,
    runId,
    runKind,
    country: ctx.country ?? "XX",
    deckVersion: ctx.deckVersion ?? "unknown",
    startedAt: issuedAt,
    nonce,
    issuedAt,
    deadline,
  });
  if (!begun) throw new Error("the run's ledger already existed");

  const token = await signToken(
    ctx.secret,
    progress(runId, first, run.date, issuedAt, deadline, nonce),
  );
  const response: RunStartResponse = {
    runId,
    round: toRoundPayload(first, run.date, ctx.images, rounds[1]),
    token,
    // What the publish dialog will show as the flag; the code only.
    country: flagCountry(ctx.country),
    ...(challenge !== undefined ? { challenge } : {}),
  };
  ctx.record?.({ type: "start", mode: "endless", run: run.body, runKind });
  return { status: 200, body: response };
}

// ------------------------------------------------------------------ guess

export async function handleGuess(body: unknown, ctx: RunContext): Promise<RunResult> {
  const parsed = parseGuess(body);
  if (!parsed.ok) return badRequest(parsed.detail);
  const { guess } = parsed.value;

  const token = await verifyToken(ctx.secret, parsed.value.token);
  if (token === undefined) return badRequest("token is not one this server issued");
  const run = await verifyRunId(token.runId, ctx.secret, "endless");
  if (run === undefined || run.replay) return badRequest("token names no Endless run");

  const limited = await ctx.limits?.answer(run.body);
  if (limited?.ok === false) return rateLimited(limited.retryAfter, "answers");

  // The server's clock, the moment the answer arrived. Nothing the client says counts.
  const receivedAt = ctx.clock().getTime();
  const now = run.date;

  // Two past the answered round: the next question, and the round after it,
  // whose challenger's photo the next question carries as `upcoming`.
  const rounds = await dealTo(ctx, run, Math.min(token.round + 2, ENDLESS_CAP));
  const round = rounds[token.round - 1];
  if (round === undefined || !matches(token, round, now)) {
    // A genuine token the sequence doesn't bear out: the deck changed mid-run.
    return conflict("token_mismatch");
  }

  const timedOut = guess === "timeout" || receivedAt > token.deadline;
  const correct = !timedOut && isCorrect(round, now, guess as "higher" | "lower");
  const score = correct ? token.round : token.round - 1;
  const next = rounds[token.round];
  const end: RunEnd | null = timedOut
    ? "timeout"
    : !correct
      ? "wrong"
      : next === undefined || token.round >= ENDLESS_CAP
        ? "deck-exhausted"
        : null;

  const outcome: StepOutcome =
    end !== null || next === undefined
      ? { kind: "end", end: end ?? "deck-exhausted", score, endedAt: receivedAt }
      : {
          kind: "next",
          nonce: ctx.uuid(),
          issuedAt: receivedAt,
          deadline: requireDeadline(receivedAt, next),
        };

  const advanced = await ctx.runs(run.body).advance({
    nonce: token.nonce,
    round: token.round,
    guess,
    issuedAt: token.issuedAt,
    receivedAt,
    correct,
    outcome,
  });
  if (!advanced.ok) return conflict(advanced.reason);

  // A resend of the latest step is answered exactly as before, from what the
  // ledger kept: the same next token, issue time and deadline, or the same end.
  const settled = advanced.outcome;
  // Right when it led on, or to an end at this round's score (the deck ran out).
  const right = settled.kind === "next" || settled.score === token.round;
  const reveal = toReveal(round, now, right);

  let response: GuessResponse;
  if (settled.kind === "next") {
    const following = rounds[token.round];
    if (following === undefined) throw new Error("a next token for a round the run can't deal");
    const continued: GuessContinueResponse = {
      reveal,
      next: toRoundPayload(following, now, ctx.images, rounds[token.round + 1]),
      token: await signToken(
        ctx.secret,
        progress(token.runId, following, now, settled.issuedAt, settled.deadline, settled.nonce),
      ),
    };
    response = continued;
  } else {
    const ended: GuessEndResponse = {
      reveal,
      end: settled.end,
      challenge: await challengeLink(ctx.secret, run.body, settled.score),
      result: await signResult(ctx.secret, {
        v: 1,
        runId: token.runId,
        mode: "endless",
        score: settled.score,
        end: settled.end,
        startedOn: run.date.toISOString().slice(0, 10),
        elapsedMs: advanced.elapsedMs,
        endedAt: settled.endedAt,
      }),
    };
    response = ended;
  }

  // Recorded once, when the answer is first accepted — never for a resend.
  if (advanced.fresh) {
    record(ctx, run, advanced.runKind, round, token, guess, right, advanced.ms, settled);
  }
  return { status: 200, body: response };
}

// ------------------------------------------------------------ disconnect

/**
 * The end of a run its ledger closed as `disconnected` (no answer came by the
 * deadline): the streak it had verified, and the round left open as the player
 * saw it — the anchor's figure, never the challenger's (`shownRound`).
 */
export async function disconnectedEnd(
  run: RunRecord,
  deck: readonly Player[],
  secret: string,
): Promise<EndEvent> {
  const id = parseRunId(run.runId);
  let shown: ShownRound | undefined;
  if (id !== undefined) {
    const seed = await endlessSeed(secret, id.origin);
    const rounds = buildRun({ deck, seed, mode: "endless", now: id.date, maxRounds: run.round });
    const open = rounds[run.round - 1];
    if (open !== undefined) shown = shownRound(open, id.date, "question");
  }
  return {
    type: "end",
    mode: "endless",
    run: run.key,
    runKind: run.runKind,
    end: "disconnected",
    score: run.streak,
    ...(shown !== undefined ? { shown } : {}),
  };
}

// --------------------------------------------------------------- helpers

function record(
  ctx: RunContext,
  run: RunId,
  runKind: RunKind,
  round: Round,
  token: ProgressPayload,
  guess: TimedGuess,
  correct: boolean,
  answerMs: number,
  outcome: StepOutcome,
): void {
  if (ctx.record === undefined) return;
  const facts = { mode: "endless", run: run.body, runKind } as const;
  ctx.record({
    type: "answer",
    ...facts,
    round: token.round,
    stat: round.stat,
    correct,
    streak: correct ? token.round : token.round - 1,
    relaxation: round.relaxation,
    rankDistance: pairRankDistance(ctx.deck, round, run.date),
    answerMs,
  });
  if (outcome.kind === "end") {
    ctx.record({
      type: "end",
      ...facts,
      end: outcome.end,
      score: outcome.score,
      final: finalRound(round, run.date, guess),
    });
  }
}

/** The run's rounds up to `maxRounds`, from its seed and date. */
async function dealTo(ctx: RunContext, run: RunId, maxRounds: number): Promise<Round[]> {
  const seed = await endlessSeed(ctx.secret, run.origin);
  return buildRun({ deck: ctx.deck, seed, mode: "endless", now: run.date, maxRounds });
}

function progress(
  runId: string,
  round: Round,
  now: Date,
  issuedAt: number,
  deadline: number,
  nonce: string,
): ProgressPayload {
  // The anchor's figure is already on screen, so it is safe in the token.
  const anchorValue = valueOf(round.anchor, round.stat, now);
  if (anchorValue === undefined) throw new Error("dealt an anchor with no figure");
  return {
    v: 1,
    runId,
    mode: "endless",
    round: round.index,
    streak: round.index - 1,
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
function matches(token: ProgressPayload, round: Round, now: Date): boolean {
  return (
    round.index === token.round &&
    round.stat === token.stat &&
    round.anchor.id === token.anchorId &&
    round.challenger.id === token.challengerId &&
    valueOf(round.anchor, round.stat, now) === token.anchorValue
  );
}

function requireDeadline(issuedAt: number, round: Round): number {
  const deadline = deadlineFor(issuedAt, round.index, round.statChanged, "endless");
  if (deadline === null) throw new Error("Endless has no clock");
  return deadline;
}

// ------------------------------------------------------------ validation

type Parsed<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly detail: string };

function keysOf(record: Record<string, unknown>): string[] {
  return Object.keys(record).sort();
}

export function parseRunStart(body: unknown): Parsed<RunStartRequest> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, detail: "body must be a JSON object" };
  }
  const record = body as Record<string, unknown>;
  const keys = keysOf(record);
  const plain = ["mode", "turnstileToken"];
  const withLink = ["challenge", "mode", "turnstileToken"];
  if (!same(keys, plain) && !same(keys, withLink)) {
    return { ok: false, detail: "expected { mode, turnstileToken, challenge? }" };
  }
  if (record.mode !== "endless") return { ok: false, detail: 'mode must be "endless"' };
  const { turnstileToken } = record;
  if (
    typeof turnstileToken !== "string" ||
    turnstileToken === "" ||
    turnstileToken.length > MAX_TURNSTILE_CHARS
  ) {
    return { ok: false, detail: "turnstileToken must be a Turnstile token" };
  }
  if (!("challenge" in record)) return { ok: true, value: { mode: "endless", turnstileToken } };
  const link = parseLink(record.challenge);
  if (link === undefined) {
    return {
      ok: false,
      detail: `challenge must be { runId, score, sig }, score an integer from 0 to ${ENDLESS_CAP}`,
    };
  }
  return { ok: true, value: { mode: "endless", turnstileToken, challenge: link } };
}

/**
 * A link is held to its types here, not its contents: one mangled on its way
 * through a chat app still starts a run, a fresh one, with a note.
 */
function parseLink(value: unknown): ChallengeLink | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (!same(keysOf(record), ["runId", "score", "sig"])) return undefined;
  const { runId, score, sig } = record;
  if (typeof runId !== "string" || runId.length > MAX_LINK_FIELD) return undefined;
  if (typeof sig !== "string" || sig.length > MAX_LINK_FIELD) return undefined;
  if (typeof score !== "number" || !Number.isInteger(score) || score < 0 || score > ENDLESS_CAP) {
    return undefined;
  }
  return { runId, score, sig };
}

const GUESSES: readonly TimedGuess[] = ["higher", "lower", "timeout"];

export function parseGuess(body: unknown): Parsed<GuessRequest> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, detail: "body must be a JSON object" };
  }
  const record = body as Record<string, unknown>;
  const keys = keysOf(record);
  if (!same(keys, ["guess", "token"]) && !same(keys, ["clientElapsedMs", "guess", "token"])) {
    return { ok: false, detail: "expected { token, guess, clientElapsedMs? }" };
  }
  const { token, guess, clientElapsedMs } = record;
  if (typeof token !== "string" || token === "" || token.length > MAX_TOKEN_CHARS) {
    return { ok: false, detail: "token must be a progress token" };
  }
  if (typeof guess !== "string" || !(GUESSES as readonly string[]).includes(guess)) {
    return { ok: false, detail: 'guess must be "higher", "lower" or "timeout"' };
  }
  // Telemetry at most, and not even recorded: checked for type, then dropped.
  if (
    clientElapsedMs !== undefined &&
    (typeof clientElapsedMs !== "number" || !Number.isFinite(clientElapsedMs))
  ) {
    return { ok: false, detail: "clientElapsedMs must be a number" };
  }
  return { ok: true, value: { token, guess: guess as TimedGuess } };
}

function same(sorted: readonly string[], expected: readonly string[]): boolean {
  return sorted.length === expected.length && sorted.every((k, i) => k === expected[i]);
}

function badRequest(detail: string): RunResult {
  return { status: 400, body: { error: "bad_request", detail } };
}

function conflict(reason: Refusal | "token_mismatch"): RunResult {
  return { status: 409, body: { error: "conflict", detail: reason } };
}

function rateLimited(retryAfter: number, limit: "starts" | "answers"): RunResult {
  return { status: 429, body: { error: "rate_limited" }, retryAfter, limit };
}
