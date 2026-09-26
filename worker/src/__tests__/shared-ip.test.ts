/**
 * The rate limits as players meet them: many honest runs behind one IP (a
 * classroom, an office, a carrier's CGNAT) against one fast script.
 *
 * Requests go through `createApp`, with the three bindings modelled as sliding
 * windows on a fake clock. That is stricter than the real limiter, whose
 * counters are per location and approximate, so passing here leaves margin.
 */

import { describe, expect, it } from "vitest";
import type { AnswerResponse, RoundPayload, StartResponse } from "@bt/core";
import { ROUND_PATH, createApp } from "../app.js";
import type { Env } from "../app.js";
import { RATE_LIMITS } from "../rate-limit.js";
import type { RateLimiter } from "../rate-limit.js";
import { SAMPLE_DECK, SECRET, TODAY, correctGuess, signedRunId, uuidFrom } from "./helpers.js";

const SHARED_IP = "198.51.100.23";

/**
 * A fast honest answer rate. The quickest round the game can show — verdict,
 * next deal and hold, with no wheel spin — takes 1.78 s from one tap to the
 * next pick (apps/web tokens.css); 0.6 s to read and tap on top of that makes
 * 2.4 s. A round with a spin takes 1.5 s longer.
 */
const HONEST_ANSWER_MS = 2400;

/** A Workers Rate Limiting binding as a sliding window over `now()` ms. */
function fakeLimiter(limit: number, period: number, now: () => number): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    async limit({ key }) {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((at) => at > t - period * 1000);
      const success = recent.length < limit;
      if (success) recent.push(t);
      hits.set(key, recent);
      return { success };
    },
  };
}

