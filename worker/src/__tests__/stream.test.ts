/**
 * Twitch Mode's server side (stream.ts, stream-ledger.ts): the start's strict
 * parsing and the pool's cap, a match played to its last question whatever
 * the answers, the chosen limit on every deadline, the resend rule, refusals
 * that never void a match, the alarm closing a silent one, chat's telemetry,
 * and the routes — a match's token through `/api/round/guess`, and refused by
 * `/api/run/submit`.
 */

import { describe, expect, it, vi } from "vitest";
import {
  ANSWER_TIMINGS,
  NETWORK_GRACE_MS,
  STREAM_LIMITS,
  answerAllowance,
  inTheme,
  themeById,
} from "@bt/core";
import type { StreamGuessEndResponse, StreamStartResponse } from "@bt/core";
import { GUESS_PATH, RUN_START_PATH, SUBMIT_PATH, createApp } from "../app.js";
import type { Env } from "../app.js";
import { toDataPoint, toLogLine } from "../analytics.js";
import type { AnswerEvent, EndEvent, StartEvent } from "../analytics.js";
import { DISCONNECT_MARGIN_MS, RETAIN_MS } from "../run-ledger.js";
import { mintStreamRunId, verifyStreamRunId, verifyRunId } from "../run-id.js";
import { handleStreamStart, parseStreamGuess, streamDisconnectedEnd } from "../stream.js";
import { StreamLedger, memoryStreamStore } from "../stream-ledger.js";
import type { NewStreamRun, StreamStep } from "../stream-ledger.js";
import { signStreamToken, verifyDailyToken, verifyStreamToken, verifyToken } from "../token.js";
import { sqliteD1 } from "./d1-sqlite.js";
import { fakeRuns } from "./endless-helpers.js";
import {
  SAMPLE_DECK,
  SECRET,
  THEMED_DECK,
  TODAY,
  correctGuess,
  uuidFrom,
  wrongGuess,
} from "./helpers.js";
import {
  playMatch,
  readStreamToken,
  sendStream,
  startMatch,
  streamHarness,
  streamOk,
  streamStartBody,
} from "./stream-helpers.js";

const TESTFIELD = "squad:club-testfield" as const; // 16 players: 15 questions

