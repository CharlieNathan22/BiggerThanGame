/**
 * Daily Ranked's handlers (daily.ts) end to end in Node: the frozen game, the
 * twenty questions and the bonus, the start's name and attempt, resume, the
 * idle finish and the post, against Node's SQLite with the real migrations and
 * a memory ledger per run.
 */

import { describe, expect, it } from "vitest";
import { DAILY_QUESTIONS, IDLE_FINISH_MS, NETWORK_GRACE_MS, normaliseNickname } from "@bt/core";
import type { DailyGuessEndResponse, DailyResumeResponse } from "@bt/core";
import { handleDailyStart } from "../daily.js";
import { buildDailyGame, ensureDailyGame, forgetDailyGames } from "../daily-game.js";
import { dailyBoard } from "../daily-scores.js";
import { postDailyRun } from "../daily-post.js";
import { hashDevice } from "../submit.js";
import {
  DAY,
  DEVICE_A,
  DEVICE_B,
  EPOCH,
  correctedDeck,
  dailyHarness,
  guess,
  guessOk,
  onGame,
  play,
  readToken,
  resume,
  rightGuess,
  start,
  startBody,
  storedGame,
  wrongOf,
} from "./daily-helpers.js";
import type { DailyHarness } from "./daily-helpers.js";
import { SAMPLE_DECK, SECRET, fakeImages } from "./helpers.js";

function inputs(h: DailyHarness, deck = SAMPLE_DECK) {
  return {
    deck,
    images: fakeImages(deck),
    secret: SECRET,
    deckVersion: "legends-test",
    epoch: EPOCH,
    clock: () => new Date(h.now),
  };
}

function ended(res: { answers: readonly unknown[] }): DailyGuessEndResponse {
  const last = res.answers.at(-1) as DailyGuessEndResponse;
  expect(last).toHaveProperty("end");
  return last;
}

describe("freezing the game", () => {
  it("is built once, and two racing requests both read the one row", async () => {
    const h = dailyHarness();
    const [a, b] = await Promise.all([
      ensureDailyGame(h.db, 3, inputs(h)),
      ensureDailyGame(h.db, 3, inputs(h)),
    ]);
    expect(a.rounds).toEqual(b.rounds);
    expect(h.db.rows("SELECT game_no FROM daily_games")).toEqual([{ game_no: 3 }]);
    expect(a.rounds.length).toBeGreaterThan(DAILY_QUESTIONS);
    expect(a.dayKey).toBe(20261103);
    expect(a.rulesVersion).toMatch(/^ranked-[0-9a-f]+$/);
  });

  it("deals every player the same game: the seed is the game's", async () => {
    const h = dailyHarness();
    const one = await buildDailyGame(5, inputs(h));
    const two = await buildDailyGame(5, inputs(h));
    const other = await buildDailyGame(6, inputs(h));
    expect(one.rounds).toEqual(two.rounds);
    expect(other.rounds).not.toEqual(one.rounds);
  });

  it("keeps today's game when the deck changes mid-day (a deploy)", async () => {
    const h = dailyHarness();
    const before = await ensureDailyGame(h.db, 3, inputs(h));
    forgetDailyGames(h.db);
    const after = await ensureDailyGame(h.db, 3, inputs(h, correctedDeck(SAMPLE_DECK)));
    expect(after.rounds).toEqual(before.rounds);
    // ...and a run played after the deploy plays the stored figures.
    const h2 = dailyHarness({ deck: correctedDeck(SAMPLE_DECK) });
    await ensureDailyGame(h2.db, 3, inputs(h));
    const started = await start(h2);
    expect(started.round.anchor.value).toBe(before.rounds[0]!.anchor.value);
  });

  it("starts the game itself when the cron hasn't stored it", async () => {
    const h = dailyHarness();
    expect(h.db.rows("SELECT * FROM daily_games")).toEqual([]);
    await start(h);
    expect(h.db.rows("SELECT game_no FROM daily_games")).toEqual([{ game_no: 3 }]);
  });
});

