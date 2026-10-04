/**
 * Publish is offered only for a run that can move the boards: one that beats
 * this device's best published score on the run's day (publish.ts
 * `publishOffer`). The server still takes any run — storage cleared, another
 * tab — and says whether it moved anything (`improved`), which the dialog and
 * the panel put in words.
 */

import { describe, expect, it } from "vitest";
import type { PeriodRank, SubmitResponse } from "@bt/core";
import type { StorageAccess } from "../best";
import { publishedKey, readStandings, saveStandings, standingsOf } from "../device";
import { beatText, panelText, publishOffer, publishedText, ranksText, runDay } from "../publish";

function memory() {
  const data = new Map<string, string>();
  const store = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
  return { data, access: (() => store) as StorageAccess };
}

const blocked: StorageAccess = () => {
  throw new DOMException("denied", "SecurityError");
};

const KEY = publishedKey("legends", "endless");
/** Sunday 4 October 2026, 15:00 UTC; the day resets at midnight. */
const NOW = Date.UTC(2026, 9, 4, 15);
const MIDNIGHT = Date.UTC(2026, 9, 5);
const TODAY_RUN = "20261004-3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b.sig";
const YESTERDAY_RUN = "20261003-3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b.sig";

function period(key: string, best: number, more: Partial<PeriodRank> = {}): PeriodRank {
  return {
    key,
    current: true,
    rank: 12,
    total: 340,
    resetsAt: MIDNIGHT,
    entryId: "best",
    best,
    improved: true,
    ...more,
  };
}

/** A submit response with the device's best `best` in every period. */
function response(best: number, more: Partial<PeriodRank> = {}, streak = best): SubmitResponse {
  return {
    id: "new",
    nickname: "SwiftVolley42",
    streak,
    periods: {
      day: period("2026-10-04", best, more),
      week: period("2026-W40", best, { resetsAt: Date.UTC(2026, 9, 5), ...more }),
      month: period("2026-10", best, { resetsAt: Date.UTC(2026, 10, 1), ...more }),
    },
  };
}

/** What this device keeps after publishing `res`. */
function published(access: StorageAccess, res: SubmitResponse) {
  saveStandings(access, KEY, standingsOf(res), NOW);
}

const offer = (access: StorageAccess, score: number, runId = TODAY_RUN) =>
  publishOffer(score, runId, readStandings(access, KEY, NOW));

describe("the run's day", () => {
  it("is the UTC date in its run id, as the server ranks it", () => {
    expect(runDay(TODAY_RUN)).toBe("2026-10-04");
    expect(runDay("20261231-x.y")).toBe("2026-12-31");
    expect(runDay("20261332-x.y")).toBeNull();
    expect(runDay("nonsense")).toBeNull();
  });
});

describe("whether the game-over panel offers Publish", () => {
  it("offers it for the first run of the day: nothing published yet", () => {
    expect(offer(memory().access, 3)).toEqual({ kind: "publish" });
  });

  it("offers it for a run that beats the day's published best", () => {
    const { access } = memory();
    published(access, response(18));
    expect(offer(access, 19)).toEqual({ kind: "publish" });
  });

  it("doesn't for an equal run or a worse one: the best to beat instead", () => {
    const { access } = memory();
    published(access, response(18));
    expect(offer(access, 18)).toEqual({ kind: "beat", best: 18 });
    expect(offer(access, 4)).toEqual({ kind: "beat", best: 18 });
    expect(beatText(18)).toBe("Your best today is 18 — beat it to move up the leaderboard");
  });

  it("offers it again once storage is cleared, or when it can't be read", () => {
    const { access, data } = memory();
    published(access, response(18));
    data.clear();
    expect(offer(access, 4)).toEqual({ kind: "publish" });
    expect(offer(blocked, 4)).toEqual({ kind: "publish" });
  });

  it("goes by the run's own day: yesterday's best doesn't count against today's run", () => {
    const { access } = memory();
    published(access, response(18));
    // A run started yesterday and ended now, against today's best: a different board.
    expect(offer(access, 4, YESTERDAY_RUN)).toEqual({ kind: "publish" });
    // Today's best once its day has reset: a new day, a new board.
    expect(publishOffer(4, "20261005-x.y", readStandings(access, KEY, MIDNIGHT))).toEqual({
      kind: "publish",
    });
  });

  it("only looks at the day: a week's best is never the one to beat", () => {
    const { access } = memory();
    saveStandings(
      access,
      KEY,
      standingsOf(response(30)).filter((s) => s.period !== "day"),
      NOW,
    );
    expect(offer(access, 5)).toEqual({ kind: "publish" });
  });

  it("learns from every publish, even one that moved nothing", () => {
    const { access } = memory();
    // Published from another tab, or before storage was cleared: this device didn't know.
    published(access, response(18, { improved: false, entryId: "older" }, 4));
    expect(offer(access, 10)).toEqual({ kind: "beat", best: 18 });
  });
});

describe("what the dialog and the panel say after publishing", () => {
  it("says Published, and the day's rank, when the run moved today's board", () => {
    const res = response(19);
    expect(publishedText(res)).toBe("Published.");
    expect(panelText(res)).toBe("12th of 340 today");
  });

  it("says the board keeps the better run when nothing improved, never just Published", () => {
    const res = response(18, { improved: false, entryId: "older" }, 4);
    expect(publishedText(res)).toBe(
      "Your best today is still 18, so the leaderboard keeps that run.",
    );
    expect(panelText(res)).toBe("Your best today is 18 — beat it to move up the leaderboard");
    // Where the device stands is still worth knowing: the kept run's ranks.
    expect(ranksText(res)).toMatch(/^12th of 340 today · /);
  });

  it("calls a day that has reset yesterday", () => {
    const res = response(18, { improved: false, current: false }, 4);
    expect(publishedText(res)).toBe(
      "Your best yesterday is still 18, so the leaderboard keeps that run.",
    );
  });

  it("says Published when today's board moved but the week's kept a better run", () => {
    const res = response(9);
    const week = { ...res.periods.week, improved: false, best: 20, entryId: "older" };
    expect(publishedText({ ...res, periods: { ...res.periods, week } })).toBe("Published.");
  });

  it("keeps the name an entry was published under when a later publish didn't replace it", () => {
    const { access } = memory();
    saveStandings(
      access,
      KEY,
      standingsOf({ ...response(18), nickname: "FirstName", id: "best" }),
      NOW,
    );
    published(access, response(18, { improved: false }, 4));
    const day = readStandings(access, KEY, NOW).find((s) => s.period === "day");
    expect(day).toMatchObject({ entryId: "best", nickname: "FirstName", streak: 18 });
  });
});
