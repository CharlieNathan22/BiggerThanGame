/**
 * Daily Ranked's round protocol, as pure functions of the request
 * (ARCHITECTURE.md §8): the start (`POST /api/run/start` with `mode:
 * "ranked"`), the guess (`POST /api/round/guess` with a Daily token) and the
 * resume after a refresh (`POST /api/run/resume`).
 *
 * - **Start.** The run-start limit; strict parsing; the game in play by the
 *   server's clock (none before launch day); the name's form and the
 *   blocklist; Turnstile; the game, frozen (daily-game.ts); then, in one
 *   atomic batch, the device's attempt and the name's reservation for the
 *   game. A name refused or taken starts nothing and uses no attempt; a
 *   device that has played the game is refused. Only then the run's Durable
 *   Object and round one with its token.
 * - **Guess.** As Endless's — the token's signature, the per-run limit, the
 *   server's clock against the deadline, the round checked against the stored
 *   game, the Durable Object spending the nonce once — but a wrong answer or
 *   a timeout before question 21 carries on. A run that ends is posted to its
 *   board in the same request (daily-post.ts), and the answer carries its rank.
 * - **Resume.** Found from the device alone: its run still being played in
 *   today's game or yesterday's (a run started at 23:58). The Durable Object
 *   checks the device again, then hands back the open question under a fresh
 *   nonce with its deadline unchanged, or, if its time has run out, records a
 *   timeout and deals the next. The run id the page kept is only a hint.
 *
 * Every response is declared and built field by field (daily-payload.ts);
 * a stored round never leaves. Deck, images, secret, clock, uuid, Turnstile,
 * D1, rate limits, the Durable Object and `record` are injected, so tests
 * drive this in Node.
 */

import {
  checkNickname,
  flagCountry,
  gameDate,
  gameNoAt,
  isGame,
  normaliseNickname,
} from "@bt/core";
import type {
  ApiError,
  DailyResult,
  DailyResumeResponse,
  DailyStartRequest,
  DailyStartResponse,
  GuessContinueResponse,
  DailyGuessEndResponse,
  DailyGuessResponse,
  Player,
  TimedGuess,
} from "@bt/core";
import { finalStored } from "./analytics.js";
import type { GameEvent } from "./analytics.js";
import { ensureDailyGame, readDailyGame } from "./daily-game.js";
import type { BuildInputs, StoredRound } from "./daily-game.js";
import type {
  DailyAdvanceResult,
  DailyResumeResult,
  DailyRunRecord,
  DailyStep,
  NewDailyRun,
} from "./daily-ledger.js";
import { bonusOf, correctOf } from "./daily-ledger.js";
import { currentImages, dailyIsCorrect, dailyReveal, dailyRoundPayload } from "./daily-payload.js";
import type { CurrentImages } from "./daily-payload.js";
import { postDailyRun, unpostedResult } from "./daily-post.js";
import type { Posted } from "./daily-post.js";
import {
  claimEntry,
  countConnection,
  deviceEntry,
  entryResult,
  releaseEntry,
  unfinishedEntry,
} from "./daily-scores.js";
import type { NewEntry } from "./daily-scores.js";
import { hmacSha256, toBase64Url } from "./hmac.js";
import type { LogLine } from "./log.js";
import { moderate } from "./moderation.js";
import type { ImageLookup } from "./payload.js";
import type { RateDecision } from "./rate-limit.js";
import { mintRankedRunId, verifyRankedRunId } from "./run-id.js";
import type { D1Like } from "./scores.js";
import { hashDevice } from "./submit.js";
import { signDailyToken } from "./token.js";
import type { DailyPayload } from "./token.js";
import type { TurnstileOutcome } from "./turnstile.js";

/** A Daily run's Durable Object, as the handlers use it (run-do.ts; a memory ledger in tests). */
export interface DailyStub {
  dailyBegin(first: NewDailyRun): Promise<DailyRunRecord | undefined>;
  dailyAdvance(step: DailyStep): Promise<DailyAdvanceResult>;
  dailyResume(args: {
    readonly deviceHash: string;
    readonly now: number;
    readonly nonce: string;
  }): Promise<DailyResumeResult>;
  dailyPosted(): Promise<boolean>;
  dailyPostFailed(now: number): Promise<void>;
}

