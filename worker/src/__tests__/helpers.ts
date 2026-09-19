/**
 * Shared scaffolding for Worker tests. Runs in Node; no Worker runtime.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { valueOf } from "@bt/core";
import type { AnswerResponse, Guess, Player, RoundPayload, StartResponse } from "@bt/core";
import { loadDeck } from "@bt/deck";
import { fixtureDeck } from "../../../packages/core/src/__fixtures__/deck.js";
import type { ImageLookup } from "../payload.js";
import { handleNextRound } from "../round.js";
import type { RoundContext, RoundResult } from "../round.js";
import { runDate } from "../run-id.js";

export const SECRET = "test-secret-not-for-production";

/** Server time for tests: mid-afternoon, so run ids mint as 2026-09-19. */
export const TODAY = new Date("2026-09-19T14:30:00Z");

const deckRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "packages",
  "deck",
);

/** The committed 24-player sample deck — realistic spread of stats and positions. */
export const SAMPLE_DECK: readonly Player[] = loadDeck(deckRoot).players;
export const FIXTURE_DECK: readonly Player[] = fixtureDeck;

/** Deterministic, well-formed v4-style uuids. */
export function uuidFrom(n: number): string {
  const hex = n.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${hex}`;
}

export function context(overrides: Partial<RoundContext> = {}): RoundContext {
  let n = 0;
  return {
    deck: SAMPLE_DECK,
    images: {},
    secret: SECRET,
    clock: () => TODAY,
    uuid: () => uuidFrom(++n),
    ...overrides,
  };
}

export async function call(body: unknown, ctx: RoundContext): Promise<RoundResult> {
  return handleNextRound(body, ctx);
}

export async function start(ctx: RoundContext): Promise<StartResponse> {
  const result = await call({ mode: "friendly" }, ctx);
  if (result.status !== 200) throw new Error(`start failed: ${JSON.stringify(result.body)}`);
  return result.body as StartResponse;
}

export async function answer(
  ctx: RoundContext,
  runId: string,
  round: number,
  guess: Guess,
): Promise<AnswerResponse> {
  const result = await call({ mode: "friendly", runId, round, guess }, ctx);
  if (result.status !== 200) throw new Error(`answer failed: ${JSON.stringify(result.body)}`);
  return result.body as AnswerResponse;
}

/**
 * The right answer, worked out from the deck the test holds — independently of
 * the server, which the test can't see into.
 */
export function correctGuess(deck: readonly Player[], runId: string, round: RoundPayload): Guess {
  const now = runDate(runId)!;
  const challenger = deck.find((p) => p.id === round.challenger.id)!;
  const hidden = valueOf(challenger, round.stat.key, now)!;
  return hidden > round.anchor.value ? "higher" : "lower";
}

export function wrongGuess(guess: Guess): Guess {
  return guess === "higher" ? "lower" : "higher";
}

/** Every response in one run, answering correctly until it ends. */
export async function walkRun(
  ctx: RoundContext,
  deck: readonly Player[] = ctx.deck,
): Promise<{ runId: string; started: StartResponse; answers: AnswerResponse[] }> {
  const started = await start(ctx);
  const answers: AnswerResponse[] = [];
  let round: RoundPayload | undefined = started.round;
  while (round !== undefined) {
    const res = await answer(
      ctx,
      started.runId,
      round.index,
      correctGuess(deck, started.runId, round),
    );
    answers.push(res);
    round = "next" in res ? res.next : undefined;
  }
  return { runId: started.runId, started, answers };
}

/** A fake photo for every player, to exercise the image path. */
export function fakeImages(deck: readonly Player[]): ImageLookup {
  return Object.fromEntries(
    deck.map((p) => [
      p.id,
      { key: `originals/${p.id}.0123456789abcdef.jpg`, width: 1600, height: 2000 },
    ]),
  );
}
