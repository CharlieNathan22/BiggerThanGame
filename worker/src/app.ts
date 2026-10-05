/**
 * HTTP routing around the pure handlers: Friendly's `/api/round/next`
 * (round.ts), Endless's `/api/run/start` and `/api/round/guess` (run.ts),
 * publishing to the boards, `/api/run/submit` (submit.ts), the boards
 * themselves, `GET /api/board/endless/:period` (board.ts), `/api/feedback`
 * (feedback.ts) and `/api/run/leave` (leave.ts). And the nightly cron
 * (cron.ts), as `scheduled`.
 *
 * `/api/*` runs here (`run_worker_first` in wrangler.toml); everything else is
 * the static site, served from the ASSETS binding. Every `/api/*` response is
 * `no-store` — a cached round response would be served to someone else.
 *
 * Built by `createApp` with the deck injected, so tests exercise the real
 * routing, rate limiting and error mapping against a fixture deck and mocked
 * bindings. `worker/index.ts` wires in the bundled deck and nothing else.
 *
 * Observability (ARCHITECTURE.md §19): every refusal and failure is one
 * structured log line (log.ts) — `warn` for a 4xx or 429, `error` for ours —
 * and the round handler's game events go to Analytics Engine, with a log line
 * for each run's start and end (analytics.ts). An accepted feedback message is
 * one `info` line with what was sent (feedback.ts). None can change a response.
 */

import type { ApiError, BoardPeriod, Player } from "@bt/core";
import { countryOf, toDataPoint, toLogLine } from "./analytics.js";
import { parseBoardPeriod, serveBoard } from "./board.js";
import type { BoardCache } from "./board.js";
import { runNightly } from "./cron.js";
import type { AnalyticsDataset, EventContext, GameEvent } from "./analytics.js";
import { feedbackLogLine, handleFeedback } from "./feedback.js";
import { handleLeave } from "./leave.js";
import { MAX_MINE_BYTES, MINE_PATH, handleMine } from "./mine.js";
import { describeError, log, problemMessage } from "./log.js";
import type { Logger } from "./log.js";
import { buildPlainTextMime, isPlainAddress } from "./mail.js";
import type { ImageLookup } from "./payload.js";
import { RATE_LIMITS, checkRateLimit, rateLimitKey } from "./rate-limit.js";
import type { RateLimiter, RateLimiters } from "./rate-limit.js";
import { handleNextRound } from "./round.js";
import { handleGuess, handleRunStart } from "./run.js";
import type { RunContext, RunResult, RunStub } from "./run.js";
import type { D1Like } from "./scores.js";
import { SUBMIT_PATH, handleSubmit } from "./submit.js";
import type { SubmitStub } from "./submit.js";
import { verifyTurnstile } from "./turnstile.js";
import type { FetchLike } from "./turnstile.js";

/**
 * An `EmailMessage` from `cloudflare:email`: opaque here, so this module
 * compiles under Node test types too.
 */
export interface OutgoingEmail {
  readonly from: string;
  readonly to: string;
}

/** Bindings, typed structurally so this module compiles under Node test types too. */
export interface Env {
  readonly ASSETS: { fetch(request: Request): Promise<Response> };
  /** A Worker secret. Locally from `.dev.vars`. */
  readonly RUN_SECRET?: string;
  /** Answers per signed run id. */
  readonly RUN_ANSWERS: RateLimiter;
  /** Run starts per IP. */
  readonly RUN_STARTS: RateLimiter;
  /** Every request per IP: the flood backstop. */
  readonly ROUND_FLOOD: RateLimiter;
  /** Feedback messages per IP. */
  readonly FEEDBACK_SENDS: RateLimiter;
  /** A Worker secret: the Turnstile widget's secret key. Locally from `.dev.vars`. */
  readonly TURNSTILE_SECRET?: string;
  /** A Worker secret: where feedback is emailed. Never in the repo. */
  readonly FEEDBACK_TO?: string;
  /** The `send_email` binding (Email Routing). Takes what `emailMessage` builds. */
  readonly FEEDBACK_EMAIL: { send(message: OutgoingEmail): Promise<unknown> };
  /**
   * The Analytics Engine dataset for gameplay events. Optional: without it
   * (some tests, a misconfigured deploy) the game plays exactly the same.
   */
  readonly GAME_EVENTS?: AnalyticsDataset;
  /** One Durable Object per Endless run (run-do.ts): spends each token once. */
  readonly RUNS?: RunNamespace;
  /** D1: the boards' scores and snapshots (scores.ts). */
  readonly DB?: D1Like;
  /** Publishes per IP. */
  readonly RUN_SUBMITS?: RateLimiter;
  /** Live rank lookups per IP. */
  readonly BOARD_LOOKUPS?: RateLimiter;
}

