/**
 * One Endless run's ledger: what its Durable Object keeps and decides
 * (ARCHITECTURE.md §8). Pure logic over a small store, so it runs under test
 * in Node with an in-memory store and in workerd over the DO's SQLite
 * (run-do.ts).
 *
 * **Single job: spend each progress token's nonce once.** A signed token alone
 * can be replayed — guess "higher", see the reveal, send the same token again
 * with "lower" — and the server would always hand back a valid next token. So
 * the ledger holds the one nonce the run may spend next, and:
 *
 * - spending it records the answer's server-measured time and the next nonce,
 *   or the run's end;
 * - **the same token with the same guess, sent again while it is still the
 *   run's latest step** (its next token unused), gets the outcome it had the
 *   first time, so a retry after a lost response is safe. The next token keeps
 *   its original issue time and deadline, so a retry never buys clock time;
 * - anything else — the same token with the other guess, an older token, one
 *   never issued, one for another round — is refused and **voids the run**;
 * - a run that is over refuses every answer, and its streak stays as banked.
 *
 * The ledger also closes a run that goes silent: a connected client always
 * answers, or sends its own timeout, before the deadline, so once the deadline
 * has passed by `DISCONNECT_MARGIN_MS` with no answer the run ends as
 * `disconnected`, keeping the streak it had verified. And it says when the
 * run's storage can go: `RETAIN_MS` after the last activity.
 *
 * For publishing to the boards it checks a submission against the run
 * (`claimForSubmit`) and marks the run published, once (`markSubmitted`).
 * Storage outlives the submit window (30 minutes) by hours, so `RETAIN_MS`
 * needs no change for it.
 */

import type { RunEnd, TimedGuess } from "@bt/core";
import type { RunKind } from "./analytics.js";

/** Past a question's deadline by this much, with no answer, a run is closed as `disconnected`. */
export const DISCONNECT_MARGIN_MS = 5000;

/** A run's storage is deleted this long after its last activity. */
export const RETAIN_MS = 6 * 60 * 60 * 1000;

export type RunStatus = "active" | "ended" | "void";

/** What a spent step led to: the next token's timing, or the run's end. */
export type StepOutcome =
  | {
      readonly kind: "next";
      readonly nonce: string;
      readonly issuedAt: number;
      readonly deadline: number;
    }
  | {
      readonly kind: "end";
      readonly end: RunEnd;
      readonly score: number;
      readonly endedAt: number;
    };

/** The most recent answer the run accepted, kept so a resend can be answered the same. */
export interface SpentStep {
  readonly nonce: string;
  readonly round: number;
  readonly guess: TimedGuess;
  readonly outcome: StepOutcome;
}

export interface RunRecord {
  /** The run key: the run id's body, `YYYYMMDD-<uuid>`. */
  readonly key: string;
  /** The signed run id. Never logged. */
  readonly runId: string;
  readonly mode: "endless";
  readonly runKind: RunKind;
  /** For the end event the ledger may write itself (a silent run's). */
  readonly country: string;
  readonly deckVersion: string;
  readonly startedAt: number;
  /** The round the live token answers; once over, the last round dealt. */
  readonly round: number;
  /** The live token's nonce: the only one the run will spend next. */
  readonly nonce: string;
  readonly issuedAt: number;
  readonly deadline: number;
  /** Rounds answered correctly, verified. */
  readonly streak: number;
  readonly status: RunStatus;
  readonly end: RunEnd | null;
  readonly endedAt: number | null;
  /** Sum of the answer times, token issue to guess received, ms. */
  readonly elapsedMs: number;
  /** Published to a leaderboard (part 2). */
  readonly submitted: boolean;
  readonly lastActivity: number;
  readonly last: SpentStep | null;
}

/** One accepted answer, as the server measured it. */
export interface AnswerRecord {
  readonly round: number;
  readonly nonce: string;
  readonly guess: TimedGuess;
  readonly issuedAt: number;
  readonly receivedAt: number;
  /** `receivedAt - issuedAt`. */
  readonly ms: number;
  readonly correct: boolean;
}

/** Where a ledger keeps its run: SQLite in the DO, memory in tests. */
export interface LedgerStore {
  read(): RunRecord | undefined;
  write(run: RunRecord): void;
  addAnswer(answer: AnswerRecord): void;
  answers(): AnswerRecord[];
  /** Everything, gone. */
  clear(): void;
}

/** A run's first token, as the start handler issued it. */
export interface NewRun {
  readonly key: string;
  readonly runId: string;
  readonly runKind: RunKind;
  readonly country: string;
  readonly deckVersion: string;
  readonly startedAt: number;
  readonly nonce: string;
  readonly issuedAt: number;
  readonly deadline: number;
}

