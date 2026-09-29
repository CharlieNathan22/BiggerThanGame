import { describe, expect, it } from "vitest";
import { ANSWER_TIMINGS } from "@bt/core";
import type { AnswerRecord } from "../run-ledger.js";
import {
  FAST_COUNT,
  FAST_MS,
  FLAT_MIN_ANSWERS,
  KNIFE_MIN_ROUNDS,
  THINK_FLOOR_MS,
  shadowReasons,
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