/** The part of the Workers `ExecutionContext` the app uses. */
export interface WaitContext {
  waitUntil(promise: Promise<unknown>): void;
}

/** The `RUNS` Durable Object namespace, typed structurally for Node tests. */
export interface RunNamespace {
  idFromName(name: string): unknown;
  get(id: never): RunStub & SubmitStub;
}

export interface AppDeps {
  readonly deck: readonly Player[];
  readonly images: ImageLookup;
  /** The bundled deck's version (`deckVersion` in @bt/deck), for analytics. */
  readonly deckVersion?: string;
  readonly clock?: () => Date;
  readonly uuid?: () => string;
  /**
   * Wraps a raw MIME message for the `send_email` binding. worker/index.ts
   * passes `new EmailMessage(…)` from `cloudflare:email`, which only exists in
   * workerd; without it, every send fails cleanly.
   */
  readonly emailMessage?: (from: string, to: string, raw: string) => OutgoingEmail;
  /** For Turnstile's Siteverify. The global `fetch` by default. */
  readonly fetch?: FetchLike;
  /** Where log lines go. The console (Workers Logs) by default. */
  readonly log?: Logger;
  /**
   * The board cache: `caches.default` in workerd by default, none where it
   * doesn't exist (so every board read goes to D1).
   */
  readonly cache?: () => BoardCache | undefined;
}

export const ROUND_PATH = "/api/round/next";
export const FEEDBACK_PATH = "/api/feedback";
export const LEAVE_PATH = "/api/run/leave";
export const RUN_START_PATH = "/api/run/start";
export const GUESS_PATH = "/api/round/guess";
export { SUBMIT_PATH };
export const BOARD_PATH = "/api/board/endless";
export { MINE_PATH };

/**
 * An Endless start: a Turnstile token (up to 2,048 characters) and perhaps a
 * challenge link. A guess: a progress token (under 1,024) and a word.
 */
export const MAX_RUN_BYTES = 4096;

/** Requests are two tiny flat objects; anything bigger is not a real client. */
const MAX_BODY_BYTES = 1024;

/**
 * A feedback body at its limits: a Turnstile token, a 1000-character note and
 * an 80-character name, even with every character JSON-escaped. Anything
 * bigger is not the form.
 */
export const MAX_FEEDBACK_BYTES = 16 * 1024;

/** A leave beacon is five short fields; a real one is about 170 bytes. */
export const MAX_LEAVE_BYTES = 512;

type Route =
  | typeof ROUND_PATH
  | typeof FEEDBACK_PATH
  | typeof LEAVE_PATH
  | typeof RUN_START_PATH
  | typeof GUESS_PATH
  | typeof SUBMIT_PATH
  | typeof BOARD_PATH
  | typeof MINE_PATH;

/** The run's Durable Object failed us: our problem, a calm 503. */
class RunStoreError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "RunStoreError";
  }
}

interface Refusal {
  /** In the response body. */
  readonly detail?: string;
  /** In the log line only; defaults to `detail`. */
  readonly reason?: string;
  /** In the log line only: more about the reason, e.g. an exception's message. */
  readonly cause?: string;
  readonly headers?: Record<string, string>;
}

