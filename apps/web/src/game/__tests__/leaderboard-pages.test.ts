/**
 * The leaderboard page (game/leaderboard.ts): the server's rows exactly as it
 * ranked them, ten to a page; a new tab back on page 1; the player's own live
 * position pinned apart from the table when their row isn't on the page on
 * show; and the previous period's winner in one line.
 */

import { describe, expect, it, vi } from "vitest";
import { BOARD_SIZE } from "@bt/core";
import type { BoardResponse, MineEntry, MineResponse } from "@bt/core";
import type { Standing } from "../device";
import {
  MINE_ENDPOINT,
  PAGE_SIZE,
  boardView,
  clampPage,
  fetchMine,
  goToPage,
  loadMine,
  ownPosition,
  pageCount,
  pageOf,
  pageRows,
  pageText,
  pinnedRow,
  pinnedText,
  rangeText,
  selectPeriod,
  winnerLine,
} from "../leaderboard";
import type { MineState, OwnPosition } from "../leaderboard";

const KEY = "2026-10-05";

/** A board of `n` entries, `e1` first, and `total` devices on it. */
function board(n: number, total = n): BoardResponse {
  return {
    mode: "endless",
    period: "day",
    key: KEY,
    resetsAt: 0,
    total,
    entries: Array.from({ length: n }, (_, i) => ({
      id: `e${i + 1}`,
      rank: i + 1,
      nickname: `Player${i + 1}`,
      streak: 100 - i,
    })),
    previous: { key: "2026-10-04", winner: null },
  };
}

/** The player's live position: entry `e<rank>` unless given. */
function live(rank: number, over: Partial<OwnPosition> = {}): OwnPosition {
  return {
    entryId: `e${rank}`,
    rank,
    total: 3208,
    streak: 100 - rank + 1,
    nickname: `Player${rank}`,
    live: true,
    ...over,
  };
}

/** What the device kept from its publish, for the board's day. */
function stored(over: Partial<Standing> = {}): Standing {
  return {
    period: "day",
    key: KEY,
    entryId: "mine",
    nickname: "LowScore",
    streak: 4,
    rank: 1,
    total: 1,
    resetsAt: Date.parse("2026-10-06T00:00:00Z"),
    ...over,
  };
}

function entry(over: Partial<MineEntry> = {}): MineEntry {
  return {
    key: KEY,
    entryId: "mine",
    rank: 151,
    total: 193,
    streak: 4,
    nickname: "LowScore",
    ...over,
  };
}

const answered = (day: MineEntry | null): MineState => ({
  status: "ok",
  response: { periods: { day, week: null, month: null } },
});

const ranks = (rows: readonly { rank: number }[]) => rows.map((r) => r.rank);

