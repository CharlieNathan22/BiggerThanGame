/**
 * Publishing a run (`POST /api/run/submit`, submit.ts): real Endless runs
 * played through the handlers against a memory ledger per run, published
 * into real SQL (`sqliteD1`, the migrations).
 */

import { describe, expect, it } from "vitest";
import { answerAllowance } from "@bt/core";
import type {
  ChallengeLink,
  GuessEndResponse,
  RunStartResponse,
  SubmitResponse,
  TimedGuess,
} from "@bt/core";
import type { GameEvent } from "../analytics.js";
import { challengeLink } from "../challenge.js";
import type { LogLine } from "../log.js";
import { RunLedger, SUBMIT_WINDOW_MS, memoryStore } from "../run-ledger.js";
import { mintRunId, parseRunId, signRunBody } from "../run-id.js";
import { publicBoard } from "../scores.js";
import type { D1Like } from "../scores.js";
import { THINK_FLOOR_MS } from "../shadow.js";
import { handleSubmit, hashDevice } from "../submit.js";
import type { SubmitContext, SubmitResult, SubmitStub } from "../submit.js";
import { signResult } from "../token.js";
import { begin, guessOk, harness, readToken, send } from "./endless-helpers.js";
import type { Harness } from "./endless-helpers.js";
import { sqliteD1 } from "./d1-sqlite.js";
import type { TestD1 } from "./d1-sqlite.js";
import { SAMPLE_DECK, SECRET, correctGuess, uuidFrom, wrongGuess } from "./helpers.js";

const DEVICE = "3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b";
const OTHER_DEVICE = "7d6c5b4a-3e2f-4a1b-8c9d-0e1f2a3b4c5d";

/** A person's pace: the floor every honest client plays, plus a few seconds, varied. */
const human = (round: number) => THINK_FLOOR_MS + 2000 + ((round * 977) % 3000);

interface World {
  readonly h: Harness;
  readonly db: TestD1;
  readonly ctx: SubmitContext;
  readonly events: GameEvent[];
  readonly lines: LogLine[];
  submit(body: Partial<Record<string, unknown>>): Promise<SubmitResult>;
}

function world(over: Partial<SubmitContext> = {}): World {
  const h = harness();
  const db = sqliteD1();
  const lines: LogLine[] = [];
  let n = 1000;
  const stub = (key: string): SubmitStub => {
    // A run's Durable Object with nothing in it: an empty ledger.
    const ledger = h.ledgers.get(key) ?? new RunLedger(memoryStore());
    return {
      claimForSubmit: async (claim) =>
        structuredClone(ledger.claimForSubmit(structuredClone(claim))),
      markSubmitted: async () => ledger.markSubmitted(),
    };
  };
  const ctx: SubmitContext = {
    deck: SAMPLE_DECK,
    secret: SECRET,
    clock: () => new Date(h.now),
    uuid: () => uuidFrom(++n),
    verifyTurnstile: async () => h.turnstile,
    runs: stub,
    db,
    record: (event) => h.events.push(event),
    log: (line) => lines.push(line),
    ...over,
  };
  return {
    h,
    db,
    ctx,
    events: h.events,
    lines,
    submit: (body) =>
      handleSubmit(
        {
          nickname: "SwiftVolley42",
          deviceId: DEVICE,
          turnstileToken: "ts",
          showCountry: true,
          ...body,
        },
        ctx,
      ),
  };
}

interface Played {
  readonly started: RunStartResponse;
  /** The end response, if the run ended. */
  readonly end?: GuessEndResponse;
  /** The latest progress token: the open question's, if the run is still going. */
  readonly latest: string;
}

/**
 * A run of `right` right answers, at a person's pace, then a wrong one — or,
 * with `open`, left waiting on the next question, as after a dropped connection.
 */
