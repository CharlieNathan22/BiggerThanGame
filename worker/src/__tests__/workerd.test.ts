/**
 * Endless under workerd: the real app and the real, SQLite-backed Durable
 * Object, through wrangler's test harness (worker/test/entry.ts). What the
 * Node tests can only fake: a nonce spent once in real storage, the resend
 * rule, the alarm closing a silent run, a whole run over HTTP, and the same
 * seed dealing the same run here as in Node.
 *
 * Slower than the rest (the Worker is bundled and workerd started once).
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildRun, valueOf } from "@bt/core";
import type {
  BoardResponse,
  Guess,
  GuessResponse,
  RoundPayload,
  RunStartResponse,
  SubmitResponse,
} from "@bt/core";
import { createTestHarness, unstable_splitSqlQuery } from "wrangler";
import { NOW, fixtureDeck } from "../../../packages/core/src/__fixtures__/deck.js";
import { parseRunId } from "../run-id.js";
import { readToken } from "./endless-helpers.js";
import { SECRET } from "./helpers.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const server = createTestHarness({
  root,
  workers: [
    {
      config: {
        name: "biggerthangame-test",
        main: "worker/test/entry.ts",
        compatibility_date: "2026-09-17",
        compatibility_flags: ["nodejs_compat"],
        vars: { RUN_SECRET: SECRET, TURNSTILE_SECRET: "test-turnstile-secret" },
        durable_objects: { bindings: [{ name: "RUNS", class_name: "RunDO" }] },
        d1_databases: [{ binding: "DB", database_name: "test", database_id: "test-db" }],
        migrations: [{ tag: "v1", new_sqlite_classes: ["RunDO"] }],
      },
    },
  ],
});

/** The test Worker's RunDO, with its test-only `alarmAt`. */
interface RunsBinding {
  idFromName(name: string): unknown;
  get(id: unknown): { alarmAt(now: number): Promise<void> };
}

/** The D1 binding, as the test reaches it from Node. */
interface DbBinding {
  prepare(sql: string): { run(): Promise<unknown>; all<T>(): Promise<{ results: T[] }> };
}

beforeAll(async () => {
  await server.listen();
  // The real migrations, into the harness's local D1.
  const env = (await server.getWorker().getEnv()) as unknown as { DB: DbBinding };
  const dir = join(root, "migrations");
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    for (const statement of unstable_splitSqlQuery(readFileSync(join(dir, file), "utf8"))) {
      await env.DB.prepare(statement).run();
    }
  }
}, 120_000);

afterAll(async () => {
  await server.close();
});

