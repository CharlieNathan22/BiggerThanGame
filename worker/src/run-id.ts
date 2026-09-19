/**
 * Friendly run ids: `YYYYMMDD-<uuid>`, the date in UTC.
 *
 * The date does two jobs. It fixes `now` for the whole run — age is computed
 * from it, so a run straddling midnight on someone's birthday can't change a
 * value between rounds — and it bounds which runs the server will answer, so a
 * caller can't pick an arbitrary reference date.
 */

const RUN_ID =
  /^(\d{4})(\d{2})(\d{2})-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** How far a run's date may sit from the server's current UTC date. */
export const RUN_DATE_TOLERANCE_DAYS = 1;

const DAY_MS = 86_400_000;

export function mintRunId(now: Date, uuid: string): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}-${uuid}`;
}

/**
 * The run's reference date — its day at 00:00 UTC — or undefined when the id
 * is malformed or names a date that doesn't exist.
 */
export function runDate(runId: string): Date | undefined {
  const match = RUN_ID.exec(runId);
  if (match === null) return undefined;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  // Date.UTC rolls 2026-02-31 over to March; a real date round-trips exactly.
  if (date.getUTCDate() !== Number(d) || date.getUTCMonth() !== Number(m) - 1) return undefined;
  return date;
}

/** True when the run's date is within the tolerance of today (UTC). */
export function isRunDateCurrent(date: Date, clock: Date): boolean {
  const today = Date.UTC(clock.getUTCFullYear(), clock.getUTCMonth(), clock.getUTCDate());
  return Math.abs(date.getTime() - today) <= RUN_DATE_TOLERANCE_DAYS * DAY_MS;
}