export interface DailyContext {
  readonly deck: readonly Player[];
  readonly images: ImageLookup;
  readonly secret: string;
  readonly clock: () => Date;
  readonly uuid: () => string;
  readonly db: D1Like;
  /** The epoch in force, ms (`dailyEpochMs`). */
  readonly epoch: number;
  readonly verifyTurnstile: (token: string) => Promise<TurnstileOutcome>;
  readonly runs: (key: string) => DailyStub;
  readonly limits?: {
    start(): Promise<RateDecision>;
    answer(run: string): Promise<RateDecision>;
  };
  /** Must not throw. */
  readonly record?: (event: GameEvent) => void;
  /** Must not throw. */
  readonly log?: (line: LogLine) => void;
  readonly country?: string;
  readonly deckVersion?: string;
  /** The connection's rate-limit key (IPv4, or the IPv6 /64), for the repeat count only. */
  readonly ip?: string;
  /** The blocklist; the shipped one by default. */
  readonly moderate?: (nickname: string) => boolean;
}

export type DailyHandlerResult<T> =
  | { readonly status: 200; readonly body: T }
  | { readonly status: 400 | 403 | 409 | 422 | 502 | 503; readonly body: ApiError }
  | {
      readonly status: 429;
      readonly body: ApiError;
      readonly retryAfter: number;
      readonly limit: "starts" | "answers";
    };

/** Turnstile's own ceiling on a token's length. */
const MAX_TURNSTILE_CHARS = 2048;
/** Far past a real nickname: the form is checked by `checkNickname`. */
const MAX_NICKNAME_CHARS = 64;
const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** Far past a real run id (84 characters). */
const MAX_RUN_ID_CHARS = 128;

function inputs(ctx: DailyContext): BuildInputs {
  return {
    deck: ctx.deck,
    images: ctx.images,
    secret: ctx.secret,
    deckVersion: ctx.deckVersion ?? "unknown",
    epoch: ctx.epoch,
    clock: ctx.clock,
  };
}

/** The connection, salted per game so it can't be linked across games: counting only. */
export async function connectionHash(secret: string, gameNo: number, ip: string): Promise<string> {
  return toBase64Url((await hmacSha256(secret, `ip:${gameNo}:${ip}`)).subarray(0, 16));
}

// ------------------------------------------------------------------ start

export async function handleDailyStart(
  body: unknown,
  ctx: DailyContext,
): Promise<DailyHandlerResult<DailyStartResponse>> {
  const limited = await ctx.limits?.start();
  if (limited?.ok === false) return rateLimited(limited.retryAfter, "starts");

  const parsed = parseDailyStart(body);
  if (!parsed.ok) return badRequest(parsed.detail);
  const req = parsed.value;

  const startedAt = ctx.clock().getTime();
  const gameNo = gameNoAt(startedAt, ctx.epoch);
  if (!isGame(gameNo)) return conflict("not_started");

  const name = checkNickname(req.nickname);
  if (!name.ok) {
    // Another script reads as a blocked name: "try another name".
    return name.problem === "script" ? rejectedName() : badRequest(`nickname_${name.problem}`);
  }
  if (!(ctx.moderate ?? moderate)(name.nickname)) return rejectedName();

  const verdict = await ctx.verifyTurnstile(req.turnstileToken);
  if (verdict === "fail") return { status: 403, body: { error: "verification_failed" } };
  if (verdict === "error") {
    return { status: 502, body: { error: "unavailable", detail: "turnstile" } };
  }

  const game = await ensureDailyGame(ctx.db, gameNo, inputs(ctx));
  const first = game.rounds[0];
  if (first === undefined) {
    return { status: 503, body: { error: "unavailable", detail: "the game has no rounds" } };
  }

  const runId = await mintRankedRunId(gameDate(gameNo, ctx.epoch), ctx.uuid(), ctx.secret);
  const key = runId.slice(0, runId.indexOf("."));
  const deviceHash = await hashDevice(ctx.secret, req.deviceId);
  const country = req.showCountry ? flagCountry(ctx.country) : null;
  const entry: NewEntry = {
    id: ctx.uuid(),
    gameNo,
    runKey: key,
    deviceHash,
    nickname: name.nickname,
    nicknameNormalised: normaliseNickname(name.nickname),
    country,
    startedAt,
  };
  const claimed = await claimEntry(ctx.db, entry);
  if (!claimed.ok) return conflict(claimed.reason);

  const nonce = ctx.uuid();
  let begun: DailyRunRecord | undefined;
  try {
    begun = await ctx.runs(key).dailyBegin({
      key,
      runId,
      gameNo,
      deviceHash,
      entryId: entry.id,
      country: ctx.country ?? "XX",
      deckVersion: game.deckVersion,
      changed: game.rounds.map((r) => r.statChanged),
      nonce,
      issuedAt: startedAt,
    });
  } catch (err) {
    // The run never started, so neither the attempt nor the name is used.
    await releaseEntry(ctx.db, entry);
    throw err;
  }
  if (begun === undefined) throw new Error("the run's ledger already existed");

  let repeat: number | undefined;
  if (ctx.ip !== undefined) {
    try {
      repeat = await countConnection(
        ctx.db,
        gameNo,
        await connectionHash(ctx.secret, gameNo, ctx.ip),
        key,
        startedAt,
      );
    } catch {
      // A measurement is never worth a failed start.
    }
  }

  const current = currentImages(ctx.deck, ctx.images);
  const token = await signDailyToken(ctx.secret, tokenFor(runId, gameNo, first, begun));
  ctx.record?.({
    type: "start",
    mode: "ranked",
    run: key,
    runKind: "fresh",
    gameNo,
    ...(repeat !== undefined ? { repeat } : {}),
  });
  return {
    status: 200,
    body: {
      runId,
      gameNo,
      round: dailyRoundPayload(first, current, game.rounds[1]),
      token,
      country,
      nickname: name.nickname,
    },
  };
}

