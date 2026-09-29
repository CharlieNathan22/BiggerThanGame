/**
 * Endless's round protocol (run.ts), in Node against a memory ledger per run:
 * forgery, replay, order, the server's clock, Turnstile, the launch switch,
 * challenge links and what gets recorded. The real Durable Object is tested
 * under workerd (workerd.test.ts).
 */

import { describe, expect, it } from "vitest";
import { ANSWER_TIMINGS, NETWORK_GRACE_MS, buildRun } from "@bt/core";
import type { GuessEndResponse, GuessResponse, RunStartResponse } from "@bt/core";
import { challengeLink, checkChallenge } from "../challenge.js";
import { hmacSha256, toBase64Url } from "../hmac.js";
import { handleGuess, handleRunStart, parseGuess, parseRunStart } from "../run.js";
import { DISCONNECT_MARGIN_MS } from "../run-ledger.js";
import { mintRunId, parseRunId, verifyRunId } from "../run-id.js";
import { endlessSeed } from "../seed.js";
import { verifyResult, verifyToken } from "../token.js";
import { begin, guessOk, harness, readToken, send, startBody, walk } from "./endless-helpers.js";
import { SAMPLE_DECK, SECRET, TODAY, correctGuess, runDay, wrongGuess } from "./helpers.js";

const t = ANSWER_TIMINGS;

