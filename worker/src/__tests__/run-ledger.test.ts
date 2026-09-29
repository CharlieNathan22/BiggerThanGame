import { describe, expect, it } from "vitest";
import {
  DISCONNECT_MARGIN_MS,
  RETAIN_MS,
  RunLedger,
  SUBMIT_WINDOW_MS,
  memoryStore,
} from "../run-ledger.js";
import type { NewRun, Step, StepOutcome } from "../run-ledger.js";

const T0 = 1_790_000_000_000;

const FIRST: NewRun = {
  key: "20260919-run",
  runId: "20260919-run.sig",
  runKind: "fresh",
  country: "GB",
  deckVersion: "legends-test",
  startedAt: T0,
  nonce: "n1",
  issuedAt: T0,
  deadline: T0 + 27_340,
};

function next(nonce: string, issuedAt: number): StepOutcome {
  return { kind: "next", nonce, issuedAt, deadline: issuedAt + 17_280 };
}

function step(round: number, nonce: string, outcome: StepOutcome, over: Partial<Step> = {}): Step {
  const issuedAt = T0 + (round - 1) * 5000;
  return {
    nonce,
    round,
    guess: "higher",
    issuedAt,
    receivedAt: issuedAt + 3000,
    correct: outcome.kind === "next",
    outcome,
    ...over,
  };
}

function ledger(): RunLedger {
  const l = new RunLedger(memoryStore());
  expect(l.begin(FIRST)).toBe(true);
  return l;
}

describe("a run's ledger", () => {
  it("begins once", () => {
    const l = ledger();
    expect(l.begin(FIRST)).toBe(false);
    expect(l.run).toMatchObject({ round: 1, nonce: "n1", streak: 0, status: "active" });
  });

  it("spends each nonce once, recording the server-measured time", () => {
    const l = ledger();
    const r1 = l.advance(step(1, "n1", next("n2", T0 + 3000)));
    expect(r1).toMatchObject({ ok: true, fresh: true, ms: 3000, elapsedMs: 3000 });
    expect(l.run).toMatchObject({ round: 2, nonce: "n2", streak: 1, status: "active" });
    const r2 = l.advance(step(2, "n2", next("n3", T0 + 8000)));
    expect(r2).toMatchObject({ ok: true, fresh: true, ms: 3000, elapsedMs: 6000 });
  });

  it("answers the latest step again, the same way, when sent again with the same guess", () => {
    const l = ledger();
    const first = l.advance(step(1, "n1", next("n2", T0 + 3000)));
    // A resend works out a different next token; the ledger keeps the original.
    const again = l.advance(step(1, "n1", next("other", T0 + 9000), { receivedAt: T0 + 9000 }));
    expect(again).toEqual({ ...first, fresh: false });
    expect(l.run).toMatchObject({ round: 2, nonce: "n2", status: "active" });
  });

  it("voids the run when the spent token comes back with the other guess", () => {
    const l = ledger();
    l.advance(step(1, "n1", next("n2", T0 + 3000)));
    expect(l.advance(step(1, "n1", next("n2", T0 + 3000), { guess: "lower" }))).toEqual({
      ok: false,
      reason: "spent",
    });
    expect(l.run?.status).toBe("void");
    // Nothing more is taken for it, not even the genuine next token.
    expect(l.advance(step(2, "n2", next("n3", T0 + 8000)))).toEqual({ ok: false, reason: "void" });
  });

  it("voids the run on an older token once its next token has been used", () => {
    const l = ledger();
    l.advance(step(1, "n1", next("n2", T0 + 3000)));
    l.advance(step(2, "n2", next("n3", T0 + 8000)));
    expect(l.advance(step(1, "n1", next("n2", T0 + 3000)))).toEqual({ ok: false, reason: "spent" });
    expect(l.run?.status).toBe("void");
  });

  it("voids the run on a token it never issued, or for another round", () => {
    const a = ledger();
    expect(a.advance(step(1, "forged", next("n2", T0)))).toEqual({
      ok: false,
      reason: "out_of_order",
    });
    expect(a.run?.status).toBe("void");
    const b = ledger();
    expect(b.advance(step(2, "n1", next("n2", T0)))).toEqual({ ok: false, reason: "out_of_order" });
  });

  it("ends a run, keeps its score, and then refuses everything but a resend of the end", () => {
    const l = ledger();
    l.advance(step(1, "n1", next("n2", T0 + 3000)));
    const end: StepOutcome = { kind: "end", end: "wrong", score: 1, endedAt: T0 + 8000 };
    const ended = l.advance(step(2, "n2", end, { correct: false }));
    expect(ended).toMatchObject({ ok: true, fresh: true, outcome: end });
    expect(l.run).toMatchObject({ status: "ended", end: "wrong", streak: 1 });
    expect(l.advance(step(2, "n2", end, { correct: false }))).toMatchObject({
      ok: true,
      fresh: false,
      outcome: end,
    });
    expect(l.advance(step(3, "n3", end))).toEqual({ ok: false, reason: "over" });
    expect(l.run?.streak).toBe(1);
  });

  it("refuses a run it doesn't know", () => {
    const l = new RunLedger(memoryStore());
    expect(l.advance(step(1, "n1", next("n2", T0)))).toEqual({ ok: false, reason: "unknown" });
  });
});

