/**
 * Challenge links are off in Friendly (`CHALLENGES`, @bt/core): a stateless
 * score can be inflated by resending a round, so "Beat n" would mislead.
 * They moved to Endless, where a link sets the score to beat on a fresh run
 * (run.test.ts). Here: Friendly refuses challenge starts and replay ids, and
 * its ends carry no link. ARCHITECTURE.md §7.
 */

import { describe, expect, it } from "vitest";
import type { EndResponse } from "@bt/core";
import { CHALLENGE_DAYS, signRunBody } from "../run-id.js";
import {
  SAMPLE_DECK,
  SECRET,
  TODAY,
  answer,
  call,
  context,
  correctGuess,
  signedRunId,
  start,
  uuidFrom,
  wrongGuess,
} from "./helpers.js";

const DAY_MS = 86_400_000;
const daysAfter = (days: number) => new Date(TODAY.getTime() + days * DAY_MS);

describe("Friendly without challenge links", () => {
  it("ends a run with no link: a wrong answer, and a win", async () => {
    const ctx = context();
    const { runId, round } = await start(ctx);
    const pick = wrongGuess(correctGuess(SAMPLE_DECK, runId, round));
    const end = (await answer(ctx, runId, 1, pick)) as EndResponse;
    expect(end.end).toBe("wrong");
    expect(end).not.toHaveProperty("challenge");
  });

  it("refuses a challenge start, as an old link sends it, with 400 and mints nothing", async () => {
    let minted = 0;
    const ctx = context({
      uuid: () => {
        minted += 1;
        return uuidFrom(minted);
      },
    });
    const result = await call(
      {
        mode: "friendly",
        challenge: await signedRunId("2026-09-19", uuidFrom(1)),
        score: 7,
        sig: "A".repeat(22),
      },
      ctx,
    );
    expect(result).toEqual({
      status: 400,
      body: { error: "bad_request", detail: "challenge links are off in Friendly" },
    });
    expect(minted).toBe(0);
  });

  it("refuses an answer on a replay id, however genuinely signed", async () => {
    const replay = await signRunBody(SECRET, `20260919-${uuidFrom(1)}~${uuidFrom(2)}`);
    const result = await call(
      { mode: "friendly", runId: replay, round: 1, guess: "higher" },
      context(),
    );
    expect(result).toMatchObject({
      status: 400,
      body: { detail: "replay ids are refused: challenge links are off in Friendly" },
    });
  });

  it("still mints fresh runs for today, with no challenge status", async () => {
    const res = await start(context());
    expect(res).not.toHaveProperty("challenge");
  });
});

describe("fresh runs keep the ±1-day rule", () => {
  it.each([2, 5, CHALLENGE_DAYS])("refuses an answer on a fresh run %d days old", async (days) => {
    const { runId } = await start(context());
    const ctx = context({ clock: () => daysAfter(days) });
    const result = await call({ mode: "friendly", runId, round: 1, guess: "higher" }, ctx);
    expect(result.body).toMatchObject({ detail: "runId is out of date" });
  });
});
