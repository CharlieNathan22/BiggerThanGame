/**
 * The client side of `POST /api/round/next`. The only way player data reaches
 * the browser (ARCHITECTURE.md §4): one round at a time, the challenger's
 * figure only after the guess.
 */

import type {
  AnswerRequest,
  AnswerResponse,
  ApiErrorCode,
  Guess,
  StartRequest,
  StartResponse,
} from "@bt/core";
import type { Failure } from "./machine";

export const ROUND_ENDPOINT = "/api/round/next";

/**
 * How long a request may go unanswered before it counts as a dropped
 * connection and the reconnect loop takes over (machine.ts). Well past the
 * slowest honest response, and past the dev switch's 3 s delay.
 */
export const REQUEST_TIMEOUT_MS = 8000;

/** When a 429 comes without a usable `retry-after`: the shortest limit's period. */
export const DEFAULT_RETRY_AFTER_S = 10;

export interface GameApi {
  start(): Promise<StartResponse>;
  answer(runId: string, round: number, guess: Guess): Promise<AnswerResponse>;
}

/** A request that failed: no connection, or a non-2xx answer. */
export class ApiFailure extends Error {
  constructor(
    /** 0 when the request never got a response. */
    readonly status: number,
    readonly code: ApiErrorCode | "network",
    /** Seconds, from `retry-after` on a 429. */
    readonly retryAfter?: number,
  ) {
    super(`round request failed: ${status} ${code}`);
    this.name = "ApiFailure";
  }
}

export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export interface ApiOptions {
  readonly endpoint?: string;
  readonly timeoutMs?: number;
}

export function createApi(fetchFn: Fetch, options: ApiOptions = {}): GameApi {
  const endpoint = options.endpoint ?? ROUND_ENDPOINT;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

  async function post<T>(body: StartRequest | AnswerRequest): Promise<T> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchFn(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: abort.signal,
      });
    } catch {
      throw new ApiFailure(0, "network");
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      const retry = Number(response.headers.get("retry-after"));
      throw new ApiFailure(
        response.status,
        await errorCode(response),
        Number.isFinite(retry) && retry > 0 ? retry : undefined,
      );
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw new ApiFailure(response.status, "network");
    }
  }

  return {
    start: () => post<StartResponse>({ mode: "friendly" }),
    answer: (runId, round, guess) =>
      post<AnswerResponse>({ mode: "friendly", runId, round, guess }),
  };
}

async function errorCode(response: Response): Promise<ApiErrorCode | "network"> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === "string" ? (body.error as ApiErrorCode) : "network";
  } catch {
    return "network";
  }
}

/**
 * What a failed request means for the run: worth retrying (no connection, a
 * timeout, a server error), a 429 to wait out, or something retrying can't fix.
 */
export function classifyFailure(err: unknown): Failure {
  if (!(err instanceof ApiFailure)) return { kind: "network" };
  if (err.status === 429) {
    return { kind: "rateLimited", retryAfterMs: (err.retryAfter ?? DEFAULT_RETRY_AFTER_S) * 1000 };
  }
  if (err.status === 0 || err.status === 408 || err.status >= 500) return { kind: "network" };
  return { kind: "fatal" };
}
