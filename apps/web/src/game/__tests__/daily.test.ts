/**
 * Daily Ranked on the page (DESIGN.md §3): the machine playing on through
 * wrong answers and picking a run up after a refresh, the words the panels
 * show, the spoiler-free share, what the device keeps, and the Daily board.
 */

import { describe, expect, it } from "vitest";
import type { DailyBoardResponse, DailyMineResponse, DailyResult } from "@bt/core";
import {
  DAILY_RUN_KEY,
  bonusChip,
  cardAction,
  cardNeedsLookup,
  cardResultText,
  bonusLine,
  boardScore,
  dailyGridLabel,
  dailyScoreText,
  dailyShareCard,
  dailyShareText,
  gameLabel,
  nextGameText,
  rankLine,
  rememberRun,
  rememberedRun,
  resultTrack,
  tally,
  titleTally,
} from "../daily";
import { dailyBoardView, dailyOwnPosition, dailyWinnerLine } from "../leaderboard";
import { initialState, reduce } from "../machine";
import type { GameEvent, GameState } from "../machine";
import { topClock } from "../view";
import { round } from "./fixtures";

const LINK = "https://biggerthangame.com/football-higher-or-lower/legends/daily";

function run(events: readonly GameEvent[], from: GameState): GameState {
  return events.reduce(reduce, from);
}

const daily = (): GameState => initialState(0, null, "ranked");

/** Through the start to question 1 on screen. */
const toFirst: GameEvent[] = [
  { type: "start" },
  { type: "started", runId: "20261008-x", round: round(1) },
  { type: "titled" },
  { type: "held" },
  { type: "introDone" },
  { type: "dealt" },
  { type: "spun" },
];

const marks = (right: number, wrong = 20 - right): boolean[] => [
  ...Array<boolean>(right).fill(true),
  ...Array<boolean>(wrong).fill(false),
];

describe("the machine in Daily Ranked", () => {
  it("goes on to the next question after a wrong answer that brings one", () => {
    let s = run(toFirst, daily());
    expect(s.phase).toBe("awaiting");
    s = run(
      [
        { type: "guess", guess: { guess: "higher", ms: 900 } as never, at: 1000 },
        {
          type: "answered",
          response: {
            reveal: { round: 1, value: 20, display: "20", correct: false },
            next: round(2),
          },
          at: 1100,
        },
      ],
      s,
    );
    expect(s.reveal?.correct).toBe(false);
    expect(s.next?.index).toBe(2);
    // However the verdict plays, the advance deals question 2 rather than ending.
    const dealt = reduce({ ...s, phase: "verdict" }, { type: "advance" });
    expect(dealt.phase).not.toBe("over");
    expect(dealt.round?.index).toBe(2);
  });

  it("ends with the run's result when the server says so", () => {
    const result: DailyResult = {
      gameNo: 8,
      score: 14,
      correct: 14,
      bonus: 0,
      results: marks(14),
      end: "finished",
      nickname: "BraveFreekick35",
      rank: 3,
      total: 40,
    };
    let s = run(toFirst, daily());
    s = run(
      [
        { type: "guess", guess: { guess: "lower", ms: 900 } as never, at: 1000 },
        {
          type: "answered",
          response: {
            reveal: { round: 1, value: 20, display: "20", correct: false },
            end: "finished",
            result,
          },
          at: 1100,
        },
      ],
      s,
    );
    expect(s.result).toEqual(result);
    expect(reduce({ ...s, phase: "verdict" }, { type: "advance" }).phase).toBe("over");
  });

  it("picks a run up after a refresh: straight to the cards, the answers so far kept", () => {
    const s = reduce(daily(), {
      type: "resumed",
      runId: "20261008-x",
      round: round(6),
      results: [true, false, true, true, false],
      remainingMs: 4000,
      at: 10_000,
    });
    expect(s.phase).toBe("dealing");
    expect(s.round?.index).toBe(6);
    expect(s.history.map((r) => r.correct)).toEqual([true, false, true, true, false]);
    expect(s.streak).toBe(3);
    // Its clock is capped at what the server says is left, never the whole limit.
    expect(s.cap).toBe(14_000);
  });

  it("gives a question dealt fresh after a refresh its whole limit", () => {
    const s = reduce(daily(), {
      type: "resumed",
      runId: "20261008-x",
      round: round(6),
      results: [true],
      remainingMs: null,
      at: 10_000,
    });
    expect(s.cap).toBeNull();
  });

  it("only resumes from a start panel or a finished run, never over a run in play", () => {
    const playing = run(toFirst, daily());
    const s = reduce(playing, {
      type: "resumed",
      runId: "other",
      round: round(9),
      results: [],
      remainingMs: 1000,
      at: 1,
    });
    expect(s).toBe(playing);
  });

  it("keeps a refused start on the panel, with the reason, and no failure", () => {
    const s = run(
      [
        { type: "start" },
        { type: "startFailed", failure: { kind: "refused", reason: "nameTaken" } } as GameEvent,
      ],
      daily(),
    );
    expect(s.phase).toBe("idle");
    expect(s.refused).toBe("nameTaken");
    expect(s.startFailed).toBe(false);
  });
});