async function play(
  w: World,
  right: number,
  opts: { challenge?: ChallengeLink; open?: boolean; pace?: (round: number) => number } = {},
): Promise<Played> {
  const { h } = w;
  const started = await begin(h, opts.challenge);
  let round = started.round;
  let token = started.token;
  for (let i = 1; ; i += 1) {
    if (opts.open === true && i > right) return { started, latest: token };
    h.wait((opts.pace ?? human)(i));
    const good = correctGuess(SAMPLE_DECK, started.runId, round);
    const guess: TimedGuess = i > right ? wrongGuess(good) : good;
    const res = await guessOk(h, token, guess);
    if (!("next" in res)) return { started, end: res, latest: token };
    round = res.next;
    token = res.token;
  }
}

function ok(result: SubmitResult): SubmitResponse {
  if (result.status !== 200) throw new Error(`submit failed: ${JSON.stringify(result)}`);
  return result.body;
}

describe("publishing a run", () => {
  it("stores a finished run and ranks it today, this week and this month", async () => {
    const w = world();
    const { started, end } = await play(w, 5);
    w.h.wait(60_000);
    const body = ok(await w.submit({ token: end?.result }));
    expect(body).toMatchObject({ nickname: "SwiftVolley42", streak: 5 });
    for (const period of ["day", "week", "month"] as const) {
      expect(body.periods[period]).toMatchObject({
        rank: 1,
        total: 1,
        current: true,
        best: 5,
        improved: true,
      });
    }
    expect(body.periods.day.key).toBe("2026-09-19");
    expect(body.periods.week.key).toBe("2026-W38");
    expect(body.periods.month.key).toBe("2026-09");

    const key = parseRunId(started.runId)?.body;
    const rows = w.db.rows<Record<string, unknown>>("SELECT * FROM scores");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      mode: "endless",
      day_key: 20260919,
      nickname: "SwiftVolley42",
      nickname_normalised: "swiftvoleya",
      streak: 5,
      run_id: key,
      shadow: 0,
      device_hash: await hashDevice(SECRET, DEVICE),
    });
    // The raw device id and the signed run id are never stored.
    expect(JSON.stringify(rows)).not.toContain(DEVICE);
    expect(JSON.stringify(rows)).not.toContain(started.runId);
    expect(w.h.ledgers.get(key ?? "")?.isSubmitted()).toBe(true);
  });

  it("publishes a challenge run: a fresh run against a score, like any other", async () => {
    const w = world();
    const link = await challengeLink(SECRET, "20260918-00000000-0000-4000-8000-00000000abcd", 3);
    const { started, end } = await play(w, 4, { challenge: link });
    expect(started.challenge).toEqual({ accepted: true, score: 3 });
    const body = ok(await w.submit({ token: end?.result }));
    expect(body.streak).toBe(4);
    expect(w.events.at(-1)).toMatchObject({
      type: "submit",
      runKind: "challenge",
      published: true,
    });
  });

  it("publishes a banked run with its latest token, closing the open question", async () => {
    const w = world();
    const { started, latest } = await play(w, 3, { open: true });
    w.h.wait(2000);
    const body = ok(await w.submit({ token: latest }));
    expect(body.streak).toBe(3);
    expect(w.events).toContainEqual(
      expect.objectContaining({ type: "end", end: "disconnected", score: 3 }),
    );
    // The open question, round 4, can't be answered now.
    expect(readToken(latest).round).toBe(4);
    expect(await send(w.h, latest, "higher")).toMatchObject({
      status: 409,
      body: { detail: "over" },
    });
    expect(w.h.ledgers.get(parseRunId(started.runId)?.body ?? "")?.isSubmitted()).toBe(true);
  });

  it("publishes a run the alarm closed, with the token it banked", async () => {
    const w = world();
    const { started, latest } = await play(w, 2, { open: true });
    const key = parseRunId(started.runId)?.body ?? "";
    const deadline = readToken(latest).deadline;
    w.h.ledgers.get(key)?.onAlarm(deadline + 6000);
    w.h.now = deadline + 60_000;
    expect(ok(await w.submit({ token: latest })).streak).toBe(2);
  });

  it("ranks one best entry per device, whatever it publishes later", async () => {
    const w = world();
    const first = await play(w, 6);
    ok(await w.submit({ token: first.end?.result }));
    const second = await play(w, 2);
    const body = ok(await w.submit({ token: second.end?.result }));
    expect(body.streak).toBe(2);
    // The device's best in the period is still the 6.
    expect(body.periods.day).toMatchObject({ best: 6, improved: false, rank: 1, total: 1 });
    const third = await play(w, 4);
    const other = ok(await w.submit({ token: third.end?.result, deviceId: OTHER_DEVICE }));
    expect(other.periods.day).toMatchObject({ best: 4, improved: true, rank: 2, total: 2 });
  });
});

