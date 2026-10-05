import { describe, expect, it } from "vitest";
import type { SubmitResponse } from "@bt/core";
import type { StorageAccess } from "../best";
import {
  DEVICE_KEY,
  LOCAL_RUNS,
  deviceId,
  publishedKey,
  readRuns,
  readStandings,
  recordRun,
  runsKey,
  saveStandings,
  standingsOf,
} from "../device";
import { countdownText, totalText } from "../leaderboard";
import {
  SUBMIT_ENDPOINT,
  canRetry,
  nicknameText,
  ordinal,
  outcomeText,
  publishRun,
  ranksText,
} from "../publish";

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const store = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
  return { data, access: (() => store) as StorageAccess };
}

const throwing: StorageAccess = () => {
  throw new DOMException("denied", "SecurityError");
};

const RESPONSE: SubmitResponse = {
  id: "e1",
  nickname: "SwiftVolley42",
  streak: 23,
  periods: {
    day: {
      key: "2026-09-29",
      current: true,
      rank: 412,
      total: 3208,
      resetsAt: 1,
      entryId: "e1",
      best: 23,
      improved: true,
    },
    week: {
      key: "2026-W40",
      current: true,
      rank: 1030,
      total: 9877,
      resetsAt: 2,
      entryId: "e1",
      best: 23,
      improved: true,
    },
    month: {
      key: "2026-09",
      current: true,
      rank: 2114,
      total: 20551,
      resetsAt: 3,
      entryId: "e0",
      best: 30,
      improved: false,
    },
  },
};

