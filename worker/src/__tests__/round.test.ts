import { describe, expect, it } from "vitest";
import { MAX_ROUNDS, STATS, valueOf } from "@bt/core";
import type { ContinueResponse, Player, Round } from "@bt/core";
import { toRoundPayload } from "../payload.js";
import { runDate } from "../run-id.js";
import {
  FIXTURE_DECK,
  SAMPLE_DECK,
  TODAY,
  answer,
  call,
  context,
  correctGuess,
  start,
  uuidFrom,
  walkRun,
  wrongGuess,
} from "./helpers.js";

describe("starting a run", () => {
  it("mints a dated run id and deals round one", async () => {
    const res = await start(context());
    expect(res.runId).toBe(`20260919-${uuidFrom(1)}`);
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
    const truth = valueOf(challenger, round.stat.key, runDate(runId)!)!;
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

  it("computes age from the run's date, not the moment of the request", () => {
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
    const runDay = runDate(`20260919-${uuidFrom(1)}`)!;
    expect(toRoundPayload(round, runDay, {}).anchor.value).toBe(45);
    expect(toRoundPayload(round, new Date("2026-09-20T00:00:00Z"), {}).anchor.value).toBe(46);
  });
});

describe("validation", () => {
  const runId = `20260919-${uuidFrom(1)}`;
  const good = { mode: "friendly", runId, round: 1, guess: "higher" };

  it.each([
    ["a non-object body", "friendly"],
    ["null", null],
    ["an array", [good]],
    ["a missing mode", { runId, round: 1, guess: "higher" }],
    ["an unknown mode", { mode: "ranked" }],
    ["a mode in the wrong case", { mode: "Friendly" }],
    ["a start with extra keys", { mode: "friendly", extra: true }],
    ["an answer with extra keys", { ...good, token: "x" }],
    ["a missing runId", { mode: "friendly", round: 1, guess: "higher" }],
    ["a malformed runId", { ...good, runId: "not-a-run" }],
    ["a runId without a date", { ...good, runId: uuidFrom(1) }],
    [
      "a runId with an upper-case uuid",
      { ...good, runId: `20260919-${uuidFrom(0xabcdef).toUpperCase()}` },
    ],
    ["a runId naming an impossible date", { ...good, runId: `20260231-${uuidFrom(1)}` }],
    ["round 0", { ...good, round: 0 }],
    ["a negative round", { ...good, round: -3 }],
    ["a fractional round", { ...good, round: 1.5 }],
    ["a round as a string", { ...good, round: "1" }],
    ["a round past the cap", { ...good, round: MAX_ROUNDS + 1 }],
    ["an unknown guess", { ...good, guess: "up" }],
    ["a guess in the wrong case", { ...good, guess: "Higher" }],
    ["a missing guess", { mode: "friendly", runId, round: 1 }],
  ])("rejects %s with 400", async (_, body) => {
    const result = await call(body, context());
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: "bad_request" });
  });

  it.each([
    ["two days ago", "20260917"],
    ["two days ahead", "20260921"],
    ["years ago", "20200101"],
  ])("rejects a run dated %s", async (_, date) => {
    const result = await call({ ...good, runId: `${date}-${uuidFrom(1)}` }, context());
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: "bad_request", detail: "runId is out of date" });
  });

  it.each([
    ["yesterday", "20260918"],
    ["today", "20260919"],
    ["tomorrow", "20260920"],
  ])("answers a run dated %s", async (_, date) => {
    const result = await call({ ...good, runId: `${date}-${uuidFrom(1)}` }, context());
    expect(result.status).toBe(200);
  });

  it("accepts a well-formed answer", async () => {
    const result = await call(good, context());
    expect(result.status).toBe(200);
    expect((result.body as ContinueResponse).reveal.round).toBe(1);
  });
});