export function createApp(deps: AppDeps): {
  fetch(request: Request, env: Env, ctx?: WaitContext): Promise<Response>;
  scheduled(controller: { scheduledTime: number; cron: string }, env: Env): Promise<void>;
} {
  const clock = deps.clock ?? (() => new Date());
  const uuid = deps.uuid ?? (() => crypto.randomUUID());
  const logger = deps.log ?? log;
  const deckVersion = deps.deckVersion ?? "unknown";

  const fetchFn: FetchLike = deps.fetch ?? ((input, init) => fetch(input, init));
  const boardCache =
    deps.cache ??
    ((): BoardCache | undefined =>
      (globalThis as { caches?: { default?: BoardCache } }).caches?.default);
  const emailMessage =
    deps.emailMessage ??
    ((): OutgoingEmail => {
      throw new Error("no EmailMessage constructor outside workerd");
    });

  /** Logged once per isolate, so a broken binding can't flood the logs. */
  let analyticsFailureLogged = false;

  /**
   * The round and leave handlers' `record`: the event to Analytics Engine,
   * and a log line for a run's start, end or leave. Fire-and-forget —
   * `writeDataPoint` doesn't block, and nothing here can throw into the handler.
   */
  function recorder(request: Request, env: Env, route: Route): (event: GameEvent) => void {
    const ctx: EventContext = { country: countryOf(request), deckVersion };
    return (event) => {
      try {
        const line = toLogLine(event, ctx, route);
        if (line !== undefined) logger(line);
      } catch {
        // A log line is never worth a failed answer.
      }
      const dataset = env.GAME_EVENTS;
      if (dataset === undefined) return;
      try {
        dataset.writeDataPoint(toDataPoint(event, ctx));
      } catch (err) {
        if (analyticsFailureLogged) return;
        analyticsFailureLogged = true;
        try {
          const { reason, cause } = describeError(err);
          logger({
            level: "error",
            message: problemMessage("analytics_failed", reason),
            event: "analytics_failed",
            route,
            reason,
            ...(cause !== undefined ? { cause } : {}),
          });
        } catch {
          // As above.
        }
      }
    };
  }

  /** An error response, and its log line: `warn` for a 4xx, `error` for ours. */
  function refuse(
    route: Route,
    status: number,
    code: ApiError["error"],
    { detail, reason = detail, cause, headers = {} }: Refusal = {},
  ): Response {
    logger({
      level: status >= 500 ? "error" : "warn",
      message: problemMessage(code, reason),
      event: code,
      route,
      status,
      ...(reason !== undefined ? { reason } : {}),
      ...(cause !== undefined ? { cause } : {}),
    });
    return error(status, code, detail, headers);
  }

  function rateLimited(route: Route, retryAfter: number, limit: string): Response {
    return refuse(route, 429, "rate_limited", {
      reason: limit,
      headers: { "retry-after": String(retryAfter) },
    });
  }

  async function feedback(request: Request, env: Env): Promise<Response> {
    const route = FEEDBACK_PATH;
    const limiters = limitersOf(env);
    const ip = rateLimitKey(request.headers.get("cf-connecting-ip"));

    // Before any work: every message costs a Turnstile check and an email.
    const limited = await checkRateLimit(limiters, "feedback", ip);
    if (!limited.ok) return rateLimited(route, limited.retryAfter, "feedback");

    if (request.method !== "POST") {
      return refuse(route, 405, "method_not_allowed", { headers: { allow: "POST" } });
    }

    const { RUN_SECRET: secret, TURNSTILE_SECRET: turnstileSecret, FEEDBACK_TO: to } = env;
    if (!secret || !turnstileSecret || !to || !isPlainAddress(to)) {
      const missing = [
        secret ? "" : "RUN_SECRET",
        turnstileSecret ? "" : "TURNSTILE_SECRET",
        to && isPlainAddress(to) ? "" : "FEEDBACK_TO",
      ].filter((name) => name !== "");
      // Names only, never values.
      return refuse(route, 500, "internal", {
        reason: "not_configured",
        cause: `${missing.join(", ")} missing or invalid`,
      });
    }

    const declared = Number(request.headers.get("content-length"));
    if (declared > MAX_FEEDBACK_BYTES) {
      return refuse(route, 400, "bad_request", { detail: "body_too_large" });
    }
    const text = await request.text();
    if (new TextEncoder().encode(text).length > MAX_FEEDBACK_BYTES) {
      return refuse(route, 400, "bad_request", { detail: "body_too_large" });
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return refuse(route, 400, "bad_request", { detail: "invalid_json" });
    }

    try {
      const result = await handleFeedback(body, {
        deck: deps.deck,
        secret,
        clock,
        to,
        uuid,
        verifyTurnstile: (token) => verifyTurnstile(token, turnstileSecret, fetchFn),
        accepted: (accepted) => {
          try {
            logger(feedbackLogLine(accepted, countryOf(request), route));
          } catch {
            // A log line is never worth a lost message.
          }
        },
        send: async (mail) => {
          const message = emailMessage(mail.from, mail.to, buildPlainTextMime(mail));
          await env.FEEDBACK_EMAIL.send(message);
        },
      });
      if (result.status === 200) return json(200, result.body);
      return refuse(route, result.status, result.body.error, {
        ...(result.body.detail !== undefined ? { detail: result.body.detail } : {}),
        ...(result.status === 502 ? { reason: result.reason } : {}),
      });
    } catch (err) {
      // Errors from the engine or config, never user text: sends are caught in feedback.ts.
      return refuse(route, 500, "internal", describeError(err));
    }
  }

  async function round(request: Request, env: Env): Promise<Response> {
    const route = ROUND_PATH;
    const limiters = limitersOf(env);
    const ip = rateLimitKey(request.headers.get("cf-connecting-ip"));

    // The backstop comes before any work, so a flood stays cheap. The run
    // start and answer limits need the parsed request, so round.ts applies them.
    const flood = await checkRateLimit(limiters, "flood", ip);
    if (!flood.ok) return rateLimited(route, flood.retryAfter, "flood");

    if (request.method !== "POST") {
      return refuse(route, 405, "method_not_allowed", { headers: { allow: "POST" } });
    }

    const secret = env.RUN_SECRET;
    if (secret === undefined || secret === "") {
      return refuse(route, 500, "internal", {
        reason: "not_configured",
        cause: "RUN_SECRET missing",
      });
    }

    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      return refuse(route, 400, "bad_request", { detail: "body too large" });
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return refuse(route, 400, "bad_request", { detail: "body must be JSON" });
    }

    try {
      const result = await handleNextRound(body, {
        deck: deps.deck,
        images: deps.images,
        secret,
        clock,
        uuid,
        limits: {
          start: () => checkRateLimit(limiters, "starts", ip),
          answer: (run) => checkRateLimit(limiters, "answers", run),
        },
        record: recorder(request, env, route),
      });
      if (result.status === 200) return json(200, result.body);
      if (result.status === 429) return rateLimited(route, result.retryAfter, result.limit);
      return refuse(
        route,
        result.status,
        result.body.error,
        result.body.detail !== undefined ? { detail: result.body.detail } : {},
      );
    } catch (err) {
      return refuse(route, 500, "internal", describeError(err));
    }
  }

  /**
   * Endless's start and guess (run.ts). Behind the flood limit like every
   * round request; the run-start and per-run answer limits apply in the
   * handler, once it knows which it is. The run's Durable Object is reached
   * through `RUNS`; if it fails, the answer is a calm 503.
   */
  async function endless(request: Request, env: Env, route: Route): Promise<Response> {
    const limiters = limitersOf(env);
    const ip = rateLimitKey(request.headers.get("cf-connecting-ip"));
    const flood = await checkRateLimit(limiters, "flood", ip);
    if (!flood.ok) return rateLimited(route, flood.retryAfter, "flood");

    if (request.method !== "POST") {
      return refuse(route, 405, "method_not_allowed", { headers: { allow: "POST" } });
    }
    const { RUN_SECRET: secret, TURNSTILE_SECRET: turnstileSecret, RUNS: runs } = env;
    const starting = route === RUN_START_PATH;
    if (!secret || runs === undefined || (starting && !turnstileSecret)) {
      const missing = [
        secret ? "" : "RUN_SECRET",
        runs === undefined ? "RUNS" : "",
        starting && !turnstileSecret ? "TURNSTILE_SECRET" : "",
      ].filter((name) => name !== "");
      return refuse(route, 500, "internal", {
        reason: "not_configured",
        cause: `${missing.join(", ")} missing`,
      });
    }

    const text = await request.text();
    if (new TextEncoder().encode(text).length > MAX_RUN_BYTES) {
      return refuse(route, 400, "bad_request", { detail: "body too large" });
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return refuse(route, 400, "bad_request", { detail: "body must be JSON" });
    }

    const ctx: RunContext = {
      deck: deps.deck,
      images: deps.images,
      secret,
      clock,
      uuid,
      verifyTurnstile: (token) => verifyTurnstile(token, turnstileSecret ?? "", fetchFn),
      runs: (key) => runStub(runs, key),
      limits: {
        start: () => checkRateLimit(limiters, "starts", ip),
        answer: (run) => checkRateLimit(limiters, "answers", run),
      },
      record: recorder(request, env, route),
      country: countryOf(request),
      deckVersion,
    };
    try {
      const result: RunResult = starting
        ? await handleRunStart(body, ctx)
        : await handleGuess(body, ctx);
      if (result.status === 200) return json(200, result.body);
      if (result.status === 429) return rateLimited(route, result.retryAfter, result.limit);
      return refuse(
        route,
        result.status,
        result.body.error,
        result.body.detail !== undefined ? { detail: result.body.detail } : {},
      );
    } catch (err) {
      if (err instanceof RunStoreError) {
        return refuse(route, 503, "unavailable", { reason: "run_store", cause: err.message });
      }
      return refuse(route, 500, "internal", describeError(err));
    }
  }

  /**
   * The leave beacon (leave.ts). Behind the flood limit like every round
   * request; always an empty 204 once it checks out, and it changes nothing.
   */
  async function leave(request: Request, env: Env): Promise<Response> {
    const route = LEAVE_PATH;
    const ip = rateLimitKey(request.headers.get("cf-connecting-ip"));
    const flood = await checkRateLimit(limitersOf(env), "flood", ip);
    if (!flood.ok) return rateLimited(route, flood.retryAfter, "flood");

    if (request.method !== "POST") {
      return refuse(route, 405, "method_not_allowed", { headers: { allow: "POST" } });
    }
    const secret = env.RUN_SECRET;
    if (secret === undefined || secret === "") {
      return refuse(route, 500, "internal", {
        reason: "not_configured",
        cause: "RUN_SECRET missing",
      });
    }
    const text = await request.text();
    if (new TextEncoder().encode(text).length > MAX_LEAVE_BYTES) {
      return refuse(route, 400, "bad_request", { detail: "body too large" });
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return refuse(route, 400, "bad_request", { detail: "body must be JSON" });
    }

    try {
      const result = await handleLeave(body, {
        deck: deps.deck,
        secret,
        clock,
        record: recorder(request, env, route),
      });
      if (result.status === 204) {
        return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
      }
      return refuse(
        route,
        result.status,
        result.body.error,
        result.body.detail !== undefined ? { detail: result.body.detail } : {},
      );
    } catch (err) {
      return refuse(route, 500, "internal", describeError(err));
    }
  }

  /**
   * Publishing (submit.ts). Behind the flood limit like the round requests,
   * then its own limit per IP, in the handler before any other work. A D1
   * failure is a calm 503, logged as an error; so is the run's Durable Object
   * failing.
   */
  async function submit(request: Request, env: Env): Promise<Response> {
    const route = SUBMIT_PATH;
    const ip = rateLimitKey(request.headers.get("cf-connecting-ip"));
    const flood = await checkRateLimit(limitersOf(env), "flood", ip);
    if (!flood.ok) return rateLimited(route, flood.retryAfter, "flood");

    if (request.method !== "POST") {
      return refuse(route, 405, "method_not_allowed", { headers: { allow: "POST" } });
    }
    const { RUN_SECRET: secret, TURNSTILE_SECRET: turnstileSecret, RUNS: runs, DB: db } = env;
    const submits = env.RUN_SUBMITS;
    if (!secret || !turnstileSecret || runs === undefined || db === undefined || !submits) {
      const missing = [
        secret ? "" : "RUN_SECRET",
        turnstileSecret ? "" : "TURNSTILE_SECRET",
        runs === undefined ? "RUNS" : "",
        db === undefined ? "DB" : "",
        submits ? "" : "RUN_SUBMITS",
      ].filter((name) => name !== "");
      return refuse(route, 500, "internal", {
        reason: "not_configured",
        cause: `${missing.join(", ")} missing`,
      });
    }

    const text = await request.text();
    if (new TextEncoder().encode(text).length > MAX_RUN_BYTES) {
      return refuse(route, 400, "bad_request", { detail: "body too large" });
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return refuse(route, 400, "bad_request", { detail: "body must be JSON" });
    }

    try {
      const result = await handleSubmit(body, {
        deck: deps.deck,
        secret,
        clock,
        uuid,
        country: countryOf(request),
        verifyTurnstile: (token) => verifyTurnstile(token, turnstileSecret, fetchFn),
        runs: (key) => runStub(runs, key),
        db,
        limit: async () => {
          const { success } = await submits.limit({ key: ip });
          return success ? { ok: true } : { ok: false, retryAfter: RATE_LIMITS.submits.period };
        },
        record: recorder(request, env, route),
        log: (line) => {
          try {
            logger(line);
          } catch {
            // A log line is never worth a failed publish.
          }
        },
      });
      if (result.status === 200) return json(200, result.body);
      if (result.status === 429) return rateLimited(route, result.retryAfter, "submits");
      return refuse(route, result.status, result.body.error, {
        ...(result.body.detail !== undefined ? { detail: result.body.detail } : {}),
        ...(result.reason !== undefined ? { reason: result.reason } : {}),
        ...(result.cause !== undefined ? { cause: result.cause } : {}),
      });
    } catch (err) {
      if (err instanceof RunStoreError) {
        return refuse(route, 503, "unavailable", { reason: "run_store", cause: err.message });
      }
      return refuse(route, 500, "internal", describeError(err));
    }
  }

  /**
   * A board (board.ts): from the cache, or D1 on a miss. Behind the flood
   * limit. Only the three current periods exist; anything else under the
   * path is a 404 like any unknown path.
   */
  async function board(
    request: Request,
    env: Env,
    period: BoardPeriod,
    ctx: WaitContext | undefined,
  ): Promise<Response> {
    const route = BOARD_PATH;
    const ip = rateLimitKey(request.headers.get("cf-connecting-ip"));
    const flood = await checkRateLimit(limitersOf(env), "flood", ip);
    if (!flood.ok) return rateLimited(route, flood.retryAfter, "flood");
    if (request.method !== "GET") {
      return refuse(route, 405, "method_not_allowed", { headers: { allow: "GET" } });
    }
    const db = env.DB;
    if (db === undefined) {
      return refuse(route, 500, "internal", { reason: "not_configured", cause: "DB missing" });
    }
    let cache: BoardCache | undefined;
    try {
      cache = boardCache();
    } catch {
      cache = undefined;
    }
    try {
      return await serveBoard(new URL(request.url).origin, period, {
        db,
        clock,
        ...(cache !== undefined ? { cache } : {}),
        ...(ctx !== undefined ? { waitUntil: (p: Promise<unknown>) => ctx.waitUntil(p) } : {}),
        cacheFailed: (err) => {
          try {
            logger({
              level: "error",
              message: "unavailable · board_cache",
              event: "unavailable",
              route,
              reason: "board_cache",
              ...describeCause(err),
            });
          } catch {
            // Served from D1 either way.
          }
        },
      });
    } catch (err) {
      return refuse(route, 503, "unavailable", {
        detail: "scores",
        reason: "scores",
        ...describeCause(err),
      });
    }
  }

  /**
   * Where this device stands now (mine.ts). Behind the flood limit, then its
   * own per IP. Per player, so never cached (`no-store`, as every API answer).
   * The device id is hashed for the query and never logged; a D1 failure is a
   * calm 503.
   */
  async function mine(request: Request, env: Env): Promise<Response> {
    const route = MINE_PATH;
    const ip = rateLimitKey(request.headers.get("cf-connecting-ip"));
    const flood = await checkRateLimit(limitersOf(env), "flood", ip);
    if (!flood.ok) return rateLimited(route, flood.retryAfter, "flood");
    if (request.method !== "POST") {
      return refuse(route, 405, "method_not_allowed", { headers: { allow: "POST" } });
    }
    const { RUN_SECRET: secret, DB: db, BOARD_LOOKUPS: lookups } = env;
    if (!secret || db === undefined || !lookups) {
      const missing = [
        secret ? "" : "RUN_SECRET",
        db === undefined ? "DB" : "",
        lookups ? "" : "BOARD_LOOKUPS",
      ].filter((name) => name !== "");
      return refuse(route, 500, "internal", {
        reason: "not_configured",
        cause: `${missing.join(", ")} missing`,
      });
    }
    const text = await request.text();
    if (new TextEncoder().encode(text).length > MAX_MINE_BYTES) {
      return refuse(route, 400, "bad_request", { detail: "body too large" });
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return refuse(route, 400, "bad_request", { detail: "body must be JSON" });
    }
    try {
      const result = await handleMine(body, {
        db,
        secret,
        clock,
        limit: async () => {
          const { success } = await lookups.limit({ key: ip });
          return success ? { ok: true } : { ok: false, retryAfter: RATE_LIMITS.lookups.period };
        },
      });
      if (result.status === 200) return json(200, result.body);
      if (result.status === 429) return rateLimited(route, result.retryAfter, "lookups");
      return refuse(route, 400, "bad_request", {
        ...(result.body.detail !== undefined ? { detail: result.body.detail } : {}),
      });
    } catch (err) {
      return refuse(route, 503, "unavailable", {
        detail: "scores",
        reason: "scores",
        ...describeCause(err),
      });
    }
  }

  return {
    /**
     * The nightly job (cron.ts). One `info` line with what it did, or an
     * `error` line and a throw, so Cloudflare's cron history marks it failed;
     * the 01:30 run does the same work again.
     */
    async scheduled(controller, env) {
      const now = new Date(controller.scheduledTime);
      if (env.DB === undefined) {
        logger({
          level: "error",
          message: "internal · not_configured",
          event: "internal",
          route: "cron",
          reason: "not_configured",
          cause: "DB missing",
        });
        return;
      }
      try {
        const done = await runNightly(env.DB, now);
        logger({
          level: "info",
          message: "nightly",
          event: "nightly",
          route: "cron",
          cron: controller.cron,
          snapshots: done.snapshots,
          pruned: done.pruned,
        });
      } catch (err) {
        logger({
          level: "error",
          message: "unavailable · cron",
          event: "unavailable",
          route: "cron",
          reason: "cron",
          cron: controller.cron,
          ...describeCause(err),
        });
        throw err;
      }
    },

    async fetch(request, env, ctx) {
      const { pathname } = new URL(request.url);
      if (!pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
      if (pathname === SUBMIT_PATH) return submit(request, env);
      if (pathname === MINE_PATH) return mine(request, env);
      const period = parseBoardPeriod(pathname);
      if (period !== undefined) return board(request, env, period, ctx);
      if (pathname === FEEDBACK_PATH) return feedback(request, env);

      if (pathname === ROUND_PATH) return round(request, env);
      if (pathname === LEAVE_PATH) return leave(request, env);
      if (pathname === RUN_START_PATH) return endless(request, env, RUN_START_PATH);
      if (pathname === GUESS_PATH) return endless(request, env, GUESS_PATH);
      // Not logged: scanners probe paths all day, and the log quota is daily.
      return error(404, "not_found");
    },
  };
}

