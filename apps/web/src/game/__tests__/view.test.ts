import { STAT_KEYS } from "@bt/core";
import type { StatKey } from "@bt/core";
import { describe, expect, it } from "vitest";
import { initialState, reduce } from "../machine";
import type { GameEvent, GameState } from "../machine";
import {
  anchorFading,
  anchorFigure,
  announcement,
  bestOutcome,
  canSkipTitle,
  hitchText,
  initial,
  isFinalQuestion,
  isIntro,
  onNewBest,
  overCaption,
  pitchCards,
  plaqueLead,
  plaqueStage,
  progressText,
  qualifierText,
  reelStrip,
  scoreBadge,
  scoreFigure,
  titleCard,
  trackSteps,
  verdictLabel,
} from "../view";
import { cont, round, won, wrong } from "./fixtures";

describe("initial", () => {
  it("takes the first character of the name", () => {
    expect(initial("Zinedine Zidane")).toBe("Z");
    expect(initial("  Éder")).toBe("É");
    expect(initial("")).toBe("");
  });
});

describe("qualifierText", () => {
  it("shows the fee's year as it is", () => {
    expect(qualifierText("fee", "2001")).toBe("2001");
  });

  it("dates the follower snapshot", () => {
    expect(qualifierText("ig", "2026-09-17")).toBe("as of 17 Sept 2026");
  });

  it("is empty when there's nothing to qualify", () => {
    expect(qualifierText("caps", undefined)).toBe("");
    expect(qualifierText("fee", "")).toBe("");
  });
});

describe("reelStrip", () => {
  const random = () => 0.5;

  it("ends on the stat it lands on, which appears nowhere else", () => {
    for (const target of STAT_KEYS) {
      const strip = reelStrip(target, STAT_KEYS, random);
      expect(strip).toHaveLength(12);
      expect(strip[strip.length - 1]).toBe(target);
      expect(strip.slice(0, -1)).not.toContain(target);
    }
  });

  it("uses every other stat before repeating one", () => {
    const strip = reelStrip("caps", STAT_KEYS, random).slice(0, -1);
    const others = STAT_KEYS.filter((k) => k !== "caps");
    expect(new Set(strip)).toEqual(new Set<StatKey>(others));
  });

  it("copes with a single stat", () => {
    expect(reelStrip("caps", ["caps"], random)).toEqual(["caps"]);
  });
});

describe("announcement", () => {
  const r1 = round(1, { stat: "caps", anchorValue: 50 });
  const start: GameEvent[] = [
    { type: "start" },
    { type: "started", runId: "20260926-a", round: r1 },
    { type: "titled" },
    { type: "held" },
    { type: "introDone" },
    { type: "dealt" },
    { type: "spun" },
  ];
  const at = (events: GameEvent[]): GameState => events.reduce(reduce, initialState());

  it("asks the question once the stat has landed", () => {
    expect(announcement(at(start.slice(0, 3)), "endless")).toBe("");
    expect(announcement(at(start), "endless")).toBe(
      "International caps. p1: 50. Is p2 higher or lower?",
    );
  });

  it("says where the run is first in Friendly: the progress track's text", () => {
    expect(announcement(at(start), "friendly")).toBe(
      "Question 1 of 20. International caps. p1: 50. Is p2 higher or lower?",
    );
  });

  it("gives the challenger's value and the verdict", () => {
    const right = at([
      ...start,
      { type: "guess", guess: "higher", at: 0 },
      { type: "answered", response: cont(1, round(2), 80), at: 1 },
      { type: "settled" },
    ]);
    expect(announcement(right, "endless")).toBe("p2: 80. Correct. Streak 1.");
    expect(announcement(right, "friendly")).toBe("p2: 80. Correct. 1 of 20.");

    const lost = at([
      ...start,
      { type: "guess", guess: "higher", at: 0 },
      { type: "answered", response: wrong(1, 20), at: 1 },
      { type: "settled" },
    ]);
    expect(announcement(lost, "friendly")).toBe("p2: 20. Wrong. The run is over.");
  });

  it("says so when the last round wins the run", () => {
    const state = at([
      ...start,
      { type: "guess", guess: "higher", at: 0 },
      { type: "answered", response: won(1, 80), at: 1 },
      { type: "settled" },
    ]);
    expect(announcement({ ...state, streak: 20 }, "friendly")).toBe(
      "p2: 80. Correct — that's all 20. You won!",
    );
  });

  it("says nothing while the answer is in flight", () => {
    expect(
      announcement(at([...start, { type: "guess", guess: "higher", at: 0 }]), "friendly"),
    ).toBe("");
  });
});