describe("the clock of a question picked up after a refresh", () => {
  /** Resumed at `at` with `left` ms on the clock, the cards still being dealt. */
  const resumed = (left: number | null, at = 10_000): GameState =>
    reduce(daily(), {
      type: "resumed",
      runId: "20261008-x",
      round: round(6),
      results: [true, true, false, true, true],
      remainingMs: left,
      at,
    });

  it("shows the time really left from its first frame, never the full limit", () => {
    const s = resumed(7400);
    expect(s.phase).toBe("dealing");
    expect(s.clock).toBeNull();
    expect(topClock(s, 10_000)).toEqual({
      seconds: 8,
      level: "calm",
      running: true,
      frozen: false,
    });
    // It keeps counting down while the cards come in.
    expect(topClock(s, 11_000)?.seconds).toBe(7);
  });

  it("is orange or red straight away when that's due", () => {
    expect(topClock(resumed(4000), 10_000)).toMatchObject({ seconds: 4, level: "warning" });
    expect(topClock(resumed(2000), 10_000)).toMatchObject({ seconds: 2, level: "urgent" });
  });

  it("reads 0 once the time has gone, and never more than the limit", () => {
    expect(topClock(resumed(1000), 12_000)?.seconds).toBe(0);
    expect(topClock(resumed(60_000), 10_000)?.seconds).toBe(10);
  });

  it("starts the question's own clock from what was left, so the two agree", () => {
    let s = resumed(6500);
    s = reduce(s, { type: "dealt", at: 10_800 });
    if (s.phase === "spinning") s = reduce(s, { type: "spun", at: 10_800 });
    expect(s.phase).toBe("awaiting");
    expect(s.clock?.limitMs).toBe(5700);
    expect(topClock(s, 10_800)?.seconds).toBe(6);
  });

  it("leaves a question dealt fresh after a refresh, and every other run, at the full limit while dealt", () => {
    expect(topClock(resumed(null), 10_000)).toMatchObject({ seconds: 10, running: false });
    const endless = reduce(reduce(initialState(0, null, "endless"), { type: "start" }), {
      type: "started",
      runId: "20261008-x",
      round: round(1),
    });
    expect(endless.cap).toBeNull();
  });
});

describe("the Daily words", () => {
  it("count right answers out of twenty, and past a perfect twenty the plain total", () => {
    expect(dailyScoreText(14, 0)).toBe("14/20");
    expect(dailyScoreText(20, 0)).toBe("20/20");
    expect(dailyScoreText(20, 5)).toBe("25");
    expect(bonusLine(20, 5)).toBe("20/20 +5 bonus");
    expect(bonusLine(14, 0)).toBe("");
  });

  it("tally the marks, and show the bonus only after a perfect twenty", () => {
    expect(tally([...marks(20, 0), true, true, false])).toEqual({ correct: 20, bonus: 2 });
    // The title bar: the right answers, and the bonus apart, only once in the bonus rounds.
    expect(titleTally(marks(7, 3))).toEqual({ correct: 7, bonus: null });
    expect(titleTally(marks(20, 0))).toEqual({ correct: 20, bonus: null });
    expect(titleTally([...marks(20, 0), true, true, true])).toEqual({ correct: 20, bonus: 3 });
    expect(titleTally([...marks(20, 0), false])).toEqual({ correct: 20, bonus: 0 });
    expect(bonusChip(marks(19, 1))).toBe("");
    expect(bonusChip([...marks(20, 0), true])).toBe("+1 bonus");
  });

  it("draw a finished run's track from its marks, an unanswered question as a miss", () => {
    const track = resultTrack([true, false, true]);
    expect(track).toHaveLength(20);
    expect(track.slice(0, 4).map((s) => s.kind)).toEqual(["hit", "miss", "hit", "miss"]);
    expect(track.filter((s) => s.current)).toHaveLength(0);
    expect(track.at(-1)?.final).toBe(true);
  });

  it("name the game and count down to the next, or to Game 1 before launch", () => {
    expect(gameLabel(12)).toBe("Game 12");
    const now = Date.UTC(2026, 9, 8, 18, 30);
    const midnight = Date.UTC(2026, 9, 9);
    expect(nextGameText(12, midnight, now)).toMatch(/^Next game in /);
    expect(nextGameText(0, midnight, now)).toMatch(/^Game 1 starts in /);
  });

  it("place the run on the board, or say nothing before it is", () => {
    expect(rankLine({ rank: 312, total: 2400 })).toBe("312th of 2,400");
    expect(rankLine({ rank: null, total: null })).toBe("");
  });

  it("read a perfect run's score in full for a screen reader", () => {
    expect(boardScore({ score: 14, perfect: false, bonus: 0 })).toEqual({
      text: "14",
      star: false,
      spoken: "14",
    });
    const perfect = boardScore({ score: 25, perfect: true, bonus: 5 });
    expect(perfect.star).toBe(true);
    expect(perfect.spoken).toMatch(/twenty out of twenty/);
  });
});

