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
import { checkRateLimits, rateLimitKey } from "./rate-limit.js";
import type { RateLimiter } from "./rate-limit.js";
import { handleNextRound } from "./round.js";

/** Bindings, typed structurally so this module compiles under Node test types too. */
export interface Env {
  readonly ASSETS: { fetch(request: Request): Promise<Response> };
  /** A Worker secret. Locally from `.dev.vars`. */
  readonly RUN_SECRET?: string;
  readonly ROUND_BURST: RateLimiter;
  readonly ROUND_SUSTAINED: RateLimiter;
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

      const limited = await checkRateLimits(
        { burst: env.ROUND_BURST, sustained: env.ROUND_SUSTAINED },
        rateLimitKey(request.headers.get("cf-connecting-ip")),
      );
      if (!limited.ok) {
        return error(429, "rate_limited", undefined, { "retry-after": String(limited.retryAfter) });
      }

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
        });
        return json(result.status, result.body);
      } catch (err) {
        console.error("round handler failed", err);
        return error(500, "internal");
      }
    },
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
