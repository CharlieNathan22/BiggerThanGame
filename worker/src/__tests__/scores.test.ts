import { describe, expect, it } from "vitest";
import { periodOf } from "@bt/core";
import {
  BOARD_SIZE,
  DuplicateRunError,
  insertScore,
  ownStanding,
  pruneScores,
  publicBoard,
  readSnapshot,
  saveSnapshot,
} from "../scores.js";
import type { ScoreRow } from "../scores.js";
import { sqliteD1 } from "./d1-sqlite.js";
import type { TestD1 } from "./d1-sqlite.js";

let n = 0;

/** A score, with everything a test doesn't care about filled in. */
function score(over: Partial<ScoreRow> & { device: string }): ScoreRow {
  n += 1;
  const { device, ...rest } = over;
  return {
    id: `id-${String(n).padStart(4, "0")}`,
    mode: "endless",
    dayKey: 20260929,
    nickname: `Player${n}`,
    nicknameNormalised: `player`,
    streak: 10,
    elapsedMs: 60_000,
    deviceHash: device,
    runKey: `20260929-run-${n}`,
    createdAt: 1_000_000 + n,
    shadow: false,
    shadowReason: null,
    ...rest,
  };
}

async function seed(db: TestD1, rows: ScoreRow[]): Promise<void> {
  for (const row of rows) await insertScore(db, row);
}

const DAY = { from: 20260929, to: 20260929 };

describe("the public board", () => {
  it("shows each device's single best run, best first", async () => {
    const db = sqliteD1();
    await seed(db, [
      score({ device: "a", streak: 12, nickname: "Alpha" }),
      score({ device: "a", streak: 30, nickname: "AlphaBest" }),
      score({ device: "a", streak: 7, nickname: "AlphaWorst" }),
      score({ device: "b", streak: 20, nickname: "Bravo" }),
      score({ device: "c", streak: 25, nickname: "Charlie" }),
    ]);
    const board = await publicBoard(db, "endless", DAY);
    expect(board.total).toBe(3);
    expect(board.entries.map((e) => [e.rank, e.nickname, e.streak])).toEqual([
      [1, "AlphaBest", 30],
      [2, "Charlie", 25],
      [3, "Bravo", 20],
    ]);
  });

  it("breaks ties on the lower time, then the earlier publish", async () => {
    const db = sqliteD1();
    await seed(db, [
      score({ device: "slow", streak: 15, elapsedMs: 90_000, createdAt: 1 }),
      score({ device: "late", streak: 15, elapsedMs: 50_000, createdAt: 3 }),
      score({ device: "early", streak: 15, elapsedMs: 50_000, createdAt: 2 }),
      score({ device: "more", streak: 16, elapsedMs: 999_000, createdAt: 9 }),
    ]);
    const board = await publicBoard(db, "endless", DAY);
    const byId = await db.rows<{ id: string; device_hash: string }>(
      "SELECT id, device_hash FROM scores",
    );
    const device = (id: string) => byId.find((r) => r.id === id)?.device_hash;
    expect(board.entries.map((e) => device(e.id))).toEqual(["more", "early", "late", "slow"]);
  });

  it("takes a device's best by the same order when its streaks tie", async () => {
    const db = sqliteD1();
    await seed(db, [
      score({ device: "a", streak: 9, elapsedMs: 80_000, nickname: "Slower" }),
      score({ device: "a", streak: 9, elapsedMs: 40_000, nickname: "Faster" }),
    ]);
    const board = await publicBoard(db, "endless", DAY);
    expect(board.entries.map((e) => e.nickname)).toEqual(["Faster"]);
  });

  it("leaves shadowed scores out of the entries and the total", async () => {
    const db = sqliteD1();
    await seed(db, [
      score({ device: "bot", streak: 99, shadow: true, shadowReason: "fast" }),
      score({ device: "a", streak: 20 }),
      score({ device: "b", streak: 10 }),
    ]);
    const board = await publicBoard(db, "endless", DAY);
    expect(board.total).toBe(2);
    expect(board.entries.map((e) => e.streak)).toEqual([20, 10]);
  });

  it("falls back to a device's unshadowed run when its best is shadowed", async () => {
    const db = sqliteD1();
    await seed(db, [
      score({ device: "a", streak: 40, shadow: true, shadowReason: "flat" }),
      score({ device: "a", streak: 8, nickname: "Honest" }),
    ]);
    const board = await publicBoard(db, "endless", DAY);
    expect(board.entries.map((e) => [e.nickname, e.streak])).toEqual([["Honest", 8]]);
  });

  it("shows a retired name as null and keeps the score", async () => {
    const db = sqliteD1();
    await seed(db, [score({ device: "a", streak: 11, nickname: "Rude" })]);
    db.exec("UPDATE scores SET name_flagged = 1");
    const board = await publicBoard(db, "endless", DAY);
    expect(board.entries).toEqual([
      { id: expect.any(String), rank: 1, nickname: null, streak: 11 },
    ]);
    expect(JSON.stringify(board)).not.toContain("Rude");
  });

  it("stops at the board's size, 50, and still counts everyone", async () => {
    expect(BOARD_SIZE).toBe(50);
    const db = sqliteD1();
    await seed(
      db,
      Array.from({ length: 105 }, (_, i) => score({ device: `d${i}`, streak: i + 1 })),
    );
    const board = await publicBoard(db, "endless", DAY);
    expect(board.entries).toHaveLength(50);
    expect(board.total).toBe(105);
    expect(board.entries[0]?.streak).toBe(105);
    expect(board.entries.at(-1)).toMatchObject({ rank: 50, streak: 56 });
  });

  it("keeps modes apart", async () => {
    const db = sqliteD1();
    await seed(db, [score({ device: "a" })]);
    db.exec(
      "INSERT INTO scores (id, mode, day_key, game_no, nickname, nickname_normalised, streak, " +
        "elapsed_ms, device_hash, run_id, created_at) VALUES " +
        "('r', 'ranked', 20260929, 1, 'R', 'r', 50, 1, 'b', 'ranked-run', 1)",
    );
    expect((await publicBoard(db, "endless", DAY)).total).toBe(1);
  });
});

