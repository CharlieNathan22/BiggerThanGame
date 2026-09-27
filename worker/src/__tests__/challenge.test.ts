/**
 * Challenge links (challenge.ts, run-id.ts): a signed run and score that a
 * friend replays, round for round. ARCHITECTURE.md §7.
 */

import { describe, expect, it } from "vitest";
import type { AnswerResponse, EndResponse, StartResponse } from "@bt/core";
import type { RateDecision } from "../rate-limit.js";
import { CHALLENGE_DAYS, parseRunId } from "../run-id.js";
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
  walkRun,
  wrongGuess,
} from "./helpers.js";
import type { RoundContext } from "../round.js";

const DAY_MS = 86_400_000;
const daysAfter = (days: number) => new Date(TODAY.getTime() + days * DAY_MS);

/** Plays a run to `score` correct answers, then a wrong one. Returns its end. */
async function playTo(ctx: RoundContext, score: number): Promise<EndResponse> {
  const { runId, round: first } = await start(ctx);
  let round = first;
  for (;;) {
    const right = correctGuess(SAMPLE_DECK, runId, round);
    const guess = round.index > score ? wrongGuess(right) : right;
    const res = await answer(ctx, runId, round.index, guess);
    if (!("next" in res)) return res;
    round = res.next;
  }
}

async function startChallenge(
  ctx: RoundContext,
  link: { runId: string; score: number; sig: string },
): Promise<StartResponse> {
  const result = await call(
    { mode: "friendly", challenge: link.runId, score: link.score, sig: link.sig },
    ctx,
  );
  if (result.status !== 200) throw new Error(`challenge start: ${JSON.stringify(result.body)}`);
  return result.body as StartResponse;
}

/** Every round of a run, answered correctly, as (index, stat, anchor, challenger, revealed). */
async function sequence(ctx: RoundContext, started: StartResponse): Promise<string[]> {
  const out: string[] = [];
  let round = started.round;
  for (;;) {
    const res: AnswerResponse = await answer(
      ctx,
      started.runId,
      round.index,
      correctGuess(SAMPLE_DECK, started.runId, round),
    );
    out.push(
      [
        round.index,
        round.stat.key,
        round.anchor.id,
        round.anchor.display,
        round.challenger.id,
        res.reveal.display,
      ].join("|"),
    );
    if (!("next" in res)) return out;
    round = res.next;
  }
}

