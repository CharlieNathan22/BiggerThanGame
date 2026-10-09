/**
 * Endless through the HTTP layer and the neighbouring endpoints: routing, a failing Durable Object, the leave beacon and corrections
 * for Endless runs, a silent run's end, and the Durable Object's config.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { buildRun } from "@bt/core";
import type { RunStartResponse } from "@bt/core";
import { GUESS_PATH, RUN_START_PATH, createApp } from "../app.js";
import type { Env, RunNamespace } from "../app.js";
import { handleFeedback } from "../feedback.js";
import type { PlainTextMail } from "../mail.js";
import { handleLeave } from "../leave.js";
import { disconnectedEnd } from "../run.js";
import { RunLedger, memoryStore } from "../run-ledger.js";
import { parseRunId } from "../run-id.js";
import { endlessSeed } from "../seed.js";
import { begin, harness, noDaily, noStream } from "./endless-helpers.js";
import { SAMPLE_DECK, SECRET, TODAY, correctGuess, uuidFrom } from "./helpers.js";

function fakeRuns(): RunNamespace {
  const ledgers = new Map<string, RunLedger>();
  const ledger = (key: string): RunLedger => {
    let l = ledgers.get(key);
    if (l === undefined) ledgers.set(key, (l = new RunLedger(memoryStore())));
    return l;
  };
  return {
    idFromName: (name) => name,
    get: (id: never) => ({
      begin: async (first) => ledger(id as string).begin(first),
      advance: async (step) => ledger(id as string).advance(step),
      claimForSubmit: async (claim) => ledger(id as string).claimForSubmit(claim),
      markSubmitted: async () => ledger(id as string).markSubmitted(),
      ...noDaily(),
      ...noStream(),
    }),
  };
}

function env(overrides: Partial<Env> = {}): Env {
  const allow = { limit: vi.fn(async () => ({ success: true })) };
  return {
    ASSETS: { fetch: vi.fn(async () => new Response("site")) },
    RUN_SECRET: SECRET,
    TURNSTILE_SECRET: "turnstile-secret",
    RUN_ANSWERS: allow,
    RUN_STARTS: allow,
    ROUND_FLOOD: allow,
    FEEDBACK_SENDS: allow,
    FEEDBACK_EMAIL: { send: vi.fn(async () => ({})) },
    RUNS: fakeRuns(),
    ...overrides,
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

function post(path: string, body: unknown, method = "POST"): Request {
  return new Request(`https://biggerthangame.com${path}`, {
    method,
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7" },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
}

const START = { mode: "endless", turnstileToken: "t" };

describe("the Endless endpoints", () => {
  it("start a run and take its guess", async () => {
    const a = app();
    const e = env();
    const res = await a.fetch(post(RUN_START_PATH, START), e);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const started = (await res.json()) as RunStartResponse;
    const guess = correctGuess(SAMPLE_DECK, started.runId, started.round);
    const answered = await a.fetch(post(GUESS_PATH, { token: started.token, guess }), e);
    expect(answered.status).toBe(200);
  });

  it("refuse anything but POST", async () => {
    for (const path of [RUN_START_PATH, GUESS_PATH]) {
      const res = await app().fetch(post(path, null, "GET"), env());
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
    }
  });

  it("take Endless starts in production: there is no launch switch any more", async () => {
    const res = await app().fetch(post(RUN_START_PATH, START), env());
    expect(res.status).toBe(200);
  });

  it("fail closed without the Durable Object, the secret or Turnstile's secret", async () => {
    for (const missing of ["RUNS", "RUN_SECRET", "TURNSTILE_SECRET"] as const) {
      const e = env();
      delete (e as Partial<Env> & Record<string, unknown>)[missing];
      const res = await app().fetch(post(RUN_START_PATH, START), e);
      expect(res.status).toBe(500);
    }
  });

  it("answer a calm 503 when the run's Durable Object fails", async () => {
    const broken: RunNamespace = {
      idFromName: (name) => name,
      get: () => ({
        begin: async () => {
          throw new Error("storage unavailable");
        },
        advance: async () => {
          throw new Error("storage unavailable");
        },
        claimForSubmit: async () => {
          throw new Error("storage unavailable");
        },
        markSubmitted: async () => {
          throw new Error("storage unavailable");
        },
        ...noDaily(),
        ...noStream(),
      }),
    };
    const res = await app().fetch(post(RUN_START_PATH, START), env({ RUNS: broken }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable" });
  });

  it("answer a spent token with 409", async () => {
    const a = app();
    const e = env();
    const started = (await (
      await a.fetch(post(RUN_START_PATH, START), e)
    ).json()) as RunStartResponse;
    const right = correctGuess(SAMPLE_DECK, started.runId, started.round);
    const wrong = right === "higher" ? "lower" : "higher";
    await a.fetch(post(GUESS_PATH, { token: started.token, guess: right }), e);
    const res = await a.fetch(post(GUESS_PATH, { token: started.token, guess: wrong }), e);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "conflict", detail: "spent" });
  });

  it("refuse an oversized body", async () => {
    const res = await app().fetch(
      post(RUN_START_PATH, { ...START, turnstileToken: "x".repeat(5000) }),
      env(),
    );
    expect(res.status).toBe(400);
  });
});

describe("the leave beacon on an Endless run", () => {
  it("is taken, and logs the round as the player saw it", async () => {
    const h = harness();
    const started = await begin(h);
    const events: unknown[] = [];
    const result = await handleLeave(
      { mode: "endless", runId: started.runId, round: 1, phase: "question", trigger: "hidden" },
      { deck: SAMPLE_DECK, secret: SECRET, clock: () => TODAY, record: (e) => events.push(e) },
    );
    expect(result).toEqual({ status: 204 });
    expect(events[0]).toMatchObject({ type: "leave", mode: "endless", round: 1 });
  });

  it("refuses an Endless run id sent as Friendly, and a round past Endless's cap", async () => {
    const h = harness();
    const { runId } = await begin(h);
    const ctx = { deck: SAMPLE_DECK, secret: SECRET, clock: () => TODAY };
    const base = { runId, round: 1, phase: "question", trigger: "hidden" };
    expect((await handleLeave({ ...base, mode: "friendly" }, ctx)).status).toBe(400);
    expect((await handleLeave({ ...base, mode: "endless", round: 151 }, ctx)).status).toBe(400);
  });
});

describe("a correction about an Endless run", () => {
  it("rebuilds the round from Endless's seed and sends it", async () => {
    const h = harness();
    const started = await begin(h);
    const sent: PlainTextMail[] = [];
    const result = await handleFeedback(
      { kind: "correction", mode: "endless", runId: started.runId, round: 1, turnstileToken: "t" },
      {
        deck: SAMPLE_DECK,
        secret: SECRET,
        clock: () => TODAY,
        to: "owner@example.com",
        uuid: () => uuidFrom(99),
        verifyTurnstile: async () => "pass",
        send: async (mail) => void sent.push(mail),
      },
    );
    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(sent[0]!.text).toContain(`Endless run ${parseRunId(started.runId)!.body}`);
    const anchor = SAMPLE_DECK.find((p) => p.id === started.round.anchor.id)!;
    expect(sent[0]!.text).toContain(anchor.name);
  });

  it("is refused without the mode: an Endless id doesn't verify as Friendly", async () => {
    const h = harness();
    const started = await begin(h);
    const result = await handleFeedback(
      { kind: "correction", runId: started.runId, round: 1, turnstileToken: "t" },
      {
        deck: SAMPLE_DECK,
        secret: SECRET,
        clock: () => TODAY,
        to: "owner@example.com",
        uuid: () => uuidFrom(99),
        verifyTurnstile: async () => "pass",
        send: async () => {},
      },
    );
    expect(result).toMatchObject({ status: 400, body: { detail: "invalid_run" } });
  });
});

describe("a silent run's end", () => {
  it("keeps the verified streak and logs only the figure the player was shown", async () => {
    const h = harness();
    const started = await begin(h);
    const ledger = [...h.ledgers.values()][0]!;
    const closed = ledger.onAlarm(ledger.run!.deadline + 60_000);
    if (closed.action !== "closed") throw new Error("expected the run to close");
    const event = await disconnectedEnd(closed.run, SAMPLE_DECK, SECRET);
    expect(event).toMatchObject({ type: "end", mode: "endless", end: "disconnected", score: 0 });
    const run = parseRunId(started.runId)!;
    const [round] = buildRun({
      deck: SAMPLE_DECK,
      seed: await endlessSeed(SECRET, run.body),
      mode: "endless",
      now: run.date,
      maxRounds: 1,
    });
    expect(event.shown?.players[0]).toMatchObject({
      id: round!.anchor.id,
      value: expect.any(Number),
    });
    expect(event.shown?.players[1]).toEqual({
      role: "challenger",
      id: round!.challenger.id,
      name: round!.challenger.name,
    });
  });
});

describe("wrangler.toml", () => {
  const toml = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "wrangler.toml"),
    "utf8",
  );

  it("binds RUNS to the RunDO class, SQLite-backed so it runs on the free plan", () => {
    expect(toml).toMatch(
      /\[\[durable_objects\.bindings\]\]\s*name = "RUNS"\s*class_name = "RunDO"/,
    );
    expect(toml).toMatch(/\[\[migrations\]\]\s*tag = "v1"\s*new_sqlite_classes = \["RunDO"\]/);
  });

  it("never sets ENDLESS_PREVIEW for production", () => {
    expect(toml).not.toContain("ENDLESS_PREVIEW");
  });
});
