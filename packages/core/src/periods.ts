/**
 * The Endless boards' periods (DESIGN.md §13): today, this week and this
 * month, all in UTC.
 *
 * - A **day** runs from 00:00 UTC to the next 00:00 UTC.
 * - A **week** is the ISO week, Monday 00:00 UTC to the next Monday. Its key
 *   is the ISO week-numbering year and week (`2026-W53`), so the week of
 *   2026-12-28 to 2027-01-03 is one week, in 2026.
 * - A **month** is the calendar month.
 *
 * A run counts in the periods of the UTC date it **started** (its run id's
 * date), so a run started at 23:58 finishes on that day's board. Scores are
 * stored with that date as a day key (`YYYYMMDD`, an integer), and a week or
 * month is a range of day keys, `from` to `to` inclusive: day keys sort as the
 * dates do, across month and year ends too.
 *
 * Pure: the Worker and the web app share it, so the board's reset countdown and
 * the server's periods can't disagree.
 */

export type BoardPeriod = "day" | "week" | "month";

export const BOARD_PERIODS: readonly BoardPeriod[] = ["day", "week", "month"];

export interface Period {
  readonly period: BoardPeriod;
  /** `2026-09-29`, `2026-W40` or `2026-09`. */
  readonly key: string;
  /** The first day, as a day key (`20260928`). */
  readonly from: number;
  /** The last day, as a day key, inclusive. */
  readonly to: number;
  /** When it starts, ms since the epoch: a 00:00 UTC. */
  readonly startsAt: number;
  /** When it ends and the next begins, ms since the epoch: a 00:00 UTC. */
  readonly resetsAt: number;
}

export const DAY_MS = 86_400_000;

/**
 * How many entries a board holds: the page shows them ten at a time, and the
 * nightly snapshot of a closed period keeps the same number. Totals and a
 * player's own rank still count everyone.
 */
export const BOARD_SIZE = 50;

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

/** The UTC date as a day key: 2026-09-29 → `20260929`. */
export function dayKey(date: Date): number {
  return date.getUTCFullYear() * 10_000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
}

/** 00:00 UTC on a day key's date; undefined if it isn't a real date. */
export function dayKeyDate(key: number): Date | undefined {
  if (!Number.isInteger(key)) return undefined;
  const y = Math.floor(key / 10_000);
  const m = Math.floor(key / 100) % 100;
  const d = key % 100;
  const date = new Date(Date.UTC(y, m - 1, d));
  return dayKey(date) === key && y >= 1970 ? date : undefined;
}

/** 00:00 UTC on `date`'s UTC day, ms. */
export function startOfDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** The ISO week-numbering year and week of the week starting on Monday `monday`. */
function isoWeek(monday: number): { year: number; week: number } {
  // The ISO week belongs to the year its Thursday is in.
  const thursday = new Date(monday + 3 * DAY_MS);
  const year = thursday.getUTCFullYear();
  const week = 1 + Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / (7 * DAY_MS));
  return { year, week };
}

/** The period of kind `period` that `date` falls in. */
export function periodOf(date: Date, period: BoardPeriod): Period {
  const day = startOfDay(date);
  let startsAt: number;
  let resetsAt: number;
  let key: string;
  switch (period) {
    case "day": {
      startsAt = day;
      resetsAt = day + DAY_MS;
      key = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
      break;
    }
    case "week": {
      const sinceMonday = (date.getUTCDay() + 6) % 7;
      startsAt = day - sinceMonday * DAY_MS;
      resetsAt = startsAt + 7 * DAY_MS;
      const { year, week } = isoWeek(startsAt);
      key = `${year}-W${pad(week)}`;
      break;
    }
    case "month": {
      const y = date.getUTCFullYear();
      const m = date.getUTCMonth();
      startsAt = Date.UTC(y, m, 1);
      resetsAt = Date.UTC(y, m + 1, 1);
      key = `${y}-${pad(m + 1)}`;
      break;
    }
  }
  return {
    period,
    key,
    from: dayKey(new Date(startsAt)),
    to: dayKey(new Date(resetsAt - DAY_MS)),
    startsAt,
    resetsAt,
  };
}

/** The period just before `p`: yesterday, last week, last month. */
export function previousPeriod(p: Period): Period {
  return periodOf(new Date(p.startsAt - 1), p.period);
}

/** The three periods a run started on `date` counts in. */
export function periodsOf(date: Date): Readonly<Record<BoardPeriod, Period>> {
  return {
    day: periodOf(date, "day"),
    week: periodOf(date, "week"),
    month: periodOf(date, "month"),
  };
}

/**
 * The periods that closed at the most recent 00:00 UTC at or before `now`:
 * always the day before; the week too when that midnight began a Monday; the
 * month too when it began the 1st. What the midnight cron snapshots.
 */
export function periodsClosedBy(now: Date): readonly Period[] {
  const midnight = new Date(startOfDay(now));
  const closingDay = new Date(midnight.getTime() - DAY_MS);
  const closed: Period[] = [periodOf(closingDay, "day")];
  if (midnight.getUTCDay() === 1) closed.push(periodOf(closingDay, "week"));
  if (midnight.getUTCDate() === 1) closed.push(periodOf(closingDay, "month"));
  return closed;
}

/** Time left until `resetsAt`, in whole days, hours and minutes, rounded up to the minute. */
export function countdown(
  resetsAt: number,
  now: number,
): { readonly days: number; readonly hours: number; readonly minutes: number } {
  const minutesLeft = Math.max(0, Math.ceil((resetsAt - now) / 60_000));
  return {
    days: Math.floor(minutesLeft / (24 * 60)),
    hours: Math.floor(minutesLeft / 60) % 24,
    minutes: minutesLeft % 60,
  };
}