describe("the device id", () => {
  const UUID = "3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b";

  it("is made once and kept", () => {
    const { data, access } = memory();
    expect(deviceId(access, () => UUID)).toBe(UUID);
    expect(data.get(DEVICE_KEY)).toBe(UUID);
    expect(deviceId(access, () => "never used")).toBe(UUID);
  });

  it("replaces a stored value that isn't one", () => {
    const { access } = memory({ [DEVICE_KEY]: "hello" });
    expect(deviceId(access, () => UUID)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("lasts the visit when storage is blocked", () => {
    const first = deviceId(throwing, () => "7d6c5b4a-3e2f-4a1b-8c9d-0e1f2a3b4c5d");
    expect(deviceId(throwing, () => "other")).toBe(first);
  });
});

describe("the local board", () => {
  const KEY = runsKey("legends", "endless");

  it("is kept per deck and mode", () => {
    expect(KEY).toBe("bt:runs:legends:endless");
    expect(publishedKey("legends", "endless")).toBe("bt:published:legends:endless");
  });

  it("keeps the 10 best runs, best first, the earlier of equals first", () => {
    const { access } = memory();
    for (let i = 0; i < 14; i += 1) {
      recordRun(access, KEY, { score: i % 7, date: `2026-09-${String(10 + i)}`, end: "wrong" });
    }
    const runs = readRuns(access, KEY);
    expect(runs).toHaveLength(LOCAL_RUNS);
    expect(runs.map((r) => r.score)).toEqual([6, 6, 5, 5, 4, 4, 3, 3, 2, 2]);
    expect(runs[0]?.date).toBe("2026-09-16");
  });

  it("records a run published or not, banked or not, even a 0", () => {
    const { access } = memory();
    recordRun(access, KEY, { score: 0, date: "2026-09-29", end: "wrong" });
    recordRun(access, KEY, { score: 4, date: "2026-09-29", end: "network" });
    expect(readRuns(access, KEY).map((r) => [r.score, r.end])).toEqual([
      [4, "network"],
      [0, "wrong"],
    ]);
  });

  it("ignores rubbish in storage and still works when storage is blocked", () => {
    const { access } = memory({
      [KEY]: '[{"score":"x"},{"score":3,"date":"2026-09-01","end":"wrong"}]',
    });
    expect(readRuns(access, KEY)).toEqual([{ score: 3, date: "2026-09-01", end: "wrong" }]);
    expect(readRuns(memory({ [KEY]: "{not json" }).access, KEY)).toEqual([]);
    expect(recordRun(throwing, KEY, { score: 5, date: "2026-09-29", end: "timeout" })).toEqual([
      { score: 5, date: "2026-09-29", end: "timeout" },
    ]);
  });
});

describe("standings kept from a publish", () => {
  const KEY = publishedKey("legends", "endless");

  it("are one per period, replaced by newer ones and dropped once reset", () => {
    const { access } = memory();
    const standings = standingsOf({
      ...RESPONSE,
      periods: {
        day: { ...RESPONSE.periods.day, resetsAt: 1000 },
        week: { ...RESPONSE.periods.week, resetsAt: 5000 },
        month: { ...RESPONSE.periods.month, resetsAt: 9000 },
      },
    });
    saveStandings(access, KEY, standings, 0);
    expect(readStandings(access, KEY, 0)).toHaveLength(3);
    expect(readStandings(access, KEY, 2000).map((s) => s.period)).toEqual(["week", "month"]);
    saveStandings(access, KEY, [{ ...standings[1]!, rank: 7 }], 0);
    const kept = readStandings(access, KEY, 0);
    expect(kept).toHaveLength(3);
    expect(kept.find((s) => s.period === "week")?.rank).toBe(7);
  });
});

describe("publishRun", () => {
  const body = { token: "t", nickname: "SwiftVolley42", deviceId: "d", turnstileToken: "ts" };
  const answer = (status: number, json?: unknown) => async (url: string, init: RequestInit) => {
    expect(url).toBe(SUBMIT_ENDPOINT);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual(body);
    return new Response(json === undefined ? null : JSON.stringify(json), { status });
  };

  it("hands back the ranks when it's published", async () => {
    expect(await publishRun(answer(200, RESPONSE), body)).toEqual({
      kind: "published",
      response: RESPONSE,
    });
  });

  it("reads each refusal calmly", async () => {
    const cases: [number, unknown, string][] = [
      [422, { error: "nickname_rejected" }, "rejected"],
      [400, { error: "bad_request", detail: "nickname_short" }, "rejected"],
      [409, { error: "conflict", detail: "expired" }, "expired"],
      [409, { error: "conflict", detail: "submitted" }, "already"],
      [409, { error: "conflict", detail: "void" }, "unpublishable"],
      [400, { error: "bad_request", detail: "zero" }, "unpublishable"],
      [429, { error: "rate_limited" }, "slowDown"],
      [403, { error: "verification_failed" }, "checkFailed"],
      [503, { error: "unavailable" }, "failed"],
      [502, undefined, "failed"],
    ];
    for (const [status, json, kind] of cases) {
      expect(await publishRun(answer(status, json), body), `${status}`).toEqual({ kind });
    }
    expect(await publishRun(async () => Promise.reject(new TypeError("offline")), body)).toEqual({
      kind: "failed",
    });
  });

  it("offers a retry only where one could work", () => {
    expect(canRetry({ kind: "rejected" })).toBe(true);
    expect(canRetry({ kind: "failed" })).toBe(true);
    expect(canRetry({ kind: "slowDown" })).toBe(true);
    expect(canRetry({ kind: "checkFailed" })).toBe(true);
    expect(canRetry({ kind: "expired" })).toBe(false);
    expect(canRetry({ kind: "already" })).toBe(false);
    expect(canRetry({ kind: "unpublishable" })).toBe(false);
    expect(outcomeText({ kind: "rejected" })).toBe("That name isn't available — try another name.");
  });
});

describe("the text", () => {
  it("says what's wrong with a name, and gives another script the same answer as a blocked name", () => {
    expect(nicknameText("SwiftVolley42")).toBeNull();
    expect(nicknameText("ab")).toMatch(/3 to 20/);
    expect(nicknameText("Goal ⚽")).toMatch(/letters, numbers/);
    expect(nicknameText("Пеле")).toBe(outcomeText({ kind: "rejected" }));
  });

  it("writes ordinals", () => {
    const cases: [number, string][] = [
      [1, "1st"],
      [2, "2nd"],
      [3, "3rd"],
      [4, "4th"],
      [11, "11th"],
      [12, "12th"],
      [13, "13th"],
      [21, "21st"],
      [101, "101st"],
      [111, "111th"],
      [412, "412th"],
      [1030, "1,030th"],
    ];
    for (const [n, text] of cases) expect(ordinal(n)).toBe(text);
  });

  it("gives the three ranks in one line", () => {
    expect(ranksText(RESPONSE)).toBe(
      "412th of 3,208 today · 1,030th of 9,877 this week · 2,114th of 20,551 this month",
    );
    const late = {
      ...RESPONSE,
      periods: { ...RESPONSE.periods, day: { ...RESPONSE.periods.day, current: false } },
    };
    expect(ranksText(late)).toMatch(/^412th of 3,208 yesterday · /);
  });
});

describe("the board page's text", () => {
  it("counts down to the reset in the two largest units", () => {
    const reset = Date.parse("2026-09-30T00:00:00Z");
    const minutes = (m: number) => reset - m * 60_000;
    expect(countdownText(reset, minutes(5 * 60 + 12))).toBe("5 hours 12 minutes");
    expect(countdownText(reset, minutes(60))).toBe("1 hour");
    expect(countdownText(reset, minutes(1))).toBe("1 minute");
    expect(countdownText(reset, reset + 1000)).toBe("1 minute");
    expect(countdownText(reset, minutes(3 * 24 * 60 + 4 * 60 + 30))).toBe("3 days 4 hours");
    expect(countdownText(reset, minutes(24 * 60))).toBe("1 day");
  });

  it("counts the players", () => {
    expect(totalText(1)).toBe("1 player");
    expect(totalText(3208)).toBe("3,208 players");
  });
});
