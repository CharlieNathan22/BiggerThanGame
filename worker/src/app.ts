/**
 * HTTP routing around the pure round handler.
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
import type { ImageLookup } from "./payload.js";
import { checkRateLimit, rateLimitKey } from "./rate-limit.js";
import type { RateLimiter, RateLimiters } from "./rate-limit.js";
import { handleNextRound } from "./round.js";

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
}

export interface AppDeps {
  readonly deck: readonly Player[];
  readonly images: ImageLookup;
  readonly clock?: () => Date;
  readonly uuid?: () => string;
}

export const ROUND_PATH = "/api/round/next";

/** Requests are two tiny flat objects; anything bigger is not a real client. */
const MAX_BODY_BYTES = 1024;

export function createApp(deps: AppDeps): {
  fetch(request: Request, env: Env): Promise<Response>;
} {
  const clock = deps.clock ?? (() => new Date());
  const uuid = deps.uuid ?? (() => crypto.randomUUID());

  return {
    async fetch(request, env) {
      const { pathname } = new URL(request.url);
      if (!pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
      if (pathname !== ROUND_PATH) return error(404, "not_found");

      const limiters: RateLimiters = {
        answers: env.RUN_ANSWERS,
        starts: env.RUN_STARTS,
        flood: env.ROUND_FLOOD,
      };
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