describe("starting a match", () => {
  it("refuses anything but the exact shape", async () => {
    const h = streamHarness();
    const bad: unknown[] = [
      null,
      [],
      { ...streamStartBody(), extra: 1 },
      { ...streamStartBody(), mode: "endless" },
      { ...streamStartBody(), pool: "ranked" },
      { ...streamStartBody(), pool: "friendly" },
      { ...streamStartBody(), pool: "Squad:club-testfield" },
      { ...streamStartBody(), questions: 15 },
      { ...streamStartBody(), questions: "10" },
      { ...streamStartBody(), limit: 45 },
      { ...streamStartBody(), limit: 0 },
      { ...streamStartBody(), limit: 120 },
      { ...streamStartBody(), turnstileToken: "" },
      { mode: "stream", pool: "endless", questions: 10, turnstileToken: "t" },
    ];
    for (const body of bad) {
      const result = await handleStreamStart(body, h.ctx);
      expect(result.status, JSON.stringify(body)).toBe(400);
    }
    expect(h.events).toEqual([]);
  });

  it("refuses a squad the deck doesn't have, before Turnstile", async () => {
    const verify = vi.fn(async () => "pass" as const);
    const h = streamHarness({ deck: THEMED_DECK, verifyTurnstile: verify });
    const result = await handleStreamStart(streamStartBody("squad:club-nowhere"), h.ctx);
    expect(result.status).toBe(400);
    expect(verify).not.toHaveBeenCalled();
  });

  it("answers Turnstile's verdict", async () => {
    const h = streamHarness();
    h.turnstile = "fail";
    expect((await handleStreamStart(streamStartBody(), h.ctx)).status).toBe(403);
    h.turnstile = "error";
    expect((await handleStreamStart(streamStartBody(), h.ctx)).status).toBe(502);
  });

  it("is behind the run-start limit", async () => {
    const h = streamHarness({
      limits: {
        start: async () => ({ ok: false, retryAfter: 60 }),
        answer: async () => ({ ok: true }),
      },
    });
    const result = await handleStreamStart(streamStartBody(), h.ctx);
    expect(result.status).toBe(429);
  });

  it("echoes the settings, capping a squad at its size less one", async () => {
    const h = streamHarness({ deck: THEMED_DECK });
    const all = await startMatch(h, "endless", 20, 60);
    expect([all.questions, all.limit]).toEqual([20, 60]);
    const squad = await startMatch(h, TESTFIELD, 20, 30);
    expect([squad.questions, squad.limit]).toEqual([15, 30]);
    const short = await startMatch(h, TESTFIELD, 10, 10);
    expect(short.questions).toBe(10);
    const token = readStreamToken(squad.token);
    expect(token).toMatchObject({
      mode: "stream",
      pool: TESTFIELD,
      questions: 15,
      limit: 30,
      round: 1,
      correct: 0,
    });
  });

  it("uses the chosen limit on question one, with the usual allowance and grace", async () => {
    for (const limit of STREAM_LIMITS) {
      const h = streamHarness();
      const started = await startMatch(h, "endless", 10, limit);
      const token = readStreamToken(started.token);
      expect(token.deadline - token.issuedAt).toBe(
        answerAllowance(1, true) + limit * 1000 + NETWORK_GRACE_MS,
      );
    }
    // Instagram has no wheel: no spin in the allowance.
    const h = streamHarness();
    const ig = readStreamToken((await startMatch(h, "endless-instagram", 10, 20)).token);
    expect(ig.deadline - ig.issuedAt).toBe(
      answerAllowance(1, true, false) + 20_000 + NETWORK_GRACE_MS,
    );
  });

  it("records its start with the match's settings", async () => {
    const h = streamHarness();
    await startMatch(h, "endless", 20, 60);
    const start = h.events[0] as StartEvent;
    expect(start).toMatchObject({
      type: "start",
      mode: "stream",
      stream: { pool: "endless", questions: 20, limit: 60 },
    });
    const point = toDataPoint(start, { country: "GB", deckVersion: "v" });
    expect(point.blobs.slice(0, 2)).toEqual(["start", "stream"]);
    expect(point.blobs[10]).toBe("endless");
    expect(point.doubles).toEqual([20, 60]);
  });
});

