/**
 * Instagram Endless (variants.ts in @bt/core) through the Worker: the same
 * round protocol as Endless, under its own run ids, seeds, tokens and
 * challenge links, with followers on every question, no spin in its
 * deadlines, and no boards.
 */

import { describe, expect, it } from "vitest";
import { NETWORK_GRACE_MS, answerAllowance, buildRun, questionLimit } from "@bt/core";
import type { GuessEndResponse, Player } from "@bt/core";
import { toDataPoint, toLogLine } from "../analytics.js";
import type { GameEvent } from "../analytics.js";
import { checkChallenge } from "../challenge.js";
import { handleLeave } from "../leave.js";
import { parseRunId, verifyRunId } from "../run-id.js";
import { disconnectedEnd, handleGuess, parseRunStart } from "../run.js";
import { endlessSeed, seedFor } from "../seed.js";
import { handleSubmit } from "../submit.js";
import type { SubmitContext } from "../submit.js";
import { signToken, verifyResult, verifyToken } from "../token.js";
import type { ProgressPayload } from "../token.js";
import { begin, harness, readToken, startBody, walk } from "./endless-helpers.js";
import { SAMPLE_DECK, SECRET, runDay } from "./helpers.js";

const VARIANT = "endless-instagram" as const;
const ctxFacts = { country: "GB", deckVersion: "legends-test" };

function player(id: string): Player {
  return SAMPLE_DECK.find((p) => p.id === id)!;
}

async function endedRun(stopAt = 4): Promise<{ end: GuessEndResponse; runId: string }> {
  const h = harness();
  const { started, answers } = await walk(h, { stopAt, ending: "wrong", variant: VARIANT });
  return { end: answers.at(-1) as GuessEndResponse, runId: started.runId };
}

describe("starting an Instagram Endless run", () => {
  it("parses the variant, and refuses an unknown one or general Endless named outright", () => {
    expect(parseRunStart(startBody(undefined, VARIANT))).toEqual({
      ok: true,
      value: { mode: "endless", variant: VARIANT, turnstileToken: "turnstile-token" },
    });
    for (const variant of ["endless", "instagram", "", 1, null]) {
      const parsed = parseRunStart({ mode: "endless", variant, turnstileToken: "t" });
      expect(parsed.ok).toBe(false);
    }
  });

  it("deals Instagram followers, under a run id and token of its own", async () => {
    const h = harness();
    const started = await begin(h, undefined, VARIANT);
    expect(started.round.stat.key).toBe("ig");
    expect(started.round.stat.statChanged).toBe(false);
    // Signed for Instagram Endless, so it is no general Endless run.
    expect(await verifyRunId(started.runId, SECRET, VARIANT)).toBeDefined();
    expect(await verifyRunId(started.runId, SECRET, "endless")).toBeUndefined();
    const token = readToken(started.token);
    expect(token.variant).toBe(VARIANT);
    expect(token.mode).toBe("endless");
    // The ledger knows the variant, for a silent run's end.
    const run = parseRunId(started.runId)!;
    expect(h.ledgers.get(run.body)!.run!.variant).toBe(VARIANT);
  });

  it("records the start under the variant", async () => {
    const h = harness();
    await begin(h, undefined, VARIANT);
    expect(h.events).toEqual([
      expect.objectContaining({ type: "start", mode: "endless", variant: VARIANT }),
    ]);
  });
});

