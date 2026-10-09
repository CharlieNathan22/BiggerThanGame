/**
 * `RunDO`: one Durable Object per Endless run (ARCHITECTURE.md §8). Wiring
 * only — the rules are the ledger's (src/run-ledger.ts), tested in Node — like
 * index.ts is for the app.
 *
 * SQLite-backed (the `new_sqlite_classes` migration in wrangler.toml), so it
 * runs on the free plan. Two tables: `run`, one row holding the run's record,
 * and `answers`, one row per accepted answer with its server-measured time.
 * The Worker reaches it by RPC with the run key as its name, so every request
 * for one run meets the same object, one at a time.
 *
 * A Daily Ranked run (src/daily-ledger.ts) lives in an object of the same
 * class, under its own tables (`daily_run`, `daily_answers`): its alarm
 * finishes a run left quiet for `IDLE_FINISH_MS` and posts it to the board,
 * retries a post that failed, and deletes the run's storage hours later.
 *
 * A Twitch Mode match (src/stream-ledger.ts) lives in one too, under a table
 * of its own (`stream_run`): no Durable Object migration either. Its alarm is
 * Endless's: a match left silent past its deadline is closed as
 * `disconnected`, and its storage goes hours later.
 *
 * Endless's alarm does two jobs. While a question is open it is set a little past
 * the deadline: if no answer has come by then, the run is closed as
 * `disconnected`, keeping the streak it had verified, and its end is logged and
 * recorded like any other. Once the run is over it is set `RETAIN_MS` after the
 * last activity, and deletes everything, so runs don't accumulate.
 */

import { DurableObject } from "cloudflare:workers";
import { toDataPoint, toLogLine } from "./src/analytics.js";
import type { GameEvent } from "./src/analytics.js";
import type { Env } from "./src/app.js";
import { recordPost } from "./src/daily.js";
import { DailyLedger } from "./src/daily-ledger.js";
import type {
  DailyAdvanceResult,
  DailyAnswer,
  DailyLedgerStore,
  DailyResumeResult,
  DailyRunRecord,
  DailyStep,
  NewDailyRun,
} from "./src/daily-ledger.js";
import { postDailyRun } from "./src/daily-post.js";
import { DECK } from "./src/deck.js";
import { log } from "./src/log.js";
import { RunLedger } from "./src/run-ledger.js";
import type {
  AdvanceResult,
  AnswerRecord,
  ClaimResult,
  LedgerStore,
  NewRun,
  RunRecord,
  Step,
  SubmitClaim,
} from "./src/run-ledger.js";
import { disconnectedEnd } from "./src/run.js";
import { streamDisconnectedEnd } from "./src/stream.js";
import { StreamLedger } from "./src/stream-ledger.js";
import type {
  NewStreamRun,
  StreamAdvanceResult,
  StreamLedgerStore,
  StreamRunRecord,
  StreamStep,
} from "./src/stream-ledger.js";