describe("thinking time and the flag", () => {
  /** A run of `right` right answers at `pace`, then a wrong one; what the player saw of each round. */
  async function playSeen(w: World, right: number, pace: (round: number) => number) {
    const { h } = w;
    const started = await begin(h);
    let round = started.round;
    let token = started.token;
    const seen: { index: number; statChanged: boolean; ms: number }[] = [];
    for (let i = 1; ; i += 1) {
      h.wait(pace(i));
      seen.push({ index: round.index, statChanged: round.stat.statChanged, ms: pace(i) });
      const good = correctGuess(SAMPLE_DECK, started.runId, round);
      const res = await guessOk(h, token, i > right ? wrongGuess(good) : good);
      if (!("next" in res)) return { end: res, seen };
      round = res.next;
      token = res.token;
    }
  }
  const row = (w: World) =>
    w.db
      .rows<{ think_ms: number; country: string | null }>("SELECT think_ms, country FROM scores")
      .at(-1);

  it("stores the run's thinking time: each answer less its own round's animation", async () => {
    const w = world();
    const { end, seen } = await playSeen(w, 9, (i) => THINK_FLOOR_MS + 2500 + ((i * 977) % 3000));
    ok(await w.submit({ token: end.result }));
    const expected = seen
      .filter((r) => r.index >= 2)
      .reduce((t, r) => t + Math.max(0, r.ms - answerAllowance(r.index, r.statChanged)), 0);
    expect(seen.some((r) => r.index >= 2 && r.statChanged)).toBe(true);
    expect(row(w)?.think_ms).toBe(expected);
  });

  it("ranks equal streaks by thinking time, on the board and in the submit's rank", async () => {
    const w = world();
    const first = await playSeen(w, 5, () => THINK_FLOOR_MS + 4000);
    ok(await w.submit({ token: first.end.result }));
    const quicker = await playSeen(w, 5, () => THINK_FLOOR_MS + 3000);
    const body = ok(await w.submit({ token: quicker.end.result, deviceId: OTHER_DEVICE }));
    expect(body.periods.day).toMatchObject({ rank: 1, total: 2, improved: true });
    const board = await publicBoard(w.db, "endless", { from: 20260919, to: 20260919 });
    expect(board.entries.map((e) => [e.streak, e.tied])).toEqual([
      [5, true],
      [5, true],
    ]);
    expect(board.entries[0]?.id).toBe(body.id);
    expect(board.entries[0]!.thinkMs!).toBeLessThan(board.entries[1]!.thinkMs!);
  });

  it("keeps the flag's code from cf.country when asked, and nothing when not", async () => {
    const w = world({ country: "BR" });
    ok(await w.submit({ token: (await play(w, 3)).end?.result }));
    expect(row(w)?.country).toBe("BR");
    ok(await w.submit({ token: (await play(w, 4)).end?.result, showCountry: false }));
    expect(row(w)?.country).toBeNull();
  });

  it("keeps no flag for an unknown, Tor or flagless code", async () => {
    for (const country of ["XX", "T1", "ZZ", "GBR", "", undefined]) {
      const w = world(country === undefined ? {} : { country });
      ok(await w.submit({ token: (await play(w, 2)).end?.result }));
      expect(row(w)?.country, String(country)).toBeNull();
    }
  });

  it("refuses a body without the flag choice", async () => {
    const w = world();
    const { end } = await play(w, 2);
    const res = await handleSubmit(
      { token: end?.result, nickname: "SwiftVolley42", deviceId: DEVICE, turnstileToken: "ts" },
      w.ctx,
    );
    expect(res).toMatchObject({ status: 400 });
    expect(
      await handleSubmit(
        {
          ...{
            token: end?.result,
            nickname: "SwiftVolley42",
            deviceId: DEVICE,
            turnstileToken: "ts",
          },
          showCountry: "yes",
        },
        w.ctx,
      ),
    ).toMatchObject({ status: 400 });
  });

  it("never logs the country", async () => {
    const w = world({ country: "BR" });
    ok(await w.submit({ token: (await play(w, 3)).end?.result }));
    expect(JSON.stringify(w.lines)).not.toContain('"BR"');
  });
});