describe("playing an Instagram Endless run", () => {
  it("never deals another stat or a player without a figure, and never spins", async () => {
    for (let i = 0; i < 12; i++) {
      const h = harness();
      const { started, answers } = await walk(h, {
        stopAt: 3 + i,
        ending: "wrong",
        variant: VARIANT,
      });
      const rounds = [started.round, ...answers.flatMap((a) => ("next" in a ? [a.next] : []))];
      expect(rounds.length).toBe(3 + i);
      for (const round of rounds) {
        expect(round.stat.key).toBe("ig");
        expect(round.stat.statChanged).toBe(false);
        expect(player(round.anchor.id).stats.ig).toBeDefined();
        expect(player(round.challenger.id).stats.ig).toBeDefined();
      }
    }
  });

  it("sets every deadline with no spin allowance, round one included", async () => {
    const h = harness();
    const started = await begin(h, undefined, VARIANT);
    const first = readToken(started.token);
    expect(first.deadline - first.issuedAt).toBe(
      answerAllowance(1, false, false) + questionLimit("endless", 1)! + NETWORK_GRACE_MS,
    );
    const { answers } = await walk(harness(), { stopAt: 8, ending: "wrong", variant: VARIANT });
    for (const answer of answers) {
      if (!("token" in answer)) continue;
      const t = readToken(answer.token);
      expect(t.deadline - t.issuedAt).toBe(
        answerAllowance(2, false, false) + questionLimit("endless", 2)! + NETWORK_GRACE_MS,
      );
    }
  });

  it("ends with a result token and a challenge link of its own variant", async () => {
    const { end, runId } = await endedRun(5);
    expect(end.end).toBe("wrong");
    const result = await verifyResult(SECRET, end.result!);
    expect(result).toMatchObject({ variant: VARIANT, score: 4, runId });
    const clock = runDay(runId);
    expect(await checkChallenge(SECRET, end.challenge!, clock, VARIANT)).toEqual({
      ok: true,
      score: 4,
    });
    // Not a general Endless link: "Beat 4" there would be another game's score.
    expect(await checkChallenge(SECRET, end.challenge!, clock, "endless")).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("takes its own challenge links, and refuses general Endless's", async () => {
    const own = await endedRun(3);
    const h = harness();
    const fromOwn = await begin(h, own.end.challenge!, VARIANT);
    expect(fromOwn.challenge).toEqual({ accepted: true, score: 2 });

    const general = await walk(harness(), { stopAt: 3, ending: "wrong" });
    const link = (general.answers.at(-1) as GuessEndResponse).challenge!;
    const fromGeneral = await begin(harness(), link, VARIANT);
    expect(fromGeneral.challenge).toEqual({ accepted: false, reason: "invalid" });
    const backAgain = await begin(harness(), own.end.challenge!);
    expect(backAgain.challenge).toEqual({ accepted: false, reason: "invalid" });
  });

  it("refuses a token rewritten to name general Endless", async () => {
    const h = harness();
    const started = await begin(h, undefined, VARIANT);
    // The same payload with its variant left out.
    const general = Object.fromEntries(
      Object.entries(readToken(started.token)).filter(([key]) => key !== "variant"),
    );
    // Re-signed by someone holding the secret would still fail: the run id is the variant's.
    const forged = await signToken(SECRET, general as unknown as ProgressPayload);
    const res = await handleGuess({ token: forged, guess: "higher" }, h.ctx);
    expect(res.status).toBe(400);
  });
});

describe("seeds", () => {
  it("are domain-separated from general Endless's, which are unchanged", async () => {
    const body = "20260919-00000000-0000-4000-8000-000000000001";
    const general = await endlessSeed(SECRET, body);
    const instagram = await endlessSeed(SECRET, body, VARIANT);
    expect(instagram).not.toBe(general);
    expect(await seedFor("endless", SECRET, body)).toBe(general);
    expect(await seedFor(VARIANT, SECRET, body)).toBe(instagram);
    expect(general).toMatchInlineSnapshot(
      `"3a51e9610bd764dc991a82f48b05197e6c7182b59fa696129cdfff61b4da7992"`,
    );
  });
});

describe("tokens", () => {
  it("leave general Endless's exactly as they were: no variant field", async () => {
    const payload: ProgressPayload = {
      v: 1,
      runId: "20260919-00000000-0000-4000-8000-000000000001.AAAAAAAAAAAAAAAAAAAAAA",
      mode: "endless",
      round: 3,
      streak: 2,
      anchorId: "a",
      challengerId: "b",
      stat: "caps",
      anchorValue: 10,
      issuedAt: 1,
      deadline: 2,
      nonce: "n",
    };
    const token = await signToken(SECRET, payload);
    expect(token).toMatchInlineSnapshot(
      `"eyJ2IjoxLCJydW5JZCI6IjIwMjYwOTE5LTAwMDAwMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDAwMS5BQUFBQUFBQUFBQUFBQUFBQUFBQUFBIiwibW9kZSI6ImVuZGxlc3MiLCJyb3VuZCI6Mywic3RyZWFrIjoyLCJhbmNob3JJZCI6ImEiLCJjaGFsbGVuZ2VySWQiOiJiIiwic3RhdCI6ImNhcHMiLCJhbmNob3JWYWx1ZSI6MTAsImlzc3VlZEF0IjoxLCJkZWFkbGluZSI6Miwibm9uY2UiOiJuIn0.RO5fYO3cGt1wN1VzkJ1TPIcGGM97cnp8UEBh4A51MTo"`,
    );
    expect(Object.keys(readToken(token))).not.toContain("variant");
    expect(await verifyToken(SECRET, token)).toEqual(payload);
    const named = await signToken(SECRET, { ...payload, variant: VARIANT });
    expect(await verifyToken(SECRET, named)).toEqual({ ...payload, variant: VARIANT });
  });

  it("refuse a variant that names nothing, or names general Endless", async () => {
    const base = readToken((await begin(harness(), undefined, VARIANT)).token);
    for (const variant of ["endless", "instagram", 7]) {
      const forged = await signToken(SECRET, { ...base, variant } as unknown as ProgressPayload);
      expect(await verifyToken(SECRET, forged)).toBeUndefined();
    }
  });
});

describe("publishing", () => {
  it("is refused for Instagram Endless, before the run, Turnstile or the database", async () => {
    const touched: string[] = [];
    const events: GameEvent[] = [];
    const { end, runId } = await endedRun(4);
    const ctx: SubmitContext = {
      deck: SAMPLE_DECK,
      secret: SECRET,
      clock: () => runDay(runId),
      uuid: () => "00000000-0000-4000-8000-000000000099",
      verifyTurnstile: async () => {
        touched.push("turnstile");
        return "pass";
      },
      runs: () => {
        touched.push("run");
        throw new Error("no Durable Object for a run without boards");
      },
      db: new Proxy({} as SubmitContext["db"], {
        get: () => {
          touched.push("db");
          throw new Error("no database for a run without boards");
        },
      }),
      record: (event) => events.push(event),
    };
    const body = {
      nickname: "SwiftVolley42",
      deviceId: "3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b",
      turnstileToken: "ts",
      showCountry: false,
    };
    for (const token of [end.result!]) {
      const res = await handleSubmit({ ...body, token }, ctx);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "bad_request", detail: "no_boards" });
    }
    // A banked run's progress token is refused the same way.
    const h = harness();
    const open = await begin(h, undefined, VARIANT);
    const banked = await handleSubmit({ ...body, token: open.token }, ctx);
    expect(banked.body).toEqual({ error: "bad_request", detail: "no_boards" });

    expect(touched).toEqual([]);
    expect(events[0]).toMatchObject({
      type: "submit",
      mode: "endless",
      variant: VARIANT,
      published: false,
      refusal: "no_boards",
    });
  });
});