/** An answer, with what the Worker has already worked out it leads to. */
export interface Step {
  readonly nonce: string;
  readonly round: number;
  readonly guess: TimedGuess;
  /** The token's own issue time, so the answer time is the server's measure. */
  readonly issuedAt: number;
  readonly receivedAt: number;
  readonly correct: boolean;
  readonly outcome: StepOutcome;
}

export type Refusal =
  /** No such run: never started here, or its storage has gone. */
  | "unknown"
  /** Already void. */
  | "void"
  /** Over: ended, or closed as disconnected. Its streak stands. */
  | "over"
  /** A nonce the run already spent, sent again other than as a safe resend. */
  | "spent"
  /** A nonce or round the run never issued as its next. */
  | "out_of_order";

export type AdvanceResult =
  | {
      readonly ok: true;
      /** False: a resend of the latest step, answered as before. */
      readonly fresh: boolean;
      readonly outcome: StepOutcome;
      /** This answer's server-measured time, ms. */
      readonly ms: number;
      /** The run's total so far, ms. */
      readonly elapsedMs: number;
      /** As the run was started, for its events. */
      readonly runKind: RunKind;
    }
  | { readonly ok: false; readonly reason: Refusal };

/** A finished run may be published up to this long after it ended. */
export const SUBMIT_WINDOW_MS = 30 * 60 * 1000;

/** What a submission says about its run, from the token it carries. */
export interface SubmitClaim {
  /** The signed run id in the token. */
  readonly runId: string;
  /** The streak the token proves: a result's score, or a progress token's streak. */
  readonly score: number;
  /** The server's clock. */
  readonly now: number;
  /** From a result token: how and when the run ended. */
  readonly result?: { readonly end: RunEnd; readonly endedAt: number };
  /** From a progress token (a banked run): the question it was for. */
  readonly progress?: { readonly nonce: string; readonly round: number };
}

export type ClaimRefusal =
  /** No such run here: never started by /api/run/start, or its storage has gone. */
  | "unknown"
  | "void"
  /** Still being played, and the token isn't its open question's. */
  | "not_ended"
  /** The run's streak, end or last round isn't what the token says. */
  | "mismatch"
  /** Already published. */
  | "submitted"
  /** Ended more than `SUBMIT_WINDOW_MS` ago. */
  | "expired";

export type ClaimResult =
  | {
      readonly ok: true;
      readonly run: RunRecord;
      readonly answers: readonly AnswerRecord[];
      /** True when the claim itself closed the run (a banked run's open question). */
      readonly closed: boolean;
    }
  | { readonly ok: false; readonly reason: ClaimRefusal };

export type AlarmAction =
  | { readonly action: "none" }
  /** The run went silent and has just been closed as `disconnected`. */
  | { readonly action: "closed"; readonly run: RunRecord }
  /** The run's storage should go. */
  | { readonly action: "delete" };

export class RunLedger {
  constructor(private readonly store: LedgerStore) {}

  get run(): RunRecord | undefined {
    return this.store.read();
  }

  /** Records a run's first token. Refused if the run already exists. */
  begin(first: NewRun): boolean {
    if (this.store.read() !== undefined) return false;
    this.store.write({
      ...first,
      mode: "endless",
      round: 1,
      streak: 0,
      status: "active",
      end: null,
      endedAt: null,
      elapsedMs: 0,
      submitted: false,
      lastActivity: first.issuedAt,
      last: null,
    });
    return true;
  }

  advance(step: Step): AdvanceResult {
    const run = this.store.read();
    if (run === undefined) return { ok: false, reason: "unknown" };
    if (run.status === "void") return { ok: false, reason: "void" };

    const { last } = run;
    if (last !== null && last.nonce === step.nonce && last.round === step.round) {
      if (last.guess === step.guess && isLatest(run, last)) {
        const answer = this.store.answers().find((a) => a.nonce === last.nonce);
        return {
          ok: true,
          fresh: false,
          outcome: last.outcome,
          ms: answer?.ms ?? 0,
          elapsedMs: run.elapsedMs,
          runKind: run.runKind,
        };
      }
      // Closed by the alarm after this step: over, not void.
      if (run.status === "ended" && last.outcome.kind === "next")
        return { ok: false, reason: "over" };
      return this.void(run, "spent");
    }
    if (run.status === "ended") return { ok: false, reason: "over" };
    if (step.nonce !== run.nonce || step.round !== run.round) {
      const spent = this.store.answers().some((a) => a.nonce === step.nonce);
      return this.void(run, spent ? "spent" : "out_of_order");
    }

    const ms = Math.max(0, step.receivedAt - step.issuedAt);
    this.store.addAnswer({
      round: step.round,
      nonce: step.nonce,
      guess: step.guess,
      issuedAt: step.issuedAt,
      receivedAt: step.receivedAt,
      ms,
      correct: step.correct,
    });
    const elapsedMs = run.elapsedMs + ms;
    const { outcome } = step;
    const spent: SpentStep = { nonce: step.nonce, round: step.round, guess: step.guess, outcome };
    this.store.write(
      outcome.kind === "next"
        ? {
            ...run,
            round: step.round + 1,
            nonce: outcome.nonce,
            issuedAt: outcome.issuedAt,
            deadline: outcome.deadline,
            streak: step.round,
            elapsedMs,
            lastActivity: step.receivedAt,
            last: spent,
          }
        : {
            ...run,
            streak: outcome.score,
            status: "ended",
            end: outcome.end,
            endedAt: outcome.endedAt,
            elapsedMs,
            lastActivity: step.receivedAt,
            last: spent,
          },
    );
    return { ok: true, fresh: true, outcome, ms, elapsedMs, runKind: run.runKind };
  }

