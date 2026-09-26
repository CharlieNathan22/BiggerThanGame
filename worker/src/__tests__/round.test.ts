import { beforeAll, describe, expect, it } from "vitest";
import { MAX_ROUNDS, STATS, buildRun, valueOf } from "@bt/core";
import type { ContinueResponse, Player, Round } from "@bt/core";
import { toRoundPayload } from "../payload.js";
import type { RateDecision } from "../rate-limit.js";
import { friendlySeed } from "../seed.js";
import {
  FIXTURE_DECK,
  SAMPLE_DECK,
  SECRET,
  TODAY,
  answer,
  call,
  context,
  correctGuess,
  runDay,
  signedRunId,
  start,
  uuidFrom,
  walkRun,
  wrongGuess,
} from "./helpers.js";

describe("starting a run", () => {
  it("mints a dated run id and deals round one", async () => {
    const res = await start(context());
    expect(res.runId).toBe(await signedRunId("2026-09-19", uuidFrom(1)));
    expect(res.runId).toMatch(/^20260919-[0-9a-f-]{36}\.[A-Za-z0-9_-]{22}$/);
    expect(res.round.index).toBe(1);
    expect(res.round.stat.statChanged).toBe(false);
  });

  it("dates the run id in UTC", async () => {
    const lateEvening = new Date("2026-09-19T23:30:00-05:00"); // 04:30 UTC on the 20th
    const res = await start(context({ clock: () => lateEvening }));
    expect(res.runId.startsWith("20260920-")).toBe(true);
  });

  it("returns 503 when the deck can't deal a single round", async () => {
    const result = await call({ mode: "friendly" }, context({ deck: [] }));
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ error: "unavailable" });
  });
});

describe("answering", () => {
  it("marks a correct guess correct and deals the next round", async () => {
    const ctx = context();
    const { runId, round } = await start(ctx);
    const res = await answer(ctx, runId, 1, correctGuess(SAMPLE_DECK, runId, round));
    expect(res.reveal.correct).toBe(true);
    expect("next" in res).toBe(true);
    expect("end" in res).toBe(false);
  });

  it("reveals the challenger's true value, formatted by the shared formatter", async () => {
    const ctx = context();
    const { runId, round } = await start(ctx);
    const res = await answer(ctx, runId, 1, "higher");
    const challenger = SAMPLE_DECK.find((p) => p.id === round.challenger.id)!;
    const truth = valueOf(challenger, round.stat.key, runDay(runId))!;
    expect(res.reveal.round).toBe(1);
    expect(res.reveal.value).toBe(truth);
    expect(res.reveal.display).toBe(STATS[round.stat.key].format(truth));
    expect(res.reveal.correct).toBe(truth > round.anchor.value);
  });

  it("ends the run on a wrong guess, with no next round", async () => {
    const ctx = context();
    const { runId, round } = await start(ctx);
    const res = await answer(ctx, runId, 1, wrongGuess(correctGuess(SAMPLE_DECK, runId, round)));
    expect(res.reveal.correct).toBe(false);
    expect(res).toMatchObject({ end: "wrong" });
    expect("next" in res).toBe(false);
  });

  it("makes round n's challenger round n+1's anchor, winner or not", async () => {
    const { answers, started } = await walkRun(context());
    let previous = started.round;
    for (const res of answers) {
      if (!("next" in res)) break;
      expect(res.next.index).toBe(previous.index + 1);
      expect(res.next.anchor.id).toBe(previous.challenger.id);
      previous = res.next;
    }
  });

  it("puts each challenger's hidden qualifier in the reveal, not the round", async () => {
    // Fee year and follower snapshot date are stat-derived hints.
    for (let i = 0; i < 20; i++) {
      const { answers, started } = await walkRun(context({ uuid: () => uuidFrom(1000 + i) }));
      let round = started.round;
      for (const res of answers) {
        const challenger = SAMPLE_DECK.find((p) => p.id === round.challenger.id)!;
        const expected = STATS[round.stat.key].qualifier?.(challenger);
        expect(res.reveal.qualifier).toBe(expected);
        if (!("next" in res)) break;
        round = res.next;
      }
    }
  });

  it.each([
    ["sample", SAMPLE_DECK],
    ["fixture", FIXTURE_DECK],
  ])("ends a perfect run on the %s deck with deck-exhausted at the round cap", async (_, deck) => {
    const { answers } = await walkRun(context({ deck }), deck);
    const last = answers.at(-1)!;
    expect(answers).toHaveLength(MAX_ROUNDS);
    expect(last.reveal).toMatchObject({ round: MAX_ROUNDS, correct: true });
    expect(last).toMatchObject({ end: "deck-exhausted" });
    expect("next" in last).toBe(false);
  });
});