describe("the rules", () => {
  it("carries on through wrong answers and timeouts to question 20, then ends", async () => {
    const h = dailyHarness();
    const run = await play(h, (r) => (r % 3 === 0 ? "wrong" : r % 5 === 0 ? "timeout" : "right"));
    expect(run.answers).toHaveLength(DAILY_QUESTIONS);
    const end = ended(run);
    expect(end.end).toBe("finished");
    const wrong = [3, 6, 9, 12, 15, 18, 5, 10, 20].length;
    expect(end.result.correct).toBe(DAILY_QUESTIONS - wrong);
    expect(end.result.bonus).toBe(0);
    expect(end.result.score).toBe(DAILY_QUESTIONS - wrong);
    expect(end.result.results).toHaveLength(DAILY_QUESTIONS);
    // Every answer but the last carried the next question, right or wrong.
    for (const a of run.answers.slice(0, -1)) expect(a).toHaveProperty("next");
  });

  it("goes into the bonus only after 20/20, and ends on the first miss", async () => {
    const h = dailyHarness();
    const run = await play(h, (r) => (r <= 25 ? "right" : "wrong"));
    const end = ended(run);
    expect(end.end).toBe("wrong");
    expect(end.result).toMatchObject({ correct: 20, bonus: 5, score: 25 });
    expect(run.answers).toHaveLength(26);
  });

  it("ends a bonus run on a timeout as well", async () => {
    const h = dailyHarness();
    const run = await play(h, (r) => (r <= 21 ? "right" : "timeout"));
    const end = ended(run);
    expect(end.end).toBe("timeout");
    expect(end.result).toMatchObject({ correct: 20, bonus: 1, score: 21 });
  });

  it("never opens the bonus for 19 out of 20", async () => {
    const h = dailyHarness();
    const run = await play(h, (r) => (r === 20 ? "wrong" : "right"));
    expect(ended(run).end).toBe("finished");
    expect(run.answers).toHaveLength(20);
  });

  it("counts an answer after the deadline as a timeout, and carries on", async () => {
    const h = dailyHarness();
    const started = await start(h);
    const game = await storedGame(h, started.gameNo);
    h.now = (await readToken(started.token)).deadline + 1;
    const res = await guessOk(h, started.token, rightGuess(game.rounds[0]!));
    expect(res.reveal.correct).toBe(false);
    expect(res).toHaveProperty("next");
  });

  it("refuses a replayed answer without voiding the run: the first answer stands", async () => {
    const h = dailyHarness();
    const started = await start(h);
    const game = await storedGame(h, started.gameNo);
    h.wait(4000);
    const first = await guessOk(h, started.token, wrongOf(game.rounds[0]!));
    // The same token with the other answer: refused.
    const again = await guess(h, started.token, rightGuess(game.rounds[0]!));
    expect(again.status).toBe(409);
    // A resend of the same answer is answered as before.
    const resend = await guessOk(h, started.token, wrongOf(game.rounds[0]!));
    expect(resend).toEqual(first);
    // And the run goes on.
    const next = "token" in first ? first.token : "";
    h.wait(4000);
    expect((await guess(h, next, rightGuess(game.rounds[1]!))).status).toBe(200);
  });
});

