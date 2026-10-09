/**
 * Scaffolding for Endless's handler tests (run.ts): a memory ledger per run
 * standing in for each run's Durable Object, a clock the test moves by hand,
 * Turnstile that says what it's told, and walks through whole runs. Runs in
 * Node; the real Durable Object is exercised under workerd (workerd.test.ts).
 */

import type {
  ChallengeLink,
  GuessResponse,
  NamedVariant,
  Player,
  RoundPayload,
  RunStartResponse,
  TimedGuess,
} from "@bt/core";
import type { GameEvent } from "../analytics.js";
import type { RunNamespace } from "../app.js";
import type { DailyStub } from "../daily.js";
import { DailyLedger, memoryDailyStore } from "../daily-ledger.js";
import { handleGuess, handleRunStart } from "../run.js";
import type { RunContext, RunResult, RunStub } from "../run.js";
import { RunLedger, memoryStore } from "../run-ledger.js";
import type { StreamStub } from "../stream.js";
import { StreamLedger, memoryStreamStore } from "../stream-ledger.js";
import type { ProgressPayload } from "../token.js";
import type { TurnstileOutcome } from "../turnstile.js";
import { SAMPLE_DECK, SECRET, TODAY, correctGuess, uuidFrom, wrongGuess } from "./helpers.js";

export interface Harness {
  readonly ctx: RunContext;
  /** The ledger behind each run, by run key. */
  readonly ledgers: Map<string, RunLedger>;
  /** Every event the handlers recorded. */
  readonly events: GameEvent[];
  /** Server time, ms; move it with `wait`. */
  now: number;
  wait(ms: number): void;
  /** What Turnstile says next. */
  turnstile: TurnstileOutcome;
}

/** RPC copies its arguments and results; so does the fake, so nothing is shared by reference. */
function copy<T>(value: T): T {
  return structuredClone(value);
}

export function harness(overrides: Partial<RunContext> = {}): Harness {
  const ledgers = new Map<string, RunLedger>();
  const events: GameEvent[] = [];
  let n = 0;
  const h: Harness = {
    ledgers,
    events,
    now: TODAY.getTime(),
    wait(ms) {
      h.now += ms;
    },
    turnstile: "pass",
    ctx: undefined as unknown as RunContext,
  };
  const ledgerFor = (key: string): RunLedger => {
    let ledger = ledgers.get(key);
    if (ledger === undefined) {
      ledger = new RunLedger(memoryStore());
      ledgers.set(key, ledger);
    }
    return ledger;
  };
  const stub = (key: string): RunStub => ({
    begin: async (first) => copy(ledgerFor(key).begin(copy(first))),
    advance: async (step) => copy(ledgerFor(key).advance(copy(step))),
  });
  (h as { ctx: RunContext }).ctx = {
    deck: SAMPLE_DECK,
    images: {},
    secret: SECRET,
    clock: () => new Date(h.now),
    uuid: () => uuidFrom(++n),
    verifyTurnstile: async () => h.turnstile,
    runs: stub,
    record: (event) => events.push(event),
    country: "GB",
    deckVersion: "legends-test",
    ...overrides,
  };
  return h;
}

export function startBody(challenge?: ChallengeLink, variant?: NamedVariant): unknown {
  return {
    mode: "endless",
    ...(variant !== undefined ? { variant } : {}),
    turnstileToken: "turnstile-token",
    ...(challenge !== undefined ? { challenge } : {}),
  };
}

export async function begin(
  h: Harness,
  challenge?: ChallengeLink,
  variant?: NamedVariant,
): Promise<RunStartResponse> {
  const result = await handleRunStart(startBody(challenge, variant), h.ctx);
  if (result.status !== 200) throw new Error(`start failed: ${JSON.stringify(result.body)}`);
  return result.body as RunStartResponse;
}

export function send(h: Harness, token: string, guess: TimedGuess): Promise<RunResult> {
  return handleGuess({ token, guess }, h.ctx);
}

export async function guessOk(
  h: Harness,
  token: string,
  guess: TimedGuess,
): Promise<GuessResponse> {
  const result = await send(h, token, guess);
  if (result.status !== 200) throw new Error(`guess failed: ${JSON.stringify(result.body)}`);
  return result.body as GuessResponse;
}

/** The token's payload, read as the client could: it is signed, not encrypted. */
export function readToken(token: string): ProgressPayload {
  const body = token.split(".")[0]!;
  return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ProgressPayload;
}

/** How a walk ends: a wrong pick, the client's own timeout, or answering past the deadline. */
export type Ending = "wrong" | "timeout" | "late" | "none";

