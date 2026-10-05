/**
 * The boards in D1 (ARCHITECTURE.md §10): every statement that reads or writes
 * `scores` and `board_snapshots`, over a structural D1 type so the same SQL
 * runs under test in Node on SQLite (`__tests__/d1-sqlite.ts`, the real
 * migrations) and in workerd on D1.
 *
 * **One entry per device per period.** A board is each device's single best
 * run in the period — highest streak, then the lower server-measured time,
 * then the earlier publish — ranked in that same order. Weeks and months are
 * ranges of `day_key`, never stored separately.
 *
 * **Shadowed scores** are left out of everyone's board and every total, but
 * their owner is ranked as if they counted (`ownStanding`): the player sees
 * an ordinary rank, and nobody else sees them.
 *
 * **Retired names** (`name_flagged`) come back as `null`, so the name itself
 * never leaves the database; the page shows "Retired name".
 */

import { BOARD_SIZE } from "@bt/core";
import type { BoardEntry } from "@bt/core";

/** The parts of a D1 prepared statement used here. */
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ meta?: { changes?: number } }>;
}

/** The parts of the D1 binding used here, typed structurally for Node tests. */
export interface D1Like {
  prepare(sql: string): D1Statement;
  batch(statements: D1Statement[]): Promise<unknown[]>;
}

export type BoardMode = "endless";

/** How many entries a board shows (@bt/core): 50. */
export { BOARD_SIZE };

/** One published run, as stored. */
export interface ScoreRow {
  readonly id: string;
  readonly mode: BoardMode;
  readonly dayKey: number;
  readonly nickname: string;
  readonly nicknameNormalised: string;
  readonly streak: number;
  /** Server-measured thinking time (shadow.ts `thinkMs`): the tiebreak on equal streaks. */
  readonly thinkMs: number;
  /** The flag's country code (@bt/core `flagCountry`), or null: unknown, or not shown. */
  readonly country: string | null;
  readonly deviceHash: string;
  /** The run key (`YYYYMMDD-<uuid>`), never the signed run id. */
  readonly runKey: string;
  readonly createdAt: number;
  readonly shadow: boolean;
  /** The heuristics that fired, comma-joined; null when none. */
  readonly shadowReason: string | null;
}

/** A day-key range, inclusive: one day, an ISO week or a month. */
export interface DayRange {
  readonly from: number;
  readonly to: number;
}

/** The run was already published: its run key is taken. */
export class DuplicateRunError extends Error {
  constructor() {
    super("run already published");
    this.name = "DuplicateRunError";
  }
}

export async function insertScore(db: D1Like, row: ScoreRow): Promise<void> {
  try {
    await db
      .prepare(
        "INSERT INTO scores (id, mode, day_key, nickname, nickname_normalised, streak, " +
          "think_ms, country, device_hash, run_id, created_at, shadow, shadow_reason) " +
          "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
      )
      .bind(
        row.id,
        row.mode,
        row.dayKey,
        row.nickname,
        row.nicknameNormalised,
        row.streak,
        row.thinkMs,
        row.country,
        row.deviceHash,
        row.runKey,
        row.createdAt,
        row.shadow ? 1 : 0,
        row.shadowReason,
      )
      .run();
  } catch (err) {
    if (err instanceof Error && /UNIQUE constraint failed: scores\.run_id/.test(err.message)) {
      throw new DuplicateRunError();
    }
    throw err;
  }
}

/**
 * The public order: streak, then the lower thinking time, then who published
 * first; the id settles the rest.
 */
const ORDER = "streak DESC, think_ms ASC, created_at ASC, id ASC";

/** Each device's best row in a range, public rows only: `n = 1` is the best. */
const BESTS =
  "SELECT id, nickname, name_flagged, streak, think_ms, created_at, country, device_hash, " +
  `ROW_NUMBER() OVER (PARTITION BY device_hash ORDER BY ${ORDER}) AS n ` +
  "FROM scores WHERE mode = ?1 AND day_key BETWEEN ?2 AND ?3 AND shadow = 0";

/**
 * A range's public board, best first, and how many devices are on it. An
 * entry is `tied` when another device's public best in the range has the same
 * streak — judged across the whole range, not just the entries returned — and
 * only a tied entry carries its thinking time, the one thing that orders it.
 */
export async function publicBoard(
  db: D1Like,
  mode: BoardMode,
  range: DayRange,
  limit = BOARD_SIZE,
): Promise<{ entries: BoardEntry[]; total: number }> {
  const [top, count] = await Promise.all([
    db
      .prepare(
        `WITH bests AS (${BESTS}), ` +
          "ranked AS (SELECT *, COUNT(*) OVER (PARTITION BY streak) AS same " +
          "FROM bests WHERE n = 1) " +
          "SELECT id, nickname, name_flagged, streak, think_ms, country, same FROM ranked " +
          `ORDER BY ${ORDER} LIMIT ?4`,
      )
      .bind(mode, range.from, range.to, limit)
      .all<{
        id: string;
        nickname: string;
        name_flagged: number;
        streak: number;
        think_ms: number;
        country: string | null;
        same: number;
      }>(),
    db
      .prepare(
        "SELECT COUNT(DISTINCT device_hash) AS total FROM scores " +
          "WHERE mode = ?1 AND day_key BETWEEN ?2 AND ?3 AND shadow = 0",
      )
      .bind(mode, range.from, range.to)
      .first<{ total: number }>(),
  ]);
  return {
    entries: top.results.map((r, i) => ({
      id: r.id,
      rank: i + 1,
      nickname: r.name_flagged === 1 ? null : r.nickname,
      streak: r.streak,
      tied: r.same > 1,
      thinkMs: r.same > 1 ? r.think_ms : null,
      country: r.country,
    })),
    total: count?.total ?? 0,
  };
}

