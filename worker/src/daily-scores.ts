/**
 * Daily Ranked's board in D1 (ARCHITECTURE.md §10): every statement that
 * reads or writes `daily_entries`, `ranked_attempts` and `daily_connections`,
 * over the same structural D1 type as scores.ts, so it runs under test on
 * Node's SQLite with the real migrations.
 *
 * **An entry is made when a run starts**, with its name: the name is reserved
 * for the game then, and the device's one attempt used, in one atomic batch,
 * so a refused or taken name uses nothing. **It is finished when the run
 * ends**, with the score, the thinking time and the right/wrong marks: there
 * is no submit step. Only finished entries are on the board.
 *
 * **The order**: the score, then the lower thinking time, then who finished
 * first; the id settles the rest. One entry per device per game, so no
 * per-device best is needed. Shadowed entries are left out of everyone's
 * board and every total, but their owner is ranked as if they counted; a
 * retired name comes back null.
 */

import { BOARD_SIZE, DAILY_QUESTIONS } from "@bt/core";
import type { DailyBoardEntry, DailyResult, RunEnd } from "@bt/core";
import type { D1Like } from "./scores.js";

/** A new entry, at the run's start. */
export interface NewEntry {
  readonly id: string;
  readonly gameNo: number;
  readonly runKey: string;
  readonly deviceHash: string;
  readonly nickname: string;
  readonly nicknameNormalised: string;
  readonly country: string | null;
  readonly startedAt: number;
}

/** Why a start's entry couldn't be made. */
export type EntryRefusal = "already_played" | "name_taken";

/**
 * Uses the device's attempt and reserves the name, together or not at all.
 * Refused when the device has already played the game, or the name is taken
 * in it; then nothing is written.
 */
export async function claimEntry(
  db: D1Like,
  entry: NewEntry,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: EntryRefusal }> {
  try {
    await db.batch([
      db
        .prepare("INSERT INTO ranked_attempts (device_hash, game_no) VALUES (?1, ?2)")
        .bind(entry.deviceHash, entry.gameNo),
      db
        .prepare(
          "INSERT INTO daily_entries (id, game_no, run_key, device_hash, nickname, " +
            "nickname_normalised, country, started_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )
        .bind(
          entry.id,
          entry.gameNo,
          entry.runKey,
          entry.deviceHash,
          entry.nickname,
          entry.nicknameNormalised,
          entry.country,
          entry.startedAt,
        ),
    ]);
    return { ok: true };
  } catch (err) {
    if (!(err instanceof Error) || !/UNIQUE|PRIMARY KEY|constraint/i.test(err.message)) throw err;
    if (await hasPlayed(db, entry.deviceHash, entry.gameNo)) {
      return { ok: false, reason: "already_played" };
    }
    const taken = await db
      .prepare(
        "SELECT 1 AS taken FROM daily_entries WHERE game_no = ?1 AND nickname_normalised = ?2",
      )
      .bind(entry.gameNo, entry.nicknameNormalised)
      .first<{ taken: number }>();
    if (taken !== null) return { ok: false, reason: "name_taken" };
    throw err;
  }
}

/** Undoes a start whose run couldn't be begun: the attempt and the name are given back. */
export async function releaseEntry(db: D1Like, entry: NewEntry): Promise<void> {
  await db.batch([
    db
      .prepare("DELETE FROM ranked_attempts WHERE device_hash = ?1 AND game_no = ?2")
      .bind(entry.deviceHash, entry.gameNo),
    db.prepare("DELETE FROM daily_entries WHERE run_key = ?1").bind(entry.runKey),
  ]);
}

export async function hasPlayed(db: D1Like, deviceHash: string, gameNo: number): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS played FROM ranked_attempts WHERE device_hash = ?1 AND game_no = ?2")
    .bind(deviceHash, gameNo)
    .first<{ played: number }>();
  return row !== null;
}

/** What a finished run writes to its entry. */
export interface Finish {
  readonly runKey: string;
  readonly score: number;
  readonly correct: number;
  readonly bonus: number;
  readonly thinkMs: number;
  readonly results: readonly boolean[];
  readonly end: RunEnd;
  readonly finishedAt: number;
  readonly shadow: boolean;
  readonly shadowReason: string | null;
}

/**
 * Finishes a run's entry, once: a second call (a resend, the alarm's retry)
 * changes nothing. False when it had already been finished.
 */
