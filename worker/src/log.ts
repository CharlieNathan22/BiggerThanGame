/**
 * Structured logs for Workers Logs (ARCHITECTURE.md §19).
 *
 * One object per event, `{ level, event, route, reason?, … }`, written with the
 * console method matching its level. Workers Logs indexes an object's fields,
 * so the dashboard can filter on `event` or `reason`; a string would only be
 * searchable as text.
 *
 * What gets a line: every 4xx the API refuses (`warn`, apart from unknown
 * `/api/` paths, which scanners hit), every 429 (`warn`), every failure of
 * ours (`error`), and the start and end of each run (`info`). Nothing else —
 * no successful answer, no successful feedback.
 *
 * Never put in a line: `RUN_SECRET` or any secret, a seed, an HMAC or
 * signature, a full run id (the run key, its body before the ".", is fine),
 * an IP, a user agent, feedback text, or a stat value. Fields are typed as
 * short strings and numbers so a request body can't be passed in whole.
 */

export type LogLevel = "info" | "warn" | "error";

export interface LogLine {
  readonly level: LogLevel;
  /** What happened: an `ApiError` code, or `run_start` / `run_end`. */
  readonly event: string;
  /** The endpoint, e.g. `/api/round/next`. */
  readonly route: string;
  /** Why, when there's a why: a short code, a missing secret's name, a run's end. */
  readonly reason?: string;
  readonly [field: string]: string | number | undefined;
}

export type Logger = (line: LogLine) => void;

const METHOD = { info: "log", warn: "warn", error: "error" } as const;

/** The default logger: one object on the console, at the line's level. */
export const log: Logger = (line) => {
  console[METHOD[line.level]](line);
};

/**
 * An exception as a log line's fields: its name and message, capped. Only for
 * errors raised by our own code or the platform — never user text, which is
 * caught and reduced to a code before it can throw (feedback.ts).
 */
export function describeError(err: unknown): { reason: string; message?: string } {
  if (err instanceof Error) return { reason: err.name, message: err.message.slice(0, 300) };
  return { reason: typeof err };
}