/** A device's place in a range, as the device itself sees it. */
export interface Standing {
  /** The device's best entry in the range. */
  readonly entryId: string;
  readonly streak: number;
  /** That entry's name; null once retired, so a retired name never leaves the database. */
  readonly nickname: string | null;
  /** That entry's flag's country code, or null. A retired name keeps its flag. */
  readonly country: string | null;
  /** 1 + the devices whose public best beats it. */
  readonly rank: number;
  /** The other devices on the public board, plus this one. */
  readonly total: number;
  /** Another device's public best in the range has the same streak. */
  readonly tied: boolean;
  /** Its thinking time, the tiebreak; given only when tied, as on the board. */
  readonly thinkMs: number | null;
}

/**
 * Where a device's best in the range stands, counting its own rows even if
 * shadowed: its rank among everyone else's public bests, out of those and
 * itself. Undefined if the device has no entry in the range.
 */
export async function ownStanding(
  db: D1Like,
  mode: BoardMode,
  deviceHash: string,
  range: DayRange,
): Promise<Standing | undefined> {
  const best = await db
    .prepare(
      "SELECT id, streak, think_ms, created_at, nickname, name_flagged, country FROM scores " +
        `WHERE mode = ?1 AND device_hash = ?2 AND day_key BETWEEN ?3 AND ?4 ORDER BY ${ORDER} LIMIT 1`,
    )
    .bind(mode, deviceHash, range.from, range.to)
    .first<{
      id: string;
      streak: number;
      think_ms: number;
      created_at: number;
      nickname: string;
      name_flagged: number;
      country: string | null;
    }>();
  if (best === null) return undefined;
  const beats =
    "streak > ?5 OR (streak = ?5 AND (think_ms < ?6 OR (think_ms = ?6 AND " +
    "(created_at < ?7 OR (created_at = ?7 AND id < ?8)))))";
  const [counts, same] = await Promise.all([
    db
      .prepare(
        "SELECT COUNT(DISTINCT device_hash) AS others, " +
          `COUNT(DISTINCT CASE WHEN ${beats} THEN device_hash END) AS better ` +
          "FROM scores WHERE mode = ?1 AND day_key BETWEEN ?2 AND ?3 AND shadow = 0 " +
          "AND device_hash != ?4",
      )
      .bind(
        mode,
        range.from,
        range.to,
        deviceHash,
        best.streak,
        best.think_ms,
        best.created_at,
        best.id,
      )
      .first<{ others: number; better: number }>(),
    // Others whose best, not just any run, has the same streak.
    db
      .prepare(
        `WITH bests AS (${BESTS} AND device_hash != ?4) ` +
          "SELECT COUNT(*) AS tied FROM bests WHERE n = 1 AND streak = ?5",
      )
      .bind(mode, range.from, range.to, deviceHash, best.streak)
      .first<{ tied: number }>(),
  ]);
  const tied = (same?.tied ?? 0) > 0;
  return {
    entryId: best.id,
    streak: best.streak,
    nickname: best.name_flagged === 1 ? null : best.nickname,
    country: best.country,
    rank: (counts?.better ?? 0) + 1,
    total: (counts?.others ?? 0) + 1,
    tied,
    thinkMs: tied ? best.think_ms : null,
  };
}

export interface Snapshot {
  readonly takenAt: number;
  readonly total: number;
  readonly entries: readonly BoardEntry[];
}

/** Stores a closed period's board, replacing any earlier snapshot of it. */
export async function saveSnapshot(
  db: D1Like,
  mode: BoardMode,
  period: string,
  key: string,
  snapshot: Snapshot,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO board_snapshots (mode, period, period_key, taken_at, total, entries) " +
        "VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT (mode, period, period_key) DO UPDATE SET " +
        "taken_at = excluded.taken_at, total = excluded.total, entries = excluded.entries",
    )
    .bind(mode, period, key, snapshot.takenAt, snapshot.total, JSON.stringify(snapshot.entries))
    .run();
}

export async function readSnapshot(
  db: D1Like,
  mode: BoardMode,
  period: string,
  key: string,
): Promise<Snapshot | undefined> {
  const row = await db
    .prepare(
      "SELECT taken_at, total, entries FROM board_snapshots " +
        "WHERE mode = ?1 AND period = ?2 AND period_key = ?3",
    )
    .bind(mode, period, key)
    .first<{ taken_at: number; total: number; entries: string }>();
  if (row === null) return undefined;
  return {
    takenAt: row.taken_at,
    total: row.total,
    entries: JSON.parse(row.entries) as BoardEntry[],
  };
}

/** Whether an entry's name has been retired since, e.g. after its snapshot was taken. */
export async function isNameFlagged(db: D1Like, id: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT name_flagged FROM scores WHERE id = ?1")
    .bind(id)
    .first<{ name_flagged: number }>();
  return row?.name_flagged === 1;
}

/** Deletes every score from before `beforeDayKey`; how many went. */
export async function pruneScores(db: D1Like, beforeDayKey: number): Promise<number> {
  const result = await db.prepare("DELETE FROM scores WHERE day_key < ?1").bind(beforeDayKey).run();
  return result.meta?.changes ?? 0;
}
