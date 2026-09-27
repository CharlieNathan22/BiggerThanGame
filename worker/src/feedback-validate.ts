/**
 * Strict request parsing for `POST /api/feedback`.
 *
 * Same discipline as validate.ts: hand-written, flat, and anything unexpected
 * — an unknown kind, an extra key, a number where a string belongs, text past
 * its limit — is a 400 with a short code, never a best guess. In particular a
 * correction may carry no value of its own: the server looks the round up
 * (feedback.ts), so a `value` key is simply an unexpected key.
 *
 * Free text is cleaned before it is measured: trimmed, with control
 * characters removed (a note keeps its line breaks). It only ever goes into
 * the body of a plain-text email, never a header, a log line or a response.
 */

import { FEEDBACK_LIMITS, MAX_ROUNDS, isSitePage, textLength } from "@bt/core";
import type { CorrectionRequest, FeedbackRequest, ProblemRequest, SuggestRequest } from "@bt/core";
import { parseRunId } from "./run-id.js";

/** The short codes a bad feedback request is refused with, in `detail`. */
export type FeedbackRejection =
  | "invalid_body"
  | "unknown_kind"
  | "unexpected_key"
  | "missing_key"
  | "not_a_string"
  | "name_required"
  | "name_too_long"
  | "note_required"
  | "note_too_long"
  | "invalid_page"
  | "invalid_token"
  | "invalid_run"
  | "run_expired"
  | "invalid_round";

export type ParsedFeedback =
  | { readonly ok: true; readonly value: FeedbackRequest }
  | { readonly ok: false; readonly code: FeedbackRejection };

const SUGGEST_KEYS = new Set(["kind", "name", "note", "turnstileToken"]);
const CORRECTION_KEYS = new Set(["kind", "runId", "round", "note", "turnstileToken"]);
const PROBLEM_KEYS = new Set(["kind", "note", "page", "turnstileToken"]);

export function parseFeedbackRequest(body: unknown): ParsedFeedback {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail("invalid_body");
  }
  const record = body as Record<string, unknown>;
  if (record.kind === "suggest") return parseSuggest(record);
  if (record.kind === "correction") return parseCorrection(record);
  if (record.kind === "problem") return parseProblem(record);
  return fail("unknown_kind");
}

function parseSuggest(record: Record<string, unknown>): ParsedFeedback {
  const shape = checkKeys(record, SUGGEST_KEYS, ["name", "turnstileToken"]);
  if (shape !== undefined) return fail(shape);

  const common = parseCommon(record);
  if (!common.ok) return common;

  if (typeof record.name !== "string") return fail("not_a_string");
  const name = cleanLine(record.name);
  if (name === "") return fail("name_required");
  if (textLength(name) > FEEDBACK_LIMITS.name) return fail("name_too_long");

  const value: SuggestRequest = {
    kind: "suggest",
    name,
    ...common.value,
  };
  return { ok: true, value };
}

function parseCorrection(record: Record<string, unknown>): ParsedFeedback {
  const shape = checkKeys(record, CORRECTION_KEYS, ["runId", "round", "turnstileToken"]);
  if (shape !== undefined) return fail(shape);

  const common = parseCommon(record);
  if (!common.ok) return common;

  const { runId, round } = record;
  if (typeof runId !== "string") return fail("not_a_string");
  if (parseRunId(runId) === undefined) return fail("invalid_run");
  if (typeof round !== "number" || !Number.isInteger(round) || round < 1 || round > MAX_ROUNDS) {
    return fail("invalid_round");
  }

  const value: CorrectionRequest = { kind: "correction", runId, round, ...common.value };
  return { ok: true, value };
}

function parseProblem(record: Record<string, unknown>): ParsedFeedback {
  const shape = checkKeys(record, PROBLEM_KEYS, ["note", "page", "turnstileToken"]);
  if (shape !== undefined) return fail(shape);

  const common = parseCommon(record);
  if (!common.ok) return common;
  // A problem report is its note: without one there's nothing to send.
  const { note } = common.value;
  if (note === undefined) return fail("note_required");

  const { page } = record;
  if (typeof page !== "string") return fail("not_a_string");
  if (!isSitePage(page)) return fail("invalid_page");

  const value: ProblemRequest = {
    kind: "problem",
    note,
    page,
    turnstileToken: common.value.turnstileToken,
  };
  return { ok: true, value };
}

/** The token and the note, which every kind carries (optional but for a problem). */
function parseCommon(
  record: Record<string, unknown>,
):
  | { readonly ok: true; readonly value: { turnstileToken: string; note?: string } }
  | { readonly ok: false; readonly code: FeedbackRejection } {
  const { turnstileToken, note } = record;
  if (typeof turnstileToken !== "string") return fail("not_a_string");
  if (turnstileToken === "" || turnstileToken.length > FEEDBACK_LIMITS.token) {
    return fail("invalid_token");
  }
  if (note !== undefined && typeof note !== "string") return fail("not_a_string");

  const cleaned = note === undefined ? "" : cleanNote(note);
  if (textLength(cleaned) > FEEDBACK_LIMITS.note) return fail("note_too_long");
  return { ok: true, value: { turnstileToken, ...(cleaned !== "" ? { note: cleaned } : {}) } };
}

/** An unknown key first, then a missing one. Undefined when the shape is right. */
function checkKeys(
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  required: readonly string[],
): FeedbackRejection | undefined {
  if (Object.keys(record).some((k) => !allowed.has(k))) return "unexpected_key";
  if (required.some((k) => !(k in record))) return "missing_key";
  return undefined;
}

/**
 * C0 and C1 controls and DEL, the Unicode line and paragraph separators, and
 * the bidirectional overrides and isolates that can make text read differently
 * from what it contains. Zero-width joiners stay: emoji and some scripts need them.
 */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;

/** One line of text: every control character, line breaks included, removed. */
export function cleanLine(text: string): string {
  return text.replace(CONTROL, "").trim();
}

/**
 * A note: line breaks kept (any style becomes `\n`, a tab a space), every
 * other control character removed, and no more than one blank line in a row.
 */
export function cleanNote(text: string): string {
  return text
    .replace(/\r\n?|[\u2028\u2029]/g, "\n")
    .replace(/\t/g, " ")
    .split("\n")
    .map((line) => line.replace(CONTROL, "").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function fail(code: FeedbackRejection): { readonly ok: false; readonly code: FeedbackRejection } {
  return { ok: false, code };
}
