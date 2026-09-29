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
import type {
  AnswerResponse,
  EndResponse,
  Guess,
  GuessResponse,
  Player,
  Round,
  RunStartResponse,
  StartResponse,
} from "@bt/core";
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
import { FEEDBACK_PATH, GUESS_PATH, ROUND_PATH, RUN_START_PATH, createApp } from "../app.js";
import type { Env } from "../app.js";
import { challengeLink } from "../challenge.js";
import type { LogLine } from "../log.js";
import { parseRunId } from "../run-id.js";
import { fakeRuns } from "./endless-helpers.js";
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

/** The app with Turnstile passing, a memory ledger per run and a clock to move. */
function endlessHarness(): {
  post<T>(path: string, body: unknown): Promise<T>;
  wait(ms: number): void;
  points: DataPoint[];
  lines: LogLine[];
} {
  const points: DataPoint[] = [];
  const lines: LogLine[] = [];
  let now = TODAY.getTime();
  let n = 0;
  const app = createApp({
    deck: SAMPLE_DECK,
    images: {},
    deckVersion: VERSION,
    clock: () => new Date(now),
    uuid: () => uuidFrom(++n),
    log: (line) => lines.push(line),
    fetch: async () => new Response(JSON.stringify({ success: true })),
  });
  const allow = { limit: vi.fn(async () => ({ success: true })) };
  const env: Env = {
    ASSETS: { fetch: vi.fn(async () => new Response("site")) },
    RUN_SECRET: SECRET,
    TURNSTILE_SECRET: "turnstile-secret",
    RUN_ANSWERS: allow,
    RUN_STARTS: allow,
    ROUND_FLOOD: allow,
    FEEDBACK_SENDS: allow,
    FEEDBACK_EMAIL: { send: vi.fn(async () => ({})) },
    GAME_EVENTS: { writeDataPoint: (p: DataPoint) => void points.push(p) },
    RUNS: fakeRuns(),
  };
  return {
    async post<T>(path: string, body: unknown): Promise<T> {
      const res = await app.fetch(post(path, body), env);
      expect(res.status, await res.clone().text()).toBe(200);
      return (await res.json()) as T;
    },
    wait: (ms) => {
      now += ms;
    },
    points,
    lines,
  };
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
): Promise<{ runId: string; last: AnswerResponse; answered: number; guess: Guess }> {
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
    if (!("next" in res)) return { runId: started.runId, last: res, answered: round.index, guess };
    round = res.next;
  }
}

/**
 * `run_end`'s final-round fields, worked out from the deck: the round that
 * ended the run, the guess, and both players with the figures the cards showed.
 */
