/**
 * `POST /api/run/submit` (ARCHITECTURE.md §8): publishes a finished Endless
 * run to the boards, as a pure function of the request. Opt-in — the page
 * sends nothing here unless the player presses Publish.
 *
 * In order:
 *
 * 1. the submissions rate limit (per IP), then strict parsing, and the
 *    nickname's form (`checkNickname`);
 * 2. **the token**: the run's signed result, or, for a run banked after a
 *    dropped connection, its latest progress token. Its run id must be an
 *    Endless one the server signed, never a retired replay id, of a variant
 *    with boards (Instagram Endless has none: `no_boards`, before anything
 *    else is touched), and its score above 0;
 * 3. **the run's Durable Object** agrees (`claimForSubmit`): the run was
 *    started by `/api/run/start` — so it is a fresh random run, a challenge
 *    run included, never a sequence the player could have learned — it is
 *    over, its streak and end are what the token says, it hasn't been
 *    published, and it ended no more than 30 minutes ago;
 * 4. Turnstile;
 * 5. moderation (moderation.ts): a blocked name is a calm 422;
 * 6. the timing heuristics (shadow.ts): a flagged score is stored, shadowed;
 * 7. the insert — `run_id` is unique, the last word on "once" — and then the
 *    Durable Object marks the run published;
 * 8. the response: the entry, and where it stands today, this week and this
 *    month as its owner sees it (scores.ts `ownStanding`): the device's best
 *    in each, and whether this run is now it (`improved`). A worse run is
 *    still accepted — the page may not know about the better one, after its
 *    storage was cleared or from another tab — but the board keeps the best.
 *
 * The periods are the run's own — the date it started — so a run begun at
 * 23:58 is ranked on that day's board even if published after midnight.
 *
 * **Privacy.** The device id is a random id the browser keeps; only
 * HMAC(RUN_SECRET, "device:" + id) is stored or used, never the id. The
 * nickname never reaches a log line or a data point.
 */

import {
  buildRun,
  checkNickname,
  dayKey,
  flagCountry,
  hasBoards,
  normaliseNickname,
  periodsOf,
  variantOf,
} from "@bt/core";
import type {
  ApiError,
  EndlessVariantId,
  Player,
  PeriodRank,
  SubmitRequest,
  SubmitResponse,
} from "@bt/core";
import type { GameEvent, RunKind } from "./analytics.js";
import { hmacSha256, toBase64Url } from "./hmac.js";
import type { Logger } from "./log.js";
import { moderate } from "./moderation.js";
import type { RateDecision } from "./rate-limit.js";
import type { ClaimRefusal, ClaimResult, SubmitClaim } from "./run-ledger.js";
import { verifyRunId } from "./run-id.js";
import { disconnectedEnd, named } from "./run.js";
import { DuplicateRunError, insertScore, ownStanding } from "./scores.js";
import type { D1Like, DayRange } from "./scores.js";
import { endlessSeed } from "./seed.js";
import { shadowReasons, thinkMs } from "./shadow.js";
import { MAX_TOKEN_CHARS, verifyResult, verifyToken } from "./token.js";
import type { TurnstileOutcome } from "./turnstile.js";

/** What submission needs of a run's Durable Object. */
export interface SubmitStub {
  claimForSubmit(claim: SubmitClaim): Promise<ClaimResult>;
  markSubmitted(): Promise<boolean>;
}

export interface SubmitContext {
  readonly deck: readonly Player[];
  readonly secret: string;
  readonly clock: () => Date;
  readonly uuid: () => string;
  readonly verifyTurnstile: (token: string) => Promise<TurnstileOutcome>;
  /** The Durable Object for the run with this key. */
  readonly runs: (key: string) => SubmitStub;
  readonly db: D1Like;
  /** Submissions per IP. */
  readonly limit?: () => Promise<RateDecision>;
  /** The blocklist check; the shipped one by default. */
  readonly moderate?: (nickname: string) => boolean;
  /** Must not throw. */
  readonly record?: (event: GameEvent) => void;
  /** For the shadow line and a failed mark. Must not throw. */
  readonly log?: Logger;
  /**
   * Cloudflare's `request.cf.country` for the publishing connection, kept as
   * the flag's code only if the player asked for it and there is a flag for
   * it. Nothing else about where they are is ever read.
   */
  readonly country?: string;
}

export type SubmitResult =
  | { readonly status: 200; readonly body: SubmitResponse }
  | {
      readonly status: 400 | 403 | 409 | 422 | 502 | 503;
      readonly body: ApiError;
      /** For the log line, when it differs from the detail. */
      readonly reason?: string;
      readonly cause?: string;
    }
  | { readonly status: 429; readonly body: ApiError; readonly retryAfter: number };

export const SUBMIT_PATH = "/api/run/submit";