describe("whether a publish moved the boards", () => {
  const PERIODS = ["day", "week", "month"] as const;
  const flags = (body: SubmitResponse) =>
    PERIODS.map((p) => [p, body.periods[p].improved, body.periods[p].best]);

  it("a better run improves every period, and becomes the device's entry", async () => {
    const w = world();
    ok(await w.submit({ token: (await play(w, 3)).end?.result }));
    const body = ok(await w.submit({ token: (await play(w, 5)).end?.result }));
    expect(flags(body)).toEqual([
      ["day", true, 5],
      ["week", true, 5],
      ["month", true, 5],
    ]);
    for (const p of PERIODS) expect(body.periods[p].entryId).toBe(body.id);
  });

  it("a worse run is accepted but improves nothing: the best stays", async () => {
    const w = world();
    const best = ok(await w.submit({ token: (await play(w, 5)).end?.result }));
    const body = ok(await w.submit({ token: (await play(w, 2)).end?.result }));
    expect(body.streak).toBe(2);
    expect(flags(body)).toEqual([
      ["day", false, 5],
      ["week", false, 5],
      ["month", false, 5],
    ]);
    for (const p of PERIODS) expect(body.periods[p].entryId).toBe(best.id);
    const board = await publicBoard(w.db, "endless", { from: 20260919, to: 20260919 });
    expect(board.entries.map((e) => [e.id, e.streak])).toEqual([[best.id, 5]]);
  });

  it("an equal run in no less time improves nothing: the earlier one keeps its place", async () => {
    const w = world();
    const best = ok(await w.submit({ token: (await play(w, 4)).end?.result }));
    const body = ok(await w.submit({ token: (await play(w, 4)).end?.result }));
    expect(flags(body)).toEqual([
      ["day", false, 4],
      ["week", false, 4],
      ["month", false, 4],
    ]);
    expect(body.periods.day.entryId).toBe(best.id);
  });

  it("an equal run in less time does take the entry, so it says so", async () => {
    const w = world();
    ok(await w.submit({ token: (await play(w, 4)).end?.result }));
    const quicker = (round: number) => human(round) - 1000;
    const body = ok(await w.submit({ token: (await play(w, 4, { pace: quicker })).end?.result }));
    expect(flags(body)).toEqual([
      ["day", true, 4],
      ["week", true, 4],
      ["month", true, 4],
    ]);
  });

  it("a new day: today's board improves, the week's and the month's keep the better run", async () => {
    const w = world();
    // Saturday 19 September 2026; Sunday is the same ISO week and month.
    const saturday = ok(await w.submit({ token: (await play(w, 6)).end?.result }));
    w.h.wait(86_400_000);
    const body = ok(await w.submit({ token: (await play(w, 3)).end?.result }));
    expect(body.periods.day.key).toBe("2026-09-20");
    expect(body.periods.week.key).toBe("2026-W38");
    expect(flags(body)).toEqual([
      ["day", true, 3],
      ["week", false, 6],
      ["month", false, 6],
    ]);
    expect(body.periods.week.entryId).toBe(saturday.id);
    expect(body.periods.day.entryId).toBe(body.id);
  });

  it("counts the device's shadowed runs, as its owner's view does", async () => {
    const w = world();
    // Answers far too quick: stored, shadowed.
    const quick = await play(w, 8, { pace: () => THINK_FLOOR_MS + 50 });
    ok(await w.submit({ token: quick.end?.result }));
    expect(w.db.rows<{ shadow: number }>("SELECT shadow FROM scores")[0]?.shadow).toBe(1);
    const body = ok(await w.submit({ token: (await play(w, 5)).end?.result }));
    expect(flags(body)).toEqual([
      ["day", false, 8],
      ["week", false, 8],
      ["month", false, 8],
    ]);
  });
});

