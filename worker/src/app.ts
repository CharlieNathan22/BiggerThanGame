/**
 * HTTP routing around the pure handlers: `/api/round/next` (round.ts) and
 * `/api/feedback` (feedback.ts).
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

import type { ApiError, Player } from "@bt/core";
import { countryOf, toDataPoint, toLogLine } from "./analytics.js";
import type { AnalyticsDataset, EventContext, GameEvent } from "./analytics.js";
import { feedbackLogLine, handleFeedback } from "./feedback.js";
import { describeError, log, problemMessage } from "./log.js";
import type { Logger } from "./log.js";
import { buildPlainTextMime, isPlainAddress } from "./mail.js";
import type { ImageLookup } from "./payload.js";
import { checkRateLimit, rateLimitKey } from "./rate-limit.js";
import type { RateLimiter, RateLimiters } from "./rate-limit.js";
import { handleNextRound } from "./round.js";
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
}

export const ROUND_PATH = "/api/round/next";
export const FEEDBACK_PATH = "/api/feedback";

/** Requests are two tiny flat objects; anything bigger is not a real client. */
const MAX_BODY_BYTES = 1024;

/**
 * A feedback body at its limits: a Turnstile token, a 1000-character note and
 * an 80-character name, even with every character JSON-escaped. Anything
 * bigger is not the form.
 */
export const MAX_FEEDBACK_BYTES = 16 * 1024;

type Route = typeof ROUND_PATH | typeof FEEDBACK_PATH;

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
  fetch(request: Request, env: Env): Promise<Response>;
} {
  const clock = deps.clock ?? (() => new Date());
  const uuid = deps.uuid ?? (() => crypto.randomUUID());
  const logger = deps.log ?? log;
  const deckVersion = deps.deckVersion ?? "unknown";

  const fetchFn: FetchLike = deps.fetch ?? ((input, init) => fetch(input, init));
  const emailMessage =
    deps.emailMessage ??
    ((): OutgoingEmail => {
      throw new Error("no EmailMessage constructor outside workerd");
    });

  /** Logged once per isolate, so a broken binding can't flood the logs. */
  let analyticsFailureLogged = false;

  /**
   * The round handler's `record`: the event to Analytics Engine, and a log
   * line for a run's start or end. Fire-and-forget — `writeDataPoint` doesn't
   * block, and nothing here can throw into the handler.
   */
  function recorder(request: Request, env: Env): (event: GameEvent) => void {
    const ctx: EventContext = { country: countryOf(request), deckVersion };
    return (event) => {
      try {
        const line = toLogLine(event, ctx, ROUND_PATH);
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
            route: ROUND_PATH,
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
        record: recorder(request, env),
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

  return {
    async fetch(request, env) {
      const { pathname } = new URL(request.url);
      if (!pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
      if (pathname === FEEDBACK_PATH) return feedback(request, env);
      if (pathname === ROUND_PATH) return round(request, env);
      // Not logged: scanners probe paths all day, and the log quota is daily.
      return error(404, "not_found");
    },
  };
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