describe("the cards on the pitch", () => {
  const r1 = round(1, { stat: "caps", anchorValue: 50 });
  const r2 = round(2, { stat: "caps", anchorValue: 80 });
  const base: GameEvent[] = [
    { type: "start" },
    { type: "started", runId: "run", round: r1 },
    { type: "titled" },
    { type: "held" },
    { type: "introDone" },
    { type: "dealt" },
    { type: "spun" },
    { type: "guess", guess: "higher", at: 0 },
    { type: "answered", response: cont(1, r2, 80), at: 1 },
    { type: "settled" },
  ];
  const at = (extra: GameEvent[] = []): GameState =>
    [...base, ...extra].reduce(reduce, initialState());

  it("shows the round's anchor and challenger in their places", () => {
    expect(pitchCards(at()).map((c) => [c.player.id, c.place, c.role])).toEqual([
      ["p1", 0, "anchor"],
      ["p2", 1, "challenger"],
    ]);
  });

  it("slides: the anchor leaves, the challenger is carried, the next comes in", () => {
    const sliding = at([{ type: "slide" }]);
    expect(pitchCards(sliding).map((c) => [c.player.id, c.place, c.role])).toEqual([
      ["p1", -1, "leaving"],
      ["p2", 0, "carried"],
      ["p3", 1, "incoming"],
    ]);
  });

  it("keeps each card's key from the slide into the next round, so nothing is rebuilt", () => {
    const sliding = pitchCards(at([{ type: "slide" }]));
    const next = pitchCards(at([{ type: "slide" }, { type: "advance" }]));
    expect(next.map((c) => c.key)).toEqual([sliding[1]!.key, sliding[2]!.key]);
    expect(next.map((c) => c.role)).toEqual(["anchor", "challenger"]);
    // Keys never repeat, even for a player dealt again soon after.
    expect(new Set(sliding.map((c) => c.key)).size).toBe(3);
  });

  it("nothing before a run is dealt", () => {
    expect(pitchCards(initialState())).toEqual([]);
  });
});

describe("anchorFigure", () => {
  const r1 = round(1, { stat: "caps", anchorValue: 50 });
  const start: GameEvent[] = [
    { type: "start" },
    { type: "started", runId: "run", round: r1 },
    { type: "titled" },
    { type: "held" },
    { type: "introDone" },
  ];
  const at = (events: GameEvent[]): GameState =>
    [...start, ...events].reduce(reduce, initialState());
  const toNext = (next: ReturnType<typeof round>): GameEvent[] => [
    { type: "dealt" },
    { type: "spun" },
    { type: "guess", guess: "higher", at: 0 },
    { type: "answered", response: cont(1, next, 80), at: 1 },
    { type: "settled" },
    { type: "advance" },
  ];

  it("shows nothing for round one's anchor until the wheel lands", () => {
    expect(anchorFigure(at([]))).toBeNull();
    expect(anchorFigure(at([{ type: "dealt" }]))).toBeNull();
    expect(anchorFigure(at([{ type: "dealt" }, { type: "spun" }]))?.display).toBe("50");
  });

  it("keeps the carried figure straight after a slide when the stat holds", () => {
    const next = round(2, { stat: "caps", anchorValue: 80 });
    expect(anchorFigure(at(toNext(next)))).toMatchObject({ display: "80", stat: "caps" });
  });

  it("fades the old stat's figure out as the wheel starts, and shows the new one when it lands", () => {
    const next = round(2, { stat: "apps", statChanged: true, anchorValue: 700 });
    const dealing = at(toNext(next));
    expect(anchorFigure(dealing)).toMatchObject({ display: "80", stat: "caps" });
    expect(anchorFading(dealing)).toBe(false);
    const spinning = reduce(dealing, { type: "dealt" });
    expect(spinning.phase).toBe("spinning");
    expect(anchorFading(spinning)).toBe(true);
    const landed = reduce(spinning, { type: "spun" });
    expect(anchorFigure(landed)).toMatchObject({ display: "700", stat: "apps" });
    expect(anchorFading(landed)).toBe(false);
  });

  it("never fades when the stat holds, nor on round one's spin", () => {
    const next = round(2, { stat: "caps", anchorValue: 80 });
    expect(anchorFading(at(toNext(next)))).toBe(false);
    expect(anchorFading(at([{ type: "dealt" }]))).toBe(false);
  });
});

