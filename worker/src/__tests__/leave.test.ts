/**
 * `POST /api/run/leave` (leave.ts): strict parsing, one log line and one data
 * point per beacon, only the figures the player had been shown, and no way to
 * change a run. Requests go through `createApp` with a capturing logger and a
 * mock dataset, as the Worker would write them.
 */

import { describe, expect, it, vi } from "vitest";
import { STATS, buildRun, valueOf } from "@bt/core";
import type { AnswerResponse, Guess, Player, Round, StartResponse } from "@bt/core";
import { LEAVE_PATH, MAX_LEAVE_BYTES, ROUND_PATH, createApp } from "../app.js";
import type { Env } from "../app.js";
import type { DataPoint } from "../analytics.js";
import { parseLeaveRequest } from "../leave.js";
import type { LogLine } from "../log.js";
import { parseRunId } from "../run-id.js";
import { friendlySeed } from "../seed.js";
import {
  SAMPLE_DECK,
  SECRET,
  TODAY,
  correctGuess,
  runDay,
  signedRunId,
  uuidFrom,
} from "./helpers.js";

const IP = "198.51.100.23";
const USER_AGENT = "Mozilla/5.0 (Leave Test)";
const VERSION = "legends-24-testdeck";

interface Harness {
  readonly app: ReturnType<typeof createApp>;
  readonly env: Env;
  readonly lines: LogLine[];
  readonly points: DataPoint[];
}

function harness(overrides: Partial<Env> = {}, deck: readonly Player[] = SAMPLE_DECK): Harness {
  const lines: LogLine[] = [];
  const points: DataPoint[] = [];
  let n = 0;
  const app = createApp({
    deck,
    images: {},
    deckVersion: VERSION,
    clock: () => TODAY,
    uuid: () => uuidFrom(++n),
    log: (line) => lines.push(line),
  });
  const allow = { limit: vi.fn(async () => ({ success: true })) };
  const env: Env = {
    ASSETS: { fetch: vi.fn(async () => new Response("site")) },
    RUN_SECRET: SECRET,
    RUN_ANSWERS: allow,
    RUN_STARTS: allow,
    ROUND_FLOOD: allow,
    FEEDBACK_SENDS: allow,
    FEEDBACK_EMAIL: { send: vi.fn(async () => ({})) },
    GAME_EVENTS: { writeDataPoint: (p: DataPoint) => void points.push(p) },
    ...overrides,
  };
  return { app, env, lines, points };
}

