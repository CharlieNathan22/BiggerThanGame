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
 */

import type { ApiError, Player } from "@bt/core";
import { handleFeedback } from "./feedback.js";
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
}

export interface AppDeps {
  readonly deck: readonly Player[];
  readonly images: ImageLookup;
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

export function createApp(deps: AppDeps): {
  fetch(request: Request, env: Env): Promise<Response>;
} {
  const clock = deps.clock ?? (() => new Date());
  const uuid = deps.uuid ?? (() => crypto.randomUUID());

  const fetchFn: FetchLike = deps.fetch ?? ((input, init) => fetch(input, init));
  const emailMessage =
    deps.emailMessage ??
    ((): OutgoingEmail => {
      throw new Error("no EmailMessage constructor outside workerd");
    });

  async function feedback(request: Request, env: Env): Promise<Response> {
    const limiters = limitersOf(env);
    const ip = rateLimitKey(request.headers.get("cf-connecting-ip"));

    // Before any work: every message costs a Turnstile check and an email.
    const limited = await checkRateLimit(limiters, "feedback", ip);
    if (!limited.ok) return rateLimited(limited.retryAfter);

    if (request.method !== "POST") {
      return error(405, "method_not_allowed", undefined, { allow: "POST" });
    }

    const { RUN_SECRET: secret, TURNSTILE_SECRET: turnstileSecret, FEEDBACK_TO: to } = env;
    if (!secret || !turnstileSecret || !to || !isPlainAddress(to)) {
      const missing = [
        secret ? "" : "RUN_SECRET",
        turnstileSecret ? "" : "TURNSTILE_SECRET",
        to && isPlainAddress(to) ? "" : "FEEDBACK_TO",
      ].filter((name) => name !== "");
      // Names only, never values.
      console.error(`feedback is not configured: ${missing.join(", ")} missing or invalid`);
      return error(500, "internal");
    }

    const declared = Number(request.headers.get("content-length"));
    if (declared > MAX_FEEDBACK_BYTES) return error(400, "bad_request", "body_too_large");
    const text = await request.text();
    if (new TextEncoder().encode(text).length > MAX_FEEDBACK_BYTES) {
      return error(400, "bad_request", "body_too_large");
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return error(400, "bad_request", "invalid_json");
    }

    try {
      const result = await handleFeedback(body, {
        deck: deps.deck,
        secret,
        clock,
        to,
        uuid,
        verifyTurnstile: (token) => verifyTurnstile(token, turnstileSecret, fetchFn),
        send: async (mail) => {
          const message = emailMessage(mail.from, mail.to, buildPlainTextMime(mail));
          await env.FEEDBACK_EMAIL.send(message);
        },
      });
      return json(result.status, result.body);
    } catch (err) {
      // Errors from the engine or config, never user text: sends are caught in feedback.ts.
      console.error("feedback handler failed", err);
      return error(500, "internal");
    }
  }

  return {
    async fetch(request, env) {
      const { pathname } = new URL(request.url);
      if (!pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
      if (pathname === FEEDBACK_PATH) return feedback(request, env);
      if (pathname !== ROUND_PATH) return error(404, "not_found");

      const limiters = limitersOf(env);
      const ip = rateLimitKey(request.headers.get("cf-connecting-ip"));

      // The backstop comes before any work, so a flood stays cheap. The run
      // start and answer limits need the parsed request, so round.ts applies them.
      const flood = await checkRateLimit(limiters, "flood", ip);
      if (!flood.ok) return rateLimited(flood.retryAfter);

      if (request.method !== "POST") {
        return error(405, "method_not_allowed", undefined, { allow: "POST" });
      }

      const secret = env.RUN_SECRET;
      if (secret === undefined || secret === "") {
        console.error("RUN_SECRET is not set");
        return error(500, "internal");
      }

      const text = await request.text();
      if (text.length > MAX_BODY_BYTES) return error(400, "bad_request", "body too large");
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return error(400, "bad_request", "body must be JSON");
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
        });
        if (result.status === 429) return rateLimited(result.retryAfter);
        return json(result.status, result.body);
      } catch (err) {
        console.error("round handler failed", err);
        return error(500, "internal");
      }
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

function rateLimited(retryAfter: number): Response {
  return error(429, "rate_limited", undefined, { "retry-after": String(retryAfter) });
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