describe("the first deal", () => {
  const events: GameEvent[] = [
    { type: "start" },
    { type: "started", runId: "20260926-a", round: round(1) },
    { type: "titled" },
    { type: "held" },
    { type: "introDone" },
    { type: "dealt" },
    { type: "spun" },
  ];
  // at(n): the state after the first n events.
  const at = (n: number): GameState => events.slice(0, n).reduce(reduce, initialState());

  it("shows the title card, then an empty pitch while the plaque holds, then the cards", () => {
    expect(titleCard(at(2), "friendly")).toBe("Question 1 of 20");
    expect(pitchCards(at(2))).toEqual([]);
    expect(plaqueStage(at(2))).toBe("title");
    expect(titleCard(at(3), "friendly")).toBeNull();
    expect(pitchCards(at(3))).toEqual([]);
    expect(plaqueStage(at(3))).toBe("hold");
    expect(isIntro(at(4))).toBe(true);
    expect(pitchCards(at(4))).toHaveLength(2);
    expect(plaqueStage(at(4))).toBeNull();
    expect(isIntro(at(5))).toBe(false);
  });

  it("can be skipped during the title card and the hold only", () => {
    expect(canSkipTitle(at(1))).toBe(false);
    expect(canSkipTitle(at(2))).toBe(true);
    expect(canSkipTitle(at(3))).toBe(true);
    expect(canSkipTitle(at(4))).toBe(false);
  });

  it("reads Question 1 of 20 on the plaque until the wheel has spun into the stat", () => {
    expect(plaqueLead(at(1), "friendly")).toBeNull();
    for (const n of [2, 3, 4, 5, 6]) expect(plaqueLead(at(n), "friendly")).toBe("Question 1 of 20");
    expect(plaqueLead(at(7), "friendly")).toBeNull();
  });

  it("reads Question 1 in a mode without a target, and nothing for a later round", () => {
    expect(titleCard(at(2), "endless")).toBe("Question 1");
    expect(plaqueLead(at(2), "endless")).toBe("Question 1");
    expect(plaqueLead({ ...at(4), round: round(2) }, "friendly")).toBeNull();
  });

  it("titles a replayed challenge Beat n/20, with Question 1 of 20 on the plaque", () => {
    const replay: GameState = { ...at(2), challenge: { status: "accepted", score: 7 } };
    expect(titleCard(replay, "friendly")).toBe("Beat 7/20");
    expect(plaqueLead(replay, "friendly")).toBe("Question 1 of 20");
    const perfect: GameState = { ...at(2), challenge: { status: "accepted", score: 20 } };
    expect(titleCard(perfect, "friendly")).toBe("Match 20/20");
  });

  it("announces Question 1 of 20 once as the title card comes up, and nothing during the hold", () => {
    expect(announcement(at(2), "friendly")).toBe("Question 1 of 20.");
    const replay: GameState = { ...at(2), challenge: { status: "accepted", score: 7 } };
    expect(announcement(replay, "friendly")).toBe("Beat 7/20. Question 1 of 20.");
    expect(announcement(at(3), "friendly")).toBe("");
    expect(announcement(at(4), "friendly")).toBe("");
  });
});

describe("verdictLabel", () => {
  const r1 = round(1, { stat: "caps", anchorValue: 50 });
  const toGuess: GameEvent[] = [
    { type: "start" },
    { type: "started", runId: "20260926-a", round: r1 },
    { type: "titled" },
    { type: "held" },
    { type: "introDone" },
    { type: "dealt" },
    { type: "spun" },
    { type: "guess", guess: "higher", at: 0 },
  ];
  const at = (events: GameEvent[]): GameState => events.reduce(reduce, initialState());

  it("says nothing until the verdict lands", () => {
    expect(verdictLabel(at(toGuess))).toBeNull();
    const answered = at([...toGuess, { type: "answered", response: cont(1, round(2)), at: 1 }]);
    expect(verdictLabel(answered)).toBeNull();
  });

  it("says Correct on a right answer, until the next pair is dealt", () => {
    const right = at([
      ...toGuess,
      { type: "answered", response: cont(1, round(2)), at: 1 },
      { type: "settled" },
    ]);
    expect(verdictLabel(right)).toBe("Correct");
    expect(verdictLabel(reduce(right, { type: "advance" }))).toBeNull();
  });

  it("says Incorrect on a wrong one, and is gone once the game-over panel is up", () => {
    const lost = at([
      ...toGuess,
      { type: "answered", response: wrong(1), at: 1 },
      { type: "settled" },
    ]);
    expect(verdictLabel(lost)).toBe("Incorrect");
    expect(verdictLabel(reduce(lost, { type: "advance" }))).toBeNull();
  });

  it("says Correct on the winning answer, then hands over to the win panel", () => {
    const winning = at([
      ...toGuess,
      { type: "answered", response: won(1), at: 1 },
      { type: "settled" },
    ]);
    expect(verdictLabel(winning)).toBe("Correct");
    const over = reduce(winning, { type: "advance" });
    expect(over.end).toBe("won");
    expect(verdictLabel(over)).toBeNull();
  });
});