describe("periods as day-key ranges", () => {
  it("count a week across a year's end and a month across its last day", async () => {
    const db = sqliteD1();
    await seed(db, [
      score({ device: "w52", dayKey: 20261227 }),
      score({ device: "w53-mon", dayKey: 20261228 }),
      score({ device: "w53-thu", dayKey: 20261231 }),
      score({ device: "w53-fri", dayKey: 20270101 }),
      score({ device: "w53-sun", dayKey: 20270103 }),
      score({ device: "w01", dayKey: 20270104 }),
    ]);
    const devices = async (range: { from: number; to: number }) => {
      const { entries } = await publicBoard(db, "endless", range);
      const ids = new Set(entries.map((e) => e.id));
      return db
        .rows<{ id: string; device_hash: string }>("SELECT id, device_hash FROM scores")
        .filter((r) => ids.has(r.id))
        .map((r) => r.device_hash)
        .sort();
    };
    const week53 = periodOf(new Date("2027-01-01T12:00:00Z"), "week");
    expect(await devices(week53)).toEqual(["w53-fri", "w53-mon", "w53-sun", "w53-thu"]);
    const december = periodOf(new Date("2026-12-31T23:59:59Z"), "month");
    expect(await devices(december)).toEqual(["w52", "w53-mon", "w53-thu"]);
    const newYear = periodOf(new Date("2027-01-01T00:00:00Z"), "day");
    expect(await devices(newYear)).toEqual(["w53-fri"]);
  });
});

describe("a device's own standing", () => {
  it("ranks its best among everyone else's public bests", async () => {
    const db = sqliteD1();
    await seed(db, [
      score({ device: "me", streak: 14 }),
      score({ device: "me", streak: 9 }),
      score({ device: "x", streak: 30 }),
      score({ device: "x", streak: 2 }),
      score({ device: "y", streak: 20 }),
      score({ device: "z", streak: 5 }),
    ]);
    const mine = await ownStanding(db, "endless", "me", DAY);
    expect(mine).toMatchObject({ streak: 14, rank: 3, total: 4 });
  });

  it("counts its own shadowed run as normal, while others' shadowed runs never count", async () => {
    const db = sqliteD1();
    await seed(db, [
      score({ device: "me", streak: 50, shadow: true, shadowReason: "fast" }),
      score({ device: "other-bot", streak: 60, shadow: true, shadowReason: "flat" }),
      score({ device: "a", streak: 40 }),
      score({ device: "b", streak: 30 }),
    ]);
    const mine = await ownStanding(db, "endless", "me", DAY);
    expect(mine).toMatchObject({ streak: 50, rank: 1, total: 3 });
    // Everyone else sees two entries and a total of two.
    expect((await publicBoard(db, "endless", DAY)).total).toBe(2);
  });

  it("uses the full tiebreak against others", async () => {
    const db = sqliteD1();
    await seed(db, [
      score({ device: "rival", streak: 10, elapsedMs: 50_000, createdAt: 5 }),
      score({ device: "me", streak: 10, elapsedMs: 50_000, createdAt: 6 }),
    ]);
    expect(await ownStanding(db, "endless", "me", DAY)).toMatchObject({ rank: 2, total: 2 });
    expect(await ownStanding(db, "endless", "rival", DAY)).toMatchObject({ rank: 1, total: 2 });
  });

  it("is undefined for a device with nothing in the range", async () => {
    const db = sqliteD1();
    await seed(db, [score({ device: "me", dayKey: 20260928 })]);
    expect(await ownStanding(db, "endless", "me", DAY)).toBeUndefined();
  });
});

describe("writes", () => {
  it("refuse a second row for one run", async () => {
    const db = sqliteD1();
    await insertScore(db, score({ device: "a", runKey: "20260929-same" }));
    await expect(insertScore(db, score({ device: "b", runKey: "20260929-same" }))).rejects.toThrow(
      DuplicateRunError,
    );
  });

  it("refuse a streak of 0", async () => {
    const db = sqliteD1();
    await expect(insertScore(db, score({ device: "a", streak: 0 }))).rejects.toThrow(/CHECK/);
  });

  it("prune rows from before a day, and only those", async () => {
    const db = sqliteD1();
    await seed(db, [
      score({ device: "a", dayKey: 20260620 }),
      score({ device: "b", dayKey: 20260621 }),
      score({ device: "c", dayKey: 20260929 }),
    ]);
    expect(await pruneScores(db, 20260621)).toBe(1);
    expect(db.rows<{ day_key: number }>("SELECT day_key FROM scores ORDER BY day_key")).toEqual([
      { day_key: 20260621 },
      { day_key: 20260929 },
    ]);
  });

  it("keep one snapshot per period, the latest", async () => {
    const db = sqliteD1();
    await saveSnapshot(db, "endless", "day", "2026-09-29", { takenAt: 1, total: 1, entries: [] });
    const entries = [{ id: "x", rank: 1, nickname: "Late", streak: 12 }];
    await saveSnapshot(db, "endless", "day", "2026-09-29", { takenAt: 2, total: 5, entries });
    expect(await readSnapshot(db, "endless", "day", "2026-09-29")).toEqual({
      takenAt: 2,
      total: 5,
      entries,
    });
    expect(await readSnapshot(db, "endless", "week", "2026-W40")).toBeUndefined();
  });
});
