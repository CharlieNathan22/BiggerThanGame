/**
 * Daily Ranked's parts, one at a time: thinking time, the shadow checks, the
 * photo a frozen round shows after the deck changes, the board and `/me`, the
 * snapshots and the nightly job.
 */

import { describe, expect, it } from "vitest";
import { DAILY_QUESTIONS } from "@bt/core";
import type { DailyMineResponse } from "@bt/core";
import { MIDNIGHT_CRON, runNightly } from "../cron.js";
import { dailyBoardData, handleDailyMine, snapshotDailyGame } from "../daily-board.js";
import { ensureDailyGame } from "../daily-game.js";
import type { StoredPlayer } from "../daily-game.js";
import type { DailyAnswer } from "../daily-ledger.js";
import { currentImages, photoFor } from "../daily-payload.js";
import {
  REPLAY_MEDIAN_MS,
  answerThinkMs,
  dailyShadowReasons,
  dailyThinkMs,
  isReplayLike,
} from "../daily-post.js";
import { entryResult, deviceEntry } from "../daily-scores.js";
import { hashDevice } from "../submit.js";
import { DAY, DEVICE_A, DEVICE_B, EPOCH, dailyHarness, onGame, play } from "./daily-helpers.js";
import { SAMPLE_DECK, SECRET, fakeImages } from "./helpers.js";

function answer(round: number, over: Partial<DailyAnswer> = {}): DailyAnswer {
  return {
    round,
    nonce: `n${round}`,
    guess: "higher",
    issuedAt: 0,
    receivedAt: 6000,
    ms: 6000,
    correct: true,
    allowanceMs: 4280,
    limitMs: round === 1 ? 15_000 : 10_000,
    timedOut: false,
    ...over,
  };
}

describe("thinking time", () => {
  it("is each answer's time less its animation, from question 2", () => {
    expect(answerThinkMs(answer(2))).toBe(6000 - 4280);
    expect(answerThinkMs(answer(1))).toBe(0);
  });

  it("counts a timeout as its whole limit, question 1's included", () => {
    expect(answerThinkMs(answer(2, { timedOut: true, ms: 1000 }))).toBe(10_000);
    expect(answerThinkMs(answer(1, { timedOut: true, ms: 1000 }))).toBe(15_000);
  });

  it("never counts more than the limit, nor less than nothing", () => {
    expect(answerThinkMs(answer(3, { ms: 60_000 }))).toBe(10_000);
    expect(answerThinkMs(answer(3, { ms: 100 }))).toBe(0);
  });

  it("so letting the clock run out never beats answering", () => {
    const answered = Array.from({ length: 20 }, (_, i) => answer(i + 1, { ms: 4280 + 9_999 }));
    const waited = answered.map((a) =>
      a.round === 5 ? { ...a, timedOut: true, ms: 4280 + 9_000 } : a,
    );
    expect(dailyThinkMs(waited)).toBeGreaterThan(dailyThinkMs(answered));
  });

  it("counts every question of the twenty never answered at its whole limit", () => {
    const three = [answer(1), answer(2), answer(3, { timedOut: true })];
    expect(dailyThinkMs(three)).toBe(0 + (6000 - 4280) + 10_000 + 17 * 10_000);
  });
});

