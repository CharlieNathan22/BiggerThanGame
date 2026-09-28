/**
 * Structured logs for Workers Logs (ARCHITECTURE.md §19).
 *
 * One object per event, `{ level, message, event, route, reason?, … }`, written
 * with the console method matching its level. Workers Logs shows `message` as
 * the line and indexes every field, so the dashboard can filter on `event`,
 * `reason` or anything else; a string would only be searchable as text.
 *
 * What gets a line: every 4xx the API refuses (`warn`, apart from unknown
 * `/api/` paths, which scanners hit), every 429 (`warn`), every failure of
 * ours (`error`), the start and end of each run (`info`), and each feedback
 * form accepted (`info`). Nothing else — no successful answer.
 *
 * Cloudflare's own invocation logs are off (wrangler.toml): they record every
 * request's IP, location, user agent and headers. These lines are all there is.
 *
 * Never put in a line: `RUN_SECRET` or any secret, a seed, an HMAC or
 * signature, a full run id (the run key, its body before the ".", is fine),
 * an IP, a user agent, a Turnstile token or `FEEDBACK_TO`. A stat value only
 * once it has been revealed: `run_end`'s final round, and the figures a
 * correction report was sent about. Feedback text only in the `feedback` line.
 * A request body is `unknown`, so it can't be passed in whole.
 */

export type LogLevel = "info" | "warn" | "error";

/** A field's value: JSON, so Workers Logs can index nested fields too. */
export type LogValue =
  string | number | readonly LogValue[] | { readonly [field: string]: LogValue | undefined };

export interface LogLine {
  readonly level: LogLevel;
  /**
   * The line as the dashboard lists it: `run_start` or `run_end`, a sentence
   * for feedback, `<event> · <reason>` for a refusal or failure.
   */
  readonly message: string;
  /** What happened: an `ApiError` code, `run_start` / `run_end`, or `feedback`. */
  readonly event: string;
  /** The endpoint, e.g. `/api/round/next`. */
  readonly route: string;
  /** Why, when there's a why: a short code, a missing secret's name, a run's end. */
  readonly reason?: string;
  readonly [field: string]: LogValue | undefined;
}

export type Logger = (line: LogLine) => void;

const METHOD = { info: "log", warn: "warn", error: "error" } as const;

/** The default logger: one object on the console, at the line's level. */
export const log: Logger = (line) => {
  console[METHOD[line.level]](line);
};

/** A refusal's or failure's `message`: `bad_request · invalid_json`, or the event alone. */
export function problemMessage(event: string, reason: string | undefined): string {
  return reason === undefined ? event : `${event} · ${reason}`;
}

/**
 * An exception as a log line's fields: its name, and its message as `cause`,
 * capped. Only for errors raised by our own code or the platform — never user
 * text, which is caught and reduced to a code before it can throw (feedback.ts).
 */
export function describeError(err: unknown): { reason: string; cause?: string } {
  if (err instanceof Error) return { reason: err.name, cause: err.message.slice(0, 300) };
  return { reason: typeof err };
}
