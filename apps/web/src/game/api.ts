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

export const ROUND_ENDPOINT = "/api/round/next";

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

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export function createApi(fetchFn: Fetch, endpoint = ROUND_ENDPOINT): GameApi {
  async function post<T>(body: StartRequest | AnswerRequest): Promise<T> {
    let response: Response;
    try {
      response = await fetchFn(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      throw new ApiFailure(0, "network");
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