async function post<T>(path: string, body: unknown): Promise<{ status: number; body: T }> {
  const res = await server.fetch(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

async function start(): Promise<RunStartResponse> {
  const res = await post<RunStartResponse>("/api/run/start", {
    mode: "endless",
    turnstileToken: "test",
  });
  expect(res.status).toBe(200);
  return res.body;
}

/** The right answer, from the test's own copy of the fixture deck. */
function right(runId: string, round: RoundPayload): Guess {
  const now = parseRunId(runId)!.date;
  const challenger = fixtureDeck.find((p) => p.id === round.challenger.id)!;
  return valueOf(challenger, round.stat.key, now)! > round.anchor.value ? "higher" : "lower";
}

const other = (g: Guess): Guess => (g === "higher" ? "lower" : "higher");

describe("under workerd", () => {
  it("deals the same Endless run from the same seed as Node", async () => {
    const node = buildRun({
      deck: fixtureDeck,
      seed: "endless:1",
      mode: "endless",
      now: NOW,
      maxRounds: 25,
    })
      .map((r) => `${r.index}:${r.stat}:${r.anchor.id}>${r.challenger.id}`)
      .join("|");
    const res = await server.fetch("http://localhost/test/fingerprint?seed=endless:1&mode=endless");
    expect(await res.text()).toBe(node);
  });

  it("plays a whole run over HTTP: right answers, then a wrong one ends it", async () => {
    const started = await start();
    let token = started.token;
    let round = started.round;
    for (let i = 0; i < 4; i++) {
      const res = await post<GuessResponse>("/api/round/guess", {
        token,
        guess: right(started.runId, round),
      });
      expect(res.status).toBe(200);
      if (!("next" in res.body)) throw new Error("expected the run to go on");
      expect(res.body.reveal.correct).toBe(true);
      token = res.body.token;
      round = res.body.next;
    }
    const end = await post<GuessResponse>("/api/round/guess", {
      token,
      guess: other(right(started.runId, round)),
    });
    expect(end.status).toBe(200);
    expect(end.body).toMatchObject({ end: "wrong", challenge: { score: 4 } });
  }, 60_000);

  it("spends a nonce once in the Durable Object: the other answer is 409 and the run is void", async () => {
    const started = await start();
    const pick = right(started.runId, started.round);
    const first = await post<GuessResponse>("/api/round/guess", {
      token: started.token,
      guess: pick,
    });
    expect(first.status).toBe(200);
    const replay = await post("/api/round/guess", { token: started.token, guess: other(pick) });
    expect(replay).toEqual({ status: 409, body: { error: "conflict", detail: "spent" } });
    if (!("token" in first.body)) throw new Error("expected a next token");
    const after = await post("/api/round/guess", { token: first.body.token, guess: "higher" });
    expect(after).toEqual({ status: 409, body: { error: "conflict", detail: "void" } });
  }, 60_000);

  it("answers a resend of the latest step identically, and refuses it once the next token is used", async () => {
    const started = await start();
    const pick = right(started.runId, started.round);
    const first = await post<GuessResponse>("/api/round/guess", {
      token: started.token,
      guess: pick,
    });
    const again = await post<GuessResponse>("/api/round/guess", {
      token: started.token,
      guess: pick,
    });
    expect(again).toEqual(first);
    if (!("token" in first.body) || !("next" in first.body))
      throw new Error("expected a next token");
    await post("/api/round/guess", {
      token: first.body.token,
      guess: right(started.runId, first.body.next),
    });
    const late = await post("/api/round/guess", { token: started.token, guess: pick });
    expect(late.status).toBe(409);
  }, 60_000);

  it("closes a silent run as disconnected, keeps its streak and refuses a late guess", async () => {
    const started = await start();
    const pick = right(started.runId, started.round);
    const first = await post<GuessResponse>("/api/round/guess", {
      token: started.token,
      guess: pick,
    });
    if (!("token" in first.body) || !("next" in first.body))
      throw new Error("expected a next token");

    const key = parseRunId(started.runId)!.body;
    const worker = server.getWorker();
    const env = (await worker.getEnv()) as unknown as { RUNS: RunsBinding };
    const stub = env.RUNS.get(env.RUNS.idFromName(key));
    await stub.alarmAt(readToken(first.body.token).deadline + 6000);

    const late = await post("/api/round/guess", {
      token: first.body.token,
      guess: right(started.runId, first.body.next),
    });
    expect(late).toEqual({ status: 409, body: { error: "conflict", detail: "over" } });

    const sql = await worker.getDurableObjectStorage("RUNS", { name: key });
    const rows = (await sql.exec("SELECT data FROM run")) as { data: string }[];
    expect(JSON.parse(rows[0]!.data)).toMatchObject({
      status: "ended",
      end: "disconnected",
      streak: 1,
    });
    const answers = (await sql.exec("SELECT round, ms FROM answers")) as { round: number }[];
    expect(answers.map((a) => a.round)).toEqual([1]);
  }, 60_000);
});

describe("publishing under workerd", () => {
  it("publishes a finished run into D1, serves the board, and snapshots it at midnight", async () => {
    const started = await start();
    let token = started.token;
    let round = started.round;
    for (let i = 0; i < 3; i++) {
      const res = await post<GuessResponse>("/api/round/guess", {
        token,
        guess: right(started.runId, round),
      });
      if (!("next" in res.body)) throw new Error("expected the run to go on");
      token = res.body.token;
      round = res.body.next;
    }
    const end = await post<GuessResponse>("/api/round/guess", {
      token,
      guess: other(right(started.runId, round)),
    });
    if (!("result" in end.body)) throw new Error("expected the run to end");

    const body = {
      token: end.body.result,
      nickname: "Workerd Winger",
      deviceId: "3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b",
      turnstileToken: "test",
      showCountry: true,
    };
    const published = await post<SubmitResponse>("/api/run/submit", body);
    expect(published.status).toBe(200);
    expect(published.body).toMatchObject({ streak: 3, periods: { day: { rank: 1 } } });
    // Once only: the Durable Object now says it was published.
    expect(await post("/api/run/submit", body)).toEqual({
      status: 409,
      body: { error: "conflict", detail: "submitted" },
    });

    const board = await server.fetch("http://localhost/api/board/endless/day");
    expect(board.status).toBe(200);
    const day = (await board.json()) as BoardResponse;
    expect(day.entries).toContainEqual({
      id: published.body.id,
      rank: expect.any(Number),
      nickname: "Workerd Winger",
      streak: 3,
      tied: false,
      thinkMs: null,
      // workerd's local request.cf has a country: stored as the flag's code.
      country: expect.stringMatching(/^[A-Z]{2}$/),
    });

    // The run's day closes at the next midnight; the cron snapshots it.
    const runDay = parseRunId(started.runId)!.date;
    const midnight = new Date(runDay.getTime() + 86_400_000);
    const result = await server
      .getWorker()
      .scheduled({ cron: "0 0 * * *", scheduledTime: midnight });
    expect(result.outcome).toBe("ok");
    const env = (await server.getWorker().getEnv()) as unknown as { DB: DbBinding };
    const snaps = await env.DB.prepare(
      "SELECT period, period_key, total FROM board_snapshots",
    ).all<{ period: string; period_key: string; total: number }>();
    expect(snaps.results).toContainEqual({
      period: "day",
      period_key: runDay.toISOString().slice(0, 10),
      total: expect.any(Number),
    });
  }, 60_000);
});