describe("the server's rows", () => {
  it("show the rank the server gave each, never their place in the list", () => {
    // Ties share a rank; the list doesn't renumber them.
    const tied: BoardResponse = {
      ...board(0),
      entries: [
        { id: "a", rank: 1, nickname: "A", streak: 9 },
        { id: "b", rank: 1, nickname: "B", streak: 9 },
        { id: "c", rank: 3, nickname: "C", streak: 7 },
      ],
      total: 3,
    };
    expect(ranks(boardView(tied, null).rows)).toEqual([1, 1, 3]);
  });

  it("never take the player's entry in: a stale stored rank 1 moves nobody", () => {
    // Published to an empty board (stored: 1st of 1), then 50 better runs came in.
    const view = boardView(board(50, 193), live(151, { entryId: "mine", total: 193 }));
    expect(view.rows).toHaveLength(50);
    expect(ranks(view.rows)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(view.rows[0]).toMatchObject({ key: "e1", rank: 1, mine: false });
    expect(view.rows.some((r) => r.key === "mine" || r.mine)).toBe(false);
    expect(view.total).toBe(193);
    expect(view.own).toMatchObject({ rank: 151, index: null });
  });

  it("marks the player's row in place when the board has it", () => {
    const view = boardView(board(50), live(27));
    expect(view.rows.filter((r) => r.mine).map((r) => r.rank)).toEqual([27]);
    expect(view.own).toMatchObject({ rank: 27, index: 26 });
  });
});

describe("pages of ten", () => {
  it("is the top 50: five pages", () => {
    expect(BOARD_SIZE).toBe(50);
    expect(PAGE_SIZE).toBe(10);
    expect(pageCount(BOARD_SIZE)).toBe(5);
  });

  it.each([
    [1, 1, [[1]]],
    [9, 1, [[1, 2, 3, 4, 5, 6, 7, 8, 9]]],
    [10, 1, [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]]],
    [11, 2, [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [11]]],
  ])("slices %i entries into %i page(s)", (n, pages, expected) => {
    const rows = boardView(board(n), null).rows;
    expect(pageCount(rows.length)).toBe(pages);
    expect(Array.from({ length: pages }, (_, p) => ranks(pageRows(rows, p)))).toEqual(expected);
  });

  it("slices 50 entries into five full pages", () => {
    const rows = boardView(board(50), null).rows;
    for (let p = 0; p < 5; p += 1) {
      expect(ranks(pageRows(rows, p))).toEqual(
        Array.from({ length: 10 }, (_, i) => p * 10 + i + 1),
      );
    }
  });

  it("has one page for an empty board, and keeps a page in range", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageRows([], 0)).toEqual([]);
    expect(clampPage(7, 50)).toBe(4);
    expect(clampPage(-1, 50)).toBe(0);
    expect(clampPage(3, 11)).toBe(1);
  });

  it("says which rows are on show, and which page", () => {
    expect(rangeText(0, 50)).toBe("1–10 of 50");
    expect(rangeText(4, 50)).toBe("41–50 of 50");
    expect(rangeText(0, 7)).toBe("1–7 of 7");
    expect(rangeText(0, 0)).toBe("");
    expect(pageText(1, 50)).toBe("Page 2 of 5");
  });

  it("starts a tab on page 1, and never goes past either end", () => {
    const paging = goToPage(selectPeriod("day"), 3, 50);
    expect(paging).toEqual({ period: "day", page: 3 });
    expect(selectPeriod("week")).toEqual({ period: "week", page: 0 });
    expect(goToPage(paging, -1, 50).page).toBe(0);
    expect(goToPage(paging, 5, 50).page).toBe(4);
  });
});

describe("the player's pinned position", () => {
  it("is pinned on the pages that don't hold the player's row, with a jump to it", () => {
    const view = boardView(board(50, 3208), live(27));
    expect(pageOf(26)).toBe(2);
    for (const page of [0, 1, 3, 4]) {
      expect(pinnedRow(view, page)).toMatchObject({ rank: 27, total: 3208, page: 2 });
    }
    expect(pinnedRow(view, 2)).toBeNull();
    expect(pinnedText(pinnedRow(view, 0)!)).toBe("27th of 3,208 · Go to page 3");
  });

  it("is pinned on every page when the player is below the top 50, with no jump", () => {
    const view = boardView(board(50, 193), live(151, { entryId: "mine", total: 193 }));
    for (let page = 0; page < 5; page += 1) {
      expect(pinnedRow(view, page)).toMatchObject({ rank: 151, total: 193, page: null });
    }
    expect(pinnedText(pinnedRow(view, 0)!)).toBe("151st of 193");
  });

  it("jumps to the page that holds the player's row, where nothing is pinned", () => {
    const view = boardView(board(50), live(27));
    const to = pinnedRow(view, 0)?.page;
    if (to === null || to === undefined) throw new Error("expected a jump");
    const paging = goToPage(selectPeriod("day"), to, view.rows.length);
    expect(pinnedRow(view, paging.page)).toBeNull();
    expect(pageRows(view.rows, paging.page).some((r) => r.mine)).toBe(true);
  });

  it("is nowhere when the player hasn't published to this period", () => {
    const view = boardView(board(50), null);
    for (let page = 0; page < 5; page += 1) expect(pinnedRow(view, page)).toBeNull();
  });
});