describe("a silent run", () => {
  it("is closed as disconnected a little past the deadline, keeping its streak", () => {
    const l = ledger();
    l.advance(step(1, "n1", next("n2", T0 + 3000)));
    const { deadline } = l.run!;
    expect(l.alarmAt()).toBe(deadline + DISCONNECT_MARGIN_MS);
    expect(l.onAlarm(deadline + DISCONNECT_MARGIN_MS - 1)).toEqual({ action: "none" });
    const closed = l.onAlarm(deadline + DISCONNECT_MARGIN_MS);
    expect(closed).toMatchObject({
      action: "closed",
      run: { status: "ended", end: "disconnected", streak: 1 },
    });
  });

  it("refuses a late guess after it was closed, even a resend, and its streak is final", () => {
    const l = ledger();
    l.advance(step(1, "n1", next("n2", T0 + 3000)));
    l.onAlarm(l.run!.deadline + DISCONNECT_MARGIN_MS);
    expect(l.advance(step(2, "n2", next("n3", T0 + 90_000)))).toEqual({
      ok: false,
      reason: "over",
    });
    expect(l.advance(step(1, "n1", next("n2", T0 + 3000)))).toEqual({ ok: false, reason: "over" });
    expect(l.run).toMatchObject({ status: "ended", end: "disconnected", streak: 1 });
  });
});

describe("storage", () => {
  it("is deleted RETAIN_MS after the last activity, and not before", () => {
    const l = ledger();
    const end: StepOutcome = { kind: "end", end: "wrong", score: 0, endedAt: T0 + 3000 };
    l.advance(step(1, "n1", end, { correct: false }));
    const last = l.run!.lastActivity;
    expect(l.alarmAt()).toBe(last + RETAIN_MS);
    expect(l.onAlarm(last + RETAIN_MS - 1)).toEqual({ action: "none" });
    expect(l.onAlarm(last + RETAIN_MS)).toEqual({ action: "delete" });
    expect(l.run).toBeUndefined();
    expect(l.alarmAt()).toBeNull();
  });
});

describe("submission, for part 2", () => {
  it("is false until marked, once, and only for a finished run", () => {
    const l = ledger();
    expect(l.isSubmitted()).toBe(false);
    expect(l.markSubmitted()).toBe(false); // still active
    l.advance(step(1, "n1", { kind: "end", end: "wrong", score: 0, endedAt: T0 + 3000 }));
    expect(l.markSubmitted()).toBe(true);
    expect(l.markSubmitted()).toBe(false);
    expect(l.isSubmitted()).toBe(true);
    expect(new RunLedger(memoryStore()).isSubmitted()).toBeUndefined();
  });
});

