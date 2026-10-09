/**
 * One Twitch Mode match's ledger: what its Durable Object keeps and decides
 * (ARCHITECTURE.md §8). Pure logic over a small store, like Endless's
 * (run-ledger.ts), so it runs in Node with a memory store and in workerd over
 * the object's SQLite (run-do.ts, its own table).
 *
 * **It spends each token's nonce once**, as Endless's does, and answers a
 * resend of the latest step with the outcome it had the first time, so a retry
 * after a lost response is safe and buys no clock time.
 *
 * **A match goes on to its last question.** A wrong answer or a timeout is a
 * point not won (`results`), as in Daily Ranked's twenty, and every answer
 * leads to the next question until the match's length; the Worker works out
 * which and hands it in.
 *
 * **A refused answer never voids a match.** The same token with the other
 * guess, an older token, one never issued: each is refused, changes nothing,
 * and the first answer stands; the genuine next token still plays on. There
 * is no leaderboard to protect, and voiding would end a live match on stream.
 *
 * The match's settings — its pool, length and limit — are written at the
 * start and never change. Chat's side is telemetry only: the page counts the
 * votes and says how chat did; nothing here changes a match because of it.
 *
 * The alarm closes a match that goes silent, as Endless's does: once the open
 * question's deadline has passed by `DISCONNECT_MARGIN_MS` with no answer, the
 * match is over as `disconnected` (a refresh ends a match). Its storage goes
 * `RETAIN_MS` after its last activity.
 */

import type { StreamLimit, StreamPool, TimedGuess } from "@bt/core";
import { DISCONNECT_MARGIN_MS, RETAIN_MS } from "./run-ledger.js";

/** How a match ended: its last question answered, the pool out of players, or no answer came. */
export type StreamEnd = "finished" | "deck-exhausted" | "disconnected";

export type StreamStatus = "active" | "ended";

export type StreamOutcome =
  | {
      readonly kind: "next";
      readonly nonce: string;
      readonly issuedAt: number;
      readonly deadline: number;
    }
  | {
      readonly kind: "end";
      readonly end: "finished" | "deck-exhausted";
      readonly endedAt: number;
    };

/** One accepted answer, as the server measured it. */
export interface StreamAnswer {
  readonly round: number;
  readonly nonce: string;
  readonly guess: TimedGuess;
  readonly correct: boolean;
  /** Token issue to guess received, ms. */
  readonly ms: number;
}

/** The latest step, kept so a resend can be answered the same. */
export interface SpentStreamStep {
  readonly nonce: string;
  readonly round: number;
  readonly guess: TimedGuess;
  readonly outcome: StreamOutcome;
}

export interface StreamRunRecord {
  /** The match key: the match id's body, `YYYYMMDD-<uuid>`. */
  readonly key: string;
  /** The signed match id. Never logged. */
  readonly runId: string;
  readonly mode: "stream";
  readonly pool: StreamPool;
  readonly questions: number;
  readonly limit: StreamLimit;
  readonly country: string;
  readonly deckVersion: string;
  readonly startedAt: number;
  /** The round the live token answers; once over, the last round dealt. */
  readonly round: number;
  readonly nonce: string;
  readonly issuedAt: number;
  readonly deadline: number;
  /** Right or wrong for each question answered, in order. */
  readonly results: readonly boolean[];
  readonly answers: readonly StreamAnswer[];
  readonly status: StreamStatus;
  readonly end: StreamEnd | null;
  readonly endedAt: number | null;
  /** Telemetry: the questions chat got right, as the page reported them. */
  readonly chatScore: number;
  /** Telemetry: the most voters on any one question. */
  readonly peakVoters: number;
  readonly lastActivity: number;
  readonly last: SpentStreamStep | null;
}

/** Where the ledger keeps its match: SQLite in the DO, memory in tests. */
export interface StreamLedgerStore {
  read(): StreamRunRecord | undefined;
  write(run: StreamRunRecord): void;
  clear(): void;
}

/** A match's first token, as the start handler issued it. */
export interface NewStreamRun {
  readonly key: string;
  readonly runId: string;
  readonly pool: StreamPool;
  readonly questions: number;
  readonly limit: StreamLimit;
  readonly country: string;
  readonly deckVersion: string;
  readonly startedAt: number;
  readonly nonce: string;
  readonly issuedAt: number;
  readonly deadline: number;
}

/** What chat did on the question, as the page counted it: telemetry only. */
export interface ChatTally {
  /** Chat's majority matched the answer. False for a split or no votes. */
  readonly right: boolean;
  readonly voters: number;
}

/** An answer, with what the Worker has already worked out it leads to. */
export interface StreamStep {
  readonly nonce: string;
  readonly round: number;
  readonly guess: TimedGuess;
  readonly issuedAt: number;
  readonly receivedAt: number;
  readonly correct: boolean;
  readonly chat?: ChatTally;
  readonly outcome: StreamOutcome;
}

export type StreamRefusal =
  /** No such match: never started here, or its storage has gone. */
  | "unknown"
  /** Over: finished, out of players, or closed as disconnected. */
  | "over"
  /** A nonce the match already spent, sent again other than as a safe resend. */
  | "spent"
  /** A nonce or round the match never issued as its next. */
  | "out_of_order";

