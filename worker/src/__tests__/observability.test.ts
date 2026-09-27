/**
 * Observability (ARCHITECTURE.md §19): gameplay events to Analytics Engine,
 * structured lines to Workers Logs.
 *
 * Requests go through `createApp` with a mock dataset and a capturing logger,
 * so the exact data points and log lines are what the Worker would write. The
 * expected values are worked out here from the seed and the deck — the test
 * holds the secret — not read back from the Worker.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { STATS, buildRun, percentiles, rankDistance, valueOf } from "@bt/core";
import type { AnswerResponse, EndResponse, Guess, Round, StartResponse } from "@bt/core";
import { scanForLeakedValues } from "@bt/deck";
import {
  DATASET,
  MAX_INDEX_BYTES,
  RELAXATION_STEP,
  bandLabel,
  countryOf,
  toDataPoint,
} from "../analytics.js";
import type { DataPoint } from "../analytics.js";
import { FEEDBACK_PATH, ROUND_PATH, createApp } from "../app.js";
import type { Env } from "../app.js";
import type { LogLine } from "../log.js";
import { parseRunId } from "../run-id.js";
import { friendlySeed } from "../seed.js";
import {
  SAMPLE_DECK,
  SECRET,
  TODAY,
  correctGuess,
  fakeImages,
  runDay,
  uuidFrom,
  wrongGuess,
} from "./helpers.js";

const VERSION = "legends-24-testdeck";
const IP = "203.0.113.7";
const USER_AGENT = "Mozilla/5.0 (Observability Test) Gecko/20100101";

interface Harness {
  readonly app: ReturnType<typeof createApp>;
  readonly env: Env;
  readonly points: DataPoint[];
  readonly lines: LogLine[];
}

function harness(
  opts: {
    dataset?: Env["GAME_EVENTS"] | null;
    log?: (line: LogLine) => void;
    images?: boolean;
  } = {},
): Harness {
  const points: DataPoint[] = [];
  const lines: LogLine[] = [];
  let n = 0;
  const app = createApp({
    deck: SAMPLE_DECK,
    images: opts.images === true ? fakeImages(SAMPLE_DECK) : {},
    deckVersion: VERSION,
    clock: () => TODAY,
    uuid: () => uuidFrom(++n),
    log: opts.log ?? ((line) => lines.push(line)),
  });
  const allow = { limit: vi.fn(async () => ({ success: true })) };
  const dataset =
    opts.dataset === null
      ? undefined
      : (opts.dataset ?? { writeDataPoint: (p: DataPoint) => void points.push(p) });
  const env: Env = {
    ASSETS: { fetch: vi.fn(async () => new Response("site")) },
    RUN_SECRET: SECRET,
    RUN_ANSWERS: allow,
    RUN_STARTS: allow,
    ROUND_FLOOD: allow,
    FEEDBACK_SENDS: allow,
    FEEDBACK_EMAIL: { send: vi.fn(async () => ({})) },
    ...(dataset !== undefined ? { GAME_EVENTS: dataset } : {}),
  };
  return { app, env, points, lines };
}

/** `country: null` sends no `request.cf`, as outside Cloudflare. */
function post(path: string, body: unknown, country: string | null = "GB"): Request {
  const request = new Request(`https://biggerthangame.com${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": IP,
      "user-agent": USER_AGENT,
      cookie: "session=not-ours",
    },
    body: JSON.stringify(body),
  });
  // Cloudflare puts `cf` on the request; Node's Request has none.
  if (country !== null) Object.defineProperty(request, "cf", { value: { country } });
  return request;
}

async function send<T>(h: Harness, body: unknown, country?: string | null): Promise<T> {
  const res = await h.app.fetch(post(ROUND_PATH, body, country), h.env);
  expect(res.status).toBe(200);
  return (await res.json()) as T;
}

function bodyOf(runId: string): string {
  return runId.slice(0, runId.indexOf("."));
}

/** The run's rounds as the server deals them, from the test's own copy of the secret. */
async function dealt(runId: string): Promise<Round[]> {
  const run = parseRunId(runId)!;
  const seed = await friendlySeed(SECRET, run.origin);
  return buildRun({ deck: SAMPLE_DECK, seed, mode: "friendly", now: run.date });
}

function distance(round: Round, now: Date): number {
  const table = percentiles(SAMPLE_DECK, round.stat, now);
  return rankDistance(
    table,
    valueOf(round.anchor, round.stat, now)!,
    valueOf(round.challenger, round.stat, now)!,
  );
}

/** Plays a run through the app, right every time unless `missAt` says otherwise. */
async function play(
  h: Harness,
  opts: { missAt?: number; start?: unknown } = {},
): Promise<{ runId: string; last: AnswerResponse; answered: number }> {
  const started = await send<StartResponse>(h, opts.start ?? { mode: "friendly" });
  let round = started.round;
  for (;;) {
    const right = correctGuess(SAMPLE_DECK, started.runId, round);
    const guess: Guess = round.index === opts.missAt ? wrongGuess(right) : right;
    const res = await send<AnswerResponse>(h, {
      mode: "friendly",
      runId: started.runId,
      round: round.index,
      guess,
    });
    if (!("next" in res)) return { runId: started.runId, last: res, answered: round.index };
    round = res.next;
  }
}

describe("the data point layout", () => {
  const ctx = { country: "GB", deckVersion: VERSION };
  const facts = { mode: "friendly", run: "20260919-run", runKind: "fresh" } as const;

  it("writes a start", () => {
    expect(toDataPoint({ type: "start", ...facts }, ctx)).toEqual({
      indexes: ["20260919-run"],
      blobs: ["start", "friendly", "fresh", VERSION, "GB"],
      doubles: [],
    });
  });

  it("writes an answer", () => {
    const point = toDataPoint(
      {
        type: "answer",
        ...facts,
        round: 20,
        stat: "ct",
        correct: false,
        streak: 19,
        relaxation: "band",
        rankDistance: 0.375,
      },
      ctx,
    );
    expect(point).toEqual({
      indexes: ["20260919-run"],
      blobs: ["answer", "friendly", "fresh", VERSION, "GB", "ct", STATS.ct.tier, "0.15-0.50", "1"],
      doubles: [20, 0, 19, 2, 0.375],
    });
  });

  it("writes an end", () => {
    expect(toDataPoint({ type: "end", ...facts, end: "won", score: 20 }, ctx)).toEqual({
      indexes: ["20260919-run"],
      blobs: ["end", "friendly", "fresh", VERSION, "GB", "won"],
      doubles: [20],
    });
  });

  it.each([
    [1, "0.45+"],
    [8, "0.45+"],
    [9, "0.40+"],
    [13, "0.40+"],
    [14, "0.30-0.80"],
    [17, "0.30-0.80"],
    [18, "0.25-0.70"],
    [19, "0.25-0.70"],
    [20, "0.15-0.50"],
  ])("labels Friendly round %i's band %s", (round, label) => {
    expect(bandLabel(round, "friendly")).toBe(label);
  });

  it("numbers the relaxation ladder 0–3, in the engine's order", () => {
    expect(RELAXATION_STEP).toEqual({ none: 0, iconic: 1, band: 2, seen: 3 });
  });

  it("reads the country from request.cf, and says XX when it can't", () => {
    expect(countryOf(post(ROUND_PATH, {}, "FR"))).toBe("FR");
    expect(countryOf(post(ROUND_PATH, {}, null))).toBe("XX");
    expect(countryOf(post(ROUND_PATH, {}, "<script>"))).toBe("XX");
  });

  it("names the dataset and binding exactly as wrangler.toml does", () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const toml = readFileSync(resolve(root, "wrangler.toml"), "utf8");
    const block = toml.split("[[analytics_engine_datasets]]")[1]?.split("[[")[0] ?? "";
    expect(block).toContain('binding = "GAME_EVENTS"');
    expect(block).toContain(`dataset = "${DATASET}"`);
  });
});

describe("events from real requests", () => {
  it("writes a start for a fresh run, and logs run_start", async () => {
    const h = harness();
    const started = await send<StartResponse>(h, { mode: "friendly" });
    expect(h.points).toEqual([
      {
        indexes: [bodyOf(started.runId)],
        blobs: ["start", "friendly", "fresh", VERSION, "GB"],
        doubles: [],
      },
    ]);
    expect(h.lines).toEqual([
      {
        level: "info",
        event: "run_start",
        route: ROUND_PATH,
        mode: "friendly",
        run: bodyOf(started.runId),
        runKind: "fresh",
        deckVersion: VERSION,
        country: "GB",
      },
    ]);
  });

  it("writes each judged answer exactly, with the pair's rank distance", async () => {
    const h = harness();
    const { runId, answered } = await play(h, { missAt: 5 });
    const rounds = await dealt(runId);
    const now = runDay(runId);
    const answers = h.points.filter((p) => p.blobs[0] === "answer");
    expect(answered).toBe(5);
    expect(answers).toEqual(
      rounds.slice(0, 5).map((round) => {
        const correct = round.index !== 5;
        return {
          indexes: [bodyOf(runId)],
          blobs: [
            "answer",
            "friendly",
            "fresh",
            VERSION,
            "GB",
            round.stat,
            STATS[round.stat].tier,
            "0.45+",
            "0",
          ],
          doubles: [
            round.index,
            correct ? 1 : 0,
            correct ? round.index : round.index - 1,
            RELAXATION_STEP[round.relaxation],
            distance(round, now),
          ],
        };
      }),
    );
    for (const point of answers) {
      expect(point.doubles[4]).toBeGreaterThanOrEqual(0);
      expect(point.doubles[4]).toBeLessThanOrEqual(1);
    }
  });

  it("ends a missed run with wrong and the score before the miss, and logs run_end", async () => {
    const h = harness();
    const { runId } = await play(h, { missAt: 3 });
    expect(h.points.map((p) => p.blobs[0])).toEqual(["start", "answer", "answer", "answer", "end"]);
    expect(h.points.at(-1)).toEqual({
      indexes: [bodyOf(runId)],
      blobs: ["end", "friendly", "fresh", VERSION, "GB", "wrong"],
      doubles: [2],
    });
    expect(h.lines.at(-1)).toEqual({
      level: "info",
      event: "run_end",
      route: ROUND_PATH,
      mode: "friendly",
      run: bodyOf(runId),
      runKind: "fresh",
      deckVersion: VERSION,
      country: "GB",
      reason: "wrong",
      score: 2,
    });
  });

  it("ends a run played to the end with its reason and score, and marks the final question", async () => {
    const h = harness();
    const { runId, last, answered } = await play(h);
    const end = (last as EndResponse).end;
    expect(end === "won" ? answered === 20 : end === "deck-exhausted").toBe(true);
    expect(h.points.at(-1)).toEqual({
      indexes: [bodyOf(runId)],
      blobs: ["end", "friendly", "fresh", VERSION, "GB", end],
      doubles: [answered],
    });
    const finals = h.points.filter((p) => p.blobs[0] === "answer" && p.blobs[8] === "1");
    expect(finals.map((p) => p.doubles[0])).toEqual(end === "won" ? [20] : []);
  });

  it("logs only a run's start and end, never an answer", async () => {
    const h = harness();
    await play(h, { missAt: 4 });
    expect(h.lines.map((l) => l.event)).toEqual(["run_start", "run_end"]);
  });

  it("writes a challenge replay as a replay, keyed on its own body", async () => {
    const h = harness();
    const first = await play(h, { missAt: 4 });
    const link = (first.last as EndResponse).challenge;
    h.points.length = 0;
    h.lines.length = 0;

    const replay = await play(h, {
      missAt: 2,
      start: { mode: "friendly", challenge: link.runId, score: link.score, sig: link.sig },
    });
    const key = bodyOf(replay.runId);
    expect(key).toContain("~");
    expect(h.points.every((p) => p.indexes[0] === key && p.blobs[2] === "replay")).toBe(true);
    expect(h.points.map((p) => p.blobs[0])).toEqual(["start", "answer", "answer", "end"]);
    expect(h.lines.map((l) => [l.event, l.runKind, l.run])).toEqual([
      ["run_start", "replay", key],
      ["run_end", "replay", key],
    ]);
  });

  it("writes XX when the request has no country", async () => {
    const h = harness();
    await send<StartResponse>(h, { mode: "friendly" }, null);
    expect(h.points[0]?.blobs[4]).toBe("XX");
    expect(h.lines[0]?.country).toBe("XX");
  });

  it("writes nothing for a refused request", async () => {
    const h = harness();
    await h.app.fetch(post(ROUND_PATH, { mode: "friendly", runId: "nope" }), h.env);
    expect(h.points).toEqual([]);
  });
});

describe("the index", () => {
  it("fits the longest run key there is — a replay's — in 96 bytes", async () => {
    const h = harness();
    const first = await play(h, { missAt: 1 });
    const link = (first.last as EndResponse).challenge;
    const replay = await send<StartResponse>(h, {
      mode: "friendly",
      challenge: link.runId,
      score: link.score,
      sig: link.sig,
    });
    // `YYYYMMDD-<uuid>~<uuid>`: 8 + 1 + 36 + 1 + 36. The run id grammar allows
    // nothing longer (run-id.ts), and the signature is never part of the key.
    const key = parseRunId(replay.runId)!.body;
    expect(new TextEncoder().encode(key).length).toBe(82);
    expect(82).toBeLessThanOrEqual(MAX_INDEX_BYTES);
    for (const point of h.points) {
      expect(new TextEncoder().encode(point.indexes[0]).length).toBeLessThanOrEqual(
        MAX_INDEX_BYTES,
      );
    }
  });

  it("is never the signed run id", async () => {
    const h = harness();
    const { runId } = await play(h, { missAt: 2 });
    for (const point of h.points) expect(point.indexes[0]).toBe(bodyOf(runId));
    expect(JSON.stringify([h.points, h.lines])).not.toContain(runId);
  });
});

describe("privacy", () => {
  it("writes and logs no hidden value, IP, user agent, cookie, secret, seed or signed id", async () => {
    const h = harness({ images: true });
    const runs: { runId: string; last: AnswerResponse }[] = [];
    for (const missAt of [1, 3, 6, 9, undefined]) {
      runs.push(await play(h, missAt === undefined ? {} : { missAt }));
    }
    const everything = JSON.stringify([h.points, h.lines]);

    for (const needle of [IP, USER_AGENT, "session=not-ours", SECRET]) {
      expect(everything).not.toContain(needle);
    }
    for (const { runId, last } of runs) {
      const run = parseRunId(runId)!;
      expect(everything).not.toContain(runId);
      expect(everything).not.toContain(runId.slice(runId.indexOf(".") + 1));
      expect(everything).not.toContain(await friendlySeed(SECRET, run.origin));
      expect(everything).not.toContain((last as EndResponse).challenge.sig);
    }
    for (const player of SAMPLE_DECK) {
      expect(everything).not.toContain(`"${player.id}"`);
      expect(everything).not.toContain(player.name);
    }

    // Values: every number is one of the declared doubles, each in its range,
    // and the deck's leak scanner finds no stat value anywhere in the text.
    for (const point of h.points) {
      const [event] = point.blobs;
      expect(point.doubles.length).toBe(event === "answer" ? 5 : event === "end" ? 1 : 0);
      if (event === "answer") {
        const [round, correct, streak, step, gap] = point.doubles as [number, ...number[]];
        expect(round).toBeGreaterThanOrEqual(1);
        expect(round).toBeLessThanOrEqual(20);
        expect([0, 1]).toContain(correct);
        expect(streak).toBe(correct === 1 ? round : round - 1);
        expect([0, 1, 2, 3]).toContain(step);
        expect(gap).toBeGreaterThanOrEqual(0);
        expect(gap).toBeLessThanOrEqual(1);
      }
    }
    const scanned = JSON.stringify(h.points.map((p) => [p.blobs.slice(0, 3), p.blobs.slice(4)]));
    expect(scanForLeakedValues(scanned, SAMPLE_DECK, TODAY, "data points")).toEqual([]);
    // A line's `score` is the player's own, already on their screen; like the
    // response-shape test, check its range rather than scan it.
    for (const line of h.lines.filter((l) => l.event === "run_end")) {
      expect(line.score).toBeGreaterThanOrEqual(0);
      expect(line.score).toBeLessThanOrEqual(20);
    }
    const lineText = JSON.stringify(
      h.lines.map((line) => ({
        ...line,
        run: undefined,
        deckVersion: undefined,
        score: undefined,
      })),
    );
    expect(scanForLeakedValues(lineText, SAMPLE_DECK, TODAY, "log lines")).toEqual([]);
  });
});

describe("a failing or missing binding", () => {
  async function responses(h: Harness): Promise<string[]> {
    const out: string[] = [];
    const started = await h.app.fetch(post(ROUND_PATH, { mode: "friendly" }), h.env);
    const body = (await started.json()) as StartResponse;
    out.push(JSON.stringify(body));
    let round = body.round;
    for (;;) {
      const res = await h.app.fetch(
        post(ROUND_PATH, {
          mode: "friendly",
          runId: body.runId,
          round: round.index,
          guess: correctGuess(SAMPLE_DECK, body.runId, round),
        }),
        h.env,
      );
      expect(res.status).toBe(200);
      const answer = (await res.json()) as AnswerResponse;
      out.push(JSON.stringify(answer));
      if (!("next" in answer)) return out;
      round = answer.next;
    }
  }

  it("answers exactly the same with no binding at all", async () => {
    const baseline = await responses(harness());
    const bare = harness({ dataset: null });
    expect(await responses(bare)).toEqual(baseline);
    expect(bare.lines.map((l) => l.event)).toEqual(["run_start", "run_end"]);
  });

  it("answers exactly the same when every write throws, and logs that once", async () => {
    const baseline = await responses(harness());
    const writeDataPoint = vi.fn(() => {
      throw new Error("Analytics Engine is down");
    });
    const broken = harness({ dataset: { writeDataPoint } });
    expect(await responses(broken)).toEqual(baseline);
    await responses(broken); // A second run: still logged only once.
    expect(writeDataPoint.mock.calls.length).toBeGreaterThan(4);
    const failures = broken.lines.filter((l) => l.event === "analytics_failed");
    expect(failures).toEqual([
      {
        level: "error",
        event: "analytics_failed",
        route: ROUND_PATH,
        reason: "Error",
        message: "Analytics Engine is down",
      },
    ]);
  });

  it("answers exactly the same when the logger throws", async () => {
    const baseline = await responses(harness());
    const loud = harness({
      log: () => {
        throw new Error("console is gone");
      },
    });
    expect(await responses(loud)).toEqual(baseline);
    expect(loud.points.length).toBeGreaterThan(2);
  });
});

describe("warn and error lines", () => {
  it("warns on a refused round request, with the reason", async () => {
    const h = harness();
    const res = await h.app.fetch(post(ROUND_PATH, { mode: "endless" }), h.env);
    expect(res.status).toBe(400);
    expect(h.lines).toEqual([
      {
        level: "warn",
        event: "bad_request",
        route: ROUND_PATH,
        status: 400,
        reason: 'mode must be "friendly"',
      },
    ]);
  });

  it("warns on a 429, naming the limit", async () => {
    const h = harness();
    const deny = { limit: vi.fn(async () => ({ success: false })) };
    await h.app.fetch(post(ROUND_PATH, { mode: "friendly" }), { ...h.env, RUN_STARTS: deny });
    await h.app.fetch(post(ROUND_PATH, { mode: "friendly" }), { ...h.env, ROUND_FLOOD: deny });
    await h.app.fetch(post(FEEDBACK_PATH, {}), { ...h.env, FEEDBACK_SENDS: deny });
    expect(h.lines.map((l) => [l.level, l.event, l.route, l.status, l.reason])).toEqual([
      ["warn", "rate_limited", ROUND_PATH, 429, "starts"],
      ["warn", "rate_limited", ROUND_PATH, 429, "flood"],
      ["warn", "rate_limited", FEEDBACK_PATH, 429, "feedback"],
    ]);
  });

  it("warns on a wrong method, and says nothing about an unknown path", async () => {
    const h = harness();
    await h.app.fetch(new Request(`https://biggerthangame.com${ROUND_PATH}`), h.env);
    await h.app.fetch(new Request("https://biggerthangame.com/api/nope"), h.env);
    expect(h.lines).toEqual([
      { level: "warn", event: "method_not_allowed", route: ROUND_PATH, status: 405 },
    ]);
  });

  it("logs a deck that can't deal as an error", async () => {
    const lines: LogLine[] = [];
    const app = createApp({
      deck: [],
      images: {},
      clock: () => TODAY,
      log: (line) => lines.push(line),
    });
    const { env } = harness();
    const res = await app.fetch(post(ROUND_PATH, { mode: "friendly" }), env);
    expect(res.status).toBe(503);
    expect(lines).toEqual([
      {
        level: "error",
        event: "unavailable",
        route: ROUND_PATH,
        status: 503,
        reason: "the deck cannot deal a round",
      },
    ]);
  });

  it("logs a thrown handler error as internal, with name and message only", async () => {
    const lines: LogLine[] = [];
    const app = createApp({
      deck: SAMPLE_DECK,
      images: {},
      clock: () => TODAY,
      uuid: () => {
        throw new TypeError("no randomness");
      },
      log: (line) => lines.push(line),
    });
    const { env } = harness();
    const res = await app.fetch(post(ROUND_PATH, { mode: "friendly" }), env);
    expect(res.status).toBe(500);
    expect(lines).toEqual([
      {
        level: "error",
        event: "internal",
        route: ROUND_PATH,
        status: 500,
        reason: "TypeError",
        message: "no randomness",
      },
    ]);
  });

  it("logs a missing secret by name only", async () => {
    const h = harness();
    await h.app.fetch(post(ROUND_PATH, { mode: "friendly" }), { ...h.env, RUN_SECRET: "" });
    expect(h.lines).toEqual([
      {
        level: "error",
        event: "internal",
        route: ROUND_PATH,
        status: 500,
        reason: "not_configured",
        message: "RUN_SECRET missing",
      },
    ]);
  });

  it.each([
    [
      "a failed send",
      { success: true },
      "error",
      "send_failed",
      502,
      { reason: "E_SENDER_NOT_VERIFIED" },
    ],
    [
      "a Turnstile refusal",
      { success: false, "error-codes": ["invalid-input-response"] },
      "warn",
      "verification_failed",
      403,
      {},
    ],
    ["Siteverify down", "not json", "error", "unavailable", 502, { reason: "turnstile" }],
  ])(
    "logs %s on feedback, and none of the user's text",
    async (_name, verdict, level, event, status, extra) => {
      const lines: LogLine[] = [];
      const app = createApp({
        deck: SAMPLE_DECK,
        images: {},
        clock: () => TODAY,
        uuid: () => uuidFrom(1),
        fetch: async () => new Response(JSON.stringify(verdict)),
        emailMessage: (from, to) => ({ from, to }),
        log: (line) => lines.push(line),
      });
      const { env } = harness();
      const res = await app.fetch(
        post(FEEDBACK_PATH, {
          kind: "suggest",
          name: "Gianfranco Zola",
          note: "Please add him",
          turnstileToken: "token-from-the-widget",
        }),
        {
          ...env,
          TURNSTILE_SECRET: "1x0000000000000000000000000000000AA",
          FEEDBACK_TO: "owner@example.com",
          FEEDBACK_EMAIL: {
            send: async () => {
              throw Object.assign(new Error("Gianfranco Zola: Please add him"), {
                code: "E_SENDER_NOT_VERIFIED",
              });
            },
          },
        },
      );
      expect(res.status).toBe(status);
      expect(lines).toEqual([{ level, event, route: FEEDBACK_PATH, status, ...extra }]);
      const logged = JSON.stringify(lines);
      for (const needle of ["Zola", "Please add him", "token-from-the-widget", "owner@", "1x0"]) {
        expect(logged).not.toContain(needle);
      }
    },
  );

  it("goes to the console at the line's level by default", async () => {
    const spies = {
      log: vi.spyOn(console, "log").mockImplementation(() => {}),
      warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
      error: vi.spyOn(console, "error").mockImplementation(() => {}),
    };
    const app = createApp({ deck: SAMPLE_DECK, images: {}, clock: () => TODAY });
    const { env } = harness();
    await app.fetch(post(ROUND_PATH, { mode: "friendly" }), env);
    await app.fetch(post(ROUND_PATH, { mode: "endless" }), env);
    await app.fetch(post(ROUND_PATH, { mode: "friendly" }), { ...env, RUN_SECRET: "" });
    expect(spies.log).toHaveBeenCalledWith(expect.objectContaining({ event: "run_start" }));
    expect(spies.warn).toHaveBeenCalledWith(expect.objectContaining({ event: "bad_request" }));
    expect(spies.error).toHaveBeenCalledWith(expect.objectContaining({ event: "internal" }));
    for (const spy of Object.values(spies)) {
      expect(spy).toHaveBeenCalledOnce();
      // One object per line: a string would only be searchable as text.
      expect(typeof spy.mock.calls[0]?.[0]).toBe("object");
      spy.mockRestore();
    }
  });
});
