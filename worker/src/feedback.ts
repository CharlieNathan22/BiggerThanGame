/**
 * `POST /api/feedback`, as a pure function of the request: "Suggest a legend",
 * "Report an error" (a card) and "Report a problem" (anything else), sent on
 * to the owner as a plain-text email.
 *
 * Privacy: nothing personal is asked for, stored or logged. There is no email
 * field; the IP is used only as a rate-limit key (app.ts) and never reaches
 * Turnstile, the email or a log. The destination address is a secret. This
 * module logs nothing itself: an accepted message goes to `accepted`, which
 * app.ts logs with what was submitted (Workers Logs, kept 3 days), and a
 * failure comes back as a `reason` code, which app.ts logs.
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
  FeedbackRequest,
  FeedbackResponse,
  Player,
  ProblemRequest,
  StatKey,
  SuggestRequest,
} from "@bt/core";
import { parseFeedbackRequest } from "./feedback-validate.js";
import type { FeedbackRejection } from "./feedback-validate.js";
import type { LogLine, LogValue } from "./log.js";
import type { PlainTextMail } from "./mail.js";
import { figureFor } from "./payload.js";
import { isRunAnswerable, verifyRunId } from "./run-id.js";
import type { RunId, RunMode } from "./run-id.js";
import { seedFor } from "./seed.js";
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
  /**
   * Told when a message is accepted — valid, and Turnstile passed — before it
   * is sent, so a failed send is still counted. app.ts logs it. Must not throw.
   */
  readonly accepted?: (feedback: AcceptedFeedback) => void;
  /** Sends the message. Throws when it couldn't. */
  readonly send: (mail: PlainTextMail) => Promise<void>;
}

/** What a sender submitted, as the log keeps it: only what they typed or were shown. */
export type Submitted = { readonly [field: string]: LogValue | undefined };

export interface AcceptedFeedback {
  readonly kind: FeedbackRequest["kind"];
  readonly submitted: Submitted;
}

export type FeedbackResult =
  | { readonly status: 200; readonly body: FeedbackResponse }
  | { readonly status: 400 | 403; readonly body: ApiError }
  | {
      readonly status: 502;
      readonly body: ApiError;
      /**
       * For app.ts's error log, never the response: `turnstile`, or the failed
       * send's error code (e.g. `E_SENDER_NOT_VERIFIED`), never its message,
       * which may quote the user's text.
       */
      readonly reason: string;
    };

export async function handleFeedback(body: unknown, ctx: FeedbackContext): Promise<FeedbackResult> {
  const parsed = parseFeedbackRequest(body);
  if (!parsed.ok) return badRequest(parsed.code);
  const req = parsed.value;

  let report: Report;
  if (req.kind === "correction") {
    const correction = await correctionReport(req, ctx);
    if (!correction.ok) return badRequest(correction.code);
    report = correction;
  } else if (req.kind === "problem") {
    report = {
      text: problemText(req, ctx.clock()),
      submitted: { note: req.note, page: req.page },
    };
  } else {
    report = {
      text: suggestionText(req, ctx.clock()),
      submitted: { name: req.name, ...(req.note !== undefined ? { note: req.note } : {}) },
    };
  }

  const verdict = await ctx.verifyTurnstile(req.turnstileToken);
  if (verdict === "fail") return { status: 403, body: { error: "verification_failed" } };
  if (verdict === "error") {
    return { status: 502, body: { error: "unavailable" }, reason: "turnstile" };
  }

  // Accepted: valid and verified. Told before the send, so it counts either way.
  ctx.accepted?.({ kind: req.kind, submitted: report.submitted });

  try {
    await ctx.send({
      from: FEEDBACK_FROM,
      to: ctx.to,
      subject: FEEDBACK_SUBJECTS[req.kind],
      text: report.text,
      date: ctx.clock(),
      messageId: `<${ctx.uuid()}@biggerthangame.com>`,
    });
  } catch (err) {
    // The error's code only (e.g. E_SENDER_NOT_VERIFIED): never the message, which is user text.
    return { status: 502, body: { error: "send_failed" }, reason: errorCode(err) };
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

/** A message's email body, and what the sender submitted, for the log line. */
interface Report {
  readonly text: string;
  readonly submitted: Submitted;
}

type CorrectionReport =
  ({ readonly ok: true } & Report) | { readonly ok: false; readonly code: FeedbackRejection };

/**
 * The report's body, from the round as the server deals it. Refuses a run id
 * this server didn't sign, one too old to answer, and a round the run never had.
 * What's logged is what the form showed: the round, its stat, and both players'
 * names and figures as the cards displayed them, with the run key, never the id.
 */
export async function correctionReport(
  req: CorrectionRequest,
  ctx: Pick<FeedbackContext, "deck" | "secret" | "clock">,
): Promise<CorrectionReport> {
  const mode = req.mode ?? "friendly";
  const run = await verifyRunId(req.runId, ctx.secret, mode);
  if (run === undefined || run.replay) return { ok: false, code: "invalid_run" };
  if (!isRunAnswerable(run, ctx.clock())) return { ok: false, code: "run_expired" };

  const now = run.date;
  const seed = await seedFor(mode, ctx.secret, run.origin);
  const rounds = buildRun({ deck: ctx.deck, seed, mode, now, maxRounds: req.round });
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
    `Round ${round.index} of ${describeRun(run, mode)}`,
    `Received: ${ctx.clock().toISOString()}`,
    "",
  ].join("\n");
  const shown = (role: "anchor" | "challenger", player: Player): LogValue => {
    const { display, qualifier } = figureFor(player, round.stat, now);
    return { role, name: player.name, display, ...(qualifier !== undefined ? { qualifier } : {}) };
  };
  const submitted: Submitted = {
    ...(req.note !== undefined ? { note: req.note } : {}),
    run: run.body,
    round: round.index,
    stat: { id: def.key, label: def.label },
    players: [shown("anchor", round.anchor), shown("challenger", round.challenger)],
  };
  return { ok: true, text, submitted };
}

/** The dashboard's line for each form. */
export const FEEDBACK_MESSAGES = {
  suggest: "Legend suggested",
  problem: "Problem reported",
  correction: "Card error reported",
} as const;

/**
 * The `info` line for an accepted message: what was sent, and the country.
 * Nothing else about the sender — no IP, user agent or token — and never where
 * it was emailed. Text arrives trimmed, capped and without control characters
 * (feedback-validate.ts), and stays plain text inside the JSON.
 */
export function feedbackLogLine(
  accepted: AcceptedFeedback,
  country: string,
  route: string,
): LogLine {
  return {
    level: "info",
    message: FEEDBACK_MESSAGES[accepted.kind],
    event: "feedback",
    route,
    kind: accepted.kind,
    country,
    submitted: accepted.submitted,
  };
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

function describeRun(run: RunId, mode: RunMode): string {
  const day = run.date.toISOString().slice(0, 10);
  return `${mode === "endless" ? "Endless run" : "run"} ${run.body} (dealt as of ${day})`;
}

function errorCode(err: unknown): string {
  if (typeof err === "object" && err !== null && "code" in err) return String(err.code);
  return err instanceof Error ? err.name : "unknown";
}

function badRequest(code: FeedbackRejection): FeedbackResult {
  return { status: 400, body: { error: "bad_request", detail: code } };
}
