/**
 * Challenge links and the local best through the state machine and the
 * controller: what the start sends, what the server's answer does to the
 * state, and when the best is saved.
 */

import type { AnswerResponse, ChallengeLink, StartResponse } from "@bt/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameApi } from "../api";
import { GameController } from "../controller";
import { initialState, offeredLink, reduce } from "../machine";
import type { Challenge, GameState } from "../machine";
import { TIMINGS } from "../timing";
import { challengeNotice } from "../view";
import { cont, link, round, wrong } from "./fixtures";

const offer: Challenge = { status: "offered", link: link(12) };

describe("the machine and a challenge link", () => {
  const starting = reduce(initialState(0, offer), { type: "start" });

  it("keeps an offered link through the first start, for the request", () => {
    expect(starting.challenge).toEqual(offer);
    expect(offeredLink(starting)).toEqual(link(12));
  });

  it("records an accepted replay", () => {
    const s = reduce(starting, {
      type: "started",
      runId: "r",
      round: round(1),
      challenge: { accepted: true, score: 12 },
    });
    expect(s.challenge).toEqual({ status: "accepted", score: 12 });
    expect(offeredLink(s)).toBeUndefined();
  });

  it("records a refusal, and the reason", () => {
    const s = reduce(starting, {
      type: "started",
      runId: "r",
      round: round(1),
      challenge: { accepted: false, reason: "expired" },
    });
    expect(s.challenge).toEqual({ status: "refused", reason: "expired" });
  });

  it("drops the challenge on Play again", () => {
    let s: GameState = reduce(starting, {
      type: "started",
      runId: "r",
      round: round(1),
      challenge: { accepted: true, score: 12 },
    });
    s = { ...s, phase: "over" };
    expect(reduce(s, { type: "start" }).challenge).toBeNull();
  });

  it("keeps a link refused before the start, and sends nothing", () => {
    const refused: Challenge = { status: "refused", reason: "invalid" };
    const s = reduce(initialState(0, refused), { type: "start" });
    expect(s.challenge).toEqual(refused);
    expect(offeredLink(s)).toBeUndefined();
  });

  it("keeps the signed link from the run's end, and none after a drop", () => {
    let s = reduce(initialState(), { type: "start" });
    s = reduce(s, { type: "started", runId: "r", round: round(1) });
    s = reduce(s, { type: "titled" });
    s = reduce(s, { type: "held" });
    s = reduce(s, { type: "introDone" });
    s = reduce(s, { type: "dealt" });
    s = reduce(s, { type: "spun" });
    s = reduce(s, { type: "guess", guess: "higher", at: 0 });
    const ended = reduce(s, { type: "answered", response: wrong(1), at: 10 });
    expect(ended.link).toEqual(link(0));
    const dropped = reduce(s, { type: "answerFailed", failure: { kind: "fatal" }, at: 10 });
    expect(dropped.link).toBeNull();
  });
});

describe("challengeNotice", () => {
  const refused = (reason: "invalid" | "expired"): GameState => ({
    ...initialState(0, { status: "refused", reason }),
  });

  it("explains a refused link before the run and during round one", () => {
    expect(challengeNotice(refused("invalid"))).toMatch(/didn't check out/);
    expect(challengeNotice(refused("expired"))).toMatch(/expired/);
    const roundOne = { ...refused("invalid"), phase: "awaiting" as const, round: round(1) };
    expect(challengeNotice(roundOne)).not.toBe("");
  });

  it("goes once the run moves on, and says nothing for other runs", () => {
    const later = { ...refused("invalid"), phase: "awaiting" as const, round: round(2) };
    expect(challengeNotice(later)).toBe("");
    expect(challengeNotice({ ...refused("invalid"), phase: "over" })).toBe("");
    expect(challengeNotice(initialState(0, offer))).toBe("");
    expect(challengeNotice(initialState())).toBe("");
  });
});

class Api implements GameApi {
  starts: (ChallengeLink | undefined)[] = [];
  reply: StartResponse = { runId: "r", round: round(1) };
  answers: AnswerResponse[] = [];
  start(challenge?: ChallengeLink): Promise<StartResponse> {
    this.starts.push(challenge);
    return Promise.resolve(this.reply);
  }
  answer(): Promise<AnswerResponse> {
    const next = this.answers.shift();
    return next ? Promise.resolve(next) : new Promise(() => {});
  }
}

describe("the controller", () => {
  let api: Api;
  let saved: number[];
  let controller: GameController;
  const flush = () => vi.advanceTimersByTimeAsync(0);
  const make = (challenge: Challenge | null, best = 0) => {
    controller = new GameController({
      api,
      timings: TIMINGS,
      now: () => Date.now(),
      schedule: (fn, ms) => {
        const id = setTimeout(fn, ms);
        return () => clearTimeout(id);
      },
      reducedMotion: () => true,
      best,
      saveBest: (b) => saved.push(b),
      challenge,
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    api = new Api();
    saved = [];
  });
  afterEach(() => {
    controller.destroy();
    vi.useRealTimers();
  });

  it("sends the offered link with the first start only", async () => {
    make(offer);
    api.reply = { runId: "r", round: round(1), challenge: { accepted: true, score: 12 } };
    controller.start();
    await flush();
    expect(api.starts).toEqual([link(12)]);
    expect(controller.state.challenge).toEqual({ status: "accepted", score: 12 });
  });

  it("starts plainly without a link", async () => {
    make(null);
    controller.start();
    await flush();
    expect(api.starts).toEqual([undefined]);
    expect(controller.state.challenge).toBeNull();
  });

  it("saves the best each time it rises, and not otherwise", async () => {
    make(null, 1);
    api.answers = [cont(1, round(2)), cont(2, round(3)), wrong(3)];
    controller.start();
    await vi.runAllTimersAsync();
    for (let i = 0; i < 3; i++) {
      controller.guess("higher");
      await vi.runAllTimersAsync();
    }
    expect(controller.state.phase).toBe("over");
    expect(controller.state.streak).toBe(2);
    expect(saved).toEqual([2]);
  });
});