describe("the Legends card's button place", () => {
  const result: DailyResult = {
    gameNo: 8,
    score: 13,
    correct: 13,
    bonus: 0,
    results: marks(13),
    end: "finished",
    nickname: "BrowserCheck",
    rank: 19,
    total: 30,
  };
  const mine = (state: "none" | "playing" | "finished", gameNo = 8): DailyMineResponse =>
    state === "finished"
      ? {
          gameNo,
          nextGameAt: 0,
          country: null,
          state,
          result,
          standing: {
            id: "x",
            rank: 19,
            nickname: "BrowserCheck",
            score: 13,
            perfect: false,
            bonus: 0,
            tied: false,
            thinkMs: null,
            country: null,
          },
        }
      : state === "playing"
        ? { gameNo, nextGameAt: 0, country: null, state, nickname: "BrowserCheck" }
        : { gameNo, nextGameAt: 0, country: null, state };

  it("asks the server only for a device with an id, from Game 1", () => {
    expect(cardNeedsLookup(8, "00000000-0000-4000-8000-000000000000")).toBe(true);
    // A fresh device, or storage blocked: Play at once, nothing to ask.
    expect(cardNeedsLookup(8, null)).toBe(false);
    // Before launch day there is nothing to look up.
    expect(cardNeedsLookup(0, "00000000-0000-4000-8000-000000000000")).toBe(false);
  });

  it("holds a placeholder while the answer is out, never a guess", () => {
    expect(cardAction(8, undefined)).toEqual({ kind: "pending" });
  });

  it("offers Play with nothing played today, or when the answer can't be had", () => {
    expect(cardAction(8, mine("none"))).toEqual({ kind: "play" });
    expect(cardAction(8, null)).toEqual({ kind: "play" });
    // Yesterday's answer, overtaken by midnight, says nothing about today.
    expect(cardAction(8, mine("finished", 7))).toEqual({ kind: "play" });
  });

  it("offers Carry on for a run still going", () => {
    expect(cardAction(8, mine("playing"))).toEqual({ kind: "resume" });
  });

  it("shows today's result once the game is done", () => {
    expect(cardAction(8, mine("finished"))).toEqual({ kind: "done", result });
    expect(cardResultText(result)).toBe("13/20 · 19th of 30");
    expect(cardResultText({ ...result, rank: null, total: null })).toBe("13/20");
    expect(cardResultText({ ...result, correct: 20, bonus: 5 })).toBe("25 · 19th of 30");
  });
});

describe("the Daily share", () => {
  const results = [...marks(8, 1), ...marks(6, 1), ...marks(4, 0)];

  it("is the game, the score, two rows of ten squares and the link: no player, no figure", () => {
    expect(results).toHaveLength(20);
    const text = dailyShareText({ gameNo: 12, results }, LINK);
    expect(text.split("\n")).toEqual([
      "Bigger Than #12 — 18/20 🔥",
      "🟩🟩🟩🟩🟩🟩🟩🟩🟥🟩",
      "🟩🟩🟩🟩🟩🟥🟩🟩🟩🟩",
      LINK,
    ]);
  });

  it("adds the bonus line after a perfect twenty", () => {
    const text = dailyShareText({ gameNo: 3, results: [...marks(20, 0), true, true, false] }, LINK);
    expect(text.split("\n")).toEqual([
      "Bigger Than #3 — 20/20 🔥",
      "🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩",
      "🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩",
      "⭐ +2 bonus",
      LINK,
    ]);
  });

  it("marks an unanswered question wrong, so a short run still shows twenty squares", () => {
    const text = dailyShareText({ gameNo: 3, results: marks(5, 0) }, LINK);
    expect([...text.split("\n")[1]!].filter((c) => c === "🟥")).toHaveLength(5);
  });

  it("draws the same in the image: no players at all", () => {
    const card = dailyShareCard({ gameNo: 12, results }, "biggerthangame.com");
    expect(card.players).toBeNull();
    expect(card.score).toBe("18/20");
    expect(card.title).toBe("Bigger Than #12");
    expect(card.cells).toHaveLength(20);
    expect(card.cells.filter((c) => c.kind === "miss")).toHaveLength(2);
    expect(dailyGridLabel(results)).toBe("Your game: 18 of 20 right.");
  });
});

