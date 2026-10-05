/**
 * A device's live standing (`POST /api/board/endless/me`, mine.ts) over real
 * SQL: its best entry in each current period, ranked as its owner sees it.
 */

import { describe, expect, it } from "vitest";
import { handleMine, parseMine } from "../mine.js";
import { insertScore } from "../scores.js";
import type { ScoreRow } from "../scores.js";
import { hashDevice } from "../submit.js";
import { sqliteD1 } from "./d1-sqlite.js";
import type { TestD1 } from "./d1-sqlite.js";
import { SECRET } from "./helpers.js";

const DEVICE = "3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b";
/** Monday 5 October 2026, so the week and the month both start today or before. */
const NOW = new Date("2026-10-05T15:00:00Z");

let n = 0;
async function add(db: TestD1, over: Partial<ScoreRow> & { device: string }): Promise<string> {
  n += 1;
  const { device, ...rest } = over;
  const id = `id-${n}`;
  await insertScore(db, {
    id,
    mode: "endless",
    dayKey: 20261005,
    nickname: `Player${n}`,
    nicknameNormalised: "player",
    streak: 10,
    elapsedMs: 60_000,
    deviceHash: device,
    runKey: `run-${n}`,
    createdAt: n,
    shadow: false,
    shadowReason: null,
    ...rest,
  });
  return id;
}

const mine = (db: TestD1, deviceId = DEVICE) =>
  handleMine({ deviceId }, { db, secret: SECRET, clock: () => NOW });

async function ok(db: TestD1, deviceId = DEVICE) {
  const result = await mine(db, deviceId);
  if (result.status !== 200) throw new Error(`expected 200: ${JSON.stringify(result)}`);
  return result.body.periods;
}

describe("a device's live standing", () => {
  it("is its rank now, counting everyone who has published since", async () => {
    const db = sqliteD1();
    const me = await hashDevice(SECRET, DEVICE);
    const id = await add(db, { device: me, streak: 4, nickname: "LowScore" });
    // Alone on the board when it published: 1st of 1.
    expect((await ok(db)).day).toMatchObject({ entryId: id, rank: 1, total: 1 });
    // 150 better runs and 42 worse ones since.
    for (let i = 0; i < 150; i += 1) await add(db, { device: `better${i}`, streak: 5 + (i % 30) });
    for (let i = 0; i < 42; i += 1) await add(db, { device: `worse${i}`, streak: 1 + (i % 3) });
    expect((await ok(db)).day).toEqual({
      key: "2026-10-05",
      entryId: id,
      rank: 151,
      total: 193,
      streak: 4,
      nickname: "LowScore",
    });
  });

  it("ranks a shadowed device as if it counted, and nobody else sees it", async () => {
    const db = sqliteD1();
    const me = await hashDevice(SECRET, DEVICE);
    await add(db, { device: me, streak: 12, shadow: true, shadowReason: "fast" });
    await add(db, { device: "a", streak: 20 });
    await add(db, { device: "b", streak: 5 });
    expect((await ok(db)).day).toMatchObject({ rank: 2, total: 3, streak: 12 });
    // Another device's view of the same board doesn't count the shadowed one.
    const other = "7d6c5b4a-3e2f-4a1b-8c9d-0e1f2a3b4c5d";
    await add(db, { device: await hashDevice(SECRET, other), streak: 8 });
    expect((await ok(db, other)).day).toMatchObject({ rank: 2, total: 3 });
  });

  it("takes each period's best: an earlier day this month can beat today", async () => {
    const db = sqliteD1();
    const me = await hashDevice(SECRET, DEVICE);
    await add(db, { device: me, streak: 9, dayKey: 20261005 });
    const better = await add(db, { device: me, streak: 30, dayKey: 20261001 });
    const periods = await ok(db);
    expect(periods.day).toMatchObject({ streak: 9, key: "2026-10-05" });
    // The week of Monday 5 October started today; 1 October is in last week.
    expect(periods.week).toMatchObject({ streak: 9, key: "2026-W41" });
    expect(periods.month).toMatchObject({ entryId: better, streak: 30, key: "2026-10" });
  });

  it("is null for a period the device has nothing in, and for a stranger", async () => {
    const db = sqliteD1();
    const me = await hashDevice(SECRET, DEVICE);
    await add(db, { device: me, dayKey: 20261001 });
    expect(await ok(db)).toMatchObject({ day: null, week: null });
    expect((await ok(db)).month).not.toBeNull();
    const stranger = "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";
    expect(await ok(db, stranger)).toEqual({ day: null, week: null, month: null });
  });

  it("never gives out a retired name", async () => {
    const db = sqliteD1();
    const me = await hashDevice(SECRET, DEVICE);
    const id = await add(db, { device: me, nickname: "Rude" });
    db.exec(`UPDATE scores SET name_flagged = 1 WHERE id = '${id}'`);
    expect((await ok(db)).day).toMatchObject({ entryId: id, nickname: null });
    expect(JSON.stringify(await ok(db))).not.toContain("Rude");
  });

  it("answers its limit before reading anything", async () => {
    const db = sqliteD1();
    const result = await handleMine(
      { deviceId: DEVICE },
      { db, secret: SECRET, clock: () => NOW, limit: async () => ({ ok: false, retryAfter: 60 }) },
    );
    expect(result).toMatchObject({ status: 429, retryAfter: 60 });
  });
});

describe("parseMine", () => {
  it("takes exactly { deviceId }, a v4 uuid", () => {
    expect(parseMine({ deviceId: DEVICE })).toEqual({ deviceId: DEVICE });
    for (const body of [
      null,
      [],
      "x",
      {},
      { deviceId: "nope" },
      { deviceId: DEVICE.toUpperCase() },
      { deviceId: DEVICE, nickname: "x" },
    ]) {
      expect(parseMine(body), JSON.stringify(body)).toBeUndefined();
    }
  });
});