  /** Whether the run has been published; undefined for no such run. */
  isSubmitted(): boolean | undefined {
    return this.store.read()?.submitted;
  }

  /**
   * Checks, in one step, that a run may be published as the token claims:
   * this ledger's own run (only `/api/run/start` ever makes one, so a run
   * found here was minted fresh), not void, over, the streak and end the
   * token says, not yet published, and ended no more than `SUBMIT_WINDOW_MS`
   * ago. Hands back the run and its answer times for the timing heuristics.
   *
   * A run banked after a dropped connection is claimed with its latest
   * progress token. If the alarm hasn't closed it yet — the question is still
   * open — the claim closes it now, as `disconnected`, at the streak the token
   * already proves: the player gives up the open question, and gains nothing.
   *
   * Doesn't mark the run published: `markSubmitted` does, once the score is
   * stored, so a failure in between leaves the run publishable.
   */
  claimForSubmit(claim: SubmitClaim): ClaimResult {
    let run = this.store.read();
    if (run === undefined || run.runId !== claim.runId) return { ok: false, reason: "unknown" };
    if (run.status === "void") return { ok: false, reason: "void" };
    if (run.submitted) return { ok: false, reason: "submitted" };

    let closed = false;
    if (run.status === "active") {
      const { progress } = claim;
      const open =
        progress !== undefined &&
        progress.nonce === run.nonce &&
        progress.round === run.round &&
        claim.score === run.streak;
      if (!open) return { ok: false, reason: "not_ended" };
      run = {
        ...run,
        status: "ended",
        end: "disconnected",
        endedAt: claim.now,
        lastActivity: claim.now,
      };
      this.store.write(run);
      closed = true;
    }

    if (run.streak !== claim.score || run.endedAt === null || run.end === null) {
      return { ok: false, reason: "mismatch" };
    }
    if (claim.result !== undefined) {
      if (run.end !== claim.result.end || run.endedAt !== claim.result.endedAt) {
        return { ok: false, reason: "mismatch" };
      }
    } else if (claim.progress === undefined || claim.progress.round !== run.round) {
      // A progress token must be the run's last one.
      return { ok: false, reason: "mismatch" };
    }
    if (claim.now - run.endedAt > SUBMIT_WINDOW_MS) return { ok: false, reason: "expired" };
    return { ok: true, run, answers: this.store.answers(), closed };
  }

  /**
   * Marks a finished run as published, once. False when there's no such run,
   * it isn't over, it's void, or it was already submitted.
   */
  markSubmitted(): boolean {
    const run = this.store.read();
    if (run === undefined || run.status !== "ended" || run.submitted) return false;
    this.store.write({ ...run, submitted: true });
    return true;
  }

  /** When the run's alarm should next fire, or null when there's no run. */
  alarmAt(): number | null {
    const run = this.store.read();
    if (run === undefined) return null;
    return run.status === "active"
      ? run.deadline + DISCONNECT_MARGIN_MS
      : run.lastActivity + RETAIN_MS;
  }

  /** The alarm fired at `now`: close a silent run, delete an old one, or nothing yet. */
  onAlarm(now: number): AlarmAction {
    const run = this.store.read();
    if (run === undefined) return { action: "delete" };
    if (run.status === "active") {
      if (now < run.deadline + DISCONNECT_MARGIN_MS) return { action: "none" };
      const closed: RunRecord = {
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

  private void(run: RunRecord, reason: "spent" | "out_of_order"): AdvanceResult {
    this.store.write({ ...run, status: "void" });
    return { ok: false, reason };
  }
}

/**
 * Whether `last` is still where the run stands: its next token unused, or the
 * end it led to still the run's end (not a later close by the alarm).
 */
function isLatest(run: RunRecord, last: SpentStep): boolean {
  if (last.outcome.kind === "next") {
    return run.status === "active" && run.nonce === last.outcome.nonce;
  }
  return run.status === "ended" && run.end === last.outcome.end;
}

/** An in-memory store, for tests and anything else outside workerd. */
export function memoryStore(): LedgerStore {
  let run: RunRecord | undefined;
  let answers: AnswerRecord[] = [];
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