// ------------------------------------------------------------------ guess

export async function handleDailyGuess(
  token: DailyPayload,
  guess: TimedGuess,
  ctx: DailyContext,
): Promise<DailyHandlerResult<DailyGuessResponse>> {
  const run = await verifyRankedRunId(token.runId, ctx.secret);
  if (run === undefined) return badRequest("token names no Daily run");

  const limited = await ctx.limits?.answer(run.body);
  if (limited?.ok === false) return rateLimited(limited.retryAfter, "answers");

  // The server's clock, the moment the answer arrived. Nothing the client says counts.
  const receivedAt = ctx.clock().getTime();

  const game = await readDailyGame(ctx.db, token.gameNo, ctx.epoch);
  const round = game?.rounds[token.round - 1];
  if (game === undefined || round === undefined || !matches(token, round)) {
    return conflict("token_mismatch");
  }

  const timedOut = guess === "timeout" || receivedAt > token.deadline;
  const correct = !timedOut && dailyIsCorrect(round, guess as "higher" | "lower");
  const advanced = await ctx.runs(run.body).dailyAdvance({
    nonce: token.nonce,
    round: token.round,
    guess,
    receivedAt,
    correct,
    nextNonce: ctx.uuid(),
  });
  if (!advanced.ok) return conflict(advanced.reason);

  // A resend of the latest step is answered as before, from what the ledger kept.
  const settled = advanced.outcome;
  const reveal = dailyReveal(round, advanced.correct);
  const current = currentImages(ctx.deck, ctx.images);
  const facts = { mode: "ranked", run: run.body, runKind: "fresh", gameNo: token.gameNo } as const;

  if (advanced.fresh) {
    ctx.record?.({
      type: "answer",
      ...facts,
      round: token.round,
      stat: round.stat,
      correct: advanced.correct,
      streak: correctOf(advanced.run.results) + bonusOf(advanced.run.results),
      relaxation: round.relaxation,
      band: round.band,
      rankDistance: round.distance,
      answerMs: advanced.ms,
    });
  }

  if (settled.kind === "next") {
    const following = game.rounds[token.round];
    if (following === undefined) throw new Error("a next token for a round the game can't deal");
    const continued: GuessContinueResponse = {
      reveal,
      next: dailyRoundPayload(following, current, game.rounds[token.round + 1]),
      token: await signDailyToken(
        ctx.secret,
        tokenFor(token.runId, token.gameNo, following, {
          ...advanced.run,
          issuedAt: settled.issuedAt,
          deadline: settled.deadline,
          nonce: settled.nonce,
        }),
      ),
    };
    return { status: 200, body: continued };
  }

  const result = await post(ctx, advanced.run, advanced.answers ?? []);
  if (advanced.fresh) {
    ctx.record?.({
      type: "end",
      ...facts,
      end: settled.end,
      score: result.score,
      correct: result.correct,
      bonus: result.bonus,
      final: finalStored(round, guess),
    });
  }
  const ended: DailyGuessEndResponse = { reveal, end: settled.end, result };
  return { status: 200, body: ended };
}

// ----------------------------------------------------------------- resume

