import { describe, expect, it } from "vitest";
import type { Reveal } from "@bt/core";
import { createLeaveReporter, leaveRequest } from "../leave";
import type { GameState, Phase } from "../machine";
import { RUN_ID, round } from "./fixtures";

type LeaveState = Pick<GameState, "phase" | "runId" | "round" | "reveal" | "end">;

function state(phase: Phase, extra: Partial<LeaveState> = {}): LeaveState {
  return { phase, runId: RUN_ID, round: round(4), reveal: null, end: null, ...extra };
}

const revealed = (index: number): Reveal => ({
  round: index,
  value: 80,
  display: "80",
  correct: true,
});

describe("leaveRequest", () => {
  it("says nothing before a run is dealt, or once it has ended", () => {
    expect(
      leaveRequest(state("idle", { runId: null, round: null }), "friendly", "hidden"),
    ).toBeNull();
    expect(
      leaveRequest(state("starting", { runId: null, round: null }), "friendly", "hidden"),
    ).toBeNull();
    expect(leaveRequest(state("over", { end: "wrong" }), "friendly", "pagehide")).toBeNull();
    expect(leaveRequest(state("over", { end: "won" }), "friendly", "hidden")).toBeNull();
    expect(
      leaveRequest(state("verdict", { end: "deck-exhausted" }), "friendly", "hidden"),
    ).toBeNull();
  });

  it.each<[Phase, Partial<LeaveState>, number, string]>([
    ["title", { round: round(1) }, 0, "intro"],
    ["holding", { round: round(1) }, 0, "intro"],
    ["intro", { round: round(1) }, 0, "intro"],
    ["dealing", {}, 4, "other"],
    ["spinning", {}, 4, "other"],
    ["awaiting", {}, 4, "question"],
    // The guess has gone, the answer hasn't come back: the question is still on screen.
    ["revealing", {}, 4, "question"],
    ["revealing", { reveal: revealed(4) }, 4, "reveal"],
    ["verdict", { reveal: revealed(4) }, 4, "reveal"],
    ["sliding", { reveal: revealed(4) }, 4, "reveal"],
    // An earlier round's reveal is never this round's.
    ["verdict", { reveal: revealed(3) }, 4, "question"],
  ])("reports %s as round %i, phase %s", (phase, extra, index, where) => {
    expect(leaveRequest(state(phase, extra), "friendly", "hidden")).toEqual({
      mode: "friendly",
      runId: RUN_ID,
      round: index,
      phase: where,
      trigger: "hidden",
    });
  });

  it("sends only the five fields", () => {
    const request = leaveRequest(state("awaiting"), "friendly", "pagehide");
    expect(Object.keys(request ?? {}).sort()).toEqual([
      "mode",
      "phase",
      "round",
      "runId",
      "trigger",
    ]);
  });
});

describe("createLeaveReporter", () => {
  it("sends each trigger once per run", () => {
    const sent: string[] = [];
    const leaves = createLeaveReporter((body) => sent.push(body));
    leaves.report(state("awaiting"), "friendly", "hidden");
    leaves.report(state("verdict", { reveal: revealed(4) }), "friendly", "hidden");
    leaves.report(state("awaiting"), "friendly", "pagehide");
    leaves.report(state("awaiting"), "friendly", "pagehide");
    expect(sent.map((b) => JSON.parse(b) as { trigger: string; phase: string })).toEqual([
      expect.objectContaining({ trigger: "hidden", phase: "question" }),
      expect.objectContaining({ trigger: "pagehide", phase: "question" }),
    ]);
  });

  it("starts again for the next run", () => {
    const sent: string[] = [];
    const leaves = createLeaveReporter((body) => sent.push(body));
    const other = RUN_ID.replace("000000000001", "000000000002");
    leaves.report(state("awaiting"), "friendly", "hidden");
    leaves.report(state("awaiting", { runId: other }), "friendly", "hidden");
    expect(sent.map((b) => (JSON.parse(b) as { runId: string }).runId)).toEqual([RUN_ID, other]);
  });

  it("sends nothing outside a run, and doesn't use up the trigger doing so", () => {
    const sent: string[] = [];
    const leaves = createLeaveReporter((body) => sent.push(body));
    leaves.report(state("over", { end: "wrong" }), "friendly", "hidden");
    expect(sent).toEqual([]);
    leaves.report(state("idle", { runId: null, round: null }), "friendly", "pagehide");
    expect(sent).toEqual([]);
  });
});