describe("the replay check", () => {
  const fast = (correct: boolean) =>
    Array.from({ length: DAILY_QUESTIONS }, (_, i) =>
      answer(i + 1, {
        ms: 4280 + REPLAY_MEDIAN_MS - 300 + ((i * 37) % 200),
        correct: correct || i > 3,
      }),
    );

  it("shadows a near-perfect twenty answered very fast early on", () => {
    expect(isReplayLike(fast(true))).toBe(true);
    expect(dailyShadowReasons(fast(true))).toContain("replay");
  });

  it("leaves a fast run alone if it isn't near-perfect", () => {
    expect(isReplayLike(fast(false))).toBe(false);
  });

  it("leaves a perfect run at a reading pace alone", () => {
    const steady = Array.from({ length: DAILY_QUESTIONS }, (_, i) =>
      answer(i + 1, { ms: 4280 + 2500 + ((i * 523) % 2500) }),
    );
    expect(isReplayLike(steady)).toBe(false);
    expect(dailyShadowReasons(steady)).toEqual([]);
  });

  it("still shows a shadowed run to its owner", async () => {
    const h = dailyHarness();
    // Every answer a whisker after its animation: replay-like (and fast).
    await play(h, () => "right", { think: 4300 });
    const hash = await hashDevice(SECRET, DEVICE_A);
    const entry = (await deviceEntry(h.db, hash, 3))!;
    expect(entry.shadow).toBe(1);
    const own = await entryResult(h.db, entry);
    expect(own.result.rank).toBe(1);
    expect((await dailyBoardData(h.db, h.now, EPOCH)).entries).toEqual([]);
    expect(h.logs.some((l) => l.event === "score_shadowed")).toBe(true);
  });
});

describe("a frozen round's photo", () => {
  const player: StoredPlayer = {
    id: "p1",
    name: "P One",
    country: "FR",
    position: "FW",
    image: { key: "legends/originals/p1.aaaaaaaaaaaaaaaa.jpg", width: 1200, height: 1500 },
    focus: "50 20",
    value: 3,
    display: "3",
  };

  it("keeps the stored photo while it still exists", () => {
    const current = currentImages([], {
      p1: { key: player.image!.key, width: 1200, height: 1500 },
    });
    expect(photoFor(player, current)).toEqual({ ...player.image, focus: "50 20" });
  });

  it("falls back to the player's current photo when the stored one has gone", () => {
    const current = currentImages([{ ...SAMPLE_DECK[0]!, id: "p1", imageFocus: "40 30" }], {
      p1: { key: "legends/originals/p1.bbbbbbbbbbbbbbbb.jpg", width: 900, height: 1200 },
    });
    expect(photoFor(player, current)).toEqual({
      key: "legends/originals/p1.bbbbbbbbbbbbbbbb.jpg",
      width: 900,
      height: 1200,
      focus: "40 30",
    });
  });

  it("shows none (the monogram) for a player whose photo was removed", () => {
    expect(photoFor(player, currentImages([], {}))).toBeUndefined();
  });
});

describe("the board and /me", () => {
  it("shows Game 0 and the countdown to Game 1 before launch day", async () => {
    const h = dailyHarness({ at: EPOCH - DAY / 2 });
    expect(await dailyBoardData(h.db, h.now, EPOCH)).toEqual({
      mode: "ranked",
      gameNo: 0,
      nextGameAt: EPOCH,
      total: 0,
      entries: [],
      previous: null,
    });
    const me = await handleDailyMine(
      { deviceId: DEVICE_A },
      {
        db: h.db,
        secret: SECRET,
        clock: () => new Date(h.now),
        epoch: EPOCH,
      },
    );
    expect(me).toEqual({
      status: 200,
      body: { gameNo: 0, nextGameAt: EPOCH, country: null, state: "none" },
    });
  });

  it("names the previous game's winner, from its snapshot", async () => {
    const h = dailyHarness({ at: onGame(2) });
    await play(h, () => "right", { nickname: "BraveFreekick35", deviceId: DEVICE_A });
    await play(h, (r) => (r === 2 ? "wrong" : "right"), { nickname: "Second", deviceId: DEVICE_B });
    h.now = onGame(3, 60_000);
    await snapshotDailyGame(h.db, 2, h.now);
    const board = await dailyBoardData(h.db, h.now, EPOCH);
    expect(board.gameNo).toBe(3);
    expect(board.previous?.gameNo).toBe(2);
    expect(board.previous?.winner).toMatchObject({ nickname: "BraveFreekick35", perfect: true });
    expect(board.entries).toEqual([]);
  });

  it("tells a device it is playing, then where it finished", async () => {
    const h = dailyHarness();
    const ctx = { db: h.db, secret: SECRET, clock: () => new Date(h.now), epoch: EPOCH };
    expect((await handleDailyMine({ deviceId: DEVICE_A }, ctx)).body).toMatchObject({
      state: "none",
    });
    await play(h, () => "right");
    const me = (await handleDailyMine({ deviceId: DEVICE_A }, ctx)).body as Extract<
      DailyMineResponse,
      { state: "finished" }
    >;
    expect(me.state).toBe("finished");
    expect(me.result).toMatchObject({ correct: 20, rank: 1, total: 1 });
    expect(me.standing).toMatchObject({ rank: 1, nickname: "SwiftVolley42", perfect: true });
    expect((await handleDailyMine({ deviceId: "x" }, ctx)).status).toBe(400);
  });
});