describe("the token", () => {
  it("refuses a forged, edited or foreign-key token", async () => {
    const w = world();
    const { end } = await play(w, 3);
    const result = end?.result ?? "";
    const [payload = "", sig = ""] = result.split(".");
    const edited = JSON.parse(Buffer.from(payload, "base64url").toString());
    edited.score = 40;
    const forged = `${Buffer.from(JSON.stringify(edited)).toString("base64url")}.${sig}`;
    const foreign = await signResult("another-secret", readResult(result));
    for (const token of [forged, foreign, "not.a-token", `${payload}.${"A".repeat(43)}`]) {
      expect(await w.submit({ token }), token).toMatchObject({
        status: 400,
        body: { error: "bad_request" },
      });
    }
  });

  it("refuses a streak the run's Durable Object doesn't agree with", async () => {
    const w = world();
    const { end } = await play(w, 3);
    const claimed = { ...readResult(end?.result ?? ""), score: 9 };
    expect(await w.submit({ token: await signResult(SECRET, claimed) })).toMatchObject({
      status: 409,
      body: { error: "conflict", detail: "mismatch" },
    });
  });

  it("refuses a spent progress token from a finished run", async () => {
    const w = world();
    const started = await begin(w.h);
    const tokens: string[] = [started.token];
    let round = started.round;
    for (let i = 1; i <= 4; i += 1) {
      w.h.wait(human(i));
      const good = correctGuess(SAMPLE_DECK, started.runId, round);
      const res = await guessOk(w.h, tokens.at(-1) ?? "", i === 4 ? wrongGuess(good) : good);
      if (!("next" in res)) break;
      round = res.next;
      tokens.push(res.token);
    }
    // Round three's token was spent on the way to a score of 3; it proves 2.
    expect(readToken(tokens[2] ?? "").streak).toBe(2);
    expect(await w.submit({ token: tokens[2] })).toMatchObject({
      status: 409,
      body: { detail: "mismatch" },
    });
    // Round one's proves nothing at all.
    expect(await w.submit({ token: tokens[0] })).toMatchObject({
      status: 400,
      body: { detail: "zero" },
    });
    // The last one, whose answer ended the run, is the banked score: 3.
    expect((await w.submit({ token: tokens[3] })).status).toBe(200);
  });

  it("refuses a run that was already published", async () => {
    const w = world();
    const { end } = await play(w, 3);
    ok(await w.submit({ token: end?.result }));
    expect(await w.submit({ token: end?.result, nickname: "Another Name" })).toMatchObject({
      status: 409,
      body: { detail: "submitted" },
    });
  });

  it("refuses a submit more than 30 minutes after the run ended", async () => {
    const w = world();
    const { end } = await play(w, 3);
    w.h.wait(SUBMIT_WINDOW_MS + 1);
    expect(await w.submit({ token: end?.result })).toMatchObject({
      status: 409,
      body: { detail: "expired" },
    });
  });

  it("takes one just inside the window", async () => {
    const w = world();
    const { end } = await play(w, 3);
    w.h.wait(SUBMIT_WINDOW_MS);
    expect((await w.submit({ token: end?.result })).status).toBe(200);
  });

  it("refuses a streak of 0: there's nothing to publish", async () => {
    const w = world();
    const { end } = await play(w, 0);
    expect(end?.end).toBe("wrong");
    expect(await w.submit({ token: end?.result })).toMatchObject({
      status: 400,
      body: { detail: "zero" },
    });
  });

  it("refuses a run /api/run/start never minted, even with a genuine signature", async () => {
    const w = world();
    // A crafted run: an Endless id this server would sign, but no run was ever
    // dealt under it, so no sequence was checked answer by answer.
    const runId = await mintRunId(new Date(w.h.now), uuidFrom(777), SECRET, "endless");
    const token = await signResult(SECRET, {
      v: 1,
      runId,
      mode: "endless",
      score: 12,
      end: "wrong",
      startedOn: "2026-09-19",
      elapsedMs: 60_000,
      endedAt: w.h.now,
    });
    expect(await w.submit({ token })).toMatchObject({
      status: 409,
      body: { error: "conflict", detail: "unknown" },
    });
    expect(w.db.rows("SELECT * FROM scores")).toEqual([]);
  });

  it("refuses a Friendly run id and a retired replay id", async () => {
    const w = world();
    const friendly = await mintRunId(new Date(w.h.now), uuidFrom(778), SECRET, "friendly");
    const replay = await signRunBody(
      SECRET,
      `20260919-${uuidFrom(779)}~${uuidFrom(780)}`,
      "endless",
    );
    for (const runId of [friendly, replay]) {
      const token = await signResult(SECRET, {
        v: 1,
        runId,
        mode: "endless",
        score: 5,
        end: "wrong",
        startedOn: "2026-09-19",
        elapsedMs: 1,
        endedAt: w.h.now,
      });
      expect(await w.submit({ token })).toMatchObject({ status: 400 });
    }
  });
});