export async function handleDailyResume(
  body: unknown,
  ctx: DailyContext,
): Promise<DailyHandlerResult<DailyResumeResponse>> {
  const parsed = parseResume(body);
  if (!parsed.ok) return badRequest(parsed.detail);
  const now = ctx.clock().getTime();
  const gameNo = gameNoAt(now, ctx.epoch);
  if (!isGame(gameNo)) return { status: 200, body: { state: "none" } };

  const deviceHash = await hashDevice(ctx.secret, parsed.value.deviceId);
  const open = await unfinishedEntry(ctx.db, deviceHash, gameNo);
  if (open === undefined) {
    // Nothing being played: today's result if there is one, so the page can show it.
    const played = await deviceEntry(ctx.db, deviceHash, gameNo);
    if (played === undefined || played.finished_at === null) {
      return { status: 200, body: { state: "none" } };
    }
    return {
      status: 200,
      body: { state: "finished", result: (await entryResult(ctx.db, played)).result },
    };
  }

  const limited = await ctx.limits?.answer(open.run_key);
  if (limited?.ok === false) return rateLimited(limited.retryAfter, "answers");

  const resumed = await ctx.runs(open.run_key).dailyResume({ deviceHash, now, nonce: ctx.uuid() });
  if (!resumed.ok) return conflict(resumed.reason);

  const facts = {
    mode: "ranked",
    run: open.run_key,
    runKind: "fresh",
    gameNo: open.game_no,
  } as const;
  if (resumed.kind === "over") {
    const result = await post(ctx, resumed.run, resumed.answers);
    if (resumed.ended) {
      ctx.record?.({
        type: "end",
        ...facts,
        end: resumed.run.end ?? "finished",
        score: result.score,
        correct: result.correct,
        bonus: result.bonus,
      });
    }
    return { status: 200, body: { state: "finished", result } };
  }

  const { run } = resumed;
  const game = await readDailyGame(ctx.db, run.gameNo, ctx.epoch);
  const round = game?.rounds[run.round - 1];
  if (game === undefined || round === undefined) throw new Error("a Daily run with no stored game");
  const current: CurrentImages = currentImages(ctx.deck, ctx.images);
  ctx.record?.({ type: "resume", ...facts, round: run.round, expired: resumed.expired });
  return {
    status: 200,
    body: {
      state: "playing",
      runId: run.runId,
      gameNo: run.gameNo,
      round: dailyRoundPayload(round, current, game.rounds[run.round]),
      token: await signDailyToken(ctx.secret, tokenFor(run.runId, run.gameNo, round, run)),
      remainingMs: resumed.remainingMs,
      results: run.results,
      nickname: open.nickname,
      country: open.country,
    },
  };
}

// ---------------------------------------------------------------- posting

/**
 * Posts a finished run and tells its Durable Object. A failure is logged and
 * answered with the result unranked: the object's alarm keeps trying.
 */
async function post(
  ctx: DailyContext,
  run: DailyRunRecord,
  answers: Parameters<typeof postDailyRun>[2],
): Promise<DailyResult> {
  const stub = ctx.runs(run.key);
  let posted: Posted;
  try {
    posted = await postDailyRun(ctx.db, run, answers);
  } catch (err) {
    safeLog(ctx, {
      level: "error",
      message: "unavailable · daily_post",
      event: "unavailable",
      route: "daily",
      reason: "daily_post",
      run: run.key,
      ...(err instanceof Error ? { cause: err.message.slice(0, 300) } : {}),
    });
    try {
      await stub.dailyPostFailed(ctx.clock().getTime());
    } catch {
      // The alarm is already set for the retry.
    }
    return unpostedResult(run, null);
  }
  try {
    await stub.dailyPosted();
  } catch {
    // Posting is idempotent: the alarm's retry changes nothing.
  }
  if (posted.fresh) recordPost(ctx, run, posted);
  return posted.result;
}

/** A run on the board: its `submit` event, and a warning when it is shadowed. */
export function recordPost(
  ctx: Pick<DailyContext, "record" | "log">,
  run: DailyRunRecord,
  posted: Posted,
): void {
  ctx.record?.({
    type: "submit",
    mode: "ranked",
    run: run.key,
    runKind: "fresh",
    gameNo: run.gameNo,
    score: posted.result.score,
    published: true,
    shadowed: posted.shadowed,
    ...(posted.result.rank !== null ? { rank: posted.result.rank } : {}),
  });
  if (posted.shadowed) {
    safeLog(ctx, {
      level: "warn",
      message: `score_shadowed · ${posted.reasons.join(",")}`,
      event: "score_shadowed",
      route: "daily",
      reason: posted.reasons.join(","),
      run: run.key,
      score: posted.result.score,
    });
  }
}

