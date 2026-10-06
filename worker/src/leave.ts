/**
 * `POST /api/run/leave`, as a pure function of the request: the beacon the
 * game page sends when the player hides or closes it mid-run (ARCHITECTURE.md
 * §8, §19).
 *
 * Telemetry only. It changes nothing about the run — Friendly is stateless, an
 * Endless run's Durable Object is never touched, and this records an event
 * and returns — and its answer is an empty 204 that
 * the page never reads. The run id must be one this server signed and still
 * answers; the round must be one the run has (or 0, the title card and the
 * intro). The round is rebuilt from the seed here, and what's logged of it is
 * what the player had been shown by then (`shownRound`), never a value from
 * the page.
 */

import { buildRun, isNamedVariant, roundCap } from "@bt/core";
import type { ApiError, LeavePhase, LeaveRequest, LeaveTrigger, Player } from "@bt/core";
import { shownRound } from "./analytics.js";
import type { GameEvent, ShownRound } from "./analytics.js";
import {
  canDeal,
  dealOptions,
  isRunAnswerable,
  parseRunId,
  runModeOf,
  verifyRunId,
} from "./run-id.js";
import { named } from "./run.js";
import { seedFor } from "./seed.js";
import type { Parsed } from "./validate.js";

export const LEAVE_PHASES: readonly LeavePhase[] = ["intro", "question", "reveal", "other"];
export const LEAVE_TRIGGERS: readonly LeaveTrigger[] = ["hidden", "pagehide"];

const LEAVE_KEYS = ["mode", "phase", "round", "runId", "trigger"];

export interface LeaveContext {
  readonly deck: readonly Player[];
  readonly secret: string;
  readonly clock: () => Date;
  /** Told about the leave; app.ts logs it and writes the data point. Must not throw. */
  readonly record?: (event: GameEvent) => void;
}

export type LeaveResult =
  { readonly status: 204 } | { readonly status: 400; readonly body: ApiError };

export function parseLeaveRequest(body: unknown): Parsed<LeaveRequest> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail("body must be a JSON object");
  }
  const record = body as Record<string, unknown>;
  // `variant` aside (an Endless variant's runs only), exactly these keys.
  const keys = Object.keys(record)
    .filter((k) => k !== "variant")
    .sort();
  if (keys.length !== LEAVE_KEYS.length || keys.some((k, i) => k !== LEAVE_KEYS[i])) {
    return fail("expected { mode, variant?, runId, round, phase, trigger }");
  }
  const { mode, runId, round, phase, trigger, variant } = record;
  if (mode !== "friendly" && mode !== "endless")
    return fail('mode must be "friendly" or "endless"');
  if ("variant" in record && (mode !== "endless" || !isNamedVariant(variant))) {
    return fail('variant must be "endless-instagram" or "squad:<theme>", in Endless only');
  }
  const cap = roundCap(mode);
  if (typeof runId !== "string" || parseRunId(runId) === undefined) {
    return fail("runId is malformed");
  }
  if (typeof round !== "number" || !Number.isInteger(round) || round < 0 || round > cap) {
    return fail(`round must be an integer from 0 to ${cap}`);
  }
  if (typeof phase !== "string" || !(LEAVE_PHASES as readonly string[]).includes(phase)) {
    return fail(`phase must be one of ${LEAVE_PHASES.join(", ")}`);
  }
  if (typeof trigger !== "string" || !(LEAVE_TRIGGERS as readonly string[]).includes(trigger)) {
    return fail(`trigger must be one of ${LEAVE_TRIGGERS.join(", ")}`);
  }
  // Round 0 is the title card and the intro, and only them.
  if ((round === 0) !== (phase === "intro")) {
    return fail('round 0 goes with phase "intro", and only with it');
  }
  return {
    ok: true,
    value: {
      mode,
      ...(isNamedVariant(variant) ? { variant } : {}),
      runId,
      round,
      phase: phase as LeavePhase,
      trigger: trigger as LeaveTrigger,
    },
  };
}

export async function handleLeave(body: unknown, ctx: LeaveContext): Promise<LeaveResult> {
  const parsed = parseLeaveRequest(body);
  if (!parsed.ok) return badRequest(parsed.detail);
  const req = parsed.value;

  const kind = runModeOf(req.mode, req.variant);
  const run = await verifyRunId(req.runId, ctx.secret, kind);
  if (run === undefined) return badRequest("runId is not one this server issued");
  if (run.replay) return badRequest("replay ids are refused: challenge links are off in Friendly");
  if (!isRunAnswerable(run, ctx.clock())) return badRequest("runId is out of date");
  if (!canDeal(kind, ctx.deck)) return badRequest("this run's theme is no longer in the deck");

  let shown: ShownRound | undefined;
  if (req.round > 0) {
    const now = run.date;
    const seed = await seedFor(kind, ctx.secret, run.origin);
    const rounds = buildRun({
      deck: ctx.deck,
      seed,
      ...dealOptions(kind),
      now,
      maxRounds: req.round,
    });
    const round = rounds[req.round - 1];
    if (round === undefined) return badRequest(`this run has no round ${req.round}`);
    shown = shownRound(round, now, req.phase);
  }

  ctx.record?.({
    type: "leave",
    mode: req.mode,
    ...(kind === "friendly" ? {} : named(kind)),
    run: run.body,
    runKind: "fresh",
    round: req.round,
    phase: req.phase,
    trigger: req.trigger,
    ...(shown !== undefined ? { shown } : {}),
  });
  return { status: 204 };
}

function fail(detail: string): Parsed<never> {
  return { ok: false, detail };
}

function badRequest(detail: string): LeaveResult {
  return { status: 400, body: { error: "bad_request", detail } };
}
