/**
 * The nightly job across real boundaries: an ordinary midnight, a month's
 * end, a Monday, ISO week 53 and the new year — with the 01:30 re-run and
 * the 100-day prune.
 */

import { describe, expect, it } from "vitest";
import { CRONS, RETAIN_DAYS, runNightly } from "../cron.js";
import { BOARD_SIZE, insertScore, readSnapshot } from "../scores.js";
import { sqliteD1 } from "./d1-sqlite.js";
import type { TestD1 } from "./d1-sqlite.js";

let n = 0;
async function add(
  db: TestD1,
  dayKey: number,
  streak: number,
  device = `d${n}`,
  over: { thinkMs?: number; country?: string | null } = {},
): Promise<void> {
  n += 1;
  await insertScore(db, {
    id: `id-${n}`,
    mode: "endless",
    dayKey,
    nickname: `P${n}`,
    nicknameNormalised: "p",
    streak,
    thinkMs: over.thinkMs ?? 1000,
    country: over.country ?? null,
    deviceHash: device,
    runKey: `run-${n}`,
    createdAt: n,
    shadow: false,
    shadowReason: null,
  });
}

const snapshots = (db: TestD1) =>
  db.rows<{ period: string; period_key: string; total: number }>(
    "SELECT period, period_key, total FROM board_snapshots ORDER BY period, period_key",
  );

describe("the nightly job", () => {
  it("runs at midnight and at 01:30 UTC", () => {
    expect(CRONS).toEqual(["0 0 * * *", "30 1 * * *"]);
  });

  it("snapshots only the day on an ordinary midnight", async () => {
    const db = sqliteD1();
    await add(db, 20260929, 12);
    await add(db, 20260929, 30);
    await add(db, 20260930, 99);
    const done = await runNightly(db, new Date("2026-09-30T00:00:00Z"));
    expect(done.snapshots).toEqual(["day:2026-09-29"]);
    const day = await readSnapshot(db, "endless", "day", "2026-09-29");
    expect(day?.total).toBe(2);
    expect(day?.entries.map((e) => e.streak)).toEqual([30, 12]);
  });

  it("adds the month at the turn of a month, and the week on a Monday", async () => {
    const db = sqliteD1();
    await add(db, 20260915, 8);
    await add(db, 20260930, 21);
    await add(db, 20261004, 17); // a Sunday
    expect((await runNightly(db, new Date("2026-10-01T00:00:00Z"))).snapshots).toEqual([
      "day:2026-09-30",
      "month:2026-09",
    ]);
    expect((await runNightly(db, new Date("2026-10-05T00:00:00Z"))).snapshots).toEqual([
      "day:2026-10-04",
      "week:2026-W40",
    ]);
    const month = await readSnapshot(db, "endless", "month", "2026-09");
    expect(month?.entries.map((e) => e.streak)).toEqual([21, 8]);
    // W40 is Mon 28 Sep to Sun 4 Oct: it holds the 30th and the 4th.
    expect((await readSnapshot(db, "endless", "week", "2026-W40"))?.total).toBe(2);
  });

  it("closes ISO week 53 across the new year, and December on the 1st", async () => {
    const db = sqliteD1();
    await add(db, 20261228, 5);
    await add(db, 20261231, 6);
    await add(db, 20270101, 7);
    await add(db, 20270103, 8);
    expect((await runNightly(db, new Date("2027-01-01T00:00:00Z"))).snapshots).toEqual([
      "day:2026-12-31",
      "month:2026-12",
    ]);
    expect((await runNightly(db, new Date("2027-01-04T00:00:00Z"))).snapshots).toEqual([
      "day:2027-01-03",
      "week:2026-W53",
    ]);
    expect((await readSnapshot(db, "endless", "month", "2026-12"))?.total).toBe(2);
    expect((await readSnapshot(db, "endless", "week", "2026-W53"))?.total).toBe(4);
  });

  it("takes the same snapshot again at 01:30, including a late publish", async () => {
    const db = sqliteD1();
    await add(db, 20260929, 12);
    await runNightly(db, new Date("2026-09-30T00:00:00Z"));
    // A run started at 23:58 on the 29th, published at 00:40 on the 30th.
    await add(db, 20260929, 40);
    const again = await runNightly(db, new Date("2026-09-30T01:30:00Z"));
    expect(again.snapshots).toEqual(["day:2026-09-29"]);
    expect(snapshots(db)).toEqual([{ period: "day", period_key: "2026-09-29", total: 2 }]);
    const day = await readSnapshot(db, "endless", "day", "2026-09-29");
    expect(day?.entries[0]?.streak).toBe(40);
    expect(day?.takenAt).toBe(Date.parse("2026-09-30T01:30:00Z"));
  });

  it("keeps the top 50 in a snapshot, and the full total", async () => {
    const db = sqliteD1();
    for (let i = 0; i < 64; i += 1) await add(db, 20260929, i + 1);
    await runNightly(db, new Date("2026-09-30T00:00:00Z"));
    const day = await readSnapshot(db, "endless", "day", "2026-09-29");
    expect(day?.entries).toHaveLength(BOARD_SIZE);
    expect(day?.entries[0]).toMatchObject({ rank: 1, streak: 64 });
    expect(day?.entries.at(-1)).toMatchObject({ rank: 50, streak: 15 });
    expect(day?.total).toBe(64);
  });

  it("keeps each entry's flag, tie and tiebreak in the snapshot, for the winner line", async () => {
    const db = sqliteD1();
    await add(db, 20260929, 20, "slow", { thinkMs: 9000, country: "BR" });
    await add(db, 20260929, 20, "quick", { thinkMs: 5000, country: "JP" });
    await add(db, 20260929, 7, "solo", { country: null });
    await runNightly(db, new Date("2026-09-30T00:00:00Z"));
    const day = await readSnapshot(db, "endless", "day", "2026-09-29");
    expect(day?.entries.map((e) => [e.rank, e.streak, e.tied, e.thinkMs, e.country])).toEqual([
      [1, 20, true, 5000, "JP"],
      [2, 20, true, 9000, "BR"],
      [3, 7, false, null, null],
    ]);
  });

  it("leaves shadowed scores out of the snapshot", async () => {
    const db = sqliteD1();
    await add(db, 20260929, 12);
    await add(db, 20260929, 90);
    db.exec("UPDATE scores SET shadow = 1 WHERE streak = 90");
    await runNightly(db, new Date("2026-09-30T00:00:00Z"));
    const day = await readSnapshot(db, "endless", "day", "2026-09-29");
    expect(day?.total).toBe(1);
    expect(day?.entries.map((e) => e.streak)).toEqual([12]);
  });

  it(`prunes scores from runs started more than ${RETAIN_DAYS} days before`, async () => {
    const db = sqliteD1();
    await add(db, 20260621, 1); // 101 days before 30 Sep
    await add(db, 20260622, 2); // exactly 100
    await add(db, 20260929, 3);
    const done = await runNightly(db, new Date("2026-09-30T00:00:00Z"));
    expect(done.pruned).toBe(1);
    expect(db.rows<{ day_key: number }>("SELECT day_key FROM scores ORDER BY day_key")).toEqual([
      { day_key: 20260622 },
      { day_key: 20260929 },
    ]);
  });
});