/**
 * The Durable Object for the run with this key. A failure reaching it (a
 * throw, or a rejected call) becomes a `RunStoreError`, answered with 503.
 */
function runStub(namespace: RunNamespace, key: string): RunStub & SubmitStub {
  const stub = (): RunStub & SubmitStub => namespace.get(namespace.idFromName(key) as never);
  const guarded =
    <A, R>(call: (s: RunStub & SubmitStub, arg: A) => Promise<R>) =>
    async (arg: A): Promise<R> => {
      try {
        return await call(stub(), arg);
      } catch (err) {
        throw new RunStoreError(err);
      }
    };
  return {
    begin: guarded((s, first) => s.begin(first)),
    advance: guarded((s, step) => s.advance(step)),
    claimForSubmit: guarded((s, claim) => s.claimForSubmit(claim)),
    markSubmitted: () => guarded((s) => s.markSubmitted())(undefined),
  };
}

/** An error's message as a log line's `cause`, capped. */
function describeCause(err: unknown): { cause?: string } {
  return err instanceof Error ? { cause: err.message.slice(0, 300) } : {};
}

function limitersOf(env: Env): RateLimiters {
  return {
    answers: env.RUN_ANSWERS,
    starts: env.RUN_STARTS,
    flood: env.ROUND_FLOOD,
    feedback: env.FEEDBACK_SENDS,
  };
}

function error(
  status: number,
  code: ApiError["error"],
  detail?: string,
  headers: Record<string, string> = {},
): Response {
  const body: ApiError = { error: code, ...(detail !== undefined ? { detail } : {}) };
  return json(status, body, headers);
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}
