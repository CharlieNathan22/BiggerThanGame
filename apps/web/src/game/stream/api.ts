/**
 * Twitch Mode's side of the round endpoints: a match starts on
 * `POST /api/run/start` (`mode: "stream"`, the pool, the length and the
 * limit, and a fresh Turnstile token every time) and each question is
 * answered on `POST /api/round/guess` with the match's token, kept in memory
 * only, as Endless's is: a refresh ends the match.
 *
 * Each guess also carries what chat did — its pick and how many voted, counts
 * only — read from the vote box as the window closes (`chat`). Nothing from
 * chat itself is ever sent.
 */

import type {
  StreamChat,
  StreamGuessRequest,
  StreamGuessResponse,
  StreamLength,
  StreamLimit,
  StreamPool,
  StreamStartRequest,
  StreamStartResponse,
} from "@bt/core";
import {
  ApiFailure,
  GUESS_ENDPOINT,
  REQUEST_TIMEOUT_MS,
  RUN_START_ENDPOINT,
  jsonPoster,
} from "../api";
import type { Fetch, GameApi } from "../api";

/** What a match is started with. */
export interface MatchRequest {
  readonly pool: StreamPool;
  readonly questions: StreamLength;
  readonly limit: StreamLimit;
}

/** A started match as the controller reads it: the response, and the pool it asked for. */
export type StreamStarted = StreamStartResponse & { readonly pool: StreamPool };

export function createStreamApi(
  fetchFn: Fetch,
  checkHuman: () => Promise<string>,
  /** The settings the next match starts with: read at each start, so Play again uses the latest. */
  settings: () => MatchRequest,
  /** Chat's pick and turnout on the question being answered, read as it goes. */
  chat: () => StreamChat | undefined,
  timeoutMs = REQUEST_TIMEOUT_MS,
): GameApi {
  const post = jsonPoster(fetchFn, timeoutMs);
  let token: string | null = null;
  return {
    async start() {
      let turnstileToken: string;
      try {
        turnstileToken = await checkHuman();
      } catch {
        throw new ApiFailure(0, "turnstile");
      }
      const { pool, questions, limit } = settings();
      const body: StreamStartRequest = { mode: "stream", pool, questions, limit, turnstileToken };
      const res = await post<StreamStartResponse>(RUN_START_ENDPOINT, body);
      token = res.token;
      const started: StreamStarted = {
        runId: res.runId,
        round: res.round,
        token: res.token,
        questions: res.questions,
        limit: res.limit,
        pool,
      };
      return started;
    },
    async answer(_runId, _round, guess) {
      if (token === null) throw new ApiFailure(0, "network");
      const tally = chat();
      const res = await post<StreamGuessResponse>(GUESS_ENDPOINT, {
        token,
        guess,
        ...(tally !== undefined ? { chat: tally } : {}),
      } satisfies StreamGuessRequest);
      if ("next" in res) {
        token = res.token;
        return { reveal: res.reveal, next: res.next };
      }
      token = null;
      return { reveal: res.reveal, end: res.end };
    },
  };
}