/** Far past a real nickname; the rules are checked after. */
const MAX_NICKNAME_CHARS = 64;
const MAX_TURNSTILE_CHARS = 2048;
const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A run's streak for the boards: a result's score, or a banked run's verified streak. */
interface Claimed {
  readonly runId: string;
  /** The variant the token was signed for: general Endless when it names none. */
  readonly variant: EndlessVariantId;
  readonly score: number;
  readonly claim: Omit<SubmitClaim, "now">;
}

export async function handleSubmit(body: unknown, ctx: SubmitContext): Promise<SubmitResult> {
  const limited = await ctx.limit?.();
  if (limited?.ok === false) {
    return { status: 429, body: { error: "rate_limited" }, retryAfter: limited.retryAfter };
  }

  const parsed = parseSubmit(body);
  if (!parsed.ok) return badRequest(parsed.detail);
  const req = parsed.value;

  const name = checkNickname(req.nickname);
  if (!name.ok) {
    // Another script reads as a blocked name: "try another name".
    return name.problem === "script"
      ? rejectedName("nickname_script")
      : badRequest(`nickname_${name.problem}`);
  }

  const token = await readToken(ctx.secret, req.token);
  if (token === undefined) return badRequest("token is not one this server issued");
  const run = await verifyRunId(token.runId, ctx.secret, token.variant);
  if (run === undefined || run.replay) return badRequest("token names no fresh Endless run");
  // A variant without boards (Instagram Endless, every "Clear the squad"
  // theme) never publishes: refused before its Durable Object, Turnstile or
  // the database are touched.
  if (!hasBoards(token.variant)) {
    ctx.record?.({
      type: "submit",
      mode: "endless",
      ...named(token.variant),
      run: run.body,
      runKind: "fresh",
      score: token.score,
      published: false,
      shadowed: false,
      refusal: "no_boards",
    });
    return badRequest("no_boards");
  }
  if (token.score <= 0) return badRequest("zero");

  const now = ctx.clock().getTime();
  const claimed = await ctx.runs(run.body).claimForSubmit({ ...token.claim, now });
  const refused = (refusal: string, runKind: RunKind = "fresh"): void =>
    ctx.record?.({
      type: "submit",
      mode: "endless",
      run: run.body,
      runKind,
      score: token.score,
      published: false,
      shadowed: false,
      refusal,
    });
  if (!claimed.ok) {
    refused(claimed.reason);
    return conflict(claimed.reason);
  }
  const { runKind } = claimed.run;
  if (claimed.closed) {
    // The claim closed a banked run's open question: its end, as the alarm would record it.
    try {
      ctx.record?.(await disconnectedEnd(claimed.run, ctx.deck, ctx.secret));
    } catch {
      // Telemetry is never worth a failed publish.
    }
  }

  const verdict = await ctx.verifyTurnstile(req.turnstileToken);
  if (verdict !== "pass") {
    refused(verdict === "fail" ? "verification_failed" : "unavailable", runKind);
    return verdict === "fail"
      ? { status: 403, body: { error: "verification_failed" } }
      : { status: 502, body: { error: "unavailable", detail: "turnstile" }, reason: "turnstile" };
  }

  if (!(ctx.moderate ?? moderate)(name.nickname)) {
    refused("nickname_rejected", runKind);
    return rejectedName("nickname_blocked");
  }

  const reasons = shadowReasons(claimed.answers);
  const shadowed = reasons.length > 0;
  // The tiebreak: each answer less its own round's animation, from the run's sequence.
  const rounds = buildRun({
    deck: ctx.deck,
    seed: await endlessSeed(ctx.secret, run.origin),
    mode: "endless",
    now: run.date,
    maxRounds: claimed.run.round,
  });
  const changed = new Set(rounds.filter((r) => r.statChanged).map((r) => r.index));
  const think = thinkMs(claimed.answers, (round) => changed.has(round));
  const country = req.showCountry ? flagCountry(ctx.country) : null;
  const deviceHash = await hashDevice(ctx.secret, req.deviceId);
  const id = ctx.uuid();
  const periods = periodsOf(run.date);
  let standings: Record<keyof typeof periods, PeriodRank>;
  try {
    await insertScore(ctx.db, {
      id,
      mode: "endless",
      dayKey: dayKey(run.date),
      nickname: name.nickname,
      nicknameNormalised: normaliseNickname(name.nickname),
      streak: claimed.run.streak,
      thinkMs: think,
      country,
      deviceHash,
      runKey: run.body,
      createdAt: now,
      shadow: shadowed,
      shadowReason: shadowed ? reasons.join(",") : null,
    });
    const rank = async (period: keyof typeof periods): Promise<PeriodRank> => {
      const p = periods[period];
      const range: DayRange = { from: p.from, to: p.to };
      const standing = await ownStanding(ctx.db, "endless", deviceHash, range);
      if (standing === undefined) throw new Error("the new entry isn't in its own period");
      return {
        key: p.key,
        current: now < p.resetsAt,
        rank: standing.rank,
        total: standing.total,
        resetsAt: p.resetsAt,
        entryId: standing.entryId,
        best: standing.streak,
        improved: standing.entryId === id,
      };
    };
    const [day, week, month] = await Promise.all([rank("day"), rank("week"), rank("month")]);
    standings = { day, week, month };
  } catch (err) {
    if (err instanceof DuplicateRunError) {
      refused("submitted", runKind);
      return conflict("submitted");
    }
    return {
      status: 503,
      body: { error: "unavailable", detail: "scores" },
      reason: "scores",
      ...(err instanceof Error ? { cause: err.message.slice(0, 300) } : {}),
    };
  }

  try {
    await ctx.runs(run.body).markSubmitted();
  } catch (err) {
    // Stored already, and run_id's uniqueness still stops a second publish.
    safeLog(ctx, {
      level: "error",
      message: "unavailable · run_store",
      event: "unavailable",
      route: SUBMIT_PATH,
      reason: "run_store",
      run: run.body,
      ...(err instanceof Error ? { cause: err.message.slice(0, 300) } : {}),
    });
  }

  if (shadowed) {
    safeLog(ctx, {
      level: "warn",
      message: `score_shadowed · ${reasons.join(",")}`,
      event: "score_shadowed",
      route: SUBMIT_PATH,
      reason: reasons.join(","),
      run: run.body,
      id,
      score: claimed.run.streak,
    });
  }
  ctx.record?.({
    type: "submit",
    mode: "endless",
    run: run.body,
    runKind,
    score: claimed.run.streak,
    published: true,
    shadowed,
    id,
    ranks: { day: standings.day.rank, week: standings.week.rank, month: standings.month.rank },
  });

  return {
    status: 200,
    body: { id, nickname: name.nickname, streak: claimed.run.streak, periods: standings },
  };
}