export class RunDO extends DurableObject<Env> {
  readonly #ledger: RunLedger;
  readonly #daily: DailyLedger;
  readonly #stream: StreamLedger;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#ledger = new RunLedger(sqlStore(ctx.storage.sql));
    this.#daily = new DailyLedger(dailySqlStore(ctx.storage.sql));
    this.#stream = new StreamLedger(streamSqlStore(ctx.storage.sql));
  }

  // ------------------------------------------------------------- Twitch Mode

  async streamBegin(first: NewStreamRun): Promise<boolean> {
    const begun = this.#stream.begin(first);
    await this.#scheduleStream();
    return begun;
  }

  async streamAdvance(step: StreamStep): Promise<StreamAdvanceResult> {
    const result = this.#stream.advance(step);
    await this.#scheduleStream();
    return result;
  }

  async #scheduleStream(): Promise<void> {
    const at = this.#stream.alarmAt();
    if (at === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(at);
  }

  /** A match's alarm: close it if it went silent, or delete it once it is old. */
  async #streamAlarm(now: number): Promise<void> {
    const action = this.#stream.onAlarm(now);
    if (action.action === "delete") {
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      return;
    }
    if (action.action === "closed") await this.#recordStreamClosed(action.run);
    await this.#scheduleStream();
  }

  /** A silent match's end, logged and recorded like any other. Never throws. */
  async #recordStreamClosed(run: StreamRunRecord): Promise<void> {
    const secret = this.env.RUN_SECRET;
    if (secret === undefined || secret === "") return;
    try {
      const event = await streamDisconnectedEnd(run, DECK, secret);
      const ctx = { country: run.country, deckVersion: run.deckVersion };
      const line = toLogLine(event, ctx, "run-do");
      if (line !== undefined) log(line);
      this.env.GAME_EVENTS?.writeDataPoint(toDataPoint(event, ctx));
    } catch {
      // Telemetry is never worth a failed alarm; the match is closed either way.
    }
  }

  // ------------------------------------------------------------ Daily Ranked

  async dailyBegin(first: NewDailyRun): Promise<DailyRunRecord | undefined> {
    const run = this.#daily.begin(first);
    await this.#scheduleDaily();
    return run;
  }

  async dailyAdvance(step: DailyStep): Promise<DailyAdvanceResult> {
    const result = this.#daily.advance(step);
    await this.#scheduleDaily();
    return result;
  }

  async dailyResume(args: {
    readonly deviceHash: string;
    readonly now: number;
    readonly nonce: string;
  }): Promise<DailyResumeResult> {
    const result = this.#daily.resume(args.deviceHash, args.now, args.nonce);
    await this.#scheduleDaily();
    return result;
  }

  /** The run is on the board: the alarm moves on to its retention. */
  async dailyPosted(): Promise<boolean> {
    const done = this.#daily.markPosted();
    await this.#scheduleDaily();
    return done;
  }

  /** Posting failed: the alarm tries again. */
  async dailyPostFailed(now: number): Promise<void> {
    this.#daily.postFailed(now);
    await this.#scheduleDaily();
  }

  async #scheduleDaily(): Promise<void> {
    const at = this.#daily.alarmAt();
    if (at === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(at);
  }

  /** A Daily run's alarm: finish it if it went quiet, post it, or delete it. */
  async #dailyAlarm(now: number): Promise<void> {
    const action = this.#daily.onAlarm(now);
    if (action.action === "delete") {
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      return;
    }
    if (action.action === "post")
      await this.#postDaily(action.run, action.answers, action.finished, now);
    await this.#scheduleDaily();
  }

  /** Posts a finished Daily run to its board; a failure leaves the alarm to try again. */
  async #postDaily(
    run: DailyRunRecord,
    answers: readonly DailyAnswer[],
    finished: boolean,
    now: number,
  ): Promise<void> {
    const ctx = { country: run.country, deckVersion: run.deckVersion };
    const record = (event: GameEvent): void => {
      try {
        const line = toLogLine(event, ctx, "run-do");
        if (line !== undefined) log(line);
        this.env.GAME_EVENTS?.writeDataPoint(toDataPoint(event, ctx));
      } catch {
        // Telemetry is never worth a failed alarm.
      }
    };
    const db = this.env.DB;
    if (db === undefined) {
      this.#daily.postFailed(now);
      return;
    }
    try {
      const posted = await postDailyRun(db, run, answers);
      this.#daily.markPosted();
      if (finished) {
        record({
          type: "end",
          mode: "ranked",
          run: run.key,
          runKind: "fresh",
          gameNo: run.gameNo,
          end: run.end ?? "abandoned",
          score: posted.result.score,
          correct: posted.result.correct,
          bonus: posted.result.bonus,
        });
      }
      if (posted.fresh) recordPost({ record, log }, run, posted);
    } catch (err) {
      this.#daily.postFailed(now);
      try {
        log({
          level: "error",
          message: "unavailable · daily_post",
          event: "unavailable",
          route: "run-do",
          reason: "daily_post",
          run: run.key,
          ...(err instanceof Error ? { cause: err.message.slice(0, 300) } : {}),
        });
      } catch {
        // As above.
      }
    }
  }

  // ----------------------------------------------------------------- Endless

  async begin(first: NewRun): Promise<boolean> {
    const begun = this.#ledger.begin(first);
    await this.#schedule();
    return begun;
  }

  async advance(step: Step): Promise<AdvanceResult> {
    const result = this.#ledger.advance(step);
    await this.#schedule();
    return result;
  }

  /** Has this run been published? Undefined for no such run. */
  isSubmitted(): boolean | undefined {
    return this.#ledger.isSubmitted();
  }

  /**
   * Checks a submission against the run (run-ledger.ts `claimForSubmit`). A
   * banked run whose question was still open is closed by the claim; its end
   * is then recorded by the submit handler, and the alarm moves on to the
   * run's retention.
   */
  async claimForSubmit(claim: SubmitClaim): Promise<ClaimResult> {
    const result = this.#ledger.claimForSubmit(claim);
    if (result.ok && result.closed) await this.#schedule();
    return result;
  }

  /** Marks a finished run published, once. */
  markSubmitted(): boolean {
    return this.#ledger.markSubmitted();
  }

  override async alarm(): Promise<void> {
    await this.onAlarm(Date.now());
  }

  /**
   * The alarm's work, as at `now`. Apart from `alarm` so the workerd tests can
   * run it at a chosen moment (worker/test/entry.ts) instead of waiting it out.
   */
  protected async onAlarm(now: number): Promise<void> {
    if (this.#daily.run !== undefined) {
      await this.#dailyAlarm(now);
      return;
    }
    if (this.#stream.run !== undefined) {
      await this.#streamAlarm(now);
      return;
    }
    const action = this.#ledger.onAlarm(now);
    if (action.action === "delete") {
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      return;
    }
    if (action.action === "closed") await this.#recordClosed(action.run);
    await this.#schedule();
  }

  async #schedule(): Promise<void> {
    const at = this.#ledger.alarmAt();
    if (at === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(at);
  }

  /** A silent run's end, logged and recorded like any other. Never throws. */
  async #recordClosed(run: RunRecord): Promise<void> {
    const secret = this.env.RUN_SECRET;
    if (secret === undefined || secret === "") return;
    try {
      const event = await disconnectedEnd(run, DECK, secret);
      const ctx = { country: run.country, deckVersion: run.deckVersion };
      const line = toLogLine(event, ctx, "run-do");
      if (line !== undefined) log(line);
      this.env.GAME_EVENTS?.writeDataPoint(toDataPoint(event, ctx));
    } catch {
      // Telemetry is never worth a failed alarm; the run is closed either way.
    }
  }
}