describe("analytics and logs", () => {
  it("write the variant id as the mode column, and the variant on log lines", async () => {
    const h = harness();
    await walk(h, { stopAt: 3, ending: "wrong", variant: VARIANT });
    const kinds = new Set(h.events.map((e) => e.type));
    expect(kinds).toEqual(new Set(["start", "answer", "end"]));
    for (const event of h.events) {
      expect(event.variant).toBe(VARIANT);
      expect(toDataPoint(event, ctxFacts).blobs[1]).toBe(VARIANT);
    }
    const start = toLogLine(h.events[0]!, ctxFacts, "/api/run/start")!;
    expect(start).toMatchObject({ message: "run_start", mode: "endless", variant: VARIANT });
    const end = toLogLine(h.events.at(-1)!, ctxFacts, "/api/round/guess")!;
    expect(end).toMatchObject({ message: "run_end", variant: VARIANT });
    // Its band label is its own schedule's.
    const answer = toDataPoint(h.events[1]!, ctxFacts);
    expect(answer.blobs[7]).toBe("0.45+");
  });

  it("leave general Endless's mode column and log lines as they were", async () => {
    const h = harness();
    await walk(h, { stopAt: 2, ending: "wrong" });
    for (const event of h.events) {
      expect(event).not.toHaveProperty("variant");
      expect(toDataPoint(event, ctxFacts).blobs[1]).toBe("endless");
      const line = toLogLine(event, ctxFacts, "/api/round/guess");
      if (line !== undefined) expect(line).not.toHaveProperty("variant");
    }
  });
});

