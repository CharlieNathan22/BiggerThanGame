/**
 * One Daily Ranked run's ledger: what its Durable Object keeps and decides
 * (ARCHITECTURE.md §8). Pure logic over a small store, like run-ledger.ts for
 * Endless: tested in Node with an in-memory store, run in workerd over the
 * object's SQLite (run-do.ts).
 *
 * The same job as Endless's — **spend each progress token's nonce once**, so a
 * question can't be answered twice — and the Daily rules around it:
 *
 * - **Mistakes don't end the run.** A wrong answer or a timeout is marked and
 *   the next question follows, to question 20. A perfect twenty goes on into
 *   the bonus rounds, where the first miss ends it (`dailyContinues`, @bt/core).
 * - **A refused answer never voids the run.** It holds the day's one attempt,
 *   so a stale token (a second tab, a lost response) is refused and the run
 *   carries on; the page recovers with a resume. A replayed answer still gains
 *   nothing: the first answer stands.
 * - **The clock never stops.** The ledger works out every deadline itself,
 *   from each question's position and whether its wheel spins, which it is told
 *   once at the start (`changed`).
 * - **Resume** (after a refresh): an open question keeps its deadline and gets
 *   a fresh nonce; one whose time has run out is recorded as a timeout, and the
 *   next question starts fresh, so a refresh never swaps a question or buys time.
 * - **Leaving for good.** With no activity for `IDLE_FINISH_MS` the run is
 *   finished: the open question and every unanswered one of the twenty count
 *   as wrong, and the bonus, if it had begun, ends.
 * - **Posting.** A finished run is written to the board by whoever finishes it
 *   (the guess handler, or the alarm). Until that has gone through the alarm
 *   keeps trying; posting is idempotent.
 */

import {
  DAILY_QUESTIONS,
  IDLE_FINISH_MS,
  NETWORK_GRACE_MS,
  answerAllowance,
  dailyContinues,
  questionLimit,
  resumeAllowance,
} from "@bt/core";
import type { RunEnd, TimedGuess } from "@bt/core";

/** A finished run's storage is deleted this long after its last activity, once posted. */
export const DAILY_RETAIN_MS = 6 * 60 * 60 * 1000;

/** A post that failed is tried again this long after. */
export const POST_RETRY_MS = 60_000;

export type DailyStatus = "active" | "ended";

/** What a spent step led to: the next question's timing, or the run's end. */
export type DailyOutcome =
  | {
      readonly kind: "next";
      readonly nonce: string;
      readonly issuedAt: number;
      readonly deadline: number;
    }
  | { readonly kind: "end"; readonly end: RunEnd; readonly endedAt: number };

export interface DailySpentStep {
  readonly nonce: string;
  readonly round: number;
  readonly guess: TimedGuess;
  readonly correct: boolean;
  readonly outcome: DailyOutcome;
}

export interface DailyRunRecord {
  /** The run key: the run id's body, `YYYYMMDD-<uuid>`. */
  readonly key: string;
  /** The signed run id. Never logged. */
  readonly runId: string;
  readonly gameNo: number;
  readonly deviceHash: string;
  /** The run's row in `daily_entries`. */
  readonly entryId: string;
  /** For the events the object writes itself. */
  readonly country: string;
  readonly deckVersion: string;
  readonly startedAt: number;
  /** Whether each round of the stored game changes stat: the deadlines' spins. Its length is the cap. */
  readonly changed: readonly boolean[];
  /** The open question; once over, the last one dealt. */
  readonly round: number;
  readonly nonce: string;
  readonly issuedAt: number;
  readonly deadline: number;
  /** The open question's animation allowance: the usual one, or a resume's. */
  readonly allowanceMs: number;
  /** Right or wrong for each question answered, in order. */
  readonly results: readonly boolean[];
  readonly status: DailyStatus;
  readonly end: RunEnd | null;
  readonly endedAt: number | null;
  readonly lastActivity: number;
  /** On the board. */
  readonly posted: boolean;
  /** When posting was last tried and failed; null if it hasn't. */
  readonly postFailedAt: number | null;
  readonly resumes: number;
  readonly last: DailySpentStep | null;
}

/** One answered question, as the server measured it. */
export interface DailyAnswer {
  readonly round: number;
  readonly nonce: string;
  readonly guess: TimedGuess;
  readonly issuedAt: number;
  readonly receivedAt: number;
  /** `receivedAt - issuedAt`. */
  readonly ms: number;
  readonly correct: boolean;
  /** The animation before the question could be answered. */
  readonly allowanceMs: number;
  /** The question's time limit. */
  readonly limitMs: number;
  /** Out of time: the client's own timeout, a late answer, or none at all. */
  readonly timedOut: boolean;
}