/** The ledger's store, over the object's own SQLite. */
function sqlStore(sql: SqlStorage): LedgerStore {
  sql.exec(
    "CREATE TABLE IF NOT EXISTS run (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL)",
  );
  sql.exec(
    "CREATE TABLE IF NOT EXISTS answers (" +
      "round INTEGER NOT NULL, nonce TEXT NOT NULL, guess TEXT NOT NULL, " +
      "issued_at INTEGER NOT NULL, received_at INTEGER NOT NULL, ms INTEGER NOT NULL, " +
      "correct INTEGER NOT NULL)",
  );
  return {
    read() {
      const row = sql.exec<{ data: string }>("SELECT data FROM run WHERE id = 1").toArray()[0];
      return row === undefined ? undefined : (JSON.parse(row.data) as RunRecord);
    },
    write(run) {
      sql.exec(
        "INSERT INTO run (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
        JSON.stringify(run),
      );
    },
    addAnswer(a) {
      sql.exec(
        "INSERT INTO answers (round, nonce, guess, issued_at, received_at, ms, correct) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?)",
        a.round,
        a.nonce,
        a.guess,
        a.issuedAt,
        a.receivedAt,
        a.ms,
        a.correct ? 1 : 0,
      );
    },
    answers() {
      return sql
        .exec<{
          round: number;
          nonce: string;
          guess: string;
          issued_at: number;
          received_at: number;
          ms: number;
          correct: number;
        }>(
          "SELECT round, nonce, guess, issued_at, received_at, ms, correct FROM answers ORDER BY round",
        )
        .toArray()
        .map((r): AnswerRecord => ({
          round: r.round,
          nonce: r.nonce,
          guess: r.guess as AnswerRecord["guess"],
          issuedAt: r.issued_at,
          receivedAt: r.received_at,
          ms: r.ms,
          correct: r.correct === 1,
        }));
    },
    clear() {
      sql.exec("DELETE FROM run");
      sql.exec("DELETE FROM answers");
    },
  };
}

/** A match's ledger store: one row, its whole record (a match has at most twenty answers). */
function streamSqlStore(sql: SqlStorage): StreamLedgerStore {
  sql.exec(
    "CREATE TABLE IF NOT EXISTS stream_run (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL)",
  );
  return {
    read() {
      const row = sql
        .exec<{ data: string }>("SELECT data FROM stream_run WHERE id = 1")
        .toArray()[0];
      return row === undefined ? undefined : (JSON.parse(row.data) as StreamRunRecord);
    },
    write(run) {
      sql.exec(
        "INSERT INTO stream_run (id, data) VALUES (1, ?) " +
          "ON CONFLICT(id) DO UPDATE SET data = excluded.data",
        JSON.stringify(run),
      );
    },
    clear() {
      sql.exec("DELETE FROM stream_run");
    },
  };
}

/** A Daily run's ledger store, over the object's own SQLite, apart from Endless's tables. */
function dailySqlStore(sql: SqlStorage): DailyLedgerStore {
  sql.exec(
    "CREATE TABLE IF NOT EXISTS daily_run (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL)",
  );
  sql.exec(
    "CREATE TABLE IF NOT EXISTS daily_answers (seq INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL)",
  );
  return {
    read() {
      const row = sql
        .exec<{ data: string }>("SELECT data FROM daily_run WHERE id = 1")
        .toArray()[0];
      return row === undefined ? undefined : (JSON.parse(row.data) as DailyRunRecord);
    },
    write(run) {
      sql.exec(
        "INSERT INTO daily_run (id, data) VALUES (1, ?) " +
          "ON CONFLICT(id) DO UPDATE SET data = excluded.data",
        JSON.stringify(run),
      );
    },
    addAnswer(answer) {
      sql.exec("INSERT INTO daily_answers (data) VALUES (?)", JSON.stringify(answer));
    },
    answers() {
      return sql
        .exec<{ data: string }>("SELECT data FROM daily_answers ORDER BY seq")
        .toArray()
        .map((r) => JSON.parse(r.data) as DailyAnswer);
    },
    clear() {
      sql.exec("DELETE FROM daily_run");
      sql.exec("DELETE FROM daily_answers");
    },
  };
}
