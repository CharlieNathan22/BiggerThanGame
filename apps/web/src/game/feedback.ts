/**
 * The feedback forms' logic: "Suggest a legend", "Report an error" (the card
 * that ended a run) and "Report a problem" (anything else), sent to
 * `POST /api/feedback`. Pure, and the network injected, so it runs under test
 * in Node; FeedbackModal.svelte renders it and holds no rules.
 *
 * A report names the round that ended the run by run id and index, nothing
 * else. The two players, the stat and both figures shown in the form are ones
 * the player has already seen; the server looks the round up for itself and
 * never takes a value from here (ARCHITECTURE.md §8). A problem report names
 * the site page it came from. Nothing personal is asked for: there is no email
 * field.
 */

import { FEEDBACK_LIMITS, isSitePage, textLength } from "@bt/core";
import type { FeedbackRequest, NamedVariant, SitePage, StatKey } from "@bt/core";
import { t } from "../i18n";
import { FRIENDLY_PATH } from "../lib/paths";
import type { Fetch } from "./api";
import type { GameMode, GameState } from "./machine";
import type { Timings } from "./timing";
import { qualifierText } from "./view";

export const FEEDBACK_ENDPOINT = "/api/feedback";

/** Longer than a round request's: Turnstile and an email sit behind this one. */
export const FEEDBACK_TIMEOUT_MS = 15_000;

export type FeedbackKind = "suggest" | "correction" | "problem";

/** The forms a link can open: every one but the report, which needs a finished run. */
export type LinkedFeedback = Exclude<FeedbackKind, "correction">;

/**
 * The form a link names: a page's hash (`#suggest`, `#problem`) or a footer
 * link's `data-feedback`. Null for anything else.
 */
export function linkedFeedback(value: string): LinkedFeedback | null {
  const name = value.startsWith("#") ? value.slice(1) : value;
  return name === "suggest" || name === "problem" ? name : null;
}

/**
 * The site page a path is, for a problem report: `/about.html` and
 * `/index.html` read as the pages they serve, and any other path is the 404
 * page, which is what the site serves there.
 */
export function sitePage(path: string): SitePage {
  const page = path.replace(/\/index\.html$/, "/").replace(/\.html$/, "");
  return isSitePage(page) ? page : "/404";
}

/**
 * Where a deep link (`…/friendly#problem`) was followed from: the referring
 * page if it is on this site, else the game page it opened on. Only a path,
 * never the query or anything else in the referrer.
 */
export function arrivedFrom(referrer: string, origin: string): SitePage {
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return FRIENDLY_PATH;
  }
  return url.origin === origin ? sitePage(url.pathname) : FRIENDLY_PATH;
}

/** A figure as the card showed it. */
export interface ShownFigure {
  readonly name: string;
  readonly display: string;
  readonly qualifier?: string;
}

/** The round a report is about: its address, and what the player saw of it. */
export interface ReportedRound {
  /** Endless for an Endless run: its run ids are signed apart from Friendly's. */
  readonly mode: GameMode;
  /** An Endless variant's run, when not general Endless: signed apart again. */
  readonly variant?: NamedVariant;
  readonly runId: string;
  readonly round: number;
  readonly stat: StatKey;
  readonly anchor: ShownFigure;
  readonly challenger: ShownFigure;
}

/**
 * The round that ended the run, once both figures have been shown. Null before
 * the run is over, and for a run banked after a dropped connection, where the
 * challenger's figure never arrived.
 */
export function reportedRound(state: GameState): ReportedRound | null {
  const { phase, runId, round, reveal } = state;
  if (phase !== "over" || runId === null || round === null || reveal === null) return null;
  if (reveal.round !== round.index) return null;
  return {
    mode: state.mode,
    ...(state.variant !== undefined ? { variant: state.variant } : {}),
    runId,
    round: round.index,
    stat: round.stat.key,
    anchor: figure(round.anchor.name, round.anchor.display, round.anchor.qualifier),
    challenger: figure(round.challenger.name, reveal.display, reveal.qualifier),
  };
}

function figure(name: string, display: string, qualifier: string | undefined): ShownFigure {
  return { name, display, ...(qualifier !== undefined ? { qualifier } : {}) };
}

export interface Draft {
  readonly name: string;
  readonly note: string;
}

export type DraftProblem = "nameRequired" | "nameTooLong" | "noteRequired" | "noteTooLong";

/** What stops the draft being sent, if anything. The server checks again. */
export function draftProblem(kind: FeedbackKind, draft: Draft): DraftProblem | null {
  if (kind === "suggest") {
    const name = draft.name.trim();
    if (name === "") return "nameRequired";
    if (textLength(name) > FEEDBACK_LIMITS.name) return "nameTooLong";
  }
  const note = draft.note.trim();
  if (kind === "problem" && note === "") return "noteRequired";
  if (textLength(note) > FEEDBACK_LIMITS.note) return "noteTooLong";
  return null;
}