describe("the start", () => {
  it("refuses a blocked name: no run, no attempt used", async () => {
    const h = dailyHarness();
    const res = await handleDailyStart(startBody("BlockedName"), h.ctx);
    expect(res.status).toBe(422);
    expect(h.db.rows("SELECT * FROM ranked_attempts")).toEqual([]);
    expect(h.db.rows("SELECT * FROM daily_entries")).toEqual([]);
  });

  it("refuses a name taken in the game: no run, no attempt used", async () => {
    const h = dailyHarness();
    await start(h, "TakenName", DEVICE_A);
    const res = await handleDailyStart(startBody("takenname", DEVICE_B), h.ctx);
    expect(res).toEqual({ status: 409, body: { error: "conflict", detail: "name_taken" } });
    const hash = await hashDevice(SECRET, DEVICE_B);
    expect(h.db.rows("SELECT * FROM ranked_attempts WHERE device_hash = ?", hash)).toEqual([]);
    // Another name goes through.
    expect((await handleDailyStart(startBody("OtherName", DEVICE_B), h.ctx)).status).toBe(200);
  });

  it("frees a name at rollover: unique within its game only", async () => {
    const h = dailyHarness();
    await start(h, "TakenName", DEVICE_A);
    h.now += DAY;
    expect((await handleDailyStart(startBody("TakenName", DEVICE_B), h.ctx)).status).toBe(200);
  });

  it("uses the attempt the moment a run starts, and refuses a second start that game", async () => {
    const h = dailyHarness();
    await start(h, "FirstName", DEVICE_A);
    expect(h.db.rows("SELECT game_no FROM ranked_attempts")).toEqual([{ game_no: 3 }]);
    const again = await handleDailyStart(startBody("SecondName", DEVICE_A), h.ctx);
    expect(again).toEqual({ status: 409, body: { error: "conflict", detail: "already_played" } });
    expect(h.db.rows("SELECT nickname FROM daily_entries")).toEqual([{ nickname: "FirstName" }]);
  });

  it("refuses a start before launch day, and nothing crashes", async () => {
    const h = dailyHarness({ at: EPOCH - 3 * DAY });
    const res = await handleDailyStart(startBody(), h.ctx);
    expect(res).toEqual({ status: 409, body: { error: "conflict", detail: "not_started" } });
    expect(await resume(h)).toEqual({ status: 200, body: { state: "none" } });
  });

  it("refuses a failed Turnstile check before anything is used", async () => {
    const h = dailyHarness();
    h.turnstile = "fail";
    expect((await handleDailyStart(startBody(), h.ctx)).status).toBe(403);
    expect(h.db.rows("SELECT * FROM ranked_attempts")).toEqual([]);
  });

  it("gives the attempt and the name back when the run's object can't begin it", async () => {
    const h = dailyHarness({
      runs: () => ({
        dailyBegin: async () => {
          throw new Error("storage unavailable");
        },
        dailyAdvance: async () => {
          throw new Error("no");
        },
        dailyResume: async () => {
          throw new Error("no");
        },
        dailyPosted: async () => false,
        dailyPostFailed: async () => {},
      }),
    });
    await expect(handleDailyStart(startBody(), h.ctx)).rejects.toThrow();
    expect(h.db.rows("SELECT * FROM ranked_attempts")).toEqual([]);
    expect(h.db.rows("SELECT * FROM daily_entries")).toEqual([]);
  });

  it("parses strictly", async () => {
    const h = dailyHarness();
    for (const body of [
      { ...startBody(), extra: 1 },
      { ...startBody(), deviceId: "nope" },
      { ...startBody(), showCountry: "yes" },
      { ...startBody(), mode: "endless" },
    ]) {
      expect((await handleDailyStart(body, h.ctx)).status).toBe(400);
    }
  });

  it("keeps the flag only when asked to", async () => {
    const h = dailyHarness();
    const started = await handleDailyStart(startBody("NoFlag", DEVICE_A, false), h.ctx);
    expect(started.status === 200 && started.body.country).toBeNull();
    const flagged = await start(h, "Flagged", DEVICE_B);
    expect(flagged.country).toBe("GB");
  });
});

