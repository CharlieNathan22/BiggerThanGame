/**
 * Scaffolding for Daily Ranked's handler tests (daily.ts): Node's SQLite with
 * the real migrations standing in for D1, a memory ledger per run for each
 * run's Durable Object, a clock the test moves by hand, Turnstile that says
 * what it's told, and walks through whole runs answered from the stored game.
 */

import { epochMs } from "@bt/core";
import type {
  DailyGuessResponse,
  DailyResumeResponse,
  DailyStartResponse,
  Player,
  RoundPayload,
  TimedGuess,
} from "@bt/core";
import type { GameEvent } from "../analytics.js";
import { handleDailyGuess, handleDailyResume, handleDailyStart } from "../daily.js";
import type { DailyContext, DailyHandlerResult } from "../daily.js";
import { readDailyGame } from "../daily-game.js";
import type { DailyGame, StoredRound } from "../daily-game.js";
import type { LogLine } from "../log.js";
import { verifyDailyToken } from "../token.js";
import type { DailyPayload } from "../token.js";
import type { TurnstileOutcome } from "../turnstile.js";
import { sqliteD1 } from "./d1-sqlite.js";
import type { TestD1 } from "./d1-sqlite.js";
import { fakeDailyRuns } from "./endless-helpers.js";
import { SAMPLE_DECK, SECRET, fakeImages, uuidFrom } from "./helpers.js";

/** Launch day in these tests: 2026-11-01, Game 1. */
export const EPOCH = epochMs("2026-11-01");
export const DAY = 86_400_000;

/** Mid-afternoon of game `n`. */
export function onGame(n: number, at = 14.5 * 3_600_000): number {
  return EPOCH + (n - 1) * DAY + at;
}

/** Devices, as the browser mints them: v4 uuids. */
export const DEVICE_A = "11111111-1111-4111-8111-111111111111";
export const DEVICE_B = "22222222-2222-4222-8222-222222222222";
export const DEVICE_C = "33333333-3333-4333-8333-333333333333";

export interface DailyHarness {
  readonly ctx: DailyContext;
  readonly db: TestD1;
  readonly events: GameEvent[];
  readonly logs: LogLine[];
  readonly runs: ReturnType<typeof fakeDailyRuns>;
  now: number;
  wait(ms: number): void;
  turnstile: TurnstileOutcome;
  /** The connection's key, for the repeat count. */
  ip: string;
}

export function dailyHarness(
  overrides: Partial<DailyContext> & { readonly at?: number } = {},
): DailyHarness {
  const db = sqliteD1();
  const runs = fakeDailyRuns();
  const events: GameEvent[] = [];
  const logs: LogLine[] = [];
  let n = 0;
  const { at, ...rest } = overrides;
  const deck = rest.deck ?? SAMPLE_DECK;
  const h: DailyHarness = {
    db,
    runs,
    events,
    logs,
    now: at ?? onGame(3),
    wait(ms) {
      h.now += ms;
    },
    turnstile: "pass",
    ip: "203.0.113.7",
    ctx: undefined as unknown as DailyContext,
  };
  const base: DailyContext = {
    deck,
    images: fakeImages(deck),
    secret: SECRET,
    clock: () => new Date(h.now),
    uuid: () => uuidFrom(++n),
    db,
    epoch: EPOCH,
    verifyTurnstile: async () => h.turnstile,
    runs: (key) => runs.stub(key),
    record: (event) => events.push(event),
    log: (line) => logs.push(line),
    country: "GB",
    deckVersion: "legends-test",
    moderate: (name) => !/blocked/i.test(name),
  };
  const ctx = { ...base, ...rest };
  Object.defineProperty(ctx, "ip", { get: () => h.ip, enumerable: true });
  (h as { ctx: DailyContext }).ctx = ctx;
  return h;
}

export function startBody(
  nickname = "SwiftVolley42",
  deviceId = DEVICE_A,
  showCountry = true,
): Record<string, unknown> {
  return { mode: "ranked", nickname, showCountry, deviceId, turnstileToken: "tok" };
}

export async function start(
  h: DailyHarness,
  nickname?: string,
  deviceId?: string,
): Promise<DailyStartResponse> {
  const res = await handleDailyStart(startBody(nickname, deviceId), h.ctx);
  if (res.status !== 200) throw new Error(`start failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

export async function readToken(token: string): Promise<DailyPayload> {
  const payload = await verifyDailyToken(SECRET, token);
  if (payload === undefined) throw new Error("not a Daily token");
  return payload;
}

export async function guess(
  h: DailyHarness,
  token: string,
  g: TimedGuess,
): Promise<DailyHandlerResult<DailyGuessResponse>> {
  return handleDailyGuess(await readToken(token), g, h.ctx);
}

export async function guessOk(
  h: DailyHarness,
  token: string,
  g: TimedGuess,
): Promise<DailyGuessResponse> {
  const res = await guess(h, token, g);
  if (res.status !== 200) throw new Error(`guess failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

export async function resume(
  h: DailyHarness,
  deviceId = DEVICE_A,
  runId?: string,
): Promise<DailyHandlerResult<DailyResumeResponse>> {
  return handleDailyResume({ deviceId, ...(runId !== undefined ? { runId } : {}) }, h.ctx);
}

/** The game a run plays, as stored: the test's window on the answers. */
export async function storedGame(h: DailyHarness, gameNo: number): Promise<DailyGame> {
  const game = await readDailyGame(h.db, gameNo, EPOCH);
  if (game === undefined) throw new Error(`game ${gameNo} isn't stored`);
  return game;
}

export function rightGuess(round: StoredRound): "higher" | "lower" {
  return round.challenger.value > round.anchor.value ? "higher" : "lower";
}

export function wrongOf(round: StoredRound): "higher" | "lower" {
  return rightGuess(round) === "higher" ? "lower" : "higher";
}

/**
 * Plays a whole run: `answer(round)` says what to send for each question —
 * `right`, `wrong` or `timeout` — answered about `think` ms after each
 * question arrives, give or take a second. Returns every
 * response.
 */
export async function play(
  h: DailyHarness,
  answer: (round: number) => "right" | "wrong" | "timeout",
  opts: { readonly nickname?: string; readonly deviceId?: string; readonly think?: number } = {},
): Promise<{ started: DailyStartResponse; answers: DailyGuessResponse[] }> {
  const started = await start(h, opts.nickname, opts.deviceId);
  const game = await storedGame(h, started.gameNo);
  const answers: DailyGuessResponse[] = [];
  let round: RoundPayload | undefined = started.round;
  let token: string | undefined = started.token;
  while (round !== undefined && token !== undefined) {
    const stored = game.rounds[round.index - 1]!;
    const kind = answer(round.index);
    const g: TimedGuess =
      kind === "right" ? rightGuess(stored) : kind === "wrong" ? wrongOf(stored) : "timeout";
    // Thinking times vary, as a person's do: the flat-timing heuristic leaves them be.
    h.wait((opts.think ?? 5000) + ((round.index * 733) % 1900));
    const res = await guessOk(h, token, g);
    answers.push(res);
    round = "next" in res ? res.next : undefined;
    token = "token" in res ? res.token : undefined;
  }
  return { started, answers };
}

/** A deck the same as `deck` but with every figure of one stat moved: a mid-day correction. */
export function correctedDeck(deck: readonly Player[]): Player[] {
  return deck.map((p) =>
    p.stats.caps === undefined ? p : { ...p, stats: { ...p.stats, caps: p.stats.caps + 7 } },
  );
}