/**
 * One whole run: right answers, `think` ms after each token, until round
 * `stopAt` is answered the `ending` way, or the run ends by itself.
 */
export async function walk(
  h: Harness,
  opts: {
    deck?: readonly Player[];
    stopAt?: number;
    ending?: Ending;
    think?: number;
    variant?: NamedVariant;
  } = {},
): Promise<{ started: RunStartResponse; answers: GuessResponse[] }> {
  const deck = opts.deck ?? h.ctx.deck;
  const started = await begin(h, undefined, opts.variant);
  const answers: GuessResponse[] = [];
  let round: RoundPayload | undefined = started.round;
  let token: string | undefined = started.token;
  while (round !== undefined && token !== undefined) {
    const right = correctGuess(deck, started.runId, round);
    const last = opts.stopAt === round.index;
    let guess: TimedGuess = right;
    if (last && opts.ending === "wrong") guess = wrongGuess(right);
    if (last && opts.ending === "timeout") guess = "timeout";
    if (last && opts.ending === "late") h.now = readToken(token).deadline + 1;
    else h.wait(opts.think ?? 2500);
    const res = await guessOk(h, token, guess);
    answers.push(res);
    round = "next" in res ? res.next : undefined;
    token = "token" in res ? res.token : undefined;
  }
  return { started, answers };
}

/** A `RUNS` namespace of memory ledgers, one per run key, copying across the "RPC". */
export function fakeRuns(): RunNamespace {
  const ledgers = new Map<string, RunLedger>();
  const ledger = (key: string): RunLedger => {
    let l = ledgers.get(key);
    if (l === undefined) ledgers.set(key, (l = new RunLedger(memoryStore())));
    return l;
  };
  const daily = fakeDailyRuns();
  const stream = fakeStreamRuns();
  return {
    idFromName: (name) => name,
    get: (id: never) => ({
      ...stream.stub(id as string),
      begin: async (first) => structuredClone(ledger(id as string).begin(structuredClone(first))),
      advance: async (step) => structuredClone(ledger(id as string).advance(structuredClone(step))),
      claimForSubmit: async (claim) =>
        structuredClone(ledger(id as string).claimForSubmit(structuredClone(claim))),
      markSubmitted: async () => ledger(id as string).markSubmitted(),
      ...daily.stub(id as string),
    }),
  };
}

/** Daily Ranked's side of a run's object: memory ledgers, one per run key, copying across the "RPC". */
export function fakeDailyRuns(): {
  stub(key: string): DailyStub;
  ledger(key: string): DailyLedger;
} {
  const ledgers = new Map<string, DailyLedger>();
  const ledger = (key: string): DailyLedger => {
    let l = ledgers.get(key);
    if (l === undefined) ledgers.set(key, (l = new DailyLedger(memoryDailyStore())));
    return l;
  };
  return {
    ledger,
    stub: (key) => ({
      dailyBegin: async (first) => structuredClone(ledger(key).begin(structuredClone(first))),
      dailyAdvance: async (step) => structuredClone(ledger(key).advance(structuredClone(step))),
      dailyResume: async ({ deviceHash, now, nonce }) =>
        structuredClone(ledger(key).resume(deviceHash, now, nonce)),
      dailyPosted: async () => ledger(key).markPosted(),
      dailyPostFailed: async (now) => ledger(key).postFailed(now),
    }),
  };
}

/** Twitch Mode's side of a run's object: memory ledgers, one per match key, copying across the "RPC". */
export function fakeStreamRuns(): {
  stub(key: string): StreamStub;
  ledger(key: string): StreamLedger;
} {
  const ledgers = new Map<string, StreamLedger>();
  const ledger = (key: string): StreamLedger => {
    let l = ledgers.get(key);
    if (l === undefined) ledgers.set(key, (l = new StreamLedger(memoryStreamStore())));
    return l;
  };
  return {
    ledger,
    stub: (key) => ({
      streamBegin: async (first) => structuredClone(ledger(key).begin(structuredClone(first))),
      streamAdvance: async (step) => structuredClone(ledger(key).advance(structuredClone(step))),
    }),
  };
}

/** A Twitch Mode side that no other test should ever reach. */
export function noStream(): StreamStub {
  const never = async (): Promise<never> => {
    throw new Error("not a match");
  };
  return { streamBegin: never, streamAdvance: never };
}

/** A Daily side that no Endless test should ever reach. */
export function noDaily(): DailyStub {
  const never = async (): Promise<never> => {
    throw new Error("not a Daily run");
  };
  return {
    dailyBegin: never,
    dailyAdvance: never,
    dailyResume: never,
    dailyPosted: never,
    dailyPostFailed: never,
  };
}