describe("the nightly job", () => {
  const options = (h: ReturnType<typeof dailyHarness>, cron: string) => ({
    cron,
    daily: {
      epoch: EPOCH,
      build: async (gameNo: number) => {
        await ensureDailyGame(h.db, gameNo, {
          deck: SAMPLE_DECK,
          images: fakeImages(SAMPLE_DECK),
          secret: SECRET,
          deckVersion: "legends-test",
          epoch: EPOCH,
          clock: () => new Date(h.now),
        });
      },
    },
  });

  it("freezes the new game at midnight, and snapshots the one that closed", async () => {
    const h = dailyHarness({ at: onGame(4) });
    await play(h, () => "right");
    const midnight = new Date(EPOCH + 4 * DAY);
    const done = await runNightly(h.db, midnight, options(h, MIDNIGHT_CRON));
    expect(done.daily?.built).toBe(5);
    expect(done.snapshots).toContain("game:4");
    expect(h.db.rows("SELECT game_no FROM daily_games ORDER BY game_no")).toEqual([
      { game_no: 4 },
      { game_no: 5 },
    ]);
    // 01:30 takes the snapshot again but freezes nothing.
    const late = await runNightly(
      h.db,
      new Date(midnight.getTime() + 90 * 60_000),
      options(h, "30 1 * * *"),
    );
    expect(late.daily?.built).toBeNull();
    expect(late.snapshots).toContain("game:4");
  });

  it("does nothing for Daily before Game 1", async () => {
    const h = dailyHarness({ at: EPOCH - 2 * DAY });
    const done = await runNightly(h.db, new Date(EPOCH - DAY), options(h, MIDNIGHT_CRON));
    expect(done.daily?.built).toBeNull();
    expect(done.snapshots.filter((s) => s.startsWith("game:"))).toEqual([]);
  });

  it("prunes games and attempts after a few days, hashes after 48 hours, entries after 100 days", async () => {
    const h = dailyHarness({ at: onGame(2) });
    await play(h, () => "right");
    // The night Game 2 closes: its snapshot, nothing pruned yet.
    const closed = await runNightly(h.db, new Date(EPOCH + 2 * DAY), options(h, "30 1 * * *"));
    expect(closed.daily?.pruned).toEqual({ entries: 0, games: 0, attempts: 0, connections: 0 });
    // Two days on: the connection hash is gone, the rest kept.
    const twoDays = await runNightly(h.db, new Date(EPOCH + 4 * DAY), options(h, "30 1 * * *"));
    expect(twoDays.daily?.pruned).toEqual({ entries: 0, games: 0, attempts: 0, connections: 1 });
    // Game 2's frozen game and attempt go once Game 5 is a few days on.
    const later = await runNightly(h.db, new Date(EPOCH + 5 * DAY), options(h, "30 1 * * *"));
    expect(later.daily?.pruned).toMatchObject({ games: 1, attempts: 1, entries: 0 });
    expect(h.db.rows("SELECT COUNT(*) AS n FROM daily_entries")).toEqual([{ n: 1 }]);
    // A hundred days on, the entry too; the snapshot stays.
    await runNightly(h.db, new Date(EPOCH + 103 * DAY), options(h, "30 1 * * *"));
    expect(h.db.rows("SELECT COUNT(*) AS n FROM daily_entries")).toEqual([{ n: 0 }]);
    expect(
      h.db.rows("SELECT period_key FROM board_snapshots WHERE mode = 'ranked'"),
    ).toContainEqual({
      period_key: "2",
    });
  });
});