export interface DailyLedgerStore {
  read(): DailyRunRecord | undefined;
  write(run: DailyRunRecord): void;
  addAnswer(answer: DailyAnswer): void;
  answers(): DailyAnswer[];
  clear(): void;
}

/** A run's start, as the start handler made it. */
export interface NewDailyRun {
  readonly key: string;
  readonly runId: string;
  readonly gameNo: number;
  readonly deviceHash: string;
  readonly entryId: string;
  readonly country: string;
  readonly deckVersion: string;
  readonly changed: readonly boolean[];
  readonly nonce: string;
  readonly issuedAt: number;
}

/** An answer, judged by the Worker against the stored game. */
export interface DailyStep {
  readonly nonce: string;
  readonly round: number;
  readonly guess: TimedGuess;
  readonly receivedAt: number;
  /** Right, as the Worker judged it; never right when out of time. */
  readonly correct: boolean;
  /** The nonce for the next question, if there is one. */
  readonly nextNonce: string;
}

export type DailyRefusal =
  /** No such run here. */
  | "unknown"
  /** The run is over. */
  | "over"
  /** A nonce the run already spent, sent again other than as a safe resend. */
  | "spent"
  /** A nonce or round the run never issued as its next. */
  | "out_of_order"
  /** Another device's run. */
  | "device";

export type DailyAdvanceResult =
  | {
      readonly ok: true;
      /** False: a resend of the latest step, answered as before. */
      readonly fresh: boolean;
      readonly correct: boolean;
      readonly outcome: DailyOutcome;
      readonly ms: number;
      readonly run: DailyRunRecord;
      /** Once the run is over: its answers, for posting. */
      readonly answers?: readonly DailyAnswer[];
    }
  | { readonly ok: false; readonly reason: DailyRefusal };

export type DailyResumeResult =
  | {
      readonly ok: true;
      readonly kind: "playing";
      readonly run: DailyRunRecord;
      /** Time left on a question that was already open; null for one dealt fresh now. */
      readonly remainingMs: number | null;
      /** The open question timed out while the player was away. */
      readonly expired: boolean;
    }
  | {
      readonly ok: true;
      readonly kind: "over";
      readonly run: DailyRunRecord;
      readonly answers: readonly DailyAnswer[];
      /** The resume itself ended it (its last question's time had run out). */
      readonly ended: boolean;
    }
  | { readonly ok: false; readonly reason: DailyRefusal };

export type DailyAlarmAction =
  | { readonly action: "none" }
  /** The run went quiet and has just been finished, or its post is due again. */
  | {
      readonly action: "post";
      readonly run: DailyRunRecord;
      readonly answers: readonly DailyAnswer[];
      /** True when the alarm itself finished it (abandoned). */
      readonly finished: boolean;
    }
  | { readonly action: "delete" };

/** The deadline and allowance for `round`, issued at `issuedAt`. */
function timing(
  changed: readonly boolean[],
  round: number,
  issuedAt: number,
  resumed: boolean,
): { readonly deadline: number; readonly allowanceMs: number } {
  const statChanged = changed[round - 1] ?? false;
  const allowanceMs = resumed
    ? resumeAllowance(round === 1 || statChanged)
    : answerAllowance(round, statChanged);
  return { deadline: issuedAt + allowanceMs + limitFor(round) + NETWORK_GRACE_MS, allowanceMs };
}

/** A question's time limit: 15 s for the first, 10 s after. */
export function limitFor(round: number): number {
  const limit = questionLimit("ranked", round);
  if (limit === null) throw new Error("Daily Ranked has no clock");
  return limit;
}

/** Right answers among the twenty. */
export function correctOf(results: readonly boolean[]): number {
  return results.slice(0, DAILY_QUESTIONS).filter(Boolean).length;
}

/** Bonus rounds answered right. */
export function bonusOf(results: readonly boolean[]): number {
  return results.slice(DAILY_QUESTIONS).filter(Boolean).length;
}

export class DailyLedger {
  constructor(private readonly store: DailyLedgerStore) {}

  get run(): DailyRunRecord | undefined {
    return this.store.read();
  }

  answers(): DailyAnswer[] {
    return this.store.answers();
  }

  /** Records a run's first question. Undefined if the run already exists. */
  begin(first: NewDailyRun): DailyRunRecord | undefined {
    if (this.store.read() !== undefined) return undefined;
    if (first.changed.length === 0) throw new Error("a game with no rounds");
    const { deadline, allowanceMs } = timing(first.changed, 1, first.issuedAt, false);
    const run: DailyRunRecord = {
      ...first,
      startedAt: first.issuedAt,
      round: 1,
      deadline,
      allowanceMs,
      results: [],
      status: "active",
      end: null,
      endedAt: null,
      lastActivity: first.issuedAt,
      posted: false,
      postFailedAt: null,
      resumes: 0,
      last: null,
    };
    this.store.write(run);
    return run;
  }