describe("the link at a run's end", () => {
  it("carries the score reached: the correct answers before the wrong one", async () => {
    const end = await playTo(context(), 3);
    expect(end.end).toBe("wrong");
    expect(end.challenge.score).toBe(3);
    expect(end.challenge.sig).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("names the run itself, signed", async () => {
    const ctx = context({ uuid: () => uuidFrom(40) });
    const end = await playTo(ctx, 0);
    expect(end.challenge.score).toBe(0);
    expect(end.challenge.runId).toBe(await signedRunId("2026-09-19", uuidFrom(40)));
  });

  it("scores a won run at twenty", async () => {
    const { answers } = await walkRun(context());
    const last = answers.at(-1) as EndResponse;
    expect(last.end).toBe("won");
    expect(last.challenge.score).toBe(20);
  });
});

describe("replaying a challenge", () => {
  it("accepts a genuine link and replays exactly the same sequence", async () => {
    const original = context({ uuid: () => uuidFrom(41) });
    const link = (await playTo(original, 4)).challenge;

    const friend = context({ uuid: () => uuidFrom(900) });
    const replay = await startChallenge(friend, link);
    expect(replay.challenge).toEqual({ accepted: true, score: 4 });

    const first = await start(context({ uuid: () => uuidFrom(41) }));
    expect(await sequence(friend, replay)).toEqual(await sequence(original, first));
  });

  it("gives the friend a replay id of their own, keyed apart for rate limits", async () => {
    const link = (await playTo(context({ uuid: () => uuidFrom(42) }), 2)).challenge;
    const replay = await startChallenge(context({ uuid: () => uuidFrom(901) }), link);
    const origin = `20260919-${uuidFrom(42)}`;
    expect(replay.runId.startsWith(`${origin}~${uuidFrom(901)}.`)).toBe(true);
    expect(parseRunId(replay.runId)).toMatchObject({ origin, replay: true });

    const seen: string[] = [];
    const ctx = context({
      limits: {
        start: async (): Promise<RateDecision> => ({ ok: true }),
        answer: async (run) => {
          seen.push(run);
          return { ok: true };
        },
      },
    });
    await answer(ctx, replay.runId, 1, "higher");
    expect(seen).toEqual([`${origin}~${uuidFrom(901)}`]);
  });

  it("links a replay's own end back to the original run, at the friend's score", async () => {
    const link = (await playTo(context({ uuid: () => uuidFrom(43) }), 1)).challenge;
    const friend = context({ uuid: () => uuidFrom(902) });
    const replay = await startChallenge(friend, link);
    const right = correctGuess(SAMPLE_DECK, replay.runId, replay.round);
    const res = (await answer(friend, replay.runId, 1, wrongGuess(right))) as EndResponse;
    expect(res.challenge.runId).toBe(link.runId);
    expect(res.challenge.score).toBe(0);
    // And that link is itself a valid challenge.
    expect((await startChallenge(context(), res.challenge)).challenge).toEqual({
      accepted: true,
      score: 0,
    });
  });

  it.each([0, CHALLENGE_DAYS - 1, CHALLENGE_DAYS])(
    "accepts a link %d days after the run",
    async (days) => {
      const link = (await playTo(context(), 2)).challenge;
      const res = await startChallenge(context({ clock: () => daysAfter(days) }), link);
      expect(res.challenge).toEqual({ accepted: true, score: 2 });
      // The replay keeps the original run's date, and so its sequence.
      expect(res.runId.startsWith("20260919-")).toBe(true);
    },
  );

  it("keeps a replay answerable for a day's grace past the window, and no longer", async () => {
    const link = (await playTo(context(), 2)).challenge;
    const replay = await startChallenge(context({ clock: () => daysAfter(CHALLENGE_DAYS) }), link);
    const body = { mode: "friendly", runId: replay.runId, round: 1, guess: "higher" };
    const late = context({ clock: () => daysAfter(CHALLENGE_DAYS + 1) });
    expect((await call(body, late)).status).toBe(200);
    const later = context({ clock: () => daysAfter(CHALLENGE_DAYS + 2) });
    expect((await call(body, later)).body).toMatchObject({ detail: "runId is out of date" });
  });
});

describe("replaying a won run", () => {
  it("accepts a link at twenty, and the replay can be won too", async () => {
    const original = context({ uuid: () => uuidFrom(46) });
    const won = (await walkRun(original)).answers.at(-1) as EndResponse;
    expect(won.challenge.score).toBe(20);

    const friend = context({ uuid: () => uuidFrom(903) });
    const replay = await startChallenge(friend, won.challenge);
    expect(replay.challenge).toEqual({ accepted: true, score: 20 });
    let round = replay.round;
    let res = await answer(friend, replay.runId, 1, correctGuess(SAMPLE_DECK, replay.runId, round));
    while ("next" in res) {
      round = res.next;
      res = await answer(
        friend,
        replay.runId,
        round.index,
        correctGuess(SAMPLE_DECK, replay.runId, round),
      );
    }
    expect(res).toMatchObject({ end: "won", challenge: { runId: won.challenge.runId, score: 20 } });
  });
});

describe("refusing a challenge", () => {
  const fresh = (res: StartResponse) => {
    expect(res.runId).toMatch(/^20260919-[0-9a-f-]{36}\.[A-Za-z0-9_-]{22}$/);
    expect(parseRunId(res.runId)?.replay).toBe(false);
  };

  it(`refuses a link older than ${CHALLENGE_DAYS} days and starts a fresh run`, async () => {
    const link = (await playTo(context(), 2)).challenge;
    const ctx = context({ clock: () => daysAfter(CHALLENGE_DAYS + 1) });
    const res = await startChallenge(ctx, link);
    expect(res.challenge).toEqual({ accepted: false, reason: "expired" });
    expect(res.runId.startsWith("20260930-")).toBe(true);
    expect(parseRunId(res.runId)?.replay).toBe(false);
  });

  it("refuses an edited score", async () => {
    const link = (await playTo(context(), 2)).challenge;
    for (const score of [3, 1, 20]) {
      const res = await startChallenge(context(), { ...link, score });
      expect(res.challenge).toEqual({ accepted: false, reason: "invalid" });
      fresh(res);
    }
  });

  it("refuses a signature moved onto another run", async () => {
    const link = (await playTo(context({ uuid: () => uuidFrom(44) }), 2)).challenge;
    const other = await signedRunId("2026-09-19", uuidFrom(45));
    const res = await startChallenge(context(), { ...link, runId: other });
    expect(res.challenge).toEqual({ accepted: false, reason: "invalid" });
    fresh(res);
  });

  it("refuses a run id with its date, uuid or signature changed", async () => {
    const link = (await playTo(context({ uuid: () => uuidFrom(46) }), 2)).challenge;
    const tampered = [
      link.runId.replace("20260919", "20260918"),
      link.runId.replace(uuidFrom(46), uuidFrom(47)),
      link.runId.slice(0, -1) + (link.runId.endsWith("A") ? "B" : "A"),
      "not-a-run-id",
      "",
    ];
    for (const runId of tampered) {
      const res = await startChallenge(context(), { ...link, runId });
      expect(res.challenge, runId).toEqual({ accepted: false, reason: "invalid" });
    }
  });

  it("refuses a sig from another secret", async () => {
    const link = (await playTo(context({ secret: "someone-else" }), 2)).challenge;
    const res = await startChallenge(context(), link);
    expect(res.challenge).toEqual({ accepted: false, reason: "invalid" });
  });

  it("refuses a replay id passed off as a challenged run", async () => {
    const link = (await playTo(context(), 2)).challenge;
    const replay = await startChallenge(context({ uuid: () => uuidFrom(903) }), link);
    const res = await startChallenge(context(), { ...link, runId: replay.runId });
    expect(res.challenge).toEqual({ accepted: false, reason: "invalid" });
  });

  it.each<[string, Record<string, unknown>]>([
    ["a score as a string", { score: "2" }],
    ["a fractional score", { score: 2.5 }],
    ["a negative score", { score: -1 }],
    ["a score past Friendly's twenty", { score: 21 }],
    ["a missing sig", { sig: undefined }],
    ["a numeric challenge", { challenge: 20260919 }],
    ["an overlong sig", { sig: "A".repeat(200) }],
  ])("rejects %s with 400", async (_, change) => {
    const body: Record<string, unknown> = {
      mode: "friendly",
      challenge: await signedRunId("2026-09-19", uuidFrom(1)),
      score: 2,
      sig: "A".repeat(22),
      ...change,
    };
    for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
    const result = await call(body, context());
    expect(result.status).toBe(400);
  });
});

describe("fresh runs keep the ±1-day rule", () => {
  it.each([2, 5, CHALLENGE_DAYS])(
    "refuses an answer on a fresh run %d days old, inside the challenge window",
    async (days) => {
      const { runId } = await start(context());
      const ctx = context({ clock: () => daysAfter(days) });
      const result = await call({ mode: "friendly", runId, round: 1, guess: "higher" }, ctx);
      expect(result.body).toMatchObject({ detail: "runId is out of date" });
    },
  );

  it("still mints fresh runs for today, with no challenge status", async () => {
    const res = await start(context());
    expect(res).not.toHaveProperty("challenge");
    expect(SECRET).not.toBe("");
  });
});
