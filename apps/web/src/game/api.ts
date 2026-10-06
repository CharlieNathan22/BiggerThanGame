/**
 * The client side of the round endpoints: Friendly's `POST /api/round/next`,
 * and Endless's `POST /api/run/start` and `POST /api/round/guess`. The only
 * way player data reaches the browser (ARCHITECTURE.md §4): one round at a
 * time, the challenger's figure only after the guess.
 *
 * Endless answers with a signed progress token, which the next guess must send
 * back. The client keeps it **in memory only** — never in storage — so a page
 * reload ends the run. It also keeps the last one of a run, and the signed
 * result a finished run comes back with, for publishing it (publish.ts).
 */

import type {
  AnswerRequest,
  AnswerResponse,
  ApiErrorCode,
  ChallengeLink,
  GuessRequest,
  GuessResponse,
  NamedVariant,
  RunStartRequest,
  RunStartResponse,
  StartRequest,
  StartResponse,
  TimedGuess,
} from "@bt/core";
import type { Failure } from "./machine";

export const ROUND_ENDPOINT = "/api/round/next";
export const RUN_START_ENDPOINT = "/api/run/start";
export const GUESS_ENDPOINT = "/api/round/guess";

/**
 * How long a request may go unanswered before it counts as a dropped
 * connection and the reconnect loop takes over (machine.ts). Well past the
 * slowest honest response, and past the dev switch's 3 s delay.
 */
export const REQUEST_TIMEOUT_MS = 8000;

/** When a 429 comes without a usable `retry-after`: the shortest limit's period. */
export const DEFAULT_RETRY_AFTER_S = 10;

export interface GameApi {
  /** Starts a run; from a challenge link, when one is given (Endless). */
  start(challenge?: ChallengeLink): Promise<StartResponse>;
  answer(runId: string, round: number, guess: TimedGuess): Promise<AnswerResponse>;
}

/** Endless's API, which also hands over what publishing a run needs (publish.ts). */
export interface EndlessApi extends GameApi {
  /** The latest progress token: the run's streak as far as it was verified. */
  latestToken(): string | null;
  /** A finished run's signed result, once the server has ended it. */
  resultToken(): string | null;
  /**
   * What proves the run to the boards: its signed result, or, for a run
   * banked after the connection dropped, its latest progress token. Null
   * before any run.
   */
  publishToken(): string | null;
  /**
   * The flag's country code the server sees for this connection, from the
   * run's start, or null: what "Show my country flag" will show.
   */
  country(): string | null;
}

/** A request that failed: no connection, or a non-2xx answer. */
export class ApiFailure extends Error {
  constructor(
    /** 0 when the request never got a response. */
    readonly status: number,
    readonly code: ApiErrorCode | "network" | "turnstile",
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

/** POSTs `body` as JSON; a non-2xx answer or no answer at all is an `ApiFailure`. */
function poster(fetchFn: Fetch, timeoutMs: number) {
  return async function post<T>(endpoint: string, body: unknown): Promise<T> {
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
  };
}

/** Friendly: stateless, no token, no challenge links. */
export function createApi(fetchFn: Fetch, options: ApiOptions = {}): GameApi {
  const endpoint = options.endpoint ?? ROUND_ENDPOINT;
  const post = poster(fetchFn, options.timeoutMs ?? REQUEST_TIMEOUT_MS);
  return {
    start: () => post<StartResponse>(endpoint, { mode: "friendly" } satisfies StartRequest),
    answer: (runId, round, guess) => {
      // Friendly has no clock, so a timeout can't happen here.
      if (guess === "timeout") return Promise.reject(new Error("Friendly has no clock"));
      const body: AnswerRequest = { mode: "friendly", runId, round, guess };
      return post<AnswerResponse>(endpoint, body);
    },
  };
}

/**
 * Endless: every run start carries a Turnstile token (`checkHuman`, run on the
 * Start press), and every guess the progress token the last response issued.
 * A retried guess sends the same token again, which the server answers the
 * same way; the token only moves on once a response lands.
 */
export function createEndlessApi(
  fetchFn: Fetch,
  checkHuman: () => Promise<string>,
  options: Omit<ApiOptions, "endpoint"> & {
    /** The Endless variant runs start in, when not general Endless. */
    readonly variant?: NamedVariant;
  } = {},
): EndlessApi {
  const post = poster(fetchFn, options.timeoutMs ?? REQUEST_TIMEOUT_MS);
  let token: string | null = null;
  let result: string | null = null;
  let country: string | null = null;

  return {
    async start(challenge) {
      let turnstileToken: string;
      try {
        turnstileToken = await checkHuman();
      } catch {
        throw new ApiFailure(0, "turnstile");
      }
      const body: RunStartRequest = {
        mode: "endless",
        ...(options.variant !== undefined ? { variant: options.variant } : {}),
        turnstileToken,
        ...(challenge !== undefined ? { challenge } : {}),
      };
      const res = await post<RunStartResponse>(RUN_START_ENDPOINT, body);
      token = res.token;
      result = null;
      country = typeof res.country === "string" ? res.country : null;
      return {
        runId: res.runId,
        round: res.round,
        ...(res.challenge !== undefined ? { challenge: res.challenge } : {}),
      };
    },
    async answer(_runId, _round, guess) {
      if (token === null) throw new ApiFailure(0, "network");
      const res = await post<GuessResponse>(GUESS_ENDPOINT, {
        token,
        guess,
      } satisfies GuessRequest);
      if ("next" in res) {
        token = res.token;
        return { reveal: res.reveal, next: res.next };
      }
      result = res.result;
      return { reveal: res.reveal, end: res.end, challenge: res.challenge };
    },
    latestToken: () => token,
    resultToken: () => result,
    publishToken: () => result ?? token,
    country: () => country,
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
 * timeout, a server error), a 429 to wait out, a Turnstile check that didn't
 * pass, or something retrying can't fix.
 */
export function classifyFailure(err: unknown): Failure {
  if (!(err instanceof ApiFailure)) return { kind: "network" };
  if (err.code === "turnstile" || err.code === "verification_failed") {
    return { kind: "verification" };
  }
  if (err.status === 429) {
    return { kind: "rateLimited", retryAfterMs: (err.retryAfter ?? DEFAULT_RETRY_AFTER_S) * 1000 };
  }
  if (err.status === 0 || err.status === 408 || err.status >= 500) return { kind: "network" };
  return { kind: "fatal" };
}