describe("determinism", () => {
  it("replays the same run id identically on every call", async () => {
    const a = await walkRun(context({ uuid: () => uuidFrom(7) }));
    const b = await walkRun(context({ uuid: () => uuidFrom(7) }));
    expect(b.runId).toBe(a.runId);
    expect(b.started).toEqual(a.started);
    expect(b.answers).toEqual(a.answers);
  });

  it("answers the same question the same way however often it is asked", async () => {
    const ctx = context();
    const { runId } = await start(ctx);
    const first = await answer(ctx, runId, 1, "higher");
    const again = await answer(ctx, runId, 1, "higher");
    expect(again).toEqual(first);
  });

  it("gives different run ids different sequences", async () => {
    const sequences = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const { answers, started } = await walkRun(context({ uuid: () => uuidFrom(200 + i) }));
      const next = answers.flatMap((r) => ("next" in r ? [r.next] : []));
      sequences.add(
        [started.round, ...next].map((r) => `${r.stat.key}:${r.challenger.id}`).join("|"),
      );
    }
    expect(sequences.size).toBeGreaterThan(1);
  });

  it("depends on the secret, so a client can't compute the sequence", async () => {
    const ctx = (secret: string) => context({ secret, uuid: () => uuidFrom(42) });
    const runs = await Promise.all(["one-secret", "another-secret"].map((s) => walkRun(ctx(s))));
    const shape = (r: (typeof runs)[number]) =>
      r.answers.map((a) => ("next" in a ? a.next.challenger.id : "end")).join("|");
    expect(shape(runs[0]!)).not.toBe(shape(runs[1]!));
  });
});

describe("the run's reference date", () => {
  it("does not move with the server clock", async () => {
    const ctx = context({ uuid: () => uuidFrom(9) });
    const { runId, round } = await start(ctx);
    const guess = correctGuess(SAMPLE_DECK, runId, round);
    const today = await answer(ctx, runId, 1, guess);
    // Same run, answered the next day (still inside the tolerance).
    const tomorrow = new Date(TODAY.getTime() + 86_400_000);
    const later = await answer(context({ clock: () => tomorrow }), runId, 1, guess);
    expect(later).toEqual(today);
  });

  it("computes age from the run's date, not the moment of the request", async () => {
    // Born 20 September: 45 on the run's date (the 19th), 46 by the server
    // clock a day later. The payload must say 45 throughout the run.
    const birthday: Player = {
      id: "birthday",
      name: "Birthday Player",
      country: "Testland",
      position: "MF",
      dob: "1980-09-20",
      stats: {},
    };
    const other: Player = { ...birthday, id: "other", name: "Other", dob: "1990-01-01" };
    const round: Round = {
      index: 12,
      stat: "age",
      anchor: birthday,
      challenger: other,
      band: { floor: 0, ceiling: null },
      relaxation: "none",
      statChanged: true,
    };
    const day = runDay(await signedRunId("2026-09-19", uuidFrom(1)));
    expect(toRoundPayload(round, day, {}).anchor.value).toBe(45);
    expect(toRoundPayload(round, new Date("2026-09-20T00:00:00Z"), {}).anchor.value).toBe(46);
  });
});

describe("validation", () => {
  let runId = "";
  beforeAll(async () => {
    runId = await signedRunId("2026-09-19", uuidFrom(1));
  });
  const good = () => ({ mode: "friendly", runId, round: 1, guess: "higher" });
  const sig = () => runId.slice(runId.indexOf(".") + 1);

  it.each<[string, () => unknown]>([
    ["a non-object body", () => "friendly"],
    ["null", () => null],
    ["an array", () => [good()]],
    ["a missing mode", () => ({ runId, round: 1, guess: "higher" })],
    ["an unknown mode", () => ({ mode: "ranked" })],
    ["a mode in the wrong case", () => ({ mode: "Friendly" })],
    ["a start with extra keys", () => ({ mode: "friendly", extra: true })],
    ["an answer with extra keys", () => ({ ...good(), token: "x" })],
    ["a missing runId", () => ({ mode: "friendly", round: 1, guess: "higher" })],
    ["a malformed runId", () => ({ ...good(), runId: "not-a-run" })],
    ["a runId without a date", () => ({ ...good(), runId: `${uuidFrom(1)}.${sig()}` })],
    [
      "a runId with an upper-case uuid",
      () => ({ ...good(), runId: `20260919-${uuidFrom(0xabcdef).toUpperCase()}.${sig()}` }),
    ],
    [
      "a runId naming an impossible date",
      () => ({ ...good(), runId: `20260231-${uuidFrom(1)}.${sig()}` }),
    ],
    ["a runId with a short signature", () => ({ ...good(), runId: runId.slice(0, -1) })],
    ["a runId with a padded signature", () => ({ ...good(), runId: `${runId}=` })],
    ["round 0", () => ({ ...good(), round: 0 })],
    ["a negative round", () => ({ ...good(), round: -3 })],
    ["a fractional round", () => ({ ...good(), round: 1.5 })],
    ["a round as a string", () => ({ ...good(), round: "1" })],
    ["a round past the cap", () => ({ ...good(), round: MAX_ROUNDS + 1 })],
    ["an unknown guess", () => ({ ...good(), guess: "up" })],
    ["a guess in the wrong case", () => ({ ...good(), guess: "Higher" })],
    ["a missing guess", () => ({ mode: "friendly", runId, round: 1 })],
  ])("rejects %s with 400", async (_, make) => {
    const result = await call(make(), context());
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: "bad_request" });
  });

  it.each([
    ["two days ago", "2026-09-17"],
    ["two days ahead", "2026-09-21"],
    ["years ago", "2020-01-01"],
  ])("rejects a genuine run dated %s", async (_, day) => {
    const old = await signedRunId(day, uuidFrom(1));
    const result = await call({ ...good(), runId: old }, context());
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: "bad_request", detail: "runId is out of date" });
  });

  it.each([
    ["yesterday", "2026-09-18"],
    ["today", "2026-09-19"],
    ["tomorrow", "2026-09-20"],
  ])("answers a genuine run dated %s", async (_, day) => {
    const current = await signedRunId(day, uuidFrom(1));
    const result = await call({ ...good(), runId: current }, context());
    expect(result.status).toBe(200);
  });

  it("accepts a well-formed answer", async () => {
    const result = await call(good(), context());
    expect(result.status).toBe(200);
    expect((result.body as ContinueResponse).reveal.round).toBe(1);
  });
});