export type StreamAdvanceResult =
  | {
      readonly ok: true;
      /** False: a resend of the latest step, answered as before. */
      readonly fresh: boolean;
      readonly outcome: StreamOutcome;
      /** Whether this answer was right, as first judged (a resend keeps its verdict). */
      readonly correct: boolean;
      /** This answer's server-measured time, ms. */
      readonly ms: number;
      /** The streamer's right answers after this one. */
      readonly score: number;
      /** Chat's, as reported, after this one. */
      readonly chatScore: number;
      readonly peakVoters: number;
    }
  | { readonly ok: false; readonly reason: StreamRefusal };

export type StreamAlarmAction =
  | { readonly action: "none" }
  /** The match went silent and has just been closed as `disconnected`. */
  | { readonly action: "closed"; readonly run: StreamRunRecord }
  /** The match's storage should go. */
  | { readonly action: "delete" };

/** The streamer's right answers. */
export function scoreOf(results: readonly boolean[]): number {
  return results.filter(Boolean).length;
}

export class StreamLedger {
  constructor(private readonly store: StreamLedgerStore) {}

  get run(): StreamRunRecord | undefined {
    return this.store.read();
  }

  /** Records a match's first token. Refused if the match already exists. */
  begin(first: NewStreamRun): boolean {
    if (this.store.read() !== undefined) return false;
    this.store.write({
      ...first,
      mode: "stream",
      round: 1,
      results: [],
      answers: [],
      status: "active",
      end: null,
      endedAt: null,
      chatScore: 0,
      peakVoters: 0,
      lastActivity: first.issuedAt,
      last: null,
    });
    return true;
  }

  advance(step: StreamStep): StreamAdvanceResult {
    const run = this.store.read();
    if (run === undefined) return { ok: false, reason: "unknown" };

    const { last } = run;
    if (last !== null && last.nonce === step.nonce && last.round === step.round) {
      if (last.guess === step.guess && isLatest(run, last)) {
        const answer = run.answers.find((a) => a.nonce === last.nonce);
        return {
          ok: true,
          fresh: false,
          outcome: last.outcome,
          correct: answer?.correct ?? false,
          ms: answer?.ms ?? 0,
          score: scoreOf(run.results),
          chatScore: run.chatScore,
          peakVoters: run.peakVoters,
        };
      }
      // Refused, and nothing changes: the first answer stands.
      return { ok: false, reason: run.status === "ended" ? "over" : "spent" };
    }
    if (run.status === "ended") return { ok: false, reason: "over" };
    if (step.nonce !== run.nonce || step.round !== run.round) {
      const spent = run.answers.some((a) => a.nonce === step.nonce);
      return { ok: false, reason: spent ? "spent" : "out_of_order" };
    }

    const ms = Math.max(0, step.receivedAt - step.issuedAt);
    const results = [...run.results, step.correct];
    const answers = [
      ...run.answers,
      { round: step.round, nonce: step.nonce, guess: step.guess, correct: step.correct, ms },
    ];
    const chatScore = run.chatScore + (step.chat?.right === true ? 1 : 0);
    const peakVoters = Math.max(run.peakVoters, step.chat?.voters ?? 0);
    const { outcome } = step;
    const spent: SpentStreamStep = {
      nonce: step.nonce,
      round: step.round,
      guess: step.guess,
      outcome,
    };
    const common = {
      ...run,
      results,
      answers,
      chatScore,
      peakVoters,
      lastActivity: step.receivedAt,
      last: spent,
    };
    this.store.write(
      outcome.kind === "next"
        ? {
            ...common,
            round: step.round + 1,
            nonce: outcome.nonce,
            issuedAt: outcome.issuedAt,
            deadline: outcome.deadline,
          }
        : { ...common, status: "ended", end: outcome.end, endedAt: outcome.endedAt },
    );
    return {
      ok: true,
      fresh: true,
      outcome,
      correct: step.correct,
      ms,
      score: scoreOf(results),
      chatScore,
      peakVoters,
    };
  }

  /** When the match's alarm should next fire, or null when there's no match. */
  alarmAt(): number | null {
    const run = this.store.read();
    if (run === undefined) return null;
    return run.status === "active"
      ? run.deadline + DISCONNECT_MARGIN_MS
      : run.lastActivity + RETAIN_MS;
  }

  /** The alarm fired at `now`: close a silent match, delete an old one, or nothing yet. */
  onAlarm(now: number): StreamAlarmAction {
    const run = this.store.read();
    if (run === undefined) return { action: "delete" };
    if (run.status === "active") {
      if (now < run.deadline + DISCONNECT_MARGIN_MS) return { action: "none" };
      const closed: StreamRunRecord = {
        ...run,
        status: "ended",
        end: "disconnected",
        endedAt: now,
        lastActivity: now,
      };
      this.store.write(closed);
      return { action: "closed", run: closed };
    }
    if (now < run.lastActivity + RETAIN_MS) return { action: "none" };
    this.store.clear();
    return { action: "delete" };
  }
}

/** Whether `last` is still where the match stands: its next token unused, or its end still the end. */
function isLatest(run: StreamRunRecord, last: SpentStreamStep): boolean {
  if (last.outcome.kind === "next") {
    return run.status === "active" && run.nonce === last.outcome.nonce;
  }
  return run.status === "ended" && run.end === last.outcome.end;
}

/** An in-memory store, for tests and anything else outside workerd. */
export function memoryStreamStore(): StreamLedgerStore {
  let run: StreamRunRecord | undefined;
  return {
    read: () => run,
    write: (next) => {
      run = next;
    },
    clear: () => {
      run = undefined;
    },
  };
}