describe("a new high score", () => {
  const over = (
    streak: number,
    bestBefore: number,
    end: GameState["end"] = "wrong",
  ): GameState => ({
    ...initialState(bestBefore),
    phase: "over",
    streak,
    best: Math.max(streak, bestBefore),
    end,
    round: round(streak + 1),
  });

  it("is a new high score only when it beats a previous best", () => {
    expect(bestOutcome(over(8, 5))).toBe("new");
    expect(bestOutcome(over(3, 5))).toBeNull();
    // A device's first run has no best to beat.
    expect(bestOutcome(over(8, 0))).toBeNull();
  });

  it("is a quieter match when it equals the previous best", () => {
    expect(bestOutcome(over(5, 5))).toBe("matched");
  });

  it("goes with You won on a first win, and a later win is You won only", () => {
    expect(bestOutcome(over(20, 12, "won"))).toBe("new");
    expect(bestOutcome(over(20, 20, "won"))).toBeNull();
    expect(bestOutcome(over(20, 0, "won"))).toBeNull();
  });

  it("isn't judged before the run is over", () => {
    expect(bestOutcome({ ...over(8, 5), phase: "verdict" })).toBeNull();
  });

  it("is announced once, as the panel comes up", () => {
    expect(announcement(over(8, 5), "friendly")).toBe("New high score!");
    expect(announcement(over(5, 5), "friendly")).toBe("You matched your best.");
  });

  it("lights the title bar's Best mid-run once the streak is past the previous best", () => {
    const playing = (streak: number, bestBefore: number): GameState => ({
      ...initialState(bestBefore),
      phase: "awaiting",
      streak,
      best: Math.max(streak, bestBefore),
    });
    expect(onNewBest(playing(5, 5))).toBe(false);
    expect(onNewBest(playing(6, 5))).toBe(true);
    expect(onNewBest(playing(6, 0))).toBe(false);
    expect(playing(6, 5).best).toBe(6);
  });
});

describe("the score badge", () => {
  const rec = (index: number, correct = true) =>
    ({ index, stat: "caps", tier: "basic", correct }) as const;
  const at = (
    streak: number,
    phase: GameState["phase"] = "verdict",
    extra: Partial<GameState> = {},
  ): GameState => ({
    ...initialState(),
    phase,
    streak,
    history: Array.from({ length: streak }, (_, i) => rec(i + 1)),
    ...extra,
  });

  it("shows the new score after a right answer, keyed by it", () => {
    expect(scoreBadge(at(3), "friendly")).toEqual({ key: 3, text: "3/20", milestone: false });
    expect(scoreBadge(at(1), "friendly")?.text).toBe("1/20");
  });

  it("adds the streak title at 5, 10 and 15", () => {
    expect(scoreBadge(at(5), "friendly")).toEqual({
      key: 5,
      text: "5/20 · Squad player",
      milestone: true,
    });
    expect(scoreBadge(at(10), "friendly")?.text).toBe("10/20 · Starter");
    expect(scoreBadge(at(15), "friendly")?.text).toBe("15/20 · Captain");
    expect(scoreBadge(at(6), "friendly")?.milestone).toBe(false);
  });

  it("stays through the slide and the next deal, and goes with the next guess", () => {
    for (const phase of ["sliding", "dealing", "spinning", "awaiting"] as const) {
      expect(scoreBadge(at(3, phase), "friendly")).not.toBeNull();
    }
    expect(scoreBadge(at(3, "revealing"), "friendly")).toBeNull();
    expect(scoreBadge(at(3, "over"), "friendly")).toBeNull();
  });

  it("never shows on a wrong answer, the winning one, before any point, or outside Friendly", () => {
    const missed = at(3, "verdict", { history: [rec(1), rec(2), rec(3), rec(4, false)] });
    expect(scoreBadge(missed, "friendly")).toBeNull();
    expect(scoreBadge(at(20, "verdict", { end: "won" }), "friendly")).toBeNull();
    expect(scoreBadge(at(0, "dealing"), "friendly")).toBeNull();
    expect(scoreBadge(at(3), "endless")).toBeNull();
  });
});