export async function finishEntry(db: D1Like, finish: Finish): Promise<boolean> {
  const result = await db
    .prepare(
      "UPDATE daily_entries SET finished_at = ?2, score = ?3, correct = ?4, bonus = ?5, " +
        "think_ms = ?6, results = ?7, end_reason = ?8, shadow = ?9, shadow_reason = ?10 " +
        "WHERE run_key = ?1 AND finished_at IS NULL",
    )
    .bind(
      finish.runKey,
      finish.finishedAt,
      finish.score,
      finish.correct,
      finish.bonus,
      finish.thinkMs,
      encodeResults(finish.results),
      finish.end,
      finish.shadow ? 1 : 0,
      finish.shadowReason,
    )
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/** "1101…": right or wrong per question, as stored. */
export function encodeResults(results: readonly boolean[]): string {
  return results.map((r) => (r ? "1" : "0")).join("");
}

export function decodeResults(text: string | null): boolean[] {
  return text === null ? [] : Array.from(text, (c) => c === "1");
}

/** An entry as stored, for its owner. */
export interface EntryRow {
  readonly id: string;
  readonly game_no: number;
  readonly run_key: string;
  readonly nickname: string;
  readonly name_flagged: number;
  readonly country: string | null;
  readonly started_at: number;
  readonly finished_at: number | null;
  readonly score: number | null;
  readonly correct: number | null;
  readonly bonus: number | null;
  readonly think_ms: number | null;
  readonly results: string | null;
  readonly end_reason: string | null;
  readonly shadow: number;
}

const ENTRY_COLUMNS =
  "id, game_no, run_key, nickname, name_flagged, country, started_at, finished_at, score, " +
  "correct, bonus, think_ms, results, end_reason, shadow";

/** This device's entry in a game, or undefined. */
export async function deviceEntry(
  db: D1Like,
  deviceHash: string,
  gameNo: number,
): Promise<EntryRow | undefined> {
  const row = await db
    .prepare(`SELECT ${ENTRY_COLUMNS} FROM daily_entries WHERE game_no = ?1 AND device_hash = ?2`)
    .bind(gameNo, deviceHash)
    .first<EntryRow>();
  return row ?? undefined;
}

/**
 * This device's run still being played, in game `gameNo` or the one before
 * (a run started at 23:58 is played on past midnight): what resume carries on.
 */
export async function unfinishedEntry(
  db: D1Like,
  deviceHash: string,
  gameNo: number,
): Promise<EntryRow | undefined> {
  const row = await db
    .prepare(
      `SELECT ${ENTRY_COLUMNS} FROM daily_entries WHERE device_hash = ?1 ` +
        "AND game_no IN (?2, ?3) AND finished_at IS NULL ORDER BY game_no DESC LIMIT 1",
    )
    .bind(deviceHash, gameNo, gameNo - 1)
    .first<EntryRow>();
  return row ?? undefined;
}

/** The public order: score, then the lower thinking time, then who finished first. */
const ORDER = "score DESC, think_ms ASC, finished_at ASC, id ASC";

/** A game's finished, public entries. */
const PUBLIC = "game_no = ?1 AND finished_at IS NOT NULL AND shadow = 0";

interface BoardRow {
  readonly id: string;
  readonly nickname: string;
  readonly name_flagged: number;
  readonly score: number;
  readonly correct: number;
  readonly bonus: number;
  readonly think_ms: number;
  readonly country: string | null;
  readonly same: number;
}

function toEntry(row: BoardRow, rank: number): DailyBoardEntry {
  const tied = row.same > 1;
  return {
    id: row.id,
    rank,
    nickname: row.name_flagged === 1 ? null : row.nickname,
    score: row.score,
    perfect: row.correct === DAILY_QUESTIONS,
    bonus: row.bonus,
    tied,
    thinkMs: tied ? row.think_ms : null,
    country: row.country,
  };
}

/**
 * A game's public board, best first, and how many finished it. An entry is
 * `tied` when another public entry has the same score — anywhere on the
 * board, not just among those returned — and only then carries its time.
 */
export async function dailyBoard(
  db: D1Like,
  gameNo: number,
  limit = BOARD_SIZE,
): Promise<{ entries: DailyBoardEntry[]; total: number }> {
  const [top, count] = await Promise.all([
    db
      .prepare(
        "WITH board AS (SELECT id, nickname, name_flagged, score, correct, bonus, think_ms, " +
          "finished_at, country, COUNT(*) OVER (PARTITION BY score) AS same " +
          `FROM daily_entries WHERE ${PUBLIC}) ` +
          `SELECT * FROM board ORDER BY ${ORDER} LIMIT ?2`,
      )
      .bind(gameNo, limit)
      .all<BoardRow>(),
    db
      .prepare(`SELECT COUNT(*) AS total FROM daily_entries WHERE ${PUBLIC}`)
      .bind(gameNo)
      .first<{ total: number }>(),
  ]);
  return {
    entries: top.results.map((r, i) => toEntry(r, i + 1)),
    total: count?.total ?? 0,
  };
}

/**
 * Where a finished entry stands, as its owner sees it, shadowed or not: its
 * rank among everyone else's public entries, out of those and itself.
 */
export async function entryStanding(
  db: D1Like,
  entry: EntryRow,
): Promise<{ readonly rank: number; readonly total: number; readonly row: DailyBoardEntry }> {
  if (entry.finished_at === null || entry.score === null || entry.think_ms === null) {
    throw new Error("entryStanding needs a finished entry");
  }
  const beats =
    "score > ?3 OR (score = ?3 AND (think_ms < ?4 OR (think_ms = ?4 AND " +
    "(finished_at < ?5 OR (finished_at = ?5 AND id < ?2)))))";
  const counts = await db
    .prepare(
      "SELECT COUNT(*) AS others, " +
        `COALESCE(SUM(CASE WHEN ${beats} THEN 1 ELSE 0 END), 0) AS better, ` +
        "COALESCE(SUM(CASE WHEN score = ?3 THEN 1 ELSE 0 END), 0) AS same " +
        `FROM daily_entries WHERE ${PUBLIC} AND id != ?2`,
    )
    .bind(entry.game_no, entry.id, entry.score, entry.think_ms, entry.finished_at)
    .first<{ others: number; better: number; same: number }>();
  const rank = (counts?.better ?? 0) + 1;
  const total = (counts?.others ?? 0) + 1;
  const row = toEntry(
    {
      id: entry.id,
      nickname: entry.nickname,
      name_flagged: entry.name_flagged,
      score: entry.score,
      correct: entry.correct ?? 0,
      bonus: entry.bonus ?? 0,
      think_ms: entry.think_ms,
      country: entry.country,
      same: (counts?.same ?? 0) + 1,
    },
    rank,
  );
  return { rank, total, row };
}

/** A finished entry as its player sees it: the result, ranked. */
export async function entryResult(
  db: D1Like,
  entry: EntryRow,
): Promise<{ readonly result: DailyResult; readonly standing: DailyBoardEntry }> {
  const { rank, total, row } = await entryStanding(db, entry);
  return {
    result: {
      gameNo: entry.game_no,
      score: entry.score ?? 0,
      correct: entry.correct ?? 0,
      bonus: entry.bonus ?? 0,
      results: decodeResults(entry.results),
      end: (entry.end_reason ?? "finished") as RunEnd,
      nickname: entry.name_flagged === 1 ? null : entry.nickname,
      rank,
      total,
    },
    standing: row,
  };
}

export async function entryByRunKey(db: D1Like, runKey: string): Promise<EntryRow | undefined> {
  const row = await db
    .prepare(`SELECT ${ENTRY_COLUMNS} FROM daily_entries WHERE run_key = ?1`)
    .bind(runKey)
    .first<EntryRow>();
  return row ?? undefined;
}

/**
 * Counts a run start's connection: stores its salted hash and says how many
 * runs of the game had already started from it. Measurement only — nothing
 * reads it but the start's log line and data point.
 */
export async function countConnection(
  db: D1Like,
  gameNo: number,
  ipHash: string,
  runKey: string,
  now: number,
): Promise<number> {
  const before = await db
    .prepare("SELECT COUNT(*) AS n FROM daily_connections WHERE game_no = ?1 AND ip_hash = ?2")
    .bind(gameNo, ipHash)
    .first<{ n: number }>();
  await db
    .prepare(
      "INSERT INTO daily_connections (game_no, ip_hash, run_key, created_at) VALUES (?1, ?2, ?3, ?4)",
    )
    .bind(gameNo, ipHash, runKey, now)
    .run();
  return before?.n ?? 0;
}

/** What the nightly prune removed. */
export interface DailyPruned {
  readonly entries: number;
  readonly games: number;
  readonly attempts: number;
  readonly connections: number;
}

/**
 * Entries from before game `entriesBefore` (the scores' 100-day rule), games
 * and attempts from before `gamesBefore`, and connection hashes older than
 * `connectionsBefore` (ms). Snapshots are kept.
 */
export async function pruneDaily(
  db: D1Like,
  cutoffs: {
    readonly entriesBefore: number;
    readonly gamesBefore: number;
    readonly connectionsBefore: number;
  },
): Promise<DailyPruned> {
  const run = async (sql: string, value: number): Promise<number> =>
    (await db.prepare(sql).bind(value).run()).meta?.changes ?? 0;
  return {
    entries: await run("DELETE FROM daily_entries WHERE game_no < ?1", cutoffs.entriesBefore),
    games: await run("DELETE FROM daily_games WHERE game_no < ?1", cutoffs.gamesBefore),
    attempts: await run("DELETE FROM ranked_attempts WHERE game_no < ?1", cutoffs.gamesBefore),
    connections: await run(
      "DELETE FROM daily_connections WHERE created_at < ?1",
      cutoffs.connectionsBefore,
    ),
  };
}