describe("claiming a run to publish it", () => {
  const ENDED = T0 + 10_000;

  /** A run with a right answer to round 1, then a wrong one to round 2: a score of 1. */
  function finished(): RunLedger {
    const l = ledger();
    l.advance(step(1, "n1", next("n2", T0 + 3000)));
    l.advance(step(2, "n2", { kind: "end", end: "wrong", score: 1, endedAt: ENDED }));
    return l;
  }
  const result = { end: "wrong" as const, endedAt: ENDED };

  it("hands back a finished run and its answer times", () => {
    const claim = finished().claimForSubmit({
      runId: FIRST.runId,
      score: 1,
      now: ENDED + 60_000,
      result,
    });
    expect(claim).toMatchObject({ ok: true, closed: false, run: { streak: 1, end: "wrong" } });
    expect(claim.ok && claim.answers.map((a) => a.ms)).toEqual([3000, 3000]);
  });

  it("refuses a run it doesn't hold, or another run's id", () => {
    const empty = new RunLedger(memoryStore());
    expect(empty.claimForSubmit({ runId: FIRST.runId, score: 1, now: ENDED, result })).toEqual({
      ok: false,
      reason: "unknown",
    });
    expect(
      finished().claimForSubmit({ runId: "20260919-other.sig", score: 1, now: ENDED, result }),
    ).toEqual({ ok: false, reason: "unknown" });
  });

  it("refuses a streak, end or end time the run doesn't have", () => {
    const l = finished();
    const base = { runId: FIRST.runId, now: ENDED };
    expect(l.claimForSubmit({ ...base, score: 2, result })).toEqual({
      ok: false,
      reason: "mismatch",
    });
    expect(l.claimForSubmit({ ...base, score: 1, result: { ...result, end: "timeout" } })).toEqual({
      ok: false,
      reason: "mismatch",
    });
    expect(l.claimForSubmit({ ...base, score: 1, result: { ...result, endedAt: 1 } })).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  it("refuses once published, and after the window", () => {
    const l = finished();
    const claim = { runId: FIRST.runId, score: 1, result };
    expect(l.claimForSubmit({ ...claim, now: ENDED + SUBMIT_WINDOW_MS }).ok).toBe(true);
    expect(l.claimForSubmit({ ...claim, now: ENDED + SUBMIT_WINDOW_MS + 1 })).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(l.markSubmitted()).toBe(true);
    expect(l.claimForSubmit({ ...claim, now: ENDED })).toEqual({ ok: false, reason: "submitted" });
  });

  it("refuses a void run", () => {
    const l = ledger();
    l.advance(step(1, "n1", next("n2", T0 + 3000)));
    l.advance(step(1, "n1", next("n9", T0 + 3000), { guess: "lower" })); // replayed: void
    expect(
      l.claimForSubmit({
        runId: FIRST.runId,
        score: 1,
        now: T0,
        progress: { nonce: "n2", round: 2 },
      }),
    ).toEqual({ ok: false, reason: "void" });
  });

  it("closes a banked run's open question when claimed with its latest token", () => {
    const l = ledger();
    l.advance(step(1, "n1", next("n2", T0 + 3000)));
    const now = T0 + 6000;
    const claim = l.claimForSubmit({
      runId: FIRST.runId,
      score: 1,
      now,
      progress: { nonce: "n2", round: 2 },
    });
    expect(claim).toMatchObject({
      ok: true,
      closed: true,
      run: { status: "ended", end: "disconnected", streak: 1, endedAt: now },
    });
    // It stays closed: the open question can't be answered now.
    expect(l.advance(step(2, "n2", next("n3", now)))).toEqual({ ok: false, reason: "over" });
  });

  it("takes the latest token of a run the alarm already closed, but not an older one", () => {
    const l = ledger();
    l.advance(step(1, "n1", next("n2", T0 + 3000)));
    const deadline = l.run?.deadline ?? 0;
    l.onAlarm(deadline + DISCONNECT_MARGIN_MS);
    const at = deadline + DISCONNECT_MARGIN_MS + 1000;
    expect(
      l.claimForSubmit({
        runId: FIRST.runId,
        score: 1,
        now: at,
        progress: { nonce: "n2", round: 2 },
      }),
    ).toMatchObject({ ok: true, closed: false, run: { end: "disconnected" } });
    expect(
      l.claimForSubmit({
        runId: FIRST.runId,
        score: 0,
        now: at,
        progress: { nonce: "n1", round: 1 },
      }),
    ).toEqual({ ok: false, reason: "mismatch" });
  });

  it("refuses a progress token that isn't the open question's while the run is live", () => {
    const l = ledger();
    l.advance(step(1, "n1", next("n2", T0 + 3000)));
    expect(
      l.claimForSubmit({
        runId: FIRST.runId,
        score: 0,
        now: T0,
        progress: { nonce: "n1", round: 1 },
      }),
    ).toEqual({ ok: false, reason: "not_ended" });
    expect(l.claimForSubmit({ runId: FIRST.runId, score: 1, now: T0, result })).toEqual({
      ok: false,
      reason: "not_ended",
    });
    expect(l.run?.status).toBe("active");
  });
});