describe("signed run ids", () => {
  const notIssued = { error: "bad_request", detail: "runId is not one this server issued" };
  const answerWith = (runId: string) => ({ mode: "friendly", runId, round: 1, guess: "higher" });

  it("refuses an unsigned run id", async () => {
    const result = await call(answerWith(`20260919-${uuidFrom(1)}`), context());
    expect(result.status).toBe(400);
  });

  it("refuses a signature from another secret", async () => {
    const forged = await signedRunId("2026-09-19", uuidFrom(1), "someone-elses-secret");
    const result = await call(answerWith(forged), context());
    expect(result.status).toBe(400);
    expect(result.body).toEqual(notIssued);
  });

  it("refuses a genuine signature moved onto another run", async () => {
    const genuine = await signedRunId("2026-09-19", uuidFrom(1));
    const moved = genuine.replace(uuidFrom(1), uuidFrom(2));
    const result = await call(answerWith(moved), context());
    expect(result.status).toBe(400);
    expect(result.body).toEqual(notIssued);
  });

  it("refuses a genuine run id with its date changed", async () => {
    const genuine = await signedRunId("2026-09-19", uuidFrom(1));
    const redated = genuine.replace("20260919", "20260918");
    expect((await call(answerWith(redated), context())).body).toEqual(notIssued);
  });

  it.each([0, 5, 21])("refuses a signature with character %d changed", async (at) => {
    const genuine = await signedRunId("2026-09-19", uuidFrom(1));
    const dot = genuine.indexOf(".") + 1;
    const swapped = genuine[dot + at] === "A" ? "B" : "A";
    const tampered = genuine.slice(0, dot + at) + swapped + genuine.slice(dot + at + 1);
    expect((await call(answerWith(tampered), context())).body).toEqual(notIssued);
  });

  it("seeds from the run id's body, not its signature", async () => {
    const ctx = context({ uuid: () => uuidFrom(5) });
    const { runId, round } = await start(ctx);
    const seed = await friendlySeed(SECRET, runId.slice(0, runId.indexOf(".")));
    const expected = buildRun({
      deck: SAMPLE_DECK,
      seed,
      mode: "friendly",
      now: runDay(runId),
      maxRounds: 1,
    })[0]!;
    expect(round.anchor.id).toBe(expected.anchor.id);
    expect(round.challenger.id).toBe(expected.challenger.id);
    expect(round.stat.key).toBe(expected.stat);
  });
});

describe("rate limits in the handler", () => {
  const allow = async (): Promise<RateDecision> => ({ ok: true });

  it("limits a run start and mints nothing", async () => {
    let minted = 0;
    const ctx = context({
      uuid: () => uuidFrom(++minted),
      limits: { start: async () => ({ ok: false, retryAfter: 60 }), answer: allow },
    });
    const result = await call({ mode: "friendly" }, ctx);
    expect(result).toEqual({ status: 429, body: { error: "rate_limited" }, retryAfter: 60 });
    expect(minted).toBe(0);
  });

  it("limits answers on the run id's body, once the signature checks out", async () => {
    const seen: string[] = [];
    const ctx = context({
      limits: {
        start: allow,
        answer: async (run) => {
          seen.push(run);
          return { ok: false, retryAfter: 10 };
        },
      },
    });
    const runId = await signedRunId("2026-09-19", uuidFrom(3));
    const result = await call({ mode: "friendly", runId, round: 1, guess: "lower" }, ctx);
    expect(result).toEqual({ status: 429, body: { error: "rate_limited" }, retryAfter: 10 });
    expect(seen).toEqual([`20260919-${uuidFrom(3)}`]);
  });

  it("never counts a forged run id against a run", async () => {
    const seen: string[] = [];
    const ctx = context({
      limits: {
        start: allow,
        answer: async (run) => {
          seen.push(run);
          return { ok: true };
        },
      },
    });
    const forged = await signedRunId("2026-09-19", uuidFrom(3), "not-the-secret");
    await call({ mode: "friendly", runId: forged, round: 1, guess: "lower" }, ctx);
    expect(seen).toEqual([]);
  });
});
