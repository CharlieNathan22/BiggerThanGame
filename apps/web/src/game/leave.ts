/**
 * Telling the server where a run was when the player left: hid the tab or
 * closed the page mid-run (ARCHITECTURE.md §19). A beacon to
 * `POST /api/run/leave` that the page never waits on and the run never
 * depends on.
 *
 * Only a run in progress reports: after Start, once the server has dealt it,
 * and before it ends. Each trigger reports once per run, so a player flicking
 * between tabs sends one "hidden", and closing the page adds one "pagehide".
 * The report says which run, which round is on screen and what the player was
 * looking at; the server looks the round up itself.
 */

import type { LeavePhase, LeaveRequest, LeaveTrigger } from "@bt/core";
import type { GameState } from "./machine";

export const LEAVE_ENDPOINT = "/api/run/leave";

type Mode = LeaveRequest["mode"];

/**
 * The report for this moment, or null when there's no run in progress: before
 * Start, while the start is on its way, and once the run has ended.
 */
export function leaveRequest(
  state: Pick<GameState, "phase" | "runId" | "round" | "reveal" | "end">,
  mode: Mode,
  trigger: LeaveTrigger,
): LeaveRequest | null {
  const { phase, runId, round } = state;
  if (runId === null || state.end !== null) return null;
  if (phase === "idle" || phase === "starting" || phase === "over") return null;
  const where = leavePhase(state);
  if (where === "intro" || round === null) {
    return { mode, runId, round: 0, phase: "intro", trigger };
  }
  return { mode, runId, round: round.index, phase: where, trigger };
}

/** What the player was looking at, by the machine's phase. */
function leavePhase(state: Pick<GameState, "phase" | "round" | "reveal">): LeavePhase {
  switch (state.phase) {
    case "title":
    case "holding":
    case "intro":
      return "intro";
    case "awaiting":
      return "question";
    case "revealing":
    case "verdict":
    case "sliding":
      // The answer is on screen once it has arrived; until then the question still is.
      return state.reveal !== null && state.reveal.round === state.round?.index
        ? "reveal"
        : "question";
    default:
      return "other";
  }
}

/**
 * Sends each run's reports, once per trigger. `send` is `navigator.sendBeacon`
 * in the browser; a report it refuses isn't tried again.
 */
export function createLeaveReporter(send: (body: string) => void): {
  report(
    state: Pick<GameState, "phase" | "runId" | "round" | "reveal" | "end">,
    mode: Mode,
    trigger: LeaveTrigger,
  ): void;
} {
  const sent = new Set<string>();
  return {
    report(state, mode, trigger) {
      const request = leaveRequest(state, mode, trigger);
      if (request === null) return;
      const key = `${request.runId} ${trigger}`;
      if (sent.has(key)) return;
      sent.add(key);
      send(JSON.stringify(request));
    },
  };
}