describe("what the device keeps of today's run", () => {
  function memory(): { storage: () => Storage; data: Map<string, string> } {
    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    } as unknown as Storage;
    return { storage: () => storage, data };
  }

  it("keeps the run id for the current game only", () => {
    const { storage, data } = memory();
    rememberRun(storage, 12, "20261008-abc.sig");
    expect(rememberedRun(storage, 12)).toBe("20261008-abc.sig");
    expect(rememberedRun(storage, 13)).toBeUndefined();
    // One key, replaced by the next game's.
    rememberRun(storage, 13, "20261009-def.sig");
    expect([...data.keys()]).toEqual([DAILY_RUN_KEY]);
    expect(rememberedRun(storage, 12)).toBeUndefined();
  });

  it("reads nothing, and throws nothing, from blocked or odd storage", () => {
    const blocked = () => {
      throw new Error("SecurityError");
    };
    expect(rememberedRun(blocked, 12)).toBeUndefined();
    expect(() => rememberRun(blocked, 12, "x")).not.toThrow();
    const { storage, data } = memory();
    for (const odd of ["", "{", "null", '{"gameNo":"12","runId":"x"}', '{"gameNo":12}']) {
      data.set(DAILY_RUN_KEY, odd);
      expect(rememberedRun(storage, 12), odd).toBeUndefined();
    }
  });
});

describe("the Daily board", () => {
  const board: DailyBoardResponse = {
    mode: "ranked",
    gameNo: 12,
    nextGameAt: Date.UTC(2026, 9, 9),
    total: 3,
    entries: [
      {
        id: "a",
        rank: 1,
        nickname: "Ace",
        score: 23,
        perfect: true,
        bonus: 3,
        tied: false,
        thinkMs: null,
        country: "GB",
      },
      {
        id: "b",
        rank: 2,
        nickname: "Bee",
        score: 14,
        perfect: false,
        bonus: 0,
        tied: true,
        thinkMs: 41_000,
        country: null,
      },
      {
        id: "c",
        rank: 3,
        nickname: null,
        score: 14,
        perfect: false,
        bonus: 0,
        tied: true,
        thinkMs: 52_000,
        country: null,
      },
    ],
    previous: {
      gameNo: 11,
      winner: { nickname: "BraveFreekick35", score: 23, perfect: true, country: "GB" },
    } as DailyBoardResponse["previous"],
  };

  it("shows each row's score, the perfect run's star, and times on tied scores only", () => {
    const view = dailyBoardView(board, null);
    expect(view.rows.map((r) => [r.rank, r.streak, r.thinkMs])).toEqual([
      [1, 23, null],
      [2, 14, 41_000],
      [3, 14, 52_000],
    ]);
    expect(view.rows[0]).toMatchObject({ perfect: true });
    expect(view.own).toBeNull();
  });

  it("marks this device's own row, and pins it from its lookup", () => {
    const mine: DailyMineResponse = {
      gameNo: 12,
      nextGameAt: board.nextGameAt,
      country: "GB",
      state: "finished",
      result: {
        gameNo: 12,
        score: 14,
        correct: 14,
        bonus: 0,
        results: marks(14),
        end: "finished",
        nickname: "Bee",
        rank: 2,
        total: 3,
      },
      standing: board.entries[1]!,
    };
    const own = dailyOwnPosition(mine);
    expect(own).toMatchObject({ rank: 2, total: 3, nickname: "Bee" });
    const view = dailyBoardView(board, own);
    expect(view.rows.map((r) => r.mine)).toEqual([false, true, false]);
    expect(view.own?.index).toBe(1);
    // A device with no finished run today has no row to pin.
    expect(dailyOwnPosition({ ...mine, state: "none" } as DailyMineResponse)).toBeNull();
    expect(dailyOwnPosition(null)).toBeNull();
  });

  it("names the previous game's winner, the name and score in gold", () => {
    const line = dailyWinnerLine(board.previous);
    expect(line?.parts.map((p) => p.text).join("")).toBe("BraveFreekick35 got 23 in Game 11");
    expect(line?.parts.filter((p) => p.gold).map((p) => p.text)).toEqual(["BraveFreekick35", "23"]);
    expect(line?.country).toBe("GB");
    expect(dailyWinnerLine(null)).toBeNull();
  });
});