describe("playing a match", () => {
  it("plays every question of each pool, only from that pool", async () => {
    const theme = themeById(THEMED_DECK, "club-testfield")!;
    for (const { pool, deck, questions, expected } of [
      { pool: "endless" as const, deck: SAMPLE_DECK, questions: 20 as const, expected: 20 },
      { pool: "endless" as const, deck: SAMPLE_DECK, questions: 10 as const, expected: 10 },
      {
        pool: "endless-instagram" as const,
        deck: SAMPLE_DECK,
        questions: 10 as const,
        expected: 10,
      },
      { pool: TESTFIELD, deck: THEMED_DECK, questions: 20 as const, expected: 15 },
      { pool: TESTFIELD, deck: THEMED_DECK, questions: 10 as const, expected: 10 },
    ]) {
      const h = streamHarness({ deck });
      const { answers, rounds } = await playMatch(h, { pool, questions });
      const last = answers.at(-1) as StreamGuessEndResponse;
      expect(answers, pool).toHaveLength(expected);
      expect(last.end).toBe("finished");
      expect(last.score).toBe(expected);
      if (pool === "endless-instagram") {
        for (const r of rounds) expect(r.stat.key).toBe("ig");
      }
      if (pool === TESTFIELD) {
        const ids = [rounds[0]!.anchor.id, ...rounds.map((r) => r.challenger.id)];
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ids)
          expect(
            inTheme(
              deck.find((p) => p.id === id)!,
              theme,
            ),
          ).toBe(true);
      }
    }
  });

  it("carries on through wrong answers, timeouts and late answers to the last question", async () => {
    const h = streamHarness();
    const how = (round: number) =>
      round % 4 === 1 ? "wrong" : round % 4 === 2 ? "timeout" : round % 4 === 3 ? "late" : "right";
    const { answers } = await playMatch(h, { questions: 20, answer: how });
    expect(answers).toHaveLength(20);
    const right = answers.filter((a) => a.reveal.correct).length;
    expect(right).toBe(5);
    const last = answers.at(-1) as StreamGuessEndResponse;
    expect(last).toMatchObject({ end: "finished", score: 5 });
    // Each next token carries the right answers so far.
    let correct = 0;
    for (const [i, a] of answers.entries()) {
      if (a.reveal.correct) correct += 1;
      if ("token" in a) expect(readStreamToken(a.token).correct, `after ${i + 1}`).toBe(correct);
    }
  });

  it("times every question by the chosen limit, the deadline itself still in time", async () => {
    for (const limit of STREAM_LIMITS) {
      const h = streamHarness();
      const started = await startMatch(h, "endless", 10, limit);
      const first = readStreamToken(started.token);
      h.now = first.deadline;
      const res = await streamOk(
        h,
        started.token,
        correctGuess(SAMPLE_DECK, started.runId, started.round),
      );
      expect(res.reveal.correct).toBe(true);
      if (!("token" in res)) throw new Error("the match ended early");
      const second = readStreamToken(res.token);
      const t = ANSWER_TIMINGS;
      const spun = t.beat + t.spin + t.land;
      const allowance = t.verdict + t.next + (res.next.stat.statChanged ? spun : t.hold);
      expect(second.deadline - second.issuedAt).toBe(allowance + limit * 1000 + NETWORK_GRACE_MS);
      // A millisecond late is a timeout, whatever the pick.
      h.now = second.deadline + 1;
      const late = await streamOk(h, res.token, correctGuess(SAMPLE_DECK, started.runId, res.next));
      expect(late.reveal.correct).toBe(false);
      expect("next" in late).toBe(true);
    }
  });

  it("answers a resend exactly as before, even after the deadline", async () => {
    const h = streamHarness();
    const started = await startMatch(h);
    const guess = correctGuess(SAMPLE_DECK, started.runId, started.round);
    h.wait(2000);
    const first = await streamOk(h, started.token, guess);
    h.now = readStreamToken(started.token).deadline + 60_000;
    const again = await streamOk(h, started.token, guess);
    expect(again).toEqual(first);
    // Recorded once.
    expect(h.events.filter((e) => e.type === "answer")).toHaveLength(1);
  });

  it("refuses a conflicting or out-of-order answer without voiding the match", async () => {
    const h = streamHarness();
    const started = await startMatch(h, "endless", 10);
    const guess = correctGuess(SAMPLE_DECK, started.runId, started.round);
    h.wait(1000);
    const first = await streamOk(h, started.token, guess);
    if (!("token" in first)) throw new Error("ended early");

    // The same token with the other guess: refused, nothing changes.
    const other = await sendStream(h, started.token, wrongGuess(guess));
    expect(other).toMatchObject({ status: 409, body: { error: "conflict", detail: "spent" } });

    // An out-of-order token: one never issued as the next (a forged nonce, re-signed).
    const forged = await signStreamToken(SECRET, {
      ...readStreamToken(first.token),
      nonce: "never-issued",
    });
    const out = await sendStream(h, forged, "higher");
    expect(out).toMatchObject({ status: 409, body: { detail: "out_of_order" } });

    // The genuine next token still plays on, to the last question.
    let token: string | undefined = first.token;
    let round = first.next;
    let answered = 1;
    let last: unknown;
    while (token !== undefined) {
      h.wait(1000);
      const res = await streamOk(h, token, correctGuess(SAMPLE_DECK, started.runId, round));
      answered += 1;
      last = res;
      if ("token" in res) {
        token = res.token;
        round = res.next;
      } else token = undefined;
    }
    expect(answered).toBe(10);
    expect(last).toMatchObject({ end: "finished", score: 10 });
    // Every answer after the end is refused as over, and the score stands.
    const over = await sendStream(h, first.token, "higher");
    expect(over.status).toBe(409);
  });

  it("refuses a token naming a round the sequence doesn't bear out", async () => {
    const h = streamHarness();
    const started = await startMatch(h);
    const edited = await signStreamToken(SECRET, {
      ...readStreamToken(started.token),
      anchorValue: readStreamToken(started.token).anchorValue + 1,
    });
    expect(await sendStream(h, edited, "higher")).toMatchObject({
      status: 409,
      body: { detail: "token_mismatch" },
    });
  });

  it("refuses a token whose match id was signed for another pool", async () => {
    const h = streamHarness({ deck: THEMED_DECK });
    const started = await startMatch(h, "endless");
    const swapped = await signStreamToken(SECRET, {
      ...readStreamToken(started.token),
      pool: TESTFIELD,
    });
    expect((await sendStream(h, swapped, "higher")).status).toBe(400);
  });
});