  advance(step: DailyStep): DailyAdvanceResult {
    const run = this.store.read();
    if (run === undefined) return { ok: false, reason: "unknown" };

    const { last } = run;
    if (last !== null && last.nonce === step.nonce && last.round === step.round) {
      if (last.guess === step.guess && isLatest(run, last)) {
        const answer = this.store.answers().find((a) => a.nonce === last.nonce);
        return {
          ok: true,
          fresh: false,
          correct: last.correct,
          outcome: last.outcome,
          ms: answer?.ms ?? 0,
          run,
          ...(run.status === "ended" ? { answers: this.store.answers() } : {}),
        };
      }
      return { ok: false, reason: run.status === "ended" ? "over" : "spent" };
    }
    if (run.status === "ended") return { ok: false, reason: "over" };
    if (step.nonce !== run.nonce || step.round !== run.round) {
      const spent = this.store.answers().some((a) => a.nonce === step.nonce);
      return { ok: false, reason: spent ? "spent" : "out_of_order" };
    }

    const timedOut = step.guess === "timeout" || step.receivedAt > run.deadline;
    const correct = step.correct && !timedOut;
    const ms = Math.max(0, step.receivedAt - run.issuedAt);
    this.store.addAnswer({
      round: run.round,
      nonce: run.nonce,
      guess: step.guess,
      issuedAt: run.issuedAt,
      receivedAt: step.receivedAt,
      ms,
      correct,
      allowanceMs: run.allowanceMs,
      limitMs: limitFor(run.round),
      timedOut,
    });
    const results = [...run.results, correct];
    const outcome = this.#after(run, results, correct, timedOut, step.receivedAt, step.nextNonce);
    const spent: DailySpentStep = {
      nonce: step.nonce,
      round: step.round,
      guess: step.guess,
      correct,
      outcome,
    };
    const next = this.#apply(run, results, outcome, step.receivedAt, spent, false);
    this.store.write(next);
    return {
      ok: true,
      fresh: true,
      correct,
      outcome,
      ms,
      run: next,
      ...(next.status === "ended" ? { answers: this.store.answers() } : {}),
    };
  }

