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
 * The alarm does two jobs. While a question is open it is set a little past
 * the deadline: if no answer has come by then, the run is closed as
 * `disconnected`, keeping the streak it had verified, and its end is logged and
 * recorded like any other. Once the run is over it is set `RETAIN_MS` after the
 * last activity, and deletes everything, so runs don't accumulate.
 */

import { DurableObject } from "cloudflare:workers";
import { toDataPoint, toLogLine } from "./src/analytics.js";
import type { Env } from "./src/app.js";
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

export class RunDO extends DurableObject<Env> {
  readonly #ledger: RunLedger;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#ledger = new RunLedger(sqlStore(ctx.storage.sql));
  }

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