describe("the checks after the token", () => {
  it("answers Turnstile's fail with 403 and its outage with 502, leaving the run publishable", async () => {
    const w = world();
    const { end } = await play(w, 3);
    w.h.turnstile = "fail";
    expect(await w.submit({ token: end?.result })).toMatchObject({ status: 403 });
    w.h.turnstile = "error";
    expect(await w.submit({ token: end?.result })).toMatchObject({ status: 502 });
    w.h.turnstile = "pass";
    expect((await w.submit({ token: end?.result })).status).toBe(200);
  });

  it("refuses a blocked or other-script name calmly, and takes the next one", async () => {
    const w = world();
    const { end } = await play(w, 3);
    for (const nickname of ["Admin", "4dm1n_42", "Пеле"]) {
      expect(await w.submit({ token: end?.result, nickname }), nickname).toMatchObject({
        status: 422,
        body: { error: "nickname_rejected" },
      });
    }
    expect(ok(await w.submit({ token: end?.result, nickname: "  Big   Sam " })).nickname).toBe(
      "Big Sam",
    );
  });

  it("refuses a malformed name as a bad request", async () => {
    const w = world();
    const { end } = await play(w, 3);
    for (const nickname of ["ab", "x".repeat(21), "Goal ⚽"]) {
      expect(await w.submit({ token: end?.result, nickname })).toMatchObject({ status: 400 });
    }
  });

  it("shadows a run answered faster than a person could, and tells its player nothing", async () => {
    const w = world();
    const { end } = await play(w, 12, { pace: () => THINK_FLOOR_MS + 100 });
    const body = ok(await w.submit({ token: end?.result, nickname: "Quick Hands" }));
    expect(body.periods.day).toMatchObject({ rank: 1, total: 1 });
    const [row] = w.db.rows<{ shadow: number; shadow_reason: string }>("SELECT * FROM scores");
    expect(row).toMatchObject({ shadow: 1, shadow_reason: "fast,flat" });
    // Everyone else sees an empty board.
    expect(await publicBoard(w.db, "endless", { from: 20260919, to: 20260919 })).toEqual({
      entries: [],
      total: 0,
    });
    const line = w.lines.find((l) => l.event === "score_shadowed");
    expect(line).toMatchObject({ level: "warn", reason: "fast,flat", score: 12 });
    expect(JSON.stringify(w.lines)).not.toContain("Quick Hands");
  });

  it("stores a person's run unshadowed", async () => {
    const w = world();
    const { end } = await play(w, 12);
    ok(await w.submit({ token: end?.result }));
    expect(w.db.rows<{ shadow: number }>("SELECT shadow FROM scores")).toEqual([{ shadow: 0 }]);
  });

  it("limits submissions before any other work", async () => {
    let asked = false;
    const w = world({
      limit: async () => ({ ok: false, retryAfter: 60 }),
      verifyTurnstile: async () => {
        asked = true;
        return "pass";
      },
    });
    expect(await w.submit({ token: "x" })).toEqual({
      status: 429,
      body: { error: "rate_limited" },
      retryAfter: 60,
    });
    expect(asked).toBe(false);
  });

  it("parses strictly", async () => {
    const w = world();
    const cases: unknown[] = [
      null,
      [],
      { token: "t", nickname: "Abc", deviceId: DEVICE },
      { token: "t", nickname: "Abc", deviceId: DEVICE, turnstileToken: "ts", extra: 1 },
      { token: "t", nickname: "Abc", deviceId: "not-a-uuid", turnstileToken: "ts" },
      { token: "t", nickname: 42, deviceId: DEVICE, turnstileToken: "ts" },
      { token: "", nickname: "Abc", deviceId: DEVICE, turnstileToken: "ts" },
    ];
    for (const body of cases) {
      expect(await handleSubmit(body, w.ctx), JSON.stringify(body)).toMatchObject({ status: 400 });
    }
  });
});

