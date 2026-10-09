/**
 * Scaffolding for Twitch Mode's handler tests (stream.ts): a memory ledger per
 * match standing in for its Durable Object, a clock the test moves by hand,
 * Turnstile that says what it's told, and walks through whole matches. Runs in
 * Node; the real Durable Object is exercised under workerd (workerd.test.ts).
 */

import type {
  GuessContinueResponse,
  Player,
  RoundPayload,
  StreamChat,
  StreamGuessResponse,
  StreamLimit,
  StreamPool,
  StreamStartResponse,
  TimedGuess,
} from "@bt/core";
import type { GameEvent } from "../analytics.js";
import { handleStreamGuess, handleStreamStart, parseStreamGuess } from "../stream.js";
import type { StreamContext, StreamResult } from "../stream.js";
import { StreamLedger, memoryStreamStore } from "../stream-ledger.js";
import { verifyStreamToken } from "../token.js";
import type { StreamPayload } from "../token.js";
import type { TurnstileOutcome } from "../turnstile.js";
import { SAMPLE_DECK, SECRET, TODAY, correctGuess, uuidFrom, wrongGuess } from "./helpers.js";

export interface StreamHarness {
  readonly ctx: StreamContext;
  readonly ledgers: Map<string, StreamLedger>;
  readonly events: GameEvent[];
  now: number;
  wait(ms: number): void;
  turnstile: TurnstileOutcome;
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

export function streamHarness(overrides: Partial<StreamContext> = {}): StreamHarness {
  const ledgers = new Map<string, StreamLedger>();
  const events: GameEvent[] = [];
  let n = 0;
  const h: StreamHarness = {
    ledgers,
    events,
    now: TODAY.getTime(),
    wait(ms) {
      h.now += ms;
    },
    turnstile: "pass",
    ctx: undefined as unknown as StreamContext,
  };
  const ledgerFor = (key: string): StreamLedger => {
    let ledger = ledgers.get(key);
    if (ledger === undefined) ledgers.set(key, (ledger = new StreamLedger(memoryStreamStore())));
    return ledger;
  };
  (h as { ctx: StreamContext }).ctx = {
    deck: SAMPLE_DECK,
    images: {},
    secret: SECRET,
    clock: () => new Date(h.now),
    uuid: () => uuidFrom(++n),
    verifyTurnstile: async () => h.turnstile,
    runs: (key) => ({
      streamBegin: async (first) => copy(ledgerFor(key).begin(copy(first))),
      streamAdvance: async (step) => copy(ledgerFor(key).advance(copy(step))),
    }),
    record: (event) => events.push(event),
    country: "GB",
    deckVersion: "legends-test",
    ...overrides,
  };
  return h;
}

export function streamStartBody(
  pool: StreamPool = "endless",
  questions: 10 | 20 = 10,
  limit: StreamLimit = 30,
): Record<string, unknown> {
  return { mode: "stream", pool, questions, limit, turnstileToken: "turnstile-token" };
}

export async function startMatch(
  h: StreamHarness,
  pool: StreamPool = "endless",
  questions: 10 | 20 = 10,
  limit: StreamLimit = 30,
): Promise<StreamStartResponse> {
  const result = await handleStreamStart(streamStartBody(pool, questions, limit), h.ctx);
  if (result.status !== 200) throw new Error(`start failed: ${JSON.stringify(result.body)}`);
  return result.body as StreamStartResponse;
}

/** A guess as the app would hand it on: parsed, its token verified. */
export async function sendStream(
  h: StreamHarness,
  token: string,
  guess: TimedGuess,
  chat?: StreamChat,
): Promise<StreamResult> {
  const parsed = parseStreamGuess({ token, guess, ...(chat !== undefined ? { chat } : {}) });
  if (!parsed.ok) throw new Error(parsed.detail);
  const verified = await verifyStreamToken(SECRET, token);
  if (verified === undefined) throw new Error("not a match's token");
  return handleStreamGuess(verified, parsed.value, h.ctx);
}

export async function streamOk(
  h: StreamHarness,
  token: string,
  guess: TimedGuess,
  chat?: StreamChat,
): Promise<StreamGuessResponse> {
  const result = await sendStream(h, token, guess, chat);
  if (result.status !== 200) throw new Error(`guess failed: ${JSON.stringify(result.body)}`);
  return result.body as StreamGuessResponse;
}

/** The token's payload, read as the client could: signed, not encrypted. */
export function readStreamToken(token: string): StreamPayload {
  const body = token.split(".")[0]!;
  return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StreamPayload;
}

export type StreamAnswer = "right" | "wrong" | "timeout" | "late";

/**
 * One whole match: `answer` says how each question is answered, `think` ms
 * after its token (a late answer lands just past its deadline).
 */
export async function playMatch(
  h: StreamHarness,
  opts: {
    pool?: StreamPool;
    questions?: 10 | 20;
    limit?: StreamLimit;
    deck?: readonly Player[];
    answer?: (round: number) => StreamAnswer;
    chat?: (round: number) => StreamChat | undefined;
    think?: number;
  } = {},
): Promise<{
  started: StreamStartResponse;
  answers: StreamGuessResponse[];
  rounds: RoundPayload[];
}> {
  const deck = opts.deck ?? h.ctx.deck;
  const started = await startMatch(h, opts.pool, opts.questions, opts.limit);
  const answers: StreamGuessResponse[] = [];
  const rounds: RoundPayload[] = [];
  let round: RoundPayload | undefined = started.round;
  let token: string | undefined = started.token;
  while (round !== undefined && token !== undefined) {
    rounds.push(round);
    const how = opts.answer?.(round.index) ?? "right";
    const right = correctGuess(deck, started.runId, round);
    let guess: TimedGuess = right;
    if (how === "wrong") guess = wrongGuess(right);
    if (how === "timeout") guess = "timeout";
    if (how === "late") h.now = readStreamToken(token).deadline + 1;
    else h.wait(opts.think ?? 2500);
    const res = await streamOk(h, token, guess, opts.chat?.(round.index));
    answers.push(res);
    const next: GuessContinueResponse | undefined = "next" in res ? res : undefined;
    round = next?.next;
    token = next?.token;
  }
  return { started, answers, rounds };
}