describe("resume", () => {
  it("keeps an open question's deadline, under a fresh token", async () => {
    const h = dailyHarness();
    const started = await start(h);
    const before = await readToken(started.token);
    h.wait(3000);
    const res = await resume(h);
    const body = res.body as Extract<DailyResumeResponse, { state: "playing" }>;
    expect(body.state).toBe("playing");
    const after = await readToken(body.token);
    expect(after.round).toBe(1);
    expect(after.deadline).toBe(before.deadline);
    expect(after.issuedAt).toBe(before.issuedAt);
    expect(after.nonce).not.toBe(before.nonce);
    // Never more than the question's limit, however early the resume.
    expect(body.remainingMs).toBe(Math.min(15_000, before.deadline - NETWORK_GRACE_MS - h.now));
    h.wait(15_000);
    const later = (await resume(h)).body as Extract<DailyResumeResponse, { state: "playing" }>;
    expect(later.remainingMs).toBe(before.deadline - NETWORK_GRACE_MS - h.now);
    expect(body.round.challenger.id).toBe(started.round.challenger.id);
    // The old token is refused now; the new one answers.
    const game = await storedGame(h, started.gameNo);
    expect((await guess(h, started.token, rightGuess(game.rounds[0]!))).status).toBe(409);
    expect((await guess(h, body.token, rightGuess(game.rounds[0]!))).status).toBe(409);
    expect((await guess(h, later.token, rightGuess(game.rounds[0]!))).status).toBe(200);
  });

  it("can't change the question, however often it is asked", async () => {
    const h = dailyHarness();
    const started = await start(h);
    for (let i = 0; i < 3; i++) {
      h.wait(1000);
      const res = await resume(h);
      const body = res.body as Extract<DailyResumeResponse, { state: "playing" }>;
      expect(body.round).toEqual(started.round);
    }
  });

  it("records an expired question as a timeout and starts the next fresh", async () => {
    const h = dailyHarness();
    const started = await start(h);
    const first = await readToken(started.token);
    h.now = first.deadline + 60_000;
    const res = await resume(h);
    const body = res.body as Extract<DailyResumeResponse, { state: "playing" }>;
    expect(body.results).toEqual([false]);
    expect(body.round.index).toBe(2);
    expect(body.remainingMs).toBeNull();
    const next = await readToken(body.token);
    expect(next.issuedAt).toBe(h.now);
    expect(next.deadline).toBeGreaterThan(h.now + 10_000);
  });

  it("works from the device alone, whatever run id the page kept", async () => {
    const h = dailyHarness();
    const started = await start(h);
    for (const hint of [
      undefined,
      "20261103-00000000-0000-4000-8000-000000000999.xxxxxxxxxxxxxxxxxxxxxx",
    ]) {
      const res = await resume(h, DEVICE_A, hint);
      expect((res.body as { state: string }).state).toBe("playing");
      expect((res.body as { runId: string }).runId).toBe(started.runId);
    }
  });

  it("refuses another device", async () => {
    const h = dailyHarness();
    await start(h);
    expect(await resume(h, DEVICE_B)).toEqual({ status: 200, body: { state: "none" } });
    const ledger = h.runs.ledger((await start(h, "Other", DEVICE_B)).runId.split(".")[0]!);
    const other = await hashDevice(SECRET, DEVICE_A);
    expect(ledger.resume(other, h.now, "n")).toEqual({ ok: false, reason: "device" });
  });

  it("carries a run started before midnight on into the next game, and no further", async () => {
    const h = dailyHarness({ at: onGame(3, DAY - 60_000) });
    const started = await start(h);
    h.now += 2 * 60_000;
    const res = await resume(h);
    expect((res.body as { gameNo: number }).gameNo).toBe(3);
    // Two games on, it's gone: a new game, nothing to resume.
    h.now += DAY;
    expect((await resume(h)).body).toEqual({ state: "none" });
    expect(started.gameNo).toBe(3);
  });

  it("shows the result of a finished run", async () => {
    const h = dailyHarness();
    await play(h, () => "right");
    const res = await resume(h);
    expect((res.body as { state: string }).state).toBe("finished");
  });
});

describe("the idle finish and the post", () => {
  it("finishes a run left quiet, counts the rest wrong, and posts it", async () => {
    const h = dailyHarness();
    const started = await start(h);
    const game = await storedGame(h, started.gameNo);
    h.wait(4000);
    await guessOk(h, started.token, rightGuess(game.rounds[0]!));
    const key = started.runId.split(".")[0]!;
    const ledger = h.runs.ledger(key);
    const at = ledger.alarmAt()!;
    expect(at).toBe(h.now + IDLE_FINISH_MS);
    const action = ledger.onAlarm(at);
    expect(action.action).toBe("post");
    if (action.action !== "post") return;
    expect(action.run.end).toBe("abandoned");
    expect(action.run.results).toHaveLength(DAILY_QUESTIONS);
    const posted = await postDailyRun(h.db, action.run, action.answers);
    expect(posted.result).toMatchObject({ correct: 1, bonus: 0, score: 1, end: "abandoned" });
    // Resuming afterwards shows the final result.
    ledger.markPosted();
    const res = await resume(h);
    expect(res.body).toMatchObject({ state: "finished", result: { score: 1 } });
  });

  it("posts every kind of ending, once", async () => {
    for (const answer of [
      () => "right" as const,
      (r: number) => (r <= 22 ? "right" : "wrong") as "right" | "wrong",
      (r: number) => (r <= 21 ? "right" : "timeout") as "right" | "timeout",
    ]) {
      const h = dailyHarness();
      const run = await play(h, (r) => (answer === undefined ? "right" : answer(r)));
      const end = ended(run);
      expect(end.result.rank).toBe(1);
      expect(end.result.total).toBe(1);
      expect(
        h.db.rows("SELECT COUNT(*) AS n FROM daily_entries WHERE finished_at IS NOT NULL"),
      ).toEqual([{ n: 1 }]);
    }
  });

  it("answers with the result unranked when the post fails, and the alarm tries again", async () => {
    const h = dailyHarness();
    const started = await start(h);
    const key = started.runId.split(".")[0]!;
    const realDb = h.db;
    let broken = true;
    const flaky = {
      prepare: (sql: string) => {
        if (broken && sql.startsWith("UPDATE daily_entries")) throw new Error("D1 down");
        return realDb.prepare(sql);
      },
      batch: realDb.batch,
    };
    (h.ctx as { db: unknown }).db = flaky;
    const game = await storedGame(h, started.gameNo);
    let token = started.token;
    let last: unknown;
    for (let r = 1; r <= DAILY_QUESTIONS; r++) {
      h.wait(4000);
      const res = await guessOk(h, token, wrongOf(game.rounds[r - 1]!));
      last = res;
      if ("token" in res) token = res.token;
    }
    expect(last).toMatchObject({ end: "finished", result: { rank: null, score: 0 } });
    const ledger = h.runs.ledger(key);
    expect(ledger.run?.posted).toBe(false);
    broken = false;
    const action = ledger.onAlarm(ledger.alarmAt()!);
    expect(action.action).toBe("post");
    if (action.action === "post") {
      const posted = await postDailyRun(realDb, action.run, action.answers);
      expect(posted.fresh).toBe(true);
    }
  });
});