describe("failures", () => {
  it("answers a calm 503 when D1 fails, and the run stays publishable", async () => {
    let broken = true;
    const real = sqliteD1();
    const flaky: D1Like = {
      prepare: (sql) => {
        if (broken) throw new Error("D1_ERROR: storage unavailable");
        return real.prepare(sql);
      },
      batch: (s) => real.batch(s),
    };
    const w = world({ db: flaky });
    const { end } = await play(w, 3);
    expect(await w.submit({ token: end?.result })).toMatchObject({
      status: 503,
      body: { error: "unavailable", detail: "scores" },
      reason: "scores",
    });
    broken = false;
    expect((await w.submit({ token: end?.result })).status).toBe(200);
  });

  it("still stops a second publish if marking the run failed", async () => {
    const w = world();
    const failingMark: SubmitContext = {
      ...w.ctx,
      runs: (key) => ({
        claimForSubmit: (claim) => w.ctx.runs(key).claimForSubmit(claim),
        markSubmitted: async () => {
          throw new Error("RunStoreError: gone");
        },
      }),
    };
    const { end } = await play(w, 3);
    const body = {
      nickname: "SwiftVolley42",
      deviceId: DEVICE,
      turnstileToken: "ts",
      showCountry: true,
    };
    expect((await handleSubmit({ ...body, token: end?.result }, failingMark)).status).toBe(200);
    expect(w.lines).toContainEqual(
      expect.objectContaining({ level: "error", reason: "run_store" }),
    );
    // The ledger never heard, but run_id is unique.
    expect(await handleSubmit({ ...body, token: end?.result }, failingMark)).toMatchObject({
      status: 409,
      body: { detail: "submitted" },
    });
    expect(w.db.rows("SELECT id FROM scores")).toHaveLength(1);
  });
});

describe("what it records", () => {
  it("writes a submit event per real attempt, and never the nickname", async () => {
    const w = world();
    const { end } = await play(w, 3);
    await w.submit({ token: end?.result, nickname: "Admin" });
    ok(await w.submit({ token: end?.result, nickname: "Tidy Winger" }));
    const submits = w.events.filter((e) => e.type === "submit");
    expect(submits).toEqual([
      expect.objectContaining({ published: false, refusal: "nickname_rejected", score: 3 }),
      expect.objectContaining({
        published: true,
        shadowed: false,
        score: 3,
        ranks: { day: 1, week: 1, month: 1 },
      }),
    ]);
    expect(JSON.stringify([w.events, w.lines])).not.toMatch(/Tidy Winger|Admin|3f2a9c1e/);
  });
});

/** A result token's payload, read as the client could. */
function readResult(token: string) {
  const body = token.split(".")[0] ?? "";
  return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
}