// --------------------------------------------------------------- helpers

function tokenFor(
  runId: string,
  gameNo: number,
  round: StoredRound,
  run: Pick<DailyRunRecord, "results" | "issuedAt" | "deadline" | "nonce">,
): DailyPayload {
  return {
    v: 1,
    runId,
    mode: "ranked",
    gameNo,
    round: round.index,
    correct: correctOf(run.results) + bonusOf(run.results),
    anchorId: round.anchor.id,
    challengerId: round.challenger.id,
    stat: round.stat,
    anchorValue: round.anchor.value,
    issuedAt: run.issuedAt,
    deadline: run.deadline,
    nonce: run.nonce,
  };
}

/** The token names exactly the stored round. */
function matches(token: DailyPayload, round: StoredRound): boolean {
  return (
    round.index === token.round &&
    round.stat === token.stat &&
    round.anchor.id === token.anchorId &&
    round.challenger.id === token.challengerId &&
    round.anchor.value === token.anchorValue
  );
}

type Parsed<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly detail: string };

const START_KEYS = ["deviceId", "mode", "nickname", "showCountry", "turnstileToken"];

export function parseDailyStart(body: unknown): Parsed<DailyStartRequest> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, detail: "body must be a JSON object" };
  }
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== START_KEYS.length || keys.some((k, i) => k !== START_KEYS[i])) {
    return {
      ok: false,
      detail: "expected { mode, nickname, showCountry, deviceId, turnstileToken }",
    };
  }
  const { mode, nickname, showCountry, deviceId, turnstileToken } = record;
  if (mode !== "ranked") return { ok: false, detail: 'mode must be "ranked"' };
  if (typeof nickname !== "string" || nickname.length > MAX_NICKNAME_CHARS) {
    return { ok: false, detail: "nickname must be a string" };
  }
  if (typeof showCountry !== "boolean") {
    return { ok: false, detail: "showCountry must be true or false" };
  }
  if (typeof deviceId !== "string" || !DEVICE_ID.test(deviceId)) {
    return { ok: false, detail: "deviceId must be a v4 uuid" };
  }
  if (
    typeof turnstileToken !== "string" ||
    turnstileToken === "" ||
    turnstileToken.length > MAX_TURNSTILE_CHARS
  ) {
    return { ok: false, detail: "turnstileToken must be a Turnstile token" };
  }
  return { ok: true, value: { mode, nickname, showCountry, deviceId, turnstileToken } };
}

export function parseResume(body: unknown): Parsed<{ deviceId: string; runId?: string }> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, detail: "body must be a JSON object" };
  }
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const shapes = [["deviceId"], ["deviceId", "runId"]];
  if (!shapes.some((s) => s.length === keys.length && s.every((k, i) => k === keys[i]))) {
    return { ok: false, detail: "expected { deviceId, runId? }" };
  }
  const { deviceId, runId } = record;
  if (typeof deviceId !== "string" || !DEVICE_ID.test(deviceId)) {
    return { ok: false, detail: "deviceId must be a v4 uuid" };
  }
  // Only a hint: the server finds the run from the device. Held to its type.
  if (runId !== undefined && (typeof runId !== "string" || runId.length > MAX_RUN_ID_CHARS)) {
    return { ok: false, detail: "runId must be a run id" };
  }
  return { ok: true, value: { deviceId, ...(typeof runId === "string" ? { runId } : {}) } };
}

function badRequest(detail: string): DailyHandlerResult<never> {
  return { status: 400, body: { error: "bad_request", detail } };
}

function conflict(detail: string): DailyHandlerResult<never> {
  return { status: 409, body: { error: "conflict", detail } };
}

/** The name didn't pass: the same calm answer whatever the reason. */
function rejectedName(): DailyHandlerResult<never> {
  return { status: 422, body: { error: "nickname_rejected" } };
}

function rateLimited(retryAfter: number, limit: "starts" | "answers"): DailyHandlerResult<never> {
  return { status: 429, body: { error: "rate_limited" }, retryAfter, limit };
}

function safeLog(ctx: Pick<DailyContext, "log">, line: LogLine): void {
  try {
    ctx.log?.(line);
  } catch {
    // A log line is never worth a failed answer.
  }
}