async function finalFields(runId: string, answered: number, guess: Guess) {
  const round = (await dealt(runId))[answered - 1]!;
  const now = runDay(runId);
  const def = STATS[round.stat];
  const player = (role: "anchor" | "challenger", p: Player) => {
    const value = valueOf(p, round.stat, now)!;
    const qualifier = def.qualifier?.(p);
    return {
      role,
      id: p.id,
      name: p.name,
      value,
      display: def.format(value),
      ...(qualifier !== undefined ? { qualifier } : {}),
    };
  };
  return {
    endStat: { id: def.key, label: def.label },
    guess,
    players: [player("anchor", round.anchor), player("challenger", round.challenger)],
  };
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
      blobs: ["answer", "friendly", "fresh", VERSION, "GB", "ct", STATS.ct.tier, "0.01-0.03", "1"],
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
    [5, "0.45+"],
    [6, "0.35+"],
    [10, "0.35+"],
    [11, "0.06-0.16"],
    [13, "0.06-0.16"],
    [14, "0.02-0.08"],
    [17, "0.02-0.08"],
    [18, "0.02-0.04"],
    [19, "0.02-0.04"],
    [20, "0.01-0.03"],
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
        message: "run_start",
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
    const { runId, guess } = await play(h, { missAt: 3 });
    expect(h.points.map((p) => p.blobs[0])).toEqual(["start", "answer", "answer", "answer", "end"]);
    expect(h.points.at(-1)).toEqual({
      indexes: [bodyOf(runId)],
      blobs: ["end", "friendly", "fresh", VERSION, "GB", "wrong"],
      doubles: [2],
    });
    expect(h.lines.at(-1)).toEqual({
      level: "info",
      message: "run_end",
      event: "run_end",
      route: ROUND_PATH,
      mode: "friendly",
      run: bodyOf(runId),
      runKind: "fresh",
      deckVersion: VERSION,
      country: "GB",
      reason: "wrong",
      score: 2,
      ...(await finalFields(runId, 3, guess)),
    });
  });

  it("ends a run played to the end with its reason and score, and marks the final question", async () => {
    const h = harness();
    const { runId, last, answered, guess } = await play(h);
    const end = (last as EndResponse).end;
    expect(end === "won" ? answered === 20 : end === "deck-exhausted").toBe(true);
    // The final question is logged on a win too: the stat, the guess and both players.
    expect(h.lines.at(-1)).toMatchObject({
      message: "run_end",
      reason: end,
      score: answered,
      ...(await finalFields(runId, answered, guess)),
    });
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

  it("writes an Endless run's events: its mode, its kind and the server-measured answer time", async () => {
    const e = endlessHarness();
    const link = await challengeLink(SECRET, `20260919-${uuidFrom(900)}`, 7);
    const started = await e.post<RunStartResponse>(RUN_START_PATH, {
      mode: "endless",
      turnstileToken: "pass",
      challenge: link,
    });
    expect(started.challenge).toEqual({ accepted: true, score: 7 });
    let token = started.token;
    let round = started.round;
    for (let i = 0; i < 3; i++) {
      e.wait(4321);
      const pick = correctGuess(SAMPLE_DECK, started.runId, round);
      const guess = i === 2 ? wrongGuess(pick) : pick;
      const res = await e.post<GuessResponse>(GUESS_PATH, { token, guess });
      if ("token" in res && "next" in res) {
        token = res.token;
        round = res.next;
      }
    }
    const key = bodyOf(started.runId);
    expect(e.points.map((p) => [p.blobs[0], p.blobs[1], p.blobs[2], p.indexes[0]])).toEqual([
      ["start", "endless", "challenge", key],
      ["answer", "endless", "challenge", key],
      ["answer", "endless", "challenge", key],
      ["answer", "endless", "challenge", key],
      ["end", "endless", "challenge", key],
    ]);
    for (const answer of e.points.filter((p) => p.blobs[0] === "answer")) {
      expect(answer.doubles).toHaveLength(6);
      expect(answer.doubles[5]).toBe(4321);
    }
    expect(e.points.at(-1)!.blobs[5]).toBe("wrong");
    expect(e.points.at(-1)!.doubles).toEqual([2]);
    expect(e.lines.map((l) => [l.event, l.mode, l.runKind, l.route])).toEqual([
      ["run_start", "endless", "challenge", RUN_START_PATH],
      ["run_end", "endless", "challenge", GUESS_PATH],
    ]);
  });

  it("writes Friendly's answers with no answer time: it has no clock", async () => {
    const h = harness();
    await play(h, { missAt: 2 });
    for (const answer of h.points.filter((p) => p.blobs[0] === "answer")) {
      expect(answer.doubles).toHaveLength(5);
    }
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
  it("fits the longest run key there is in 96 bytes", async () => {
    const h = harness();
    const { runId } = await play(h, { missAt: 1 });
    // `YYYYMMDD-<uuid>`: 8 + 1 + 36. The run id grammar allows nothing longer
    // but the retired replay form, `…~<uuid>`, at 82 (run-id.ts); the
    // signature is never part of the key.
    const key = parseRunId(runId)!.body;
    expect(new TextEncoder().encode(key).length).toBe(45);
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
    const runs: Awaited<ReturnType<typeof play>>[] = [];
    for (const missAt of [1, 3, 6, 9, undefined]) {
      runs.push(await play(h, missAt === undefined ? {} : { missAt }));
    }
    const everything = JSON.stringify([h.points, h.lines]);
    // Everything but run_end's final round, which the ending response revealed.
    const revealed = new Set(["endStat", "guess", "players"]);
    const lines = h.lines.map((line) =>
      Object.fromEntries(Object.entries(line).filter(([field]) => !revealed.has(field))),
    );
    const unrevealed = JSON.stringify([h.points, lines]);

    for (const needle of [IP, USER_AGENT, "session=not-ours", SECRET]) {
      expect(everything).not.toContain(needle);
    }
    for (const { runId } of runs) {
      const run = parseRunId(runId)!;
      expect(everything).not.toContain(runId);
      expect(everything).not.toContain(runId.slice(runId.indexOf(".") + 1));
      expect(everything).not.toContain(await friendlySeed(SECRET, run.origin));
    }
    // A player appears in one place only: run_end's `players`, the two in the
    // round that ended the run, whose figures the ending response revealed.
    // Never the next round's pair, dealt but never shown.
    const ends = h.lines.filter((l) => l.event === "run_end");
    expect(ends).toHaveLength(runs.length);
    for (const [i, { runId, answered, guess }] of runs.entries()) {
      const { endStat, guess: guessed, players } = ends[i]!;
      expect({ endStat, guess: guessed, players }).toEqual(
        await finalFields(runId, answered, guess),
      );
    }
    for (const player of SAMPLE_DECK) {
      expect(unrevealed).not.toContain(`"${player.id}"`);
      expect(unrevealed).not.toContain(player.name);
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
      lines.map((line) => ({
        ...line,
        run: undefined,
        deckVersion: undefined,
        score: undefined,
      })),
    );
    expect(scanForLeakedValues(lineText, SAMPLE_DECK, TODAY, "log lines")).toEqual([]);
  });
});

describe("the feedback line", () => {
  const TOKEN = "token-from-the-widget";

  function feedbackHarness(): { h: Harness; env: Env } {
    const h = harness();
    const app = createApp({
      deck: SAMPLE_DECK,
      images: {},
      clock: () => TODAY,
      uuid: () => uuidFrom(7),
      fetch: async () => Response.json({ success: true }),
      emailMessage: (from, to) => ({ from, to }),
      log: (line) => h.lines.push(line),
    });
    const env: Env = {
      ...h.env,
      TURNSTILE_SECRET: "1x0000000000000000000000000000000AA",
      FEEDBACK_TO: "owner@example.com",
    };
    return { h: { ...h, app }, env };
  }

  async function submit(body: unknown, country: string | null = "GB"): Promise<LogLine[]> {
    const { h, env } = feedbackHarness();
    const res = await h.app.fetch(post(FEEDBACK_PATH, body, country), env);
    expect(res.status).toBe(200);
    return h.lines;
  }

  function expectNothingPersonal(lines: LogLine[]): void {
    const logged = JSON.stringify(lines);
    for (const needle of [IP, USER_AGENT, "session=not-ours", TOKEN, "owner@", "1x0", SECRET]) {
      expect(logged).not.toContain(needle);
    }
  }

  it("logs an accepted suggestion with its name and note", async () => {
    const lines = await submit({
      kind: "suggest",
      name: "Gianfranco Zola",
      note: "Chelsea \u0007legend\nand Parma",
      turnstileToken: TOKEN,
    });
    expect(lines).toEqual([
      {
        level: "info",
        message: "Legend suggested",
        event: "feedback",
        route: FEEDBACK_PATH,
        kind: "suggest",
        country: "GB",
        submitted: { name: "Gianfranco Zola", note: "Chelsea legend\nand Parma" },
      },
    ]);
    expectNothingPersonal(lines);
  });

  it("logs an accepted problem report with its note and page", async () => {
    const lines = await submit(
      { kind: "problem", note: "Share does nothing", page: "/about", turnstileToken: TOKEN },
      null,
    );
    expect(lines).toEqual([
      {
        level: "info",
        message: "Problem reported",
        event: "feedback",
        route: FEEDBACK_PATH,
        kind: "problem",
        country: "XX",
        submitted: { note: "Share does nothing", page: "/about" },
      },
    ]);
    expectNothingPersonal(lines);
  });

  it("logs an accepted correction with the round as shown, and the run key only", async () => {
    const { h, env } = feedbackHarness();
    const { runId, answered, guess } = await play(h, { missAt: 2 });
    h.lines.length = 0;
    const res = await h.app.fetch(
      post(FEEDBACK_PATH, {
        kind: "correction",
        runId,
        round: answered,
        note: "That fee is wrong",
        turnstileToken: TOKEN,
      }),
      env,
    );
    expect(res.status).toBe(200);
    const { endStat, players } = await finalFields(runId, answered, guess);
    expect(h.lines).toEqual([
      {
        level: "info",
        message: "Card error reported",
        event: "feedback",
        route: FEEDBACK_PATH,
        kind: "correction",
        country: "GB",
        submitted: {
          note: "That fee is wrong",
          run: bodyOf(runId),
          round: answered,
          stat: endStat,
          players: players.map(({ role, name, display, qualifier }) => ({
            role,
            name,
            display,
            ...(qualifier !== undefined ? { qualifier } : {}),
          })),
        },
      },
    ]);
    const logged = JSON.stringify(h.lines);
    expect(logged).not.toContain(runId);
    expect(logged).not.toContain(runId.slice(runId.indexOf(".") + 1));
    expectNothingPersonal(h.lines);
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
        message: "analytics_failed · Error",
        event: "analytics_failed",
        route: ROUND_PATH,
        reason: "Error",
        cause: "Analytics Engine is down",
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
        message: 'bad_request · mode must be "friendly"',
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
    expect(h.lines.map((l) => [l.level, l.message, l.event, l.route, l.status, l.reason])).toEqual([
      ["warn", "rate_limited · starts", "rate_limited", ROUND_PATH, 429, "starts"],
      ["warn", "rate_limited · flood", "rate_limited", ROUND_PATH, 429, "flood"],
      ["warn", "rate_limited · feedback", "rate_limited", FEEDBACK_PATH, 429, "feedback"],
    ]);
  });

  it("warns on a wrong method, and says nothing about an unknown path", async () => {
    const h = harness();
    await h.app.fetch(new Request(`https://biggerthangame.com${ROUND_PATH}`), h.env);
    await h.app.fetch(new Request("https://biggerthangame.com/api/nope"), h.env);
    expect(h.lines).toEqual([
      {
        level: "warn",
        message: "method_not_allowed",
        event: "method_not_allowed",
        route: ROUND_PATH,
        status: 405,
      },
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
        message: "unavailable · the deck cannot deal a round",
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
        message: "internal · TypeError",
        event: "internal",
        route: ROUND_PATH,
        status: 500,
        reason: "TypeError",
        cause: "no randomness",
      },
    ]);
  });

  it("logs a missing secret by name only", async () => {
    const h = harness();
    await h.app.fetch(post(ROUND_PATH, { mode: "friendly" }), { ...h.env, RUN_SECRET: "" });
    expect(h.lines).toEqual([
      {
        level: "error",
        message: "internal · not_configured",
        event: "internal",
        route: ROUND_PATH,
        status: 500,
        reason: "not_configured",
        cause: "RUN_SECRET missing",
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
    "logs %s on feedback, with none of the user's text in that line",
    async (_name, verdict, level, event, status, extra: { reason?: string }) => {
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
      const message = extra.reason === undefined ? event : `${event} · ${extra.reason}`;
      const failures = lines.filter((l) => l.event !== "feedback");
      expect(failures).toEqual([{ level, message, event, route: FEEDBACK_PATH, status, ...extra }]);
      // Accepted once Turnstile passed, so a failed send still has its feedback line first.
      const accepted = lines.filter((l) => l.event === "feedback");
      expect(accepted.map((l) => l.kind)).toEqual(event === "send_failed" ? ["suggest"] : []);
      expect(lines.indexOf(failures[0]!)).toBe(accepted.length);
      const failure = JSON.stringify(failures);
      for (const needle of ["Zola", "Please add him"]) expect(failure).not.toContain(needle);
      const logged = JSON.stringify(lines);
      for (const needle of ["token-from-the-widget", "owner@", "1x0", IP, USER_AGENT]) {
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