describe("overCaption", () => {
  it("reads naturally for one", () => {
    expect(overCaption({ streak: 1, end: "wrong" })).toBe("correct, then out");
    expect(overCaption({ streak: 0, end: "wrong" })).toBe("in a row");
    expect(overCaption({ streak: 12, end: "wrong" })).toBe("in a row");
  });

  it("calls a win a perfect run", () => {
    expect(overCaption({ streak: 20, end: "won" })).toBe("a perfect run");
  });
});

describe("scores, per mode", () => {
  it("reads out of twenty in Friendly and plain elsewhere", () => {
    expect(scoreFigure(7, "friendly")).toBe("7/20");
    expect(scoreFigure(7, "endless")).toBe("7");
    expect(scoreFigure(7, "ranked")).toBe("7");
  });

  it("gives the progress as text in Friendly only", () => {
    expect(progressText(initialState(), "friendly")).toBe("Question 1 of 20");
    expect(progressText({ ...initialState(), round: round(7) }, "friendly")).toBe(
      "Question 7 of 20",
    );
    expect(progressText(initialState(), "endless")).toBe("");
  });
});

describe("the final question", () => {
  const at20 = (phase: GameState["phase"]): GameState => ({
    ...initialState(),
    phase,
    round: round(20),
  });

  it("is round twenty in Friendly, while it is on screen", () => {
    expect(isFinalQuestion(at20("awaiting"), "friendly")).toBe(true);
    expect(isFinalQuestion(at20("dealing"), "friendly")).toBe(true);
    expect(isFinalQuestion(at20("verdict"), "friendly")).toBe(true);
    expect(isFinalQuestion(at20("over"), "friendly")).toBe(false);
    expect(isFinalQuestion({ ...at20("awaiting"), round: round(19) }, "friendly")).toBe(false);
  });

  it("doesn't exist in a mode without a win target", () => {
    expect(isFinalQuestion(at20("awaiting"), "endless")).toBe(false);
  });

  it("is marked on the track's last segment", () => {
    const steps = trackSteps(at20("awaiting"), "friendly");
    expect(steps.map((s) => s.final)).toEqual([...Array(19).fill(false), true]);
    expect(steps.at(-1)).toMatchObject({ current: true, final: true });
  });

  it("is named in the progress text and announced first", () => {
    const state = at20("awaiting");
    expect(progressText(state, "friendly")).toBe("Final question — question 20 of 20");
    expect(announcement(state, "friendly")).toBe(
      "Final question — question 20 of 20. International caps. p20: 50. Is p21 higher or lower?",
    );
  });
});

describe("the progress track", () => {
  const history = [
    { index: 1, stat: "caps", tier: "basic", correct: true },
    { index: 2, stat: "fee", tier: "uncommon", correct: true },
    { index: 3, stat: "ct", tier: "rare", correct: false },
  ] as const;

  it("has a step per round of the target, and none without one", () => {
    expect(trackSteps(initialState(), "friendly")).toHaveLength(20);
    expect(trackSteps(initialState(), "endless")).toEqual([]);
  });

  it("fills answered rounds by tier, marks the miss, and lights the round on screen", () => {
    const playing: GameState = {
      ...initialState(),
      phase: "awaiting",
      round: round(3),
      history: history.slice(0, 2),
    };
    const steps = trackSteps(playing, "friendly");
    expect(steps.slice(0, 4)).toEqual([
      { kind: "hit", tier: "basic", current: false, final: false },
      { kind: "hit", tier: "uncommon", current: false, final: false },
      { kind: "todo", tier: null, current: true, final: false },
      { kind: "todo", tier: null, current: false, final: false },
    ]);

    const over: GameState = { ...playing, phase: "over", history };
    const done = trackSteps(over, "friendly");
    expect(done[2]).toEqual({ kind: "miss", tier: "rare", current: false, final: false });
    expect(done.some((s) => s.current)).toBe(false);
  });
});

describe("hitchText", () => {
  it("says nothing when all is well", () => {
    expect(hitchText(null)).toBe("");
  });

  it("names a reconnect and a slow-down differently", () => {
    const reconnecting = hitchText({ kind: "reconnecting", since: 0, retries: 0 });
    const slowDown = hitchText({ kind: "slowDown", until: 10_000 });
    expect(reconnecting).not.toBe("");
    expect(slowDown).not.toBe("");
    expect(reconnecting).not.toBe(slowDown);
  });
});