function post(path: string, body: unknown, method = "POST"): Request {
  const request = new Request(`https://biggerthangame.com${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": IP,
      "user-agent": USER_AGENT,
      cookie: "session=not-ours",
    },
    ...(method === "POST" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
  Object.defineProperty(request, "cf", { value: { country: "GB" } });
  return request;
}

async function startRun(h: Harness): Promise<StartResponse> {
  const res = await h.app.fetch(post(ROUND_PATH, { mode: "friendly" }), h.env);
  return (await res.json()) as StartResponse;
}

async function dealt(runId: string): Promise<Round[]> {
  const run = parseRunId(runId)!;
  const seed = await friendlySeed(SECRET, run.origin);
  return buildRun({ deck: SAMPLE_DECK, seed, mode: "friendly", now: run.date });
}

function bodyOf(runId: string): string {
  return runId.slice(0, runId.indexOf("."));
}

const leaveBody = (runId: string, extra: Record<string, unknown> = {}) => ({
  mode: "friendly",
  runId,
  round: 1,
  phase: "question",
  trigger: "hidden",
  ...extra,
});

describe("parseLeaveRequest", () => {
  const runId = "20260919-00000000-0000-4000-8000-000000000001.AAAAAAAAAAAAAAAAAAAAAA";

  it("accepts the five fields, round 0 only on the intro", () => {
    expect(parseLeaveRequest(leaveBody(runId))).toEqual({ ok: true, value: leaveBody(runId) });
    expect(parseLeaveRequest(leaveBody(runId, { round: 0, phase: "intro" })).ok).toBe(true);
    expect(parseLeaveRequest(leaveBody(runId, { round: 20, phase: "reveal" })).ok).toBe(true);
    expect(parseLeaveRequest(leaveBody(runId, { trigger: "pagehide", phase: "other" })).ok).toBe(
      true,
    );
  });

  it.each<[string, unknown]>([
    ["a string", "leave"],
    ["null", null],
    ["an array", [leaveBody(runId)]],
    ["an extra key", { ...leaveBody(runId), value: 108 }],
    ["a missing key", { mode: "friendly", runId, round: 1, phase: "question" }],
    ["another mode", leaveBody(runId, { mode: "squad" })],
    ["a malformed run id", leaveBody(runId, { runId: "not-a-run" })],
    ["a negative round", leaveBody(runId, { round: -1 })],
    ["a round past the last", leaveBody(runId, { round: 21 })],
    ["a fractional round", leaveBody(runId, { round: 1.5 })],
    ["a round as a string", leaveBody(runId, { round: "1" })],
    ["an unknown phase", leaveBody(runId, { phase: "thinking" })],
    ["an unknown trigger", leaveBody(runId, { trigger: "unload" })],
    ["round 0 outside the intro", leaveBody(runId, { round: 0, phase: "question" })],
    ["the intro with a round", leaveBody(runId, { round: 3, phase: "intro" })],
  ])("refuses %s", (_name, body) => {
    expect(parseLeaveRequest(body).ok).toBe(false);
  });
});

describe("POST /api/run/leave", () => {
  it("answers an empty, uncached 204 and writes one line and one data point", async () => {
    const h = harness();
    const { runId, round } = await startRun(h);
    h.lines.length = 0;
    h.points.length = 0;
    const res = await h.app.fetch(post(LEAVE_PATH, leaveBody(runId)), h.env);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(res.headers.get("cache-control")).toBe("no-store");

    const [dealtRound] = await dealt(runId);
    const anchor = SAMPLE_DECK.find((p) => p.id === round.anchor.id)!;
    const challenger = SAMPLE_DECK.find((p) => p.id === round.challenger.id)!;
    const value = valueOf(anchor, dealtRound!.stat, runDay(runId))!;
    const qualifier = STATS[dealtRound!.stat].qualifier?.(anchor);
    expect(h.lines).toEqual([
      {
        level: "info",
        message: "run_leave",
        event: "run_leave",
        route: LEAVE_PATH,
        mode: "friendly",
        run: bodyOf(runId),
        runKind: "fresh",
        deckVersion: VERSION,
        country: "GB",
        round: 1,
        phase: "question",
        trigger: "hidden",
        stat: { id: dealtRound!.stat, label: STATS[dealtRound!.stat].label },
        players: [
          {
            role: "anchor",
            id: anchor.id,
            name: anchor.name,
            value,
            display: STATS[dealtRound!.stat].format(value),
            ...(qualifier !== undefined ? { qualifier } : {}),
          },
          { role: "challenger", id: challenger.id, name: challenger.name },
        ],
      },
    ]);
    expect(h.points).toEqual([
      {
        indexes: [bodyOf(runId)],
        blobs: [
          "leave",
          "friendly",
          "fresh",
          VERSION,
          "GB",
          "question",
          "hidden",
          dealtRound!.stat,
        ],
        doubles: [1],
      },
    ]);
  });

  it("writes one line per beacon, each with its own trigger", async () => {
    const h = harness();
    const { runId } = await startRun(h);
    h.lines.length = 0;
    await h.app.fetch(post(LEAVE_PATH, leaveBody(runId)), h.env);
    await h.app.fetch(post(LEAVE_PATH, leaveBody(runId, { trigger: "pagehide" })), h.env);
    expect(h.lines.map((l) => [l.message, l.trigger])).toEqual([
      ["run_leave", "hidden"],
      ["run_leave", "pagehide"],
    ]);
  });

  it("leaves out the stat and players on the intro", async () => {
    const h = harness();
    const { runId } = await startRun(h);
    h.lines.length = 0;
    h.points.length = 0;
    await h.app.fetch(post(LEAVE_PATH, leaveBody(runId, { round: 0, phase: "intro" })), h.env);
    expect(h.lines[0]).not.toHaveProperty("stat");
    expect(h.lines[0]).not.toHaveProperty("players");
    expect(h.lines[0]).toMatchObject({ round: 0, phase: "intro" });
    expect(h.points[0]?.blobs.slice(5)).toEqual(["intro", "hidden", ""]);
    expect(h.points[0]?.doubles).toEqual([0]);
  });

  it("never carries the challenger's figure before it's revealed, nor the anchor's before the question", async () => {
    const h = harness();
    const { runId } = await startRun(h);
    const rounds = await dealt(runId);
    const now = runDay(runId);
    h.lines.length = 0;
    for (const phase of ["other", "question", "reveal"] as const) {
      for (let round = 1; round <= 5; round++) {
        await h.app.fetch(post(LEAVE_PATH, leaveBody(runId, { round, phase })), h.env);
      }
    }
    expect(h.lines).toHaveLength(15);
    for (const line of h.lines) {
      const round = rounds[(line.round as number) - 1]!;
      const [anchor, challenger] = line.players as Record<string, unknown>[];
      const hidden = valueOf(round.challenger, round.stat, now)!;
      if (line.phase === "reveal") {
        expect(challenger).toMatchObject({ value: hidden });
      } else {
        expect(Object.keys(challenger!).sort()).toEqual(["id", "name", "role"]);
        // Nowhere else in the line either, as a value or as the card would show it.
        const text = JSON.stringify(line);
        expect(text).not.toMatch(new RegExp(`"value":${hidden}[,}]`));
        expect(text).not.toContain(`"display":"${STATS[round.stat].format(hidden)}"`);
      }
      if (line.phase === "other") {
        expect(Object.keys(anchor!).sort()).toEqual(["id", "name", "role"]);
      } else {
        expect(anchor).toMatchObject({ value: valueOf(round.anchor, round.stat, now) });
      }
    }
  });

  it("logs nothing personal and no secret: no IP, user agent, cookie, seed or signed id", async () => {
    const h = harness();
    const { runId } = await startRun(h);
    await h.app.fetch(post(LEAVE_PATH, leaveBody(runId)), h.env);
    const run = parseRunId(runId)!;
    const everything = JSON.stringify([h.lines, h.points]);
    for (const needle of [
      IP,
      USER_AGENT,
      "session=not-ours",
      SECRET,
      runId,
      runId.slice(runId.indexOf(".") + 1),
      await friendlySeed(SECRET, run.origin),
    ]) {
      expect(everything).not.toContain(needle);
    }
  });

  it("changes nothing about the run: the answers are the same with or without beacons", async () => {
    async function play(withLeaves: boolean): Promise<string[]> {
      const h = harness();
      const started = await startRun(h);
      const out = [JSON.stringify(started)];
      let round = started.round;
      for (;;) {
        if (withLeaves) {
          for (const phase of ["other", "question"] as const) {
            await h.app.fetch(
              post(LEAVE_PATH, leaveBody(started.runId, { round: round.index, phase })),
              h.env,
            );
          }
        }
        const guess: Guess = correctGuess(SAMPLE_DECK, started.runId, round);
        const res = await h.app.fetch(
          post(ROUND_PATH, { mode: "friendly", runId: started.runId, round: round.index, guess }),
          h.env,
        );
        const answer = (await res.json()) as AnswerResponse;
        out.push(JSON.stringify(answer));
        if (withLeaves) {
          await h.app.fetch(
            post(LEAVE_PATH, leaveBody(started.runId, { round: round.index, phase: "reveal" })),
            h.env,
          );
        }
        if (!("next" in answer)) return out;
        round = answer.next;
      }
    }
    expect(await play(true)).toEqual(await play(false));
  });

  it.each<[string, (runId: string) => Promise<unknown> | unknown, string]>([
    [
      "a run id signed with another secret",
      async () => leaveBody(await signedRunId("2026-09-19", uuidFrom(1), "not-the-secret")),
      "runId is not one this server issued",
    ],
    [
      "a run too old to answer",
      async () => leaveBody(await signedRunId("2026-08-01", uuidFrom(1))),
      "runId is out of date",
    ],
    ["a malformed body", () => "{not json", "body must be JSON"],
    [
      "an extra field",
      (runId) => ({ ...leaveBody(runId), value: 108 }),
      "expected { mode, variant?, runId, round, phase, trigger }",
    ],
  ])("refuses %s with a 400, and records nothing", async (_name, make, detail) => {
    const h = harness();
    const { runId } = await startRun(h);
    h.lines.length = 0;
    h.points.length = 0;
    const res = await h.app.fetch(post(LEAVE_PATH, await make(runId)), h.env);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request", detail });
    expect(h.points).toEqual([]);
    expect(h.lines.map((l) => [l.level, l.event, l.route])).toEqual([
      ["warn", "bad_request", LEAVE_PATH],
    ]);
  });

  it("refuses a round the run never dealt", async () => {
    const one = SAMPLE_DECK[0]!;
    const twins = [one, { ...one, id: `${one.id}-twin`, name: "Twin" }];
    const h = harness({}, twins);
    const runId = await signedRunId("2026-09-19", uuidFrom(1));
    const res = await h.app.fetch(post(LEAVE_PATH, leaveBody(runId)), h.env);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request", detail: "this run has no round 1" });
  });

  it("refuses an oversized body before reading it as JSON", async () => {
    const h = harness();
    const res = await h.app.fetch(post(LEAVE_PATH, "x".repeat(MAX_LEAVE_BYTES + 1)), h.env);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request", detail: "body too large" });
  });

  it("refuses anything but POST", async () => {
    const h = harness();
    const res = await h.app.fetch(post(LEAVE_PATH, null, "GET"), h.env);
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });

  it("sits behind the flood limit, keyed on the IP, before any work", async () => {
    const deny = { limit: vi.fn(async () => ({ success: false })) };
    const h = harness({ ROUND_FLOOD: deny });
    const res = await h.app.fetch(post(LEAVE_PATH, "{not even json"), h.env);
    expect(res.status).toBe(429);
    expect(deny.limit).toHaveBeenCalledWith({ key: IP });
    expect(h.lines.map((l) => [l.event, l.reason])).toEqual([["rate_limited", "flood"]]);
  });
});
