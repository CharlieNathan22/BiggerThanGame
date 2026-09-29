import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  countdown,
  dayKey,
  dayKeyDate,
  periodOf,
  periodsClosedBy,
  periodsOf,
  previousPeriod,
} from "../periods.js";

const at = (iso: string) => new Date(iso);

describe("day keys", () => {
  it("are the UTC date as YYYYMMDD", () => {
    expect(dayKey(at("2026-09-29T00:00:00Z"))).toBe(20260929);
    expect(dayKey(at("2026-09-29T23:59:59.999Z"))).toBe(20260929);
    // 23:30 in New York on the 29th is already the 30th in UTC.
    expect(dayKey(at("2026-09-29T23:30:00-04:00"))).toBe(20260930);
  });

  it("round-trip only for real dates", () => {
    expect(dayKeyDate(20260929)?.toISOString()).toBe("2026-09-29T00:00:00.000Z");
    expect(dayKeyDate(20260231)).toBeUndefined();
    expect(dayKeyDate(2026929)).toBeUndefined();
    expect(dayKeyDate(20260929.5)).toBeUndefined();
  });
});

describe("the day", () => {
  it("resets at 00:00 UTC: 23:59:59.999 and 00:00:00 are different days", () => {
    const before = periodOf(at("2026-09-29T23:59:59.999Z"), "day");
    const after = periodOf(at("2026-09-30T00:00:00.000Z"), "day");
    expect(before).toEqual({
      period: "day",
      key: "2026-09-29",
      from: 20260929,
      to: 20260929,
      startsAt: Date.parse("2026-09-29T00:00:00Z"),
      resetsAt: Date.parse("2026-09-30T00:00:00Z"),
    });
    expect(after.key).toBe("2026-09-30");
    expect(before.resetsAt).toBe(after.startsAt);
  });
});

describe("the week", () => {
  it("is the ISO week, Monday 00:00 UTC to the next Monday", () => {
    const week = periodOf(at("2026-09-29T12:00:00Z"), "week");
    expect(week).toMatchObject({ key: "2026-W40", from: 20260928, to: 20261004 });
    expect(new Date(week.startsAt).toISOString()).toBe("2026-09-28T00:00:00.000Z");
    expect(new Date(week.resetsAt).toISOString()).toBe("2026-10-05T00:00:00.000Z");
  });

  it("turns over from Sunday into Monday", () => {
    const sunday = periodOf(at("2026-10-04T23:59:59.999Z"), "week");
    const monday = periodOf(at("2026-10-05T00:00:00Z"), "week");
    expect(sunday.key).toBe("2026-W40");
    expect(monday.key).toBe("2026-W41");
    expect(monday.from).toBe(20261005);
  });

  it("has a week 53 in 2026, spanning two years and two months", () => {
    for (const day of ["2026-12-28", "2026-12-31", "2027-01-01", "2027-01-03"]) {
      const week = periodOf(at(`${day}T08:00:00Z`), "week");
      expect(week).toMatchObject({ key: "2026-W53", from: 20261228, to: 20270103 });
    }
    expect(periodOf(at("2027-01-04T00:00:00Z"), "week").key).toBe("2027-W01");
    expect(periodOf(at("2026-12-27T23:59:59Z"), "week").key).toBe("2026-W52");
  });

  it("puts the first days of a year in the last year's week when Thursday says so", () => {
    // 2021-01-01 was a Friday: ISO week 53 of 2020.
    expect(periodOf(at("2021-01-01T00:00:00Z"), "week").key).toBe("2020-W53");
    // 2024-12-30 was a Monday whose Thursday is in 2025: week 1 of 2025.
    expect(periodOf(at("2024-12-31T00:00:00Z"), "week").key).toBe("2025-W01");
  });
});

describe("the month", () => {
  it("is the calendar month, the 31st into the 1st", () => {
    const august = periodOf(at("2026-08-31T23:59:59.999Z"), "month");
    const september = periodOf(at("2026-09-01T00:00:00Z"), "month");
    expect(august).toMatchObject({ key: "2026-08", from: 20260801, to: 20260831 });
    expect(september).toMatchObject({ key: "2026-09", from: 20260901, to: 20260930 });
    expect(august.resetsAt).toBe(september.startsAt);
  });

  it("knows February's length and the year's end", () => {
    expect(periodOf(at("2028-02-10T00:00:00Z"), "month").to).toBe(20280229);
    expect(periodOf(at("2027-02-10T00:00:00Z"), "month").to).toBe(20270228);
    expect(periodOf(at("2026-12-31T23:00:00Z"), "month")).toMatchObject({
      key: "2026-12",
      from: 20261201,
      to: 20261231,
      resetsAt: Date.parse("2027-01-01T00:00:00Z"),
    });
  });
});

describe("previous periods", () => {
  it("are yesterday, last week and last month", () => {
    const now = at("2027-01-01T09:00:00Z");
    const { day, week, month } = periodsOf(now);
    expect(previousPeriod(day).key).toBe("2026-12-31");
    expect(previousPeriod(week).key).toBe("2026-W52");
    expect(previousPeriod(month).key).toBe("2026-12");
  });
});

describe("the periods a midnight closes", () => {
  const keys = (iso: string) => periodsClosedBy(at(iso)).map((p) => `${p.period}:${p.key}`);

  it("is yesterday on an ordinary day, whenever in that day the cron runs", () => {
    expect(keys("2026-09-30T00:00:00Z")).toEqual(["day:2026-09-29"]);
    expect(keys("2026-09-30T01:30:00Z")).toEqual(["day:2026-09-29"]);
  });

  it("adds the week on a Monday and the month on the 1st", () => {
    expect(keys("2026-10-05T00:00:00Z")).toEqual(["day:2026-10-04", "week:2026-W40"]);
    expect(keys("2026-10-01T00:00:00Z")).toEqual(["day:2026-09-30", "month:2026-09"]);
    expect(keys("2027-01-01T00:00:00Z")).toEqual(["day:2026-12-31", "month:2026-12"]);
    expect(keys("2027-01-04T01:30:00Z")).toEqual(["day:2027-01-03", "week:2026-W53"]);
    // 2027-03-01 is a Monday: all three close together.
    expect(keys("2027-03-01T00:00:00Z")).toEqual([
      "day:2027-02-28",
      "week:2027-W08",
      "month:2027-02",
    ]);
  });
});

describe("countdown", () => {
  it("rounds up to the minute and never goes below zero", () => {
    const reset = Date.parse("2026-09-30T00:00:00Z");
    expect(countdown(reset, reset - 1)).toEqual({ days: 0, hours: 0, minutes: 1 });
    expect(countdown(reset, reset - (5 * 60 + 12) * 60_000)).toEqual({
      days: 0,
      hours: 5,
      minutes: 12,
    });
    expect(countdown(reset, reset - 3 * DAY_MS - 60_000)).toEqual({
      days: 3,
      hours: 0,
      minutes: 1,
    });
    expect(countdown(reset, reset + 5000)).toEqual({ days: 0, hours: 0, minutes: 0 });
  });
});