/** Re-signs an edited payload with the real secret, as only the server could. */
async function resign(payload: object): Promise<string> {
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${body}.${toBase64Url(await hmacSha256(SECRET, `token:${body}`))}`;
}

function edited(token: string, change: Record<string, unknown>): string {
  const [body, sig] = token.split(".");
  const json = { ...readToken(token), ...change };
  void body;
  return `${Buffer.from(JSON.stringify(json)).toString("base64url")}.${sig}`;
}

async function right(
  h: ReturnType<typeof harness>,
  started: RunStartResponse,
): Promise<GuessResponse> {
  h.wait(2000);
  return guessOk(h, started.token, correctGuess(SAMPLE_DECK, started.runId, started.round));
}

describe("starting a run", () => {
  it("mints a signed Endless run id and deals round one with its first token", async () => {
    const h = harness();
    const started = await begin(h);
    const run = await verifyRunId(started.runId, SECRET, "endless");
    expect(run?.date.toISOString()).toBe("2026-09-19T00:00:00.000Z");
    expect(started.round.index).toBe(1);
    expect(await verifyToken(SECRET, started.token)).toMatchObject({
      runId: started.runId,
      round: 1,
      streak: 0,
      issuedAt: TODAY.getTime(),
    });
    expect(h.ledgers.get(run!.body)?.run).toMatchObject({ round: 1, status: "active" });
  });

  it("signs Endless ids apart from Friendly's: neither verifies as the other", async () => {
    const h = harness();
    const { runId } = await begin(h);
    expect(await verifyRunId(runId, SECRET, "friendly")).toBeUndefined();
    const friendly = await mintRunId(TODAY, "00000000-0000-4000-8000-000000000999", SECRET);
    expect(await verifyRunId(friendly, SECRET, "endless")).toBeUndefined();
  });

  it("seeds from endless:<run>, so its rounds are Endless's", async () => {
    const h = harness();
    const started = await begin(h);
    const run = parseRunId(started.runId)!;
    const seed = await endlessSeed(SECRET, run.body);
    const [first] = buildRun({
      deck: SAMPLE_DECK,
      seed,
      mode: "endless",
      now: run.date,
      maxRounds: 1,
    });
    expect(started.round.challenger.id).toBe(first!.challenger.id);
    expect(started.round.anchor.id).toBe(first!.anchor.id);
  });

  it("refuses when Turnstile says no, and asks nothing else", async () => {
    const h = harness();
    h.turnstile = "fail";
    const result = await handleRunStart(startBody(), h.ctx);
    expect(result).toEqual({ status: 403, body: { error: "verification_failed" } });
    expect(h.ledgers.size).toBe(0);
    expect(h.events).toEqual([]);
  });

  it("answers a calm 502 when Turnstile can't be asked", async () => {
    const h = harness();
    h.turnstile = "error";
    const result = await handleRunStart(startBody(), h.ctx);
    expect(result.status).toBe(502);
    expect(h.ledgers.size).toBe(0);
  });

  it("limits run starts before any other work", async () => {
    let asked = 0;
    const h = harness({
      limits: {
        start: async () => ({ ok: false, retryAfter: 60 }),
        answer: async () => ({ ok: true }),
      },
      verifyTurnstile: async () => {
        asked += 1;
        return "pass";
      },
    });
    const result = await handleRunStart(startBody(), h.ctx);
    expect(result).toMatchObject({ status: 429, retryAfter: 60, limit: "starts" });
    expect(asked).toBe(0);
  });

  it("records the start as an Endless run", async () => {
    const h = harness();
    const { runId } = await begin(h);
    expect(h.events).toEqual([
      { type: "start", mode: "endless", run: parseRunId(runId)!.body, runKind: "fresh" },
    ]);
  });
});

describe("answering", () => {
  it("reveals and deals the next round and its token in the same response", async () => {
    const h = harness();
    const started = await begin(h);
    const res = await right(h, started);
    expect(res.reveal).toMatchObject({ round: 1, correct: true });
    if (!("next" in res)) throw new Error("expected the run to go on");
    expect(res.next.index).toBe(2);
    expect(res.next.anchor.id).toBe(started.round.challenger.id);
    expect(readToken(res.token)).toMatchObject({
      round: 2,
      streak: 1,
      anchorId: res.next.anchor.id,
    });
  });

  it("ends a wrong answer as wrong, with the reveal, a challenge link and a result", async () => {
    const h = harness();
    const started = await begin(h);
    h.wait(2000);
    const pick = wrongGuess(correctGuess(SAMPLE_DECK, started.runId, started.round));
    const res = (await guessOk(h, started.token, pick)) as GuessEndResponse;
    expect(res.end).toBe("wrong");
    expect(res.reveal).toMatchObject({ round: 1, correct: false });
    expect(res.challenge.score).toBe(0);
    expect(await verifyResult(SECRET, res.result)).toMatchObject({
      runId: started.runId,
      score: 0,
      end: "wrong",
      startedOn: "2026-09-19",
      elapsedMs: 2000,
    });
  });

  it("sums the server-measured answer times into the result", async () => {
    const h = harness();
    const { answers } = await walk(h, { stopAt: 6, ending: "wrong", think: 3000 });
    const end = answers.at(-1) as GuessEndResponse;
    expect(await verifyResult(SECRET, end.result)).toMatchObject({ score: 5, elapsedMs: 6 * 3000 });
  });
});

describe("forged and tampered tokens", () => {
  it.each([
    ["round", { round: 2, streak: 1 }],
    ["mode", { mode: "ranked" }],
    ["stat", { stat: "apps" }],
    ["anchor", { anchorId: "someone-else" }],
    ["anchor value", { anchorValue: 1 }],
    ["deadline", { deadline: 9_999_999_999_999 }],
  ])("refuses the %s edited with 400, and spends nothing", async (_name, change) => {
    const h = harness();
    const started = await begin(h);
    const result = await send(h, edited(started.token, change), "higher");
    expect(result.status).toBe(400);
    expect([...h.ledgers.values()][0]!.run).toMatchObject({ round: 1, status: "active" });
  });

  it("refuses a token signed with another key", async () => {
    const h = harness();
    const other = harness({ secret: "another-secret" });
    const theirs = await begin(other);
    const result = await send(h, theirs.token, "higher");
    expect(result).toMatchObject({ status: 400 });
  });

  it("refuses one run's signature on another run's token", async () => {
    const h = harness();
    const a = await begin(h);
    const b = await begin(h);
    const spliced = `${b.token.split(".")[0]}.${a.token.split(".")[1]}`;
    expect((await send(h, spliced, "higher")).status).toBe(400);
  });

  it("refuses a genuinely signed token that names no run the server signed", async () => {
    const h = harness();
    const started = await begin(h);
    const forged = await resign({ ...readToken(started.token), runId: "20260919-not-a-run.x" });
    expect((await send(h, forged, "higher")).status).toBe(400);
  });

  it("refuses a genuinely signed token the sequence doesn't bear out", async () => {
    const h = harness();
    const started = await begin(h);
    const forged = await resign({ ...readToken(started.token), anchorId: "nobody" });
    expect(await send(h, forged, "higher")).toEqual({
      status: 409,
      body: { error: "conflict", detail: "token_mismatch" },
    });
  });

  it("keeps one run's token out of another run: each spends only in its own ledger", async () => {
    const h = harness();
    const a = await begin(h);
    const b = await begin(h);
    await right(h, a);
    // b is untouched by a's answer, and still takes its own first token.
    const keyB = parseRunId(b.runId)!.body;
    expect(h.ledgers.get(keyB)!.run).toMatchObject({ round: 1, status: "active" });
    expect((await send(h, b.token, correctGuess(SAMPLE_DECK, b.runId, b.round))).status).toBe(200);
  });
});

describe("replay", () => {
  it("voids the run when a spent token comes back with the other answer", async () => {
    const h = harness();
    const started = await begin(h);
    const first = await right(h, started);
    const other = wrongGuess(correctGuess(SAMPLE_DECK, started.runId, started.round));
    expect(await send(h, started.token, other)).toEqual({
      status: 409,
      body: { error: "conflict", detail: "spent" },
    });
    // Void: even the genuine next token is refused now.
    if (!("token" in first)) throw new Error("expected a next token");
    expect(await send(h, first.token, "higher")).toMatchObject({ status: 409 });
  });

  it("answers a resend of the latest step with the identical response, and no extra time", async () => {
    const h = harness();
    const started = await begin(h);
    const pick = correctGuess(SAMPLE_DECK, started.runId, started.round);
    h.wait(2000);
    const first = await guessOk(h, started.token, pick);
    h.wait(4000); // the response was lost; the client retries a few seconds later
    const again = await guessOk(h, started.token, pick);
    expect(again).toEqual(first);
    if (!("token" in again)) throw new Error("expected a next token");
    expect(readToken(again.token).deadline).toBe(
      readToken((first as { token: string }).token).deadline,
    );
    // Recorded once, not twice.
    expect(h.events.filter((e) => e.type === "answer")).toHaveLength(1);
  });

  it("refuses an older token once its next token has been used", async () => {
    const h = harness();
    const started = await begin(h);
    const first = await right(h, started);
    if (!("token" in first) || !("next" in first)) throw new Error("expected a next token");
    h.wait(2000);
    await guessOk(h, first.token, correctGuess(SAMPLE_DECK, started.runId, first.next));
    const pick = correctGuess(SAMPLE_DECK, started.runId, started.round);
    expect(await send(h, started.token, pick)).toMatchObject({
      status: 409,
      body: { detail: "spent" },
    });
  });

  it("answers a resend of the ending step with the same end", async () => {
    const h = harness();
    const started = await begin(h);
    const pick = wrongGuess(correctGuess(SAMPLE_DECK, started.runId, started.round));
    h.wait(1000);
    const first = await guessOk(h, started.token, pick);
    h.wait(3000);
    expect(await guessOk(h, started.token, pick)).toEqual(first);
    expect(h.events.filter((e) => e.type === "end")).toHaveLength(1);
  });

  it("refuses every answer once a silent run has been closed, and keeps its banked streak", async () => {
    const h = harness();
    const started = await begin(h);
    const first = await right(h, started);
    if (!("token" in first) || !("next" in first)) throw new Error("expected a next token");
    const ledger = [...h.ledgers.values()][0]!;
    const { deadline } = ledger.run!;
    expect(ledger.onAlarm(deadline + DISCONNECT_MARGIN_MS)).toMatchObject({ action: "closed" });
    h.now = deadline + DISCONNECT_MARGIN_MS + 1000;
    const late = await send(h, first.token, correctGuess(SAMPLE_DECK, started.runId, first.next));
    expect(late).toEqual({ status: 409, body: { error: "conflict", detail: "over" } });
    expect(ledger.run).toMatchObject({ status: "ended", end: "disconnected", streak: 1 });
  });
});

describe("the server's clock", () => {
  it("gives question 1 its 15 seconds after the title, hold, intro and spin, plus the grace", async () => {
    const h = harness();
    const started = await begin(h);
    const token = readToken(started.token);
    const allowance = t.title + t.holdMin + t.holdExtra + t.introMin + t.beat + t.spin + t.land;
    expect(token.deadline - token.issuedAt).toBe(allowance + 15_000 + NETWORK_GRACE_MS);
  });

  it("gives later questions 10 seconds, with the wheel's time when the stat changes", async () => {
    const h = harness();
    const { answers } = await walk(h, { stopAt: 20, ending: "wrong" });
    const deals = answers.flatMap((a) => ("token" in a && "next" in a ? [a] : []));
    const spun = t.verdict + t.next + t.beat + t.spin + t.land;
    const held = t.verdict + t.next + t.hold;
    let changed = 0;
    for (const deal of deals) {
      const token = readToken(deal.token);
      const allowance = deal.next.stat.statChanged ? spun : held;
      if (deal.next.stat.statChanged) changed += 1;
      expect(token.deadline - token.issuedAt).toBe(allowance + 10_000 + NETWORK_GRACE_MS);
    }
    expect(changed).toBeGreaterThan(0);
    expect(changed).toBeLessThan(deals.length);
  });

  it("accepts an answer right on the deadline", async () => {
    const h = harness();
    const started = await begin(h);
    h.now = readToken(started.token).deadline;
    const pick = correctGuess(SAMPLE_DECK, started.runId, started.round);
    const res = await guessOk(h, started.token, pick);
    expect(res.reveal.correct).toBe(true);
    expect("next" in res).toBe(true);
  });

  it("ends an answer just after the deadline as a timeout, whatever it says, with the reveal", async () => {
    const h = harness();
    const started = await begin(h);
    h.now = readToken(started.token).deadline + 1;
    const pick = correctGuess(SAMPLE_DECK, started.runId, started.round);
    const res = (await guessOk(h, started.token, pick)) as GuessEndResponse;
    expect(res.end).toBe("timeout");
    expect(res.reveal).toMatchObject({ round: 1, correct: false });
    expect(typeof res.reveal.value).toBe("number");
    expect(res.challenge.score).toBe(0);
  });

  it("ends the run on the client's own timeout, before the deadline, with the reveal", async () => {
    const h = harness();
    const { answers } = await walk(h, { stopAt: 4, ending: "timeout" });
    const end = answers.at(-1) as GuessEndResponse;
    expect(end).toMatchObject({ end: "timeout", reveal: { round: 4, correct: false } });
    expect(end.challenge.score).toBe(3);
  });

  it("ignores the client's own timing", async () => {
    const h = harness();
    const started = await begin(h);
    h.now = readToken(started.token).deadline + 1;
    const pick = correctGuess(SAMPLE_DECK, started.runId, started.round);
    const result = await handleGuess(
      { token: started.token, guess: pick, clientElapsedMs: 10 },
      h.ctx,
    );
    expect(result).toMatchObject({ status: 200, body: { end: "timeout" } });
  });
});

describe("challenge links", () => {
  async function linkFrom(
    score: number,
    when = TODAY,
  ): Promise<{ link: Awaited<ReturnType<typeof challengeLink>>; body: string }> {
    const runId = await mintRunId(when, "00000000-0000-4000-8000-0000000000cc", SECRET, "endless");
    const body = parseRunId(runId)!.body;
    return { link: await challengeLink(SECRET, body, score), body };
  }

  it("start a fresh run with the target, not the challenged run's rounds", async () => {
    const h = harness();
    const { link, body } = await linkFrom(23);
    const started = await begin(h, link);
    expect(started.challenge).toEqual({ accepted: true, score: 23 });
    const run = parseRunId(started.runId)!;
    expect(run.body).not.toBe(body);
    expect(run.replay).toBe(false);
    // The challenged run's own rounds, dealt from its seed: not what the friend got.
    const theirs = buildRun({
      deck: SAMPLE_DECK,
      seed: await endlessSeed(SECRET, body),
      mode: "endless",
      now: run.date,
      maxRounds: 5,
    });
    const ours = buildRun({
      deck: SAMPLE_DECK,
      seed: await endlessSeed(SECRET, run.body),
      mode: "endless",
      now: run.date,
      maxRounds: 5,
    });
    expect(ours.map((r) => r.challenger.id)).not.toEqual(theirs.map((r) => r.challenger.id));
    expect(started.round.challenger.id).toBe(ours[0]!.challenger.id);
    expect(h.events[0]).toMatchObject({ type: "start", runKind: "challenge" });
  });

  it("start a fresh run with a note for a forged, edited or expired link", async () => {
    const { link } = await linkFrom(12);
    const old = await linkFrom(12, new Date("2026-09-01T12:00:00Z"));
    const cases = [
      [{ ...link, score: 13 }, "invalid"],
      [{ ...link, sig: "A".repeat(22) }, "invalid"],
      [{ ...link, runId: link.runId.replace("0cc", "0cd") }, "invalid"],
      [old.link, "expired"],
    ] as const;
    for (const [bad, reason] of cases) {
      const h = harness();
      const started = await begin(h, bad);
      expect(started.challenge).toEqual({ accepted: false, reason });
      expect(h.events[0]).toMatchObject({ runKind: "fresh" });
    }
  });

  it("refuse a Friendly-signed link", async () => {
    const friendly = await mintRunId(TODAY, "00000000-0000-4000-8000-0000000000cc", SECRET);
    const check = await checkChallenge(SECRET, { runId: friendly, score: 3, sig: "x" }, TODAY);
    expect(check).toEqual({ ok: false, reason: "invalid" });
  });

  it("come with every end, at the score reached, and check out", async () => {
    const h = harness();
    const { answers } = await walk(h, { stopAt: 5, ending: "wrong" });
    const end = answers.at(-1) as GuessEndResponse;
    expect(end.challenge.score).toBe(4);
    expect(await checkChallenge(SECRET, end.challenge, TODAY)).toEqual({ ok: true, score: 4 });
  });
});

describe("what gets recorded", () => {
  it("each answer once, with the server-measured time; the end with its round", async () => {
    const h = harness();
    await walk(h, { stopAt: 3, ending: "wrong", think: 4200 });
    const answers = h.events.filter((e) => e.type === "answer");
    expect(answers).toHaveLength(3);
    for (const a of answers) expect(a).toMatchObject({ mode: "endless", answerMs: 4200 });
    const end = h.events.filter((e) => e.type === "end");
    expect(end).toEqual([
      expect.objectContaining({
        mode: "endless",
        end: "wrong",
        score: 2,
        final: expect.anything(),
      }),
    ]);
  });

  it("a timeout, with the round's guess as timeout", async () => {
    const h = harness();
    await walk(h, { stopAt: 2, ending: "timeout" });
    const end = h.events.find((e) => e.type === "end");
    expect(end).toMatchObject({ end: "timeout", score: 1, final: { guess: "timeout" } });
  });
});

describe("validation", () => {
  it("takes { mode, turnstileToken, challenge? } to start, and nothing else", () => {
    expect(parseRunStart({ mode: "endless", turnstileToken: "t" }).ok).toBe(true);
    const link = { runId: "r", score: 3, sig: "s" };
    expect(parseRunStart({ mode: "endless", turnstileToken: "t", challenge: link }).ok).toBe(true);
    for (const body of [
      { mode: "friendly", turnstileToken: "t" },
      { mode: "endless" },
      { mode: "endless", turnstileToken: "" },
      { mode: "endless", turnstileToken: "t", extra: 1 },
      { mode: "endless", turnstileToken: "t", challenge: { ...link, score: 151 } },
      { mode: "endless", turnstileToken: "t", challenge: { ...link, score: 1.5 } },
      { mode: "endless", turnstileToken: "t", challenge: { runId: "r", score: 3 } },
      null,
      [],
    ]) {
      expect(parseRunStart(body).ok).toBe(false);
    }
  });

  it("takes { token, guess, clientElapsedMs? } to guess, and nothing else", () => {
    expect(parseGuess({ token: "a.b", guess: "higher" }).ok).toBe(true);
    expect(parseGuess({ token: "a.b", guess: "timeout", clientElapsedMs: 9900 }).ok).toBe(true);
    for (const body of [
      { token: "a.b", guess: "maybe" },
      { token: "", guess: "higher" },
      { token: "a.b", guess: "higher", round: 3 },
      { token: "a.b", guess: "higher", clientElapsedMs: "fast" },
      { guess: "higher" },
    ]) {
      expect(parseGuess(body).ok).toBe(false);
    }
  });

  it("limits answers per run, keyed on the verified run key", async () => {
    const keys: string[] = [];
    const h = harness({
      limits: {
        start: async () => ({ ok: true }),
        answer: async (run) => {
          keys.push(run);
          return { ok: false, retryAfter: 10 };
        },
      },
    });
    const started = await begin(h);
    const result = await send(h, started.token, "higher");
    expect(result).toMatchObject({ status: 429, limit: "answers" });
    expect(keys).toEqual([parseRunId(started.runId)!.body]);
  });
});

describe("the run's date", () => {
  it("is the run's own, whatever the clock says later", async () => {
    const h = harness();
    const started = await begin(h);
    expect(runDay(started.runId).toISOString()).toBe("2026-09-19T00:00:00.000Z");
  });
});