describe("the board's order", () => {
  it("ranks by score, then thinking time, then who finished first", async () => {
    const h = dailyHarness();
    const slow = await play(h, () => "right", {
      nickname: "SlowPerfect",
      deviceId: DEVICE_A,
      think: 8000,
    });
    h.wait(1000);
    const quick = await play(h, () => "right", {
      nickname: "QuickPerfect",
      deviceId: DEVICE_B,
      think: 6000,
    });
    const board = await dailyBoard(h.db, 3);
    expect(board.entries.map((e) => e.nickname)).toEqual(["QuickPerfect", "SlowPerfect"]);
    expect(ended(slow).result.rank).toBe(1);
    expect(ended(quick).result.rank).toBe(1);
  });

  it("puts a run that timed out behind the same score answered in time", async () => {
    const h = dailyHarness();
    await play(h, (r) => (r === 4 ? "timeout" : r === 7 ? "wrong" : "right"), {
      nickname: "Waited",
      deviceId: DEVICE_A,
      think: 4500,
    });
    await play(h, (r) => (r === 4 || r === 7 ? "wrong" : "right"), {
      nickname: "Answered",
      deviceId: DEVICE_B,
      think: 4500,
    });
    const board = await dailyBoard(h.db, 3);
    expect(board.entries.map((e) => [e.nickname, e.score, e.tied])).toEqual([
      ["Answered", 18, true],
      ["Waited", 18, true],
    ]);
    expect(board.entries[0]!.thinkMs!).toBeLessThan(board.entries[1]!.thinkMs!);
  });
});

describe("the repeat count", () => {
  it("counts runs from the same connection, and never shadows or changes them", async () => {
    const h = dailyHarness();
    await play(h, () => "right", { nickname: "One", deviceId: DEVICE_A });
    await play(h, () => "right", { nickname: "Two", deviceId: DEVICE_B });
    const starts = h.events.filter((e) => e.type === "start");
    expect(starts.map((e) => (e as { repeat?: number }).repeat)).toEqual([0, 1]);
    expect(h.db.rows("SELECT nickname, shadow FROM daily_entries ORDER BY nickname")).toEqual([
      { nickname: "One", shadow: 0 },
      { nickname: "Two", shadow: 0 },
    ]);
    // Only a salted hash is kept, never the address.
    const kept = h.db.rows<{ ip_hash: string }>("SELECT ip_hash FROM daily_connections");
    for (const row of kept) expect(row.ip_hash).not.toContain("203.0.113");
  });
});

describe("names", () => {
  it("are unique on their skeleton, as moderation reads them", () => {
    expect(normaliseNickname("TakenName")).toBe(normaliseNickname("takenname"));
  });
});