  /**
   * Carries on after a refresh, for the device that started the run. An open
   * question keeps its issue time and deadline under a fresh nonce; one whose
   * time has run out is recorded as a timeout, and the next starts now.
   */
  resume(deviceHash: string, now: number, nonce: string): DailyResumeResult {
    const run = this.store.read();
    if (run === undefined) return { ok: false, reason: "unknown" };
    if (run.deviceHash !== deviceHash) return { ok: false, reason: "device" };
    if (run.status === "ended") {
      return { ok: true, kind: "over", run, answers: this.store.answers(), ended: false };
    }

    // The question's own limit runs out at the deadline less the network grace.
    const limitEnds = run.deadline - NETWORK_GRACE_MS;
    if (now < limitEnds) {
      const reissued: DailyRunRecord = {
        ...run,
        nonce,
        lastActivity: now,
        resumes: run.resumes + 1,
      };
      this.store.write(reissued);
      return {
        ok: true,
        kind: "playing",
        run: reissued,
        remainingMs: Math.min(limitFor(run.round), limitEnds - now),
        expired: false,
      };
    }

    this.store.addAnswer({
      round: run.round,
      nonce: run.nonce,
      guess: "timeout",
      issuedAt: run.issuedAt,
      receivedAt: now,
      ms: Math.max(0, now - run.issuedAt),
      correct: false,
      allowanceMs: run.allowanceMs,
      limitMs: limitFor(run.round),
      timedOut: true,
    });
    const results = [...run.results, false];
    const outcome = this.#after(run, results, false, true, now, nonce, true);
    const next = this.#apply(
      { ...run, resumes: run.resumes + 1 },
      results,
      outcome,
      now,
      null,
      true,
    );
    this.store.write(next);
    if (next.status === "ended") {
      return { ok: true, kind: "over", run: next, answers: this.store.answers(), ended: true };
    }
    return { ok: true, kind: "playing", run: next, remainingMs: null, expired: true };
  }

  /** The run is on the board. */
  markPosted(): boolean {
    const run = this.store.read();
    if (run === undefined || run.status !== "ended") return false;
    if (!run.posted) this.store.write({ ...run, posted: true, postFailedAt: null });
    return true;
  }

  /** Posting failed: the alarm tries again `POST_RETRY_MS` later. */
  postFailed(now: number): void {
    const run = this.store.read();
    if (run === undefined || run.status !== "ended" || run.posted) return;
    this.store.write({ ...run, postFailedAt: now });
  }

  /** When the run's alarm should next fire, or null when there's no run. */
  alarmAt(): number | null {
    const run = this.store.read();
    if (run === undefined) return null;
    if (run.status === "active") return run.lastActivity + IDLE_FINISH_MS;
    if (!run.posted) return (run.postFailedAt ?? run.endedAt ?? run.lastActivity) + POST_RETRY_MS;
    return run.lastActivity + DAILY_RETAIN_MS;
  }

  /** The alarm fired at `now`: finish a quiet run, try its post again, delete an old one. */
  onAlarm(now: number): DailyAlarmAction {
    const run = this.store.read();
    if (run === undefined) return { action: "delete" };
    if (run.status === "active") {
      if (now < run.lastActivity + IDLE_FINISH_MS) return { action: "none" };
      const finished = this.#abandon(run, now);
      return { action: "post", run: finished, answers: this.store.answers(), finished: true };
    }
    if (!run.posted) {
      const due = (run.postFailedAt ?? run.endedAt ?? run.lastActivity) + POST_RETRY_MS;
      if (now < due) return { action: "none" };
      return { action: "post", run, answers: this.store.answers(), finished: false };
    }
    if (now < run.lastActivity + DAILY_RETAIN_MS) return { action: "none" };
    this.store.clear();
    return { action: "delete" };
  }

  /**
   * A quiet run, finished: its open question is recorded as unanswered (a
   * timeout), and every question of the twenty it never reached counts as
   * wrong. A bonus round in progress simply ends.
   */
  #abandon(run: DailyRunRecord, now: number): DailyRunRecord {
    this.store.addAnswer({
      round: run.round,
      nonce: run.nonce,
      guess: "timeout",
      issuedAt: run.issuedAt,
      receivedAt: now,
      ms: Math.max(0, now - run.issuedAt),
      correct: false,
      allowanceMs: run.allowanceMs,
      limitMs: limitFor(run.round),
      timedOut: true,
    });
    const results = [...run.results, false];
    while (results.length < DAILY_QUESTIONS) results.push(false);
    const finished: DailyRunRecord = {
      ...run,
      results,
      status: "ended",
      end: "abandoned",
      endedAt: now,
      lastActivity: now,
    };
    this.store.write(finished);
    return finished;
  }

  /** What answering the open question leads to. */
  #after(
    run: DailyRunRecord,
    results: readonly boolean[],
    correct: boolean,
    timedOut: boolean,
    at: number,
    nonce: string,
    resumed = false,
  ): DailyOutcome {
    const goesOn = dailyContinues(run.round, correctOf(results), correct);
    const cap = run.changed.length;
    if (goesOn && run.round < cap) {
      const { deadline } = timing(run.changed, run.round + 1, at, resumed);
      return { kind: "next", nonce, issuedAt: at, deadline };
    }
    const end: RunEnd = goesOn
      ? "deck-exhausted"
      : run.round <= DAILY_QUESTIONS
        ? "finished"
        : timedOut
          ? "timeout"
          : "wrong";
    return { kind: "end", end, endedAt: at };
  }

  #apply(
    run: DailyRunRecord,
    results: readonly boolean[],
    outcome: DailyOutcome,
    at: number,
    spent: DailySpentStep | null,
    resumed: boolean,
  ): DailyRunRecord {
    if (outcome.kind === "next") {
      const round = run.round + 1;
      const { allowanceMs } = timing(run.changed, round, outcome.issuedAt, resumed);
      return {
        ...run,
        round,
        nonce: outcome.nonce,
        issuedAt: outcome.issuedAt,
        deadline: outcome.deadline,
        allowanceMs,
        results,
        lastActivity: at,
        last: spent,
      };
    }
    return {
      ...run,
      results,
      status: "ended",
      end: outcome.end,
      endedAt: outcome.endedAt,
      lastActivity: at,
      last: spent,
    };
  }
}

/** Whether `last` is still where the run stands: its next token unused, or its end the run's. */
function isLatest(run: DailyRunRecord, last: DailySpentStep): boolean {
  if (last.outcome.kind === "next") {
    return run.status === "active" && run.nonce === last.outcome.nonce;
  }
  return run.status === "ended" && run.end === last.outcome.end;
}

/** An in-memory store, for tests and anything else outside workerd. */
export function memoryDailyStore(): DailyLedgerStore {
  let run: DailyRunRecord | undefined;
  let answers: DailyAnswer[] = [];
  return {
    read: () => run,
    write: (next) => {
      run = next;
    },
    addAnswer: (answer) => {
      answers.push(answer);
    },
    answers: () => answers.slice(),
    clear: () => {
      run = undefined;
      answers = [];
    },
  };
}
