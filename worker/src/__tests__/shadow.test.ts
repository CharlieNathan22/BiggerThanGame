import { describe, expect, it } from "vitest";
import { ANSWER_TIMINGS, answerAllowance } from "@bt/core";
import type { AnswerRecord } from "../run-ledger.js";
import {
  FAST_COUNT,
  FAST_MS,
  FLAT_MIN_ANSWERS,
  KNIFE_MIN_ROUNDS,
  THINK_FLOOR_MS,
  shadowReasons,
  thinkMs,
} from "../shadow.js";
import { createRng } from "@bt/core";

/** A run of right answers from round 1, each with this think time on top of the floor. */
function run(thinks: readonly number[], over: Partial<AnswerRecord> = {}): AnswerRecord[] {
  return thinks.map((think, i) => ({
    round: i + 1,
    nonce: `n${i + 1}`,
    guess: "higher",
    issuedAt: 0,
    receivedAt: THINK_FLOOR_MS + think,
    ms: THINK_FLOOR_MS + think,
    correct: true,
    ...over,
  }));
}

/** Human-looking think times: 1.5–7 s, spread out. */
function human(count: number, seed = "person"): number[] {
  const rng = createRng(seed);
  return Array.from({ length: count }, () => 1500 + Math.floor(rng.next() * 5500));
}

describe("the think-time floor", () => {
  it("is the verdict, the gap to the next pair and the short hold", () => {
    expect(THINK_FLOOR_MS).toBe(ANSWER_TIMINGS.verdict + ANSWER_TIMINGS.next + ANSWER_TIMINGS.hold);
    expect(THINK_FLOOR_MS).toBe(4280);
  });
});

describe("thinking time, the boards' tiebreak", () => {
  const t = ANSWER_TIMINGS;
  const held = t.verdict + t.next + t.hold;
  const spun = t.verdict + t.next + t.beat + t.spin + t.land;
  /** Answers with these measured times, round 1 first. */
  const answers = (ms: readonly number[], over: Partial<AnswerRecord> = {}): AnswerRecord[] =>
    ms.map((m, i) => ({
      round: i + 1,
      nonce: `n${i + 1}`,
      guess: "higher",
      issuedAt: 0,
      receivedAt: m,
      ms: m,
      correct: true,
      ...over,
    }));

  it("takes each round's own animation off its answer, from round two", () => {
    expect(answerAllowance(2, false)).toBe(held);
    expect(answerAllowance(2, true)).toBe(spun);
    // Round 1 (left out), then a held stat (+1.2 s), a change (+0.8 s), a held one (+2 s).
    const ms = [14_000, held + 1200, spun + 800, held + 2000];
    expect(thinkMs(answers(ms), (round) => round === 3)).toBe(1200 + 800 + 2000);
  });

  it("doesn't count a stat change's spin against the player", () => {
    // Two players thinking 1.5 s a question: one run's stat changed every round, the other's never.
    const changing = answers([9000, spun + 1500, spun + 1500, spun + 1500]);
    const holding = answers([9000, held + 1500, held + 1500, held + 1500]);
    expect(thinkMs(changing, () => true)).toBe(4500);
    expect(thinkMs(holding, () => false)).toBe(4500);
    // The fixed floor the heuristics use would have put the changing run 5.4 s behind.
    expect(thinkMs(changing, () => false) - thinkMs(holding, () => false)).toBe(3 * (spun - held));
  });

  it("counts a timeout's time, and never an answer below zero", () => {
    expect(thinkMs(answers([9000, held + 10_000], { guess: "timeout" }), () => false)).toBe(10_000);
    expect(thinkMs(answers([9000, held - 500, held + 300]), () => false)).toBe(300);
    expect(thinkMs(answers([9000]), () => false)).toBe(0);
  });
});

describe("shadowReasons", () => {
  it("leaves a person's run alone, however long", () => {
    expect(shadowReasons(run(human(12)))).toEqual([]);
    expect(shadowReasons(run(human(45, "long run")))).toEqual([]);
  });

  it("flags several right answers faster than a person could think", () => {
    const thinks = human(15);
    for (let i = 2; i < 2 + FAST_COUNT; i += 1) thinks[i] = FAST_MS - 50;
    expect(shadowReasons(run(thinks))).toContain("fast");
    // One fewer is a quick player, not a script.
    thinks[2] = 2000;
    expect(shadowReasons(run(thinks))).not.toContain("fast");
  });

  it("ignores round one, whose title card can be skipped, and timeouts", () => {
    const thinks = human(12);
    thinks[0] = -4000;
    expect(shadowReasons(run(thinks))).toEqual([]);
    expect(shadowReasons(run(Array(12).fill(0), { guess: "timeout", correct: false }))).toEqual([]);
  });

  it("flags think times that barely vary", () => {
    const steady = Array.from({ length: FLAT_MIN_ANSWERS + 1 }, (_, i) => 2500 + (i % 3) * 40);
    expect(shadowReasons(run(steady))).toContain("flat");
    // Too few answers to say.
    expect(shadowReasons(run(steady.slice(0, FLAT_MIN_ANSWERS - 1)))).not.toContain("flat");
  });

  it("flags perfect, quick answers deep into the knife-edge bands", () => {
    // Rounds 1–15 human, then the knife-edge rounds (16+) fast but varied.
    const rng = createRng("bot");
    const thinks = [
      ...human(15),
      ...Array.from({ length: KNIFE_MIN_ROUNDS }, () => 400 + Math.floor(rng.next() * 600)),
    ];
    expect(shadowReasons(run(thinks))).toEqual(["knife"]);
    // A person taking their time at the knife edge is fine.
    const careful = [...human(15), ...human(KNIFE_MIN_ROUNDS, "careful").map((t) => t + 1000)];
    expect(shadowReasons(run(careful))).toEqual([]);
  });

  it("can give more than one reason", () => {
    const bot = Array.from({ length: 30 }, () => 100);
    expect(shadowReasons(run(bot))).toEqual(["fast", "flat", "knife"]);
  });
});