/** The keyed hash stored for a device: friction, not identity. The raw id is never kept. */
export async function hashDevice(secret: string, deviceId: string): Promise<string> {
  return toBase64Url((await hmacSha256(secret, `device:${deviceId}`)).subarray(0, 16));
}

async function readToken(secret: string, token: string): Promise<Claimed | undefined> {
  const result = await verifyResult(secret, token);
  if (result !== undefined) {
    return {
      runId: result.runId,
      variant: variantOf(result.variant),
      score: result.score,
      claim: {
        runId: result.runId,
        score: result.score,
        result: { end: result.end, endedAt: result.endedAt },
      },
    };
  }
  const progress = await verifyToken(secret, token);
  if (progress === undefined) return undefined;
  return {
    runId: progress.runId,
    variant: variantOf(progress.variant),
    score: progress.streak,
    claim: {
      runId: progress.runId,
      score: progress.streak,
      progress: { nonce: progress.nonce, round: progress.round },
    },
  };
}

type Parsed<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly detail: string };

const KEYS = ["deviceId", "nickname", "showCountry", "token", "turnstileToken"];

export function parseSubmit(body: unknown): Parsed<SubmitRequest> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, detail: "body must be a JSON object" };
  }
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== KEYS.length || keys.some((k, i) => k !== KEYS[i])) {
    return {
      ok: false,
      detail: "expected { token, nickname, deviceId, turnstileToken, showCountry }",
    };
  }
  const { token, nickname, deviceId, turnstileToken, showCountry } = record;
  if (typeof token !== "string" || token === "" || token.length > MAX_TOKEN_CHARS) {
    return { ok: false, detail: "token must be a result or progress token" };
  }
  if (typeof nickname !== "string" || nickname.length > MAX_NICKNAME_CHARS) {
    return { ok: false, detail: "nickname must be a string" };
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
  if (typeof showCountry !== "boolean") {
    return { ok: false, detail: "showCountry must be true or false" };
  }
  return { ok: true, value: { token, nickname, deviceId, turnstileToken, showCountry } };
}

function badRequest(detail: string): SubmitResult {
  return { status: 400, body: { error: "bad_request", detail } };
}

function conflict(reason: ClaimRefusal): SubmitResult {
  return { status: 409, body: { error: "conflict", detail: reason } };
}

/** The name didn't pass: the same calm answer whatever the reason, which only the log keeps. */
function rejectedName(reason: string): SubmitResult {
  return { status: 422, body: { error: "nickname_rejected" }, reason };
}

function safeLog(ctx: SubmitContext, line: Parameters<Logger>[0]): void {
  try {
    ctx.log?.(line);
  } catch {
    // A log line is never worth a failed publish.
  }
}