describe("tokens and ids", () => {
  it("a match's token is no other kind, and no other kind is a match's", async () => {
    const h = streamHarness();
    const started = await startMatch(h);
    expect(await verifyToken(SECRET, started.token)).toBeUndefined();
    expect(await verifyDailyToken(SECRET, started.token)).toBeUndefined();
    expect(await verifyStreamToken("another-secret", started.token)).toBeUndefined();
    expect(await verifyStreamToken(SECRET, started.token)).toBeDefined();
  });

  it("a forged or edited token fails", async () => {
    const h = streamHarness();
    const started = await startMatch(h);
    const [body, sig] = started.token.split(".");
    const payload = readStreamToken(started.token);
    const edited = Buffer.from(JSON.stringify({ ...payload, correct: 0, round: 2 })).toString(
      "base64url",
    );
    expect(await verifyStreamToken(SECRET, `${edited}.${sig}`)).toBeUndefined();
    expect(await verifyStreamToken(SECRET, `${body}.${"A".repeat(43)}`)).toBeUndefined();
    // Strict: a limit the mode doesn't have, or a stray key, is no token even signed.
    expect(
      await verifyStreamToken(
        SECRET,
        await signStreamToken(SECRET, { ...payload, limit: 45 as never }),
      ),
    ).toBeUndefined();
  });

  it("a match id verifies only for its own pool, never as Endless", async () => {
    const id = await mintStreamRunId(TODAY, uuidFrom(1), SECRET, "endless");
    expect(await verifyStreamRunId(id, SECRET, "endless")).toBeDefined();
    expect(await verifyStreamRunId(id, SECRET, "endless-instagram")).toBeUndefined();
    expect(await verifyRunId(id, SECRET, "endless")).toBeUndefined();
    expect(await verifyRunId(id, SECRET, "friendly")).toBeUndefined();
  });
});

