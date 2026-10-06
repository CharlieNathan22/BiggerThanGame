/**
 * Instagram Endless on the client (game/variant.ts): its own local best and
 * page, no wheel, no boards, its name in the share text, and the variant on
 * every request that names a run.
 */

import { describe, expect, it } from "vitest";
import type { RunStartResponse } from "@bt/core";
import { createEndlessApi } from "../api";
import { bestKey } from "../best";
import { challengeUrl } from "../challenge";
import { feedbackRequest, reportedRound } from "../feedback";
import { leaveRequest } from "../leave";
import { dealDelay, initialState, reduce, shouldSpin, wheelOf } from "../machine";
import type { GameEvent, GameState } from "../machine";
import { challengeText, shareHeading, shareText } from "../share";
import { TIMINGS } from "../timing";
import { PLAY_PATHS, hasBoards, modeSubtitle, playId, spins, startIntro } from "../variant";
import { RUN_ID, link, round, wrong } from "./fixtures";

const IG = "endless-instagram" as const;

function play(events: readonly GameEvent[], from: GameState): GameState {
  return events.reduce(reduce, from);
}

describe("the plays a page can be", () => {
  it("names each play, and its page", () => {
    expect(playId("friendly")).toBe("friendly");
    expect(playId("endless")).toBe("endless");
    expect(playId("endless", IG)).toBe(IG);
    expect(PLAY_PATHS).toEqual({
      friendly: "/football-higher-or-lower/legends/friendly",
      endless: "/football-higher-or-lower/legends/endless",
      "endless-instagram": "/football-higher-or-lower/legends/endless/instagram",
    });
  });

  it("gives Endless boards and the wheel, and Instagram Endless neither", () => {
    expect(hasBoards("endless")).toBe(true);
    expect(hasBoards("endless", IG)).toBe(false);
    expect(hasBoards("friendly")).toBe(false);
    expect(spins("friendly")).toBe(true);
    expect(spins("endless")).toBe(true);
    expect(spins("endless", IG)).toBe(false);
  });

  it("says Instagram under the deck, and explains the questions", () => {
    expect(modeSubtitle("endless", IG)).toBe("Instagram");
    expect(modeSubtitle("endless")).toBe("Endless");
    expect(modeSubtitle("friendly")).toBe("Friendly");
    expect(startIntro("endless", IG)).toMatch(/Every question is Instagram followers/);
    expect(startIntro("endless", IG)).toMatch(/snapshots, dated on each card/);
    expect(startIntro("endless")).toMatch(/the stat changes as you play/);
  });

  it("keeps its best apart: bt:best:legends:endless-instagram", () => {
    expect(bestKey("legends", IG)).toBe("bt:best:legends:endless-instagram");
    expect(bestKey("legends", "endless")).toBe("bt:best:legends:endless");
  });
});

describe("no wheel", () => {
  const r1 = round(1, { stat: "ig" });
  const r2 = round(2, { stat: "ig" });

  it("never spins, round one included, and the plaque shows the stat from the deal", () => {
    expect(shouldSpin(r1)).toBe(true);
    expect(shouldSpin(r1, false)).toBe(false);
    expect(shouldSpin(round(4, { statChanged: true }), false)).toBe(false);
    let s = initialState(0, null, "endless", IG);
    expect(s.variant).toBe(IG);
    expect(wheelOf(s)).toBe(false);
    for (const e of [
      { type: "start" },
      { type: "started", runId: "r", round: r1 },
      { type: "titled" },
      { type: "held" },
      { type: "introDone" },
    ] as GameEvent[]) {
      s = reduce(s, e);
    }
    expect(s.phase).toBe("dealing");
    expect(s.plaque?.key).toBe("ig");
    s = reduce(s, { type: "dealt", at: 100 });
    expect(s.phase).toBe("awaiting");
    expect(s.clock).toEqual({ startedAt: 100, limitMs: 15_000 });
    expect(dealDelay(r1, TIMINGS, false)).toBe(TIMINGS.hold);
    expect(dealDelay(r2, TIMINGS, false)).toBe(TIMINGS.hold);
  });

  it("keeps the variant through Play again", () => {
    const over = play(
      [
        { type: "start" },
        { type: "started", runId: "r", round: r1 },
        { type: "titled" },
        { type: "held" },
        { type: "introDone" },
        { type: "dealt", at: 0 },
        { type: "guess", guess: "higher", at: 10 },
        { type: "answered", response: wrong(1), at: 20 },
      ],
      initialState(0, null, "endless", IG),
    );
    const again = reduce({ ...over, phase: "over" }, { type: "start" });
    expect(again.variant).toBe(IG);
    expect(again.phase).toBe("starting");
  });

  it("is general Endless's wheel when no variant is named, and Friendly ignores one", () => {
    expect(wheelOf(initialState(0, null, "endless"))).toBe(true);
    expect(initialState(0, null, "friendly", IG).variant).toBeUndefined();
  });
});

describe("what the server is told", () => {
  it("starts runs in the variant", async () => {
    const sent: unknown[] = [];
    const response: RunStartResponse = { runId: "r", round: round(1), token: "t1", country: null };
    const api = createEndlessApi(
      async (_url, init) => {
        sent.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify(response), { status: 200 });
      },
      async () => "ok",
      { variant: IG },
    );
    await api.start();
    expect(sent[0]).toEqual({ mode: "endless", variant: IG, turnstileToken: "ok" });
  });

  it("names the variant on a leave beacon", () => {
    const state: Parameters<typeof leaveRequest>[0] = {
      phase: "awaiting",
      runId: RUN_ID,
      round: round(3),
      reveal: null,
      end: null,
    };
    expect(leaveRequest({ ...state, variant: IG }, "endless", "hidden")).toEqual({
      mode: "endless",
      variant: IG,
      runId: RUN_ID,
      round: 3,
      phase: "question",
      trigger: "hidden",
    });
    expect(leaveRequest(state, "endless", "hidden")).not.toHaveProperty("variant");
  });

  it("names the variant on a correction report", () => {
    const r = round(2, { stat: "ig" });
    const over: GameState = {
      ...initialState(0, null, "endless", IG),
      phase: "over",
      runId: RUN_ID,
      round: r,
      reveal: { round: 2, value: 10, display: "10m", correct: false },
    };
    const report = reportedRound(over)!;
    expect(report.variant).toBe(IG);
    const body = feedbackRequest("correction", { name: "", note: "" }, { report, page: "/" }, "ts");
    expect(body).toMatchObject({ kind: "correction", mode: "endless", variant: IG, round: 2 });
  });
});

describe("sharing", () => {
  it("says Instagram Endless in the share text", () => {
    expect(shareHeading(IG)).toBe("Bigger Than — Instagram Endless");
    expect(shareHeading()).toBe("Bigger Than — Football Legends");
    const text = shareText(3, [], "wrong", "biggerthangame.com", "endless", null, IG);
    expect(text.split("\n")[0]).toBe("Bigger Than — Instagram Endless");
  });

  it("points a challenge at Instagram Endless's own page", () => {
    const url = challengeUrl("https://biggerthangame.com", link(7), IG);
    expect(url).toMatch(
      /^https:\/\/biggerthangame\.com\/football-higher-or-lower\/legends\/endless\/instagram\?challenge=/,
    );
    expect(challengeText(link(7), "https://biggerthangame.com", "endless", IG)).toContain(
      "/legends/endless/instagram?challenge=",
    );
    expect(challengeText(link(7), "https://biggerthangame.com", "endless")).toContain(
      "/legends/endless?challenge=",
    );
  });
});