/** What a form is about: the round for a report, the page for a problem. */
export interface FeedbackContext {
  readonly report: ReportedRound | null;
  readonly page: SitePage;
}

/** The request body. A blank optional note is left out. */
export function feedbackRequest(
  kind: FeedbackKind,
  draft: Draft,
  context: FeedbackContext,
  turnstileToken: string,
): FeedbackRequest {
  const note = draft.note.trim();
  const withNote = note !== "" ? { note } : {};
  if (kind === "suggest") {
    return { kind, name: draft.name.trim(), ...withNote, turnstileToken };
  }
  if (kind === "problem") {
    return { kind, note, page: context.page, turnstileToken };
  }
  const { report } = context;
  if (report === null) throw new Error("feedbackRequest: a correction needs the round it's about");
  return {
    kind,
    ...(report.mode === "endless" ? { mode: "endless" as const } : {}),
    ...(report.mode === "ranked" ? { mode: "ranked" as const } : {}),
    ...(report.mode === "endless" && report.variant !== undefined
      ? { variant: report.variant }
      : {}),
    runId: report.runId,
    round: report.round,
    ...withNote,
    turnstileToken,
  };
}

/** How a send went, as the form tells the player. */
export type SendOutcome =
  /** Sent on. */
  | "sent"
  /** Too many messages from this connection: a calm "try again in a minute". */
  | "rateLimited"
  /** Turnstile said no: the form gets a fresh check. */
  | "verificationFailed"
  /** Anything else: no connection, a refusal, a server or send failure. */
  | "failed";

export async function sendFeedback(
  fetchFn: Fetch,
  body: FeedbackRequest,
  timeoutMs = FEEDBACK_TIMEOUT_MS,
): Promise<SendOutcome> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetchFn(FEEDBACK_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: abort.signal,
    });
    if (response.ok) return "sent";
    if (response.status === 429) return "rateLimited";
    if (response.status === 403) return "verificationFailed";
    return "failed";
  } catch {
    return "failed";
  } finally {
    clearTimeout(timer);
  }
}

/** One card's line in the report: "Zinedine Zidane: €77.5m (2001)". */
export function shownFigureText(stat: StatKey, figure: ShownFigure): string {
  const qualifier = qualifierText(stat, figure.qualifier);
  const params = { name: figure.name, display: figure.display, qualifier };
  return qualifier === ""
    ? t("feedback.report.figure", params)
    : t("feedback.report.qualified", params);
}

/** What the form is doing, from the player's side. */
export type FormStatus =
  | "editing"
  | "sending"
  | "sent"
  | "failed"
  | "rateLimited"
  | "verificationFailed"
  /** The Turnstile script couldn't load. */
  | "checkFailed";

/** The status line under the form. Empty while there's nothing to say. */
export function statusText(status: FormStatus, problem: DraftProblem | null): string {
  switch (status) {
    case "editing":
      if (problem === "nameRequired") return t("feedback.nameRequired");
      if (problem === "noteRequired") return t("feedback.noteRequired");
      if (problem !== null) return t("feedback.tooLong");
      return "";
    case "sending":
      return t("feedback.sending");
    case "sent":
      return t("feedback.sent");
    case "failed":
      return t("feedback.failed");
    case "rateLimited":
      return t("feedback.slowDown");
    case "verificationFailed":
      return t("feedback.verifyFailed");
    case "checkFailed":
      return t("feedback.checkFailed");
  }
}

/**
 * After a send goes through: "Thanks" shows for `thanks`, long enough to read,
 * then the modal fades for `modal` and closes. The player can close it sooner. With reduced motion there's no fade, but the same
 * pause, so the message can still be read (and heard) before it goes.
 */
export function afterSent(
  timings: Pick<Timings, "thanks" | "modal">,
  reducedMotion: boolean,
): { readonly fadeAt: number; readonly closeAt: number } {
  const fade = reducedMotion ? 0 : timings.modal;
  return { fadeAt: timings.thanks, closeAt: timings.thanks + fade };
}

/**
 * Where Tab should wrap to inside the dialog, or null to let the browser move
 * focus as usual. `index` is the focused element's place among the dialog's
 * focusable elements, -1 if focus is somewhere else.
 */
export function wrapFocus(index: number, count: number, backwards: boolean): number | null {
  if (count === 0) return null;
  if (backwards) return index <= 0 ? count - 1 : null;
  return index === -1 || index >= count - 1 ? 0 : null;
}