describe("chat's telemetry", () => {
  it("is held to its shape", () => {
    const token = "a.b";
    const ok = (chat: unknown) => parseStreamGuess({ token, guess: "higher", chat }).ok;
    expect(ok({ pick: "higher", voters: 12 })).toBe(true);
    expect(ok({ pick: "split", voters: 4 })).toBe(true);
    expect(ok({ pick: "none", voters: 0 })).toBe(true);
    for (const chat of [
      null,
      { pick: "higher" },
      { pick: "up", voters: 1 },
      { pick: "higher", voters: -1 },
      { pick: "higher", voters: 1.5 },
      { pick: "higher", voters: 0 },
      { pick: "none", voters: 3 },
      { pick: "higher", voters: 1, name: "someone" },
    ]) {
      expect(ok(chat), JSON.stringify(chat)).toBe(false);
    }
    expect(parseStreamGuess({ token, guess: "higher", extra: 1 }).ok).toBe(false);
  });

  it("is recorded, judged by the server, and never changes the match", async () => {
    const h = streamHarness();
    const picks = [
      { pick: "split", voters: 4 },
      { pick: "none", voters: 0 },
    ] as const;
    let chatRight = 0;
    const { answers, started, rounds } = await playMatch(h, {
      questions: 10,
      chat: (round) => {
        if (round <= 2) return picks[round - 1];
        return { pick: round % 2 === 0 ? "higher" : "lower", voters: round * 3 };
      },
    });
    for (const r of rounds.slice(2)) {
      const answer = correctGuess(SAMPLE_DECK, started.runId, r);
      if ((r.index % 2 === 0 ? "higher" : "lower") === answer) chatRight += 1;
    }
    expect(answers.every((a) => a.reveal.correct)).toBe(true);
    const answered = h.events.filter((e): e is AnswerEvent => e.type === "answer");
    expect(answered.map((e) => e.voters)).toEqual([4, 0, 9, 12, 15, 18, 21, 24, 27, 30]);
    expect(answered[0]!.chat).toBe("split");
    expect(answered[1]!.chat).toBe("none");
    const end = h.events.find((e): e is EndEvent => e.type === "end")!;
    expect(end).toMatchObject({ end: "finished", score: 10, chatScore: chatRight, peakVoters: 30 });
    const point = toDataPoint(end, { country: "GB", deckVersion: "v" });
    expect(point.blobs[1]).toBe("stream");
    expect(point.blobs[5]).toBe("finished");
    expect(point.blobs[10]).toBe("endless");
    expect(point.doubles).toEqual([10, 10, 30, chatRight, 30]);
    const answerPoint = toDataPoint(answered[0]!, { country: "GB", deckVersion: "v" });
    expect(answerPoint.blobs[11]).toBe("split");
    expect(answerPoint.doubles[7]).toBe(4);
    const line = toLogLine(end, { country: "GB", deckVersion: "v" }, GUESS_PATH)!;
    expect(line).toMatchObject({ mode: "stream", pool: "endless", chatScore: chatRight });
  });

  it("puts a squad's theme in its column", async () => {
    const h = streamHarness({ deck: THEMED_DECK });
    await startMatch(h, TESTFIELD, 10, 30);
    const point = toDataPoint(h.events[0]!, { country: "GB", deckVersion: "v" });
    expect(point.blobs[9]).toBe("club-testfield");
    expect(point.blobs[10]).toBe(TESTFIELD);
  });
});

describe("the ledger", () => {
  const first: NewStreamRun = {
    key: "20260919-k",
    runId: "20260919-k.sig",
    pool: "endless",
    questions: 3,
    limit: 30,
    country: "GB",
    deckVersion: "v",
    startedAt: 0,
    nonce: "n1",
    issuedAt: 0,
    deadline: 50_000,
  };
  const step = (over: Partial<StreamStep>): StreamStep => ({
    nonce: "n1",
    round: 1,
    guess: "higher",
    issuedAt: 0,
    receivedAt: 1000,
    correct: false,
    outcome: { kind: "next", nonce: "n2", issuedAt: 1000, deadline: 60_000 },
    ...over,
  });

  it("begins once", () => {
    const ledger = new StreamLedger(memoryStreamStore());
    expect(ledger.begin(first)).toBe(true);
    expect(ledger.begin(first)).toBe(false);
  });

  it("goes on after a miss, and never voids", () => {
    const ledger = new StreamLedger(memoryStreamStore());
    ledger.begin(first);
    expect(ledger.advance(step({}))).toMatchObject({ ok: true, fresh: true, score: 0 });
    expect(ledger.advance(step({ guess: "lower" }))).toEqual({ ok: false, reason: "spent" });
    expect(ledger.advance(step({ nonce: "zz", round: 2 }))).toEqual({
      ok: false,
      reason: "out_of_order",
    });
    const second = ledger.advance(
      step({
        nonce: "n2",
        round: 2,
        correct: true,
        outcome: { kind: "next", nonce: "n3", issuedAt: 2000, deadline: 70_000 },
      }),
    );
    expect(second).toMatchObject({ ok: true, score: 1 });
    const third = ledger.advance(
      step({
        nonce: "n3",
        round: 3,
        correct: true,
        outcome: { kind: "end", end: "finished", endedAt: 3000 },
      }),
    );
    expect(third).toMatchObject({ ok: true, score: 2, outcome: { kind: "end" } });
    expect(ledger.run).toMatchObject({
      status: "ended",
      end: "finished",
      results: [false, true, true],
    });
    expect(ledger.advance(step({ nonce: "n9", round: 4 }))).toEqual({ ok: false, reason: "over" });
  });

  it("closes a silent match, then lets it go", () => {
    const ledger = new StreamLedger(memoryStreamStore());
    ledger.begin(first);
    expect(ledger.alarmAt()).toBe(first.deadline + DISCONNECT_MARGIN_MS);
    expect(ledger.onAlarm(first.deadline)).toEqual({ action: "none" });
    const closed = ledger.onAlarm(first.deadline + DISCONNECT_MARGIN_MS);
    expect(closed).toMatchObject({ action: "closed", run: { end: "disconnected" } });
    // A late answer is over, not void.
    expect(ledger.advance(step({}))).toEqual({ ok: false, reason: "over" });
    const at = ledger.alarmAt()!;
    expect(at).toBe(first.deadline + DISCONNECT_MARGIN_MS + RETAIN_MS);
    expect(ledger.onAlarm(at)).toEqual({ action: "delete" });
    expect(ledger.run).toBeUndefined();
  });

  it("logs a silent match's open round with only what was on screen", async () => {
    const h = streamHarness();
    const started = await startMatch(h);
    const key = started.runId.split(".")[0]!;
    const ledger = h.ledgers.get(key)!;
    const action = ledger.onAlarm(readStreamToken(started.token).deadline + DISCONNECT_MARGIN_MS);
    if (action.action !== "closed") throw new Error("not closed");
    const event = await streamDisconnectedEnd(action.run, SAMPLE_DECK, SECRET);
    expect(event).toMatchObject({ mode: "stream", end: "disconnected", score: 0 });
    const challenger = event.shown?.players[1];
    expect(challenger?.id).toBe(started.round.challenger.id);
    expect(challenger?.value).toBeUndefined();
  });
});

