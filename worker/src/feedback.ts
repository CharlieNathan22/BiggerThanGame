/**
 * `POST /api/feedback`, as a pure function of the request: "Suggest a legend",
 * "Report an error" (a card) and "Report a problem" (anything else), sent on
 * to the owner as a plain-text email.
 *
 * Privacy: nothing personal is asked for, stored or logged. There is no email
 * field; the IP is used only as a rate-limit key (app.ts) and never reaches
 * Turnstile, the email or a log. The destination address is a secret.
 *
 * A correction names a run and a round, nothing more. The server verifies the
 * run id's signature, rebuilds that round from the seed exactly as the round
 * endpoint dealt it, and writes the two players, the stat and both values into
 * the email itself. Values never come from the client, and the response is a
 * bare `{ ok: true }`, so nothing new reaches the client (ARCHITECTURE.md §4).
 *
 * Checks run cheapest first — shape, then the run, then Turnstile over the
 * network — and the email goes last. Deck, secret, clock, Turnstile and the
 * send are all injected, so tests drive this in Node.
 */

import { STATS, buildRun, valueOf } from "@bt/core";
import type {
  ApiError,
  CorrectionRequest,
  FeedbackResponse,
  Player,
  ProblemRequest,
  StatKey,
  SuggestRequest,
} from "@bt/core";
import { parseFeedbackRequest } from "./feedback-validate.js";
import type { FeedbackRejection } from "./feedback-validate.js";
import type { PlainTextMail } from "./mail.js";
import { isRunAnswerable, verifyRunId } from "./run-id.js";
import type { RunId } from "./run-id.js";
import { friendlySeed } from "./seed.js";
import type { TurnstileOutcome } from "./turnstile.js";

/** The sender: an address on the site's own domain, where Email Routing is set up. */
export const FEEDBACK_FROM = "feedback@biggerthangame.com";

/** Fixed per kind. No user text ever goes in a header. */
export const FEEDBACK_SUBJECTS = {
  suggest: "Bigger Than: legend suggestion",
  correction: "Bigger Than: correction report",
  problem: "Bigger Than: problem report",
} as const;

export interface FeedbackContext {
  readonly deck: readonly Player[];
  /** `RUN_SECRET`: verifies run ids and derives seeds. */
  readonly secret: string;
  readonly clock: () => Date;
  /** Where the email goes: the `FEEDBACK_TO` secret. */
  readonly to: string;
  /** A unique id for the Message-ID header. */
  readonly uuid: () => string;
  readonly verifyTurnstile: (token: string) => Promise<TurnstileOutcome>;
  /** Sends the message. Throws when it couldn't. */
  readonly send: (mail: PlainTextMail) => Promise<void>;
}

export type FeedbackResult =
  | { readonly status: 200; readonly body: FeedbackResponse }
  | { readonly status: 400 | 403 | 502; readonly body: ApiError };

export async function handleFeedback(body: unknown, ctx: FeedbackContext): Promise<FeedbackResult> {
  const parsed = parseFeedbackRequest(body);
  if (!parsed.ok) return badRequest(parsed.code);
  const req = parsed.value;

  let text: string;
  if (req.kind === "correction") {
    const report = await correctionText(req, ctx);
    if (!report.ok) return badRequest(report.code);
    text = report.text;
  } else if (req.kind === "problem") {
    text = problemText(req, ctx.clock());
  } else {
    text = suggestionText(req, ctx.clock());
  }

  const verdict = await ctx.verifyTurnstile(req.turnstileToken);
  if (verdict === "fail") return { status: 403, body: { error: "verification_failed" } };
  if (verdict === "error") return { status: 502, body: { error: "unavailable" } };

  try {
    await ctx.send({
      from: FEEDBACK_FROM,
      to: ctx.to,
      subject: FEEDBACK_SUBJECTS[req.kind],
      text,
      date: ctx.clock(),
      messageId: `<${ctx.uuid()}@biggerthangame.com>`,
    });
  } catch (err) {
    // The error's code only (e.g. E_SENDER_NOT_VERIFIED): never the message, which is user text.
    console.error("feedback send failed", errorCode(err));
    return { status: 502, body: { error: "send_failed" } };
  }
  return { status: 200, body: { ok: true } };
}

export function suggestionText(req: SuggestRequest, received: Date): string {
  return [
    "Legend suggestion",
    "",
    `Name: ${req.name}`,
    "",
    "Note:",
    req.note ?? "(none)",
    "",
    `Received: ${received.toISOString()}`,
    "",
  ].join("\n");
}

/** The page is one of the site's own (validated); nothing else about the sender. */
export function problemText(req: ProblemRequest, received: Date): string {
  return [
    "Problem report",
    "",
    `Page: ${req.page}`,
    "",
    "Note:",
    req.note,
    "",
    `Received: ${received.toISOString()}`,
    "",
  ].join("\n");
}

type CorrectionText =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly code: FeedbackRejection };

/**
 * The report's body, from the round as the server deals it. Refuses a run id
 * this server didn't sign, one too old to answer, and a round the run never had.
 */
export async function correctionText(
  req: CorrectionRequest,
  ctx: Pick<FeedbackContext, "deck" | "secret" | "clock">,
): Promise<CorrectionText> {
  const run = await verifyRunId(req.runId, ctx.secret);
  if (run === undefined) return { ok: false, code: "invalid_run" };
  if (!isRunAnswerable(run, ctx.clock())) return { ok: false, code: "run_expired" };

  const now = run.date;
  const seed = await friendlySeed(ctx.secret, run.origin);
  const rounds = buildRun({ deck: ctx.deck, seed, mode: "friendly", now, maxRounds: req.round });
  const round = rounds[req.round - 1];
  if (round === undefined) return { ok: false, code: "invalid_round" };

  const def = STATS[round.stat];
  const text = [
    "Correction report",
    "",
    `Stat: ${def.label} (${def.key})`,
    `Shown:  ${figureLine(round.anchor, round.stat, now)}`,
    `Hidden: ${figureLine(round.challenger, round.stat, now)}`,
    "",
    "Note:",
    req.note ?? "(none)",
    "",
    `Round ${round.index} of ${describeRun(run)}`,
    `Received: ${ctx.clock().toISOString()}`,
    "",
  ].join("\n");
  return { ok: true, text };
}

/** `Zinedine Zidane (zidane-zinedine): €77.5m, 2001 [77.5]` — as the card showed it, then raw. */
function figureLine(player: Player, stat: StatKey, now: Date): string {
  const def = STATS[stat];
  const value = valueOf(player, stat, now);
  if (value === undefined) {
    throw new Error(`${player.id} has no ${stat}; the engine must not deal an ineligible player`);
  }
  const qualifier = def.qualifier?.(player);
  const shown = qualifier === undefined ? def.format(value) : `${def.format(value)}, ${qualifier}`;
  return `${player.name} (${player.id}): ${shown} [${value}]`;
}

function describeRun(run: RunId): string {
  const day = run.date.toISOString().slice(0, 10);
  return run.replay
    ? `replay ${run.body} of run ${run.origin} (dealt as of ${day})`
    : `run ${run.body} (dealt as of ${day})`;
}

function errorCode(err: unknown): string {
  if (typeof err === "object" && err !== null && "code" in err) return String(err.code);
  return err instanceof Error ? err.name : "unknown";
}

function badRequest(code: FeedbackRejection): FeedbackResult {
  return { status: 400, body: { error: "bad_request", detail: code } };
}