describe("a silent run and a leave", () => {
  it("closes a disconnected run with the round it left open, from its own sequence", async () => {
    const h = harness();
    const started = await begin(h, undefined, VARIANT);
    const run = parseRunId(started.runId)!;
    const record = h.ledgers.get(run.body)!.run!;
    const event = await disconnectedEnd(record, SAMPLE_DECK, SECRET);
    expect(event).toMatchObject({ type: "end", variant: VARIANT, end: "disconnected", score: 0 });
    expect(event.shown?.stat).toBe("ig");
    expect(event.shown?.players[0].id).toBe(started.round.anchor.id);
  });

  it("reads a run stored before variants as general Endless", async () => {
    const h = harness();
    const started = await begin(h);
    const run = parseRunId(started.runId)!;
    const record = h.ledgers.get(run.body)!.run!;
    expect(record).not.toHaveProperty("variant");
    const event = await disconnectedEnd(record, SAMPLE_DECK, SECRET);
    expect(event).not.toHaveProperty("variant");
    expect(event.shown?.stat).toBe(started.round.stat.key);
  });

  it("takes a leave beacon naming the variant, and refuses one that leaves it out", async () => {
    const h = harness();
    const started = await begin(h, undefined, VARIANT);
    const events: GameEvent[] = [];
    const ctx = {
      deck: SAMPLE_DECK,
      secret: SECRET,
      clock: () => runDay(started.runId),
      record: (e: GameEvent) => events.push(e),
    };
    const leave = {
      mode: "endless",
      runId: started.runId,
      round: 1,
      phase: "question",
      trigger: "hidden",
    };
    expect(await handleLeave({ ...leave, variant: VARIANT }, ctx)).toEqual({ status: 204 });
    expect(events[0]).toMatchObject({ type: "leave", variant: VARIANT });
    expect(events[0]).toMatchObject({ shown: { stat: "ig" } });
    expect((await handleLeave(leave, ctx)).status).toBe(400);
    expect((await handleLeave({ ...leave, mode: "friendly", variant: VARIANT }, ctx)).status).toBe(
      400,
    );
  });
});

describe("the sequence the server deals", () => {
  it("is buildRun's for the variant, from the variant's seed", async () => {
    const h = harness();
    const started = await begin(h, undefined, VARIANT);
    const run = parseRunId(started.runId)!;
    const rounds = buildRun({
      deck: SAMPLE_DECK,
      seed: await endlessSeed(SECRET, run.origin, VARIANT),
      mode: "endless",
      now: run.date,
      maxRounds: 1,
      variant: VARIANT,
    });
    expect(rounds[0]!.anchor.id).toBe(started.round.anchor.id);
    expect(rounds[0]!.challenger.id).toBe(started.round.challenger.id);
  });
});