describe("the routes", () => {
  function env(): Env {
    const allow = { limit: vi.fn(async () => ({ success: true })) };
    return {
      ASSETS: { fetch: vi.fn(async () => new Response("site")) },
      RUN_SECRET: SECRET,
      TURNSTILE_SECRET: "turnstile-secret",
      RUN_ANSWERS: allow,
      RUN_STARTS: allow,
      ROUND_FLOOD: allow,
      FEEDBACK_SENDS: allow,
      RUN_SUBMITS: allow,
      FEEDBACK_EMAIL: { send: vi.fn(async () => ({})) },
      RUNS: fakeRuns(),
      DB: sqliteD1(),
    };
  }
  function app() {
    let n = 0;
    return createApp({
      deck: SAMPLE_DECK,
      images: {},
      clock: () => TODAY,
      uuid: () => uuidFrom(++n),
      log: () => {},
      fetch: async () => new Response(JSON.stringify({ success: true })),
    });
  }
  const post = (path: string, body: unknown) =>
    new Request(`https://biggerthangame.com${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7" },
      body: JSON.stringify(body),
    });

  it("start a match and take its guesses, chat included", async () => {
    const a = app();
    const e = env();
    const res = await a.fetch(post(RUN_START_PATH, streamStartBody("endless", 10, 20)), e);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const started = (await res.json()) as StreamStartResponse;
    const guess = correctGuess(SAMPLE_DECK, started.runId, started.round);
    const answered = await a.fetch(
      post(GUESS_PATH, { token: started.token, guess, chat: { pick: "lower", voters: 7 } }),
      e,
    );
    expect(answered.status).toBe(200);
    // An Endless guess body with chat in it is still refused.
    const endless = await a.fetch(
      post(GUESS_PATH, { token: "x.y", guess: "higher", chat: { pick: "lower", voters: 7 } }),
      e,
    );
    expect(endless.status).toBe(400);
  });

  it("refuse to publish a match", async () => {
    const a = app();
    const e = env();
    const res = await a.fetch(post(RUN_START_PATH, streamStartBody()), e);
    const started = (await res.json()) as StreamStartResponse;
    const submit = await a.fetch(
      post(SUBMIT_PATH, {
        token: started.token,
        nickname: "SwiftVolley42",
        deviceId: "6f1c2b0e-4a5d-4c3e-9b1a-2d3e4f5a6b7c",
        turnstileToken: "t",
        showCountry: true,
      }),
      e,
    );
    expect(submit.status).toBe(400);
    expect(await submit.json()).toEqual({ error: "bad_request", detail: "no_boards" });
  });
});