function world() {
  let t = 0;
  let minted = 0;
  const now = () => t;
  const app = createApp({
    deck: SAMPLE_DECK,
    images: {},
    clock: () => new Date(TODAY.getTime() + t),
    uuid: () => uuidFrom(++minted),
  });
  const env: Env = {
    ASSETS: { fetch: async () => new Response("") },
    RUN_SECRET: SECRET,
    RUN_ANSWERS: fakeLimiter(RATE_LIMITS.answers.limit, RATE_LIMITS.answers.period, now),
    RUN_STARTS: fakeLimiter(RATE_LIMITS.starts.limit, RATE_LIMITS.starts.period, now),
    ROUND_FLOOD: fakeLimiter(RATE_LIMITS.flood.limit, RATE_LIMITS.flood.period, now),
  };
  const send = (body: unknown, ip = SHARED_IP) =>
    app.fetch(
      new Request(`https://biggerthangame.com${ROUND_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": ip },
        body: JSON.stringify(body),
      }),
      env,
    );
  return {
    send,
    at: (ms: number) => void (t = ms),
    startRun: () => send({ mode: "friendly" }),
    answer: (runId: string, round: RoundPayload, ip = SHARED_IP) =>
      send(
        {
          mode: "friendly",
          runId,
          round: round.index,
          guess: correctGuess(SAMPLE_DECK, runId, round),
        },
        ip,
      ),
  };
}

describe("many players behind one IP", () => {
  it("never limits 30 runs at a time, each answering at a fast honest pace, for three minutes", async () => {
    const w = world();
    const PLAYERS = 30;
    const UNTIL = 180_000;
    const statuses = new Map<number, number>();
    const count = (status: number) => statuses.set(status, (statuses.get(status) ?? 0) + 1);

    interface Player {
      next: number;
      runId: string | null;
      round: RoundPayload | null;
    }
    // Players arrive over three seconds, as a class starting together would.
    const players: Player[] = Array.from({ length: PLAYERS }, (_, i) => ({
      next: i * 100,
      runId: null,
      round: null,
    }));

    for (;;) {
      const player = players.reduce((a, b) => (b.next < a.next ? b : a));
      if (player.next >= UNTIL) break;
      w.at(player.next);

      if (player.runId === null || player.round === null) {
        const res = await w.startRun();
        count(res.status);
        const body = (await res.json()) as StartResponse;
        player.runId = body.runId;
        player.round = body.round;
      } else {
        const res = await w.answer(player.runId, player.round);
        count(res.status);
        const body = (await res.json()) as AnswerResponse;
        // A finished run (the round cap) starts again straight away.
        player.round = "next" in body ? body.next : null;
        if (player.round === null) player.runId = null;
      }
      player.next += HONEST_ANSWER_MS;
    }

    expect(statuses.get(429) ?? 0).toBe(0);
    expect([...statuses.keys()]).toEqual([200]);
    // Enough traffic that the flood backstop was genuinely in play.
    expect(statuses.get(200)).toBeGreaterThan(2000);
  });

  it("still lets a second IP play while one IP is flooding", async () => {
    const w = world();
    for (let i = 0; i <= RATE_LIMITS.flood.limit; i++) await w.send({ mode: "nope" });
    expect((await w.startRun()).status).toBe(429);

    const res = await w.send({ mode: "friendly" }, "192.0.2.99");
    expect(res.status).toBe(200);
  });

  it("limits the backstop at the flood rate, with a minute's retry-after", async () => {
    const w = world();
    let first429: Response | undefined;
    for (let i = 0; i <= RATE_LIMITS.flood.limit && first429 === undefined; i++) {
      w.at(i * 10);
      const res = await w.send({ mode: "nope" });
      if (res.status === 429) first429 = res;
    }
    expect(first429?.headers.get("retry-after")).toBe(String(RATE_LIMITS.flood.period));
  });
});

describe("one fast client", () => {
  it("limits a run answering faster than 20 per 10 seconds, and not before", async () => {
    const w = world();
    const started = (await (await w.startRun()).json()) as StartResponse;
    let round: RoundPayload = started.round;
    const results: number[] = [];

    // One answer every 400 ms: 25 in ten seconds.
    for (let i = 0; i < 25; i++) {
      w.at(1000 + i * 400);
      const res = await w.answer(started.runId, round);
      results.push(res.status);
      if (res.status === 429) {
        expect(res.headers.get("retry-after")).toBe(String(RATE_LIMITS.answers.period));
        continue;
      }
      const body = (await res.json()) as AnswerResponse;
      if ("next" in body) round = body.next;
    }

    expect(results.slice(0, RATE_LIMITS.answers.limit).every((s) => s === 200)).toBe(true);
    expect(results[RATE_LIMITS.answers.limit]).toBe(429);
  });

  it("lets the same run carry on with the same round once the window has passed", async () => {
    const w = world();
    const started = (await (await w.startRun()).json()) as StartResponse;
    for (let i = 0; i < RATE_LIMITS.answers.limit; i++) {
      w.at(i * 100);
      await w.send({ mode: "friendly", runId: started.runId, round: 1, guess: "higher" });
    }
    const limited = await w.answer(started.runId, started.round);
    expect(limited.status).toBe(429);

    w.at(RATE_LIMITS.answers.period * 1000 + 2000);
    const res = await w.answer(started.runId, started.round);
    expect(res.status).toBe(200);
    expect(((await res.json()) as AnswerResponse).reveal.correct).toBe(true);
  });

  it("limits a script starting a run a second", async () => {
    const w = world();
    const statuses: number[] = [];
    for (let i = 0; i < 70; i++) {
      w.at(i * 500);
      statuses.push((await w.startRun()).status);
    }
    expect(statuses.slice(0, RATE_LIMITS.starts.limit).every((s) => s === 200)).toBe(true);
    expect(statuses[RATE_LIMITS.starts.limit]).toBe(429);
  });

  it("refuses a forged run id with 400 rather than answering it", async () => {
    const w = world();
    const forged = await signedRunId("2026-09-19", uuidFrom(1), "guessed-secret");
    const res = await w.send({ mode: "friendly", runId: forged, round: 1, guess: "higher" });
    expect(res.status).toBe(400);
  });

  it("refuses a tampered run id with 400", async () => {
    const w = world();
    const { runId } = (await (await w.startRun()).json()) as StartResponse;
    const tampered = runId.replace(/-[0-9a-f](?=[0-9a-f]{11}\.)/, (m) =>
      m === "-0" ? "-1" : "-0",
    );
    expect(tampered).not.toBe(runId);
    const res = await w.send({ mode: "friendly", runId: tampered, round: 1, guess: "higher" });
    expect(res.status).toBe(400);
  });
});