describe("the player's live position", () => {
  it("is the live lookup's, not the rank stored when they published", () => {
    const own = ownPosition("day", KEY, answered(entry()), [stored()]);
    expect(own).toEqual({
      entryId: "mine",
      rank: 151,
      total: 193,
      streak: 4,
      nickname: "LowScore",
      live: true,
    });
  });

  it("is none for a period the lookup has nothing in, or another period's key", () => {
    expect(ownPosition("day", KEY, answered(null), [stored()])).toBeNull();
    expect(ownPosition("day", KEY, answered(entry({ key: "2026-10-04" })), [])).toBeNull();
    expect(ownPosition("week", KEY, answered(entry()), [])).toBeNull();
  });

  it("is none while the lookup is on its way, and when nothing was published", () => {
    expect(ownPosition("day", KEY, { status: "loading" }, [stored()])).toBeNull();
    expect(ownPosition("day", KEY, { status: "none" }, [])).toBeNull();
  });

  it("falls back to the stored publish when the lookup fails, labelled as then", () => {
    const own = ownPosition("day", KEY, { status: "failed" }, [stored()]);
    expect(own).toMatchObject({ rank: 1, total: 1, live: false });
    const pinned = pinnedRow(boardView(board(50, 193), own), 0);
    expect(pinned && pinnedText(pinned)).toBe("1st of 1 when published");
    // Never for another period's stored publish.
    expect(ownPosition("day", KEY, { status: "failed" }, [stored({ key: "2026-10-04" })])).toBe(
      null,
    );
  });
});

describe("asking for the live position", () => {
  const ok = (body: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  const response: MineResponse = {
    periods: { day: entry(), week: entry({ key: "2026-W41" }), month: null },
  };

  it("doesn't ask when this device has published to no current period", async () => {
    const fetchFn = ok(response);
    const deviceId = vi.fn(() => "3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b");
    expect(await loadMine(fetchFn, [], deviceId)).toEqual({ status: "none" });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(deviceId).not.toHaveBeenCalled();
  });

  it("asks once, with the device id, when it has", async () => {
    const fetchFn = ok(response);
    const id = "3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b";
    expect(await loadMine(fetchFn, [stored()], () => id)).toEqual({ status: "ok", response });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith(
      MINE_ENDPOINT,
      expect.objectContaining({ method: "POST", body: JSON.stringify({ deviceId: id }) }),
    );
  });

  it("fails calmly on an error, no connection or a body that isn't one", async () => {
    const id = () => "3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b";
    const status = vi.fn(async () => new Response("{}", { status: 503 }));
    expect(await loadMine(status, [stored()], id)).toEqual({ status: "failed" });
    const offline = vi.fn(async () => {
      throw new TypeError("offline");
    });
    expect(await loadMine(offline, [stored()], id)).toEqual({ status: "failed" });
    expect(await fetchMine(ok({ periods: { day: { rank: "x" } } }), "id")).toBeNull();
    expect(await fetchMine(ok({}), "id")).toBeNull();
  });
});

describe("the previous winner", () => {
  const prev = (winner: BoardResponse["previous"]["winner"]) => ({ key: "x", winner });
  const text = (parts: ReturnType<typeof winnerLine>) => parts?.map((p) => p.text).join("");

  it("is one line per tab, the name and the number in gold", () => {
    const won = prev({ nickname: "HardyOffside889", streak: 23 });
    expect(winnerLine(won, "day")).toEqual([
      { text: "HardyOffside889", gold: true },
      { text: " got a ", gold: false },
      { text: "23", gold: true },
      { text: " streak yesterday", gold: false },
    ]);
    expect(text(winnerLine(won, "week"))).toBe("HardyOffside889 got a 23 streak last week");
    expect(text(winnerLine(won, "month"))).toBe("HardyOffside889 got a 23 streak last month");
  });

  it("says Retired name for a retired one, and nothing when there was no winner", () => {
    expect(text(winnerLine(prev({ nickname: null, streak: 31 }), "day"))).toBe(
      "Retired name got a 31 streak yesterday",
    );
    expect(winnerLine(prev(null), "day")).toBeNull();
  });
});
