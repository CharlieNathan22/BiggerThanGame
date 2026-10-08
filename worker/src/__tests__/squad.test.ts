/**
 * "Clear the squad" (variants.ts and themes.ts in @bt/core) through the
 * Worker: Endless's round protocol under each theme's own run ids, seeds,
 * tokens and challenge links, every player dealt once, `won` when the squad is
 * cleared, the squad's own label for club goals, and no boards.
 */

import { describe, expect, it } from "vitest";
import { SQUAD_LABELS, STATS, STAT_KEYS, buildRun } from "@bt/core";
import type { GuessEndResponse, GuessResponse, RoundPayload } from "@bt/core";
import { toDataPoint, toLogLine } from "../analytics.js";
import type { GameEvent } from "../analytics.js";
import { checkChallenge } from "../challenge.js";
import { handleLeave } from "../leave.js";
import { toRoundPayload } from "../payload.js";
import { parseRunId, verifyRunId } from "../run-id.js";
import { disconnectedEnd, handleGuess, handleRunStart, parseRunStart } from "../run.js";
import { endlessSeed, seedFor } from "../seed.js";
import { handleSubmit } from "../submit.js";
import type { SubmitContext } from "../submit.js";
import { begin, harness, readToken, startBody, walk } from "./endless-helpers.js";
import type { Harness } from "./endless-helpers.js";
import { SAMPLE_DECK, SECRET, THEMED_DECK, TODAY, runDay } from "./helpers.js";

const SQUAD = "squad:club-testfield" as const;
const OTHER = "squad:club-kestrel-rovers" as const;
const ctxFacts = { country: "GB", deckVersion: "legends-test" };

function themed(): Harness {
  return harness({ deck: THEMED_DECK });
}

/** Every round a walk dealt: the first, then each `next`. */
function roundsOf(started: { round: RoundPayload }, answers: readonly GuessResponse[]) {
  return [started.round, ...answers.flatMap((a) => ("next" in a ? [a.next] : []))];
}

async function endedRun(stopAt: number): Promise<{ end: GuessEndResponse; runId: string }> {
  const { started, answers } = await walk(themed(), { stopAt, ending: "wrong", variant: SQUAD });
  return { end: answers.at(-1) as GuessEndResponse, runId: started.runId };
}

describe("starting a squad run", () => {
  it("parses a theme's variant, and refuses a malformed one", () => {
    expect(parseRunStart(startBody(undefined, SQUAD))).toEqual({
      ok: true,
      value: { mode: "endless", variant: SQUAD, turnstileToken: "turnstile-token" },
    });
    for (const variant of ["squad:", "squad:Club", "squad:a b", "squad", "club-testfield"]) {
      expect(parseRunStart({ mode: "endless", variant, turnstileToken: "t" }).ok).toBe(false);
    }
  });

  it("refuses a theme the deck doesn't have, before Turnstile", async () => {
    let asked = false;
    const h = harness({
      deck: THEMED_DECK,
      verifyTurnstile: async () => ((asked = true), "pass"),
    });
    for (const variant of ["squad:club-nowhere", "squad:club-elsewhere"] as const) {
      const res = await handleRunStart(startBody(undefined, variant), h.ctx);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: "bad_request",
        detail: "variant names no theme in this deck",
      });
    }
    expect(asked).toBe(false);
    // The sample deck has no themes at all.
    const bare = await handleRunStart(startBody(undefined, SQUAD), harness().ctx);
    expect(bare.status).toBe(400);
  });

  it("starts under a run id, seed and token of the theme's own", async () => {
    const h = themed();
    const started = await begin(h, undefined, SQUAD);
    expect(await verifyRunId(started.runId, SECRET, SQUAD)).toBeDefined();
    for (const other of ["endless", "endless-instagram", OTHER] as const) {
      expect(await verifyRunId(started.runId, SECRET, other)).toBeUndefined();
    }
    expect(readToken(started.token)).toMatchObject({ mode: "endless", variant: SQUAD });
    expect(h.events).toEqual([
      expect.objectContaining({ type: "start", mode: "endless", variant: SQUAD }),
    ]);
  });
});

describe("playing a squad run", () => {
  it("deals every Testfield player once and ends `won` when the squad is cleared", async () => {
    for (let i = 0; i < 6; i++) {
      const h = themed();
      const { started, answers } = await walk(h, { variant: SQUAD, ending: "none" });
      const rounds = roundsOf(started, answers);
      expect(rounds).toHaveLength(15);
      const ids = [rounds[0]!.anchor.id, ...rounds.map((r) => r.challenger.id)];
      expect(new Set(ids).size).toBe(16);
      for (const id of ids) {
        expect(THEMED_DECK.find((p) => p.id === id)!.mainClubs).toContain("Testfield");
      }
      const end = answers.at(-1) as GuessEndResponse;
      expect(end.end).toBe("won");
      expect(end.reveal.correct).toBe(true);
      expect(answers.at(-2)).toHaveProperty("next");
      // The last question carries no photo for a round after it.
      expect(rounds.at(-1)!.upcoming).toBeUndefined();
      expect(h.events.at(-1)).toMatchObject({ type: "end", end: "won", score: 15 });
    }
  });

  it("still ends on a wrong answer or a timeout, at the score reached", async () => {
    const wrong = await endedRun(6);
    expect(wrong.end).toMatchObject({ end: "wrong" });
    const late = await walk(themed(), { stopAt: 4, ending: "late", variant: SQUAD });
    expect(late.answers.at(-1)).toMatchObject({ end: "timeout" });
  });

  it("matches the core sequence round for round", async () => {
    const h = themed();
    const { started, answers } = await walk(h, { variant: SQUAD, ending: "none" });
    const run = parseRunId(started.runId)!;
    const seed = await endlessSeed(SECRET, run.origin, SQUAD);
    expect(await seedFor(SQUAD, SECRET, run.origin)).toBe(seed);
    const core = buildRun({
      deck: THEMED_DECK,
      seed,
      mode: "endless",
      now: run.date,
      variant: SQUAD,
    });
    expect(roundsOf(started, answers).map((r) => `${r.stat.key}:${r.challenger.id}`)).toEqual(
      core.map((r) => `${r.stat}:${r.challenger.id}`),
    );
  });

  it("labels the career stats as the whole career in a squad, and only there", () => {
    const run = buildRun({
      deck: THEMED_DECK,
      seed: "label",
      mode: "endless",
      now: TODAY,
      variant: SQUAD,
    });
    const career: Readonly<Record<string, string>> = SQUAD_LABELS;
    for (const stat of STAT_KEYS) {
      const round = { ...run[0]!, stat };
      expect(toRoundPayload(round, new Date(), {}, undefined, SQUAD).stat.label, stat).toBe(
        career[stat] ?? STATS[stat].label,
      );
      expect(toRoundPayload(round, new Date(), {}, undefined, "endless").stat.label).toBe(
        STATS[stat].label,
      );
      expect(toRoundPayload(round, new Date(), {}).stat.label).toBe(STATS[stat].label);
    }
    expect(
      toRoundPayload({ ...run[0]!, stat: "apps" }, new Date(), {}, undefined, SQUAD).stat.label,
    ).toBe("All club appearances");
  });

  it("answers a token whose theme the deck has since lost with token_mismatch", async () => {
    const h = themed();
    const started = await begin(h, undefined, SQUAD);
    const res = await handleGuess(
      { token: started.token, guess: "higher" },
      { ...h.ctx, deck: SAMPLE_DECK },
    );
    expect(res.status).toBe(409);
  });
});

describe("challenge links", () => {
  it("check out in their own theme and nowhere else", async () => {
    const { end, runId } = await endedRun(5);
    const clock = runDay(runId);
    expect(await checkChallenge(SECRET, end.challenge, clock, SQUAD)).toEqual({
      ok: true,
      score: 4,
    });
    for (const other of ["endless", "endless-instagram", OTHER] as const) {
      expect(await checkChallenge(SECRET, end.challenge, clock, other)).toEqual({
        ok: false,
        reason: "invalid",
      });
    }
    const taken = await begin(themed(), end.challenge, SQUAD);
    expect(taken.challenge).toEqual({ accepted: true, score: 4 });
    const elsewhere = await begin(themed(), end.challenge, OTHER);
    expect(elsewhere.challenge).toEqual({ accepted: false, reason: "invalid" });
  });
});

describe("publishing", () => {
  it("is refused for a squad, before the run, Turnstile or the database", async () => {
    const touched: string[] = [];
    const events: GameEvent[] = [];
    const { end, runId } = await endedRun(4);
    const ctx: SubmitContext = {
      deck: THEMED_DECK,
      secret: SECRET,
      clock: () => runDay(runId),
      uuid: () => "00000000-0000-4000-8000-000000000099",
      verifyTurnstile: async () => {
        touched.push("turnstile");
        return "pass";
      },
      runs: () => {
        touched.push("run");
        throw new Error("no Durable Object for a run without boards");
      },
      db: new Proxy({} as SubmitContext["db"], {
        get: () => {
          touched.push("db");
          throw new Error("no database for a run without boards");
        },
      }),
      record: (event) => events.push(event),
    };
    const res = await handleSubmit(
      {
        nickname: "SwiftVolley42",
        deviceId: "3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b",
        turnstileToken: "ts",
        showCountry: false,
        token: end.result,
      },
      ctx,
    );
    expect(res.body).toEqual({ error: "bad_request", detail: "no_boards" });
    expect(touched).toEqual([]);
    expect(events[0]).toMatchObject({ type: "submit", variant: SQUAD, refusal: "no_boards" });
    expect(toDataPoint(events[0]!, ctxFacts).blobs[1]).toBe("squad");
  });
});

describe("analytics and logs", () => {
  it('write "squad" as the mode and the theme id in blob10, on every event', async () => {
    const h = themed();
    await walk(h, { stopAt: 4, ending: "wrong", variant: SQUAD });
    expect(new Set(h.events.map((e) => e.type))).toEqual(new Set(["start", "answer", "end"]));
    for (const event of h.events) {
      const point = toDataPoint(event, ctxFacts);
      expect(point.blobs[1]).toBe("squad");
      expect(point.blobs).toHaveLength(10);
      expect(point.blobs[9]).toBe("club-testfield");
    }
    // The answer's own blobs are where they always were.
    const answer = toDataPoint(h.events[1]!, ctxFacts);
    expect(answer.blobs[5]).toBe(h.events[1]!.type === "answer" ? h.events[1]!.stat : "");
    const start = toLogLine(h.events[0]!, ctxFacts, "/api/run/start")!;
    expect(start).toMatchObject({ message: "run_start", mode: "squad", theme: "club-testfield" });
    expect(start).not.toHaveProperty("variant");
    const end = toLogLine(h.events.at(-1)!, ctxFacts, "/api/round/guess")!;
    expect(end).toMatchObject({ message: "run_end", mode: "squad", theme: "club-testfield" });
  });

  it("leave every other mode's data points without a theme blob", async () => {
    const h = harness();
    await walk(h, { stopAt: 2, ending: "wrong" });
    for (const event of h.events) {
      expect(toDataPoint(event, ctxFacts).blobs.length).toBeLessThan(10);
    }
  });
});

describe("a silent run and a leave", () => {
  it("closes a disconnected squad run with the round it left open", async () => {
    const h = themed();
    const started = await begin(h, undefined, SQUAD);
    const record = h.ledgers.get(parseRunId(started.runId)!.body)!.run!;
    expect(record.variant).toBe(SQUAD);
    const event = await disconnectedEnd(record, THEMED_DECK, SECRET);
    expect(event).toMatchObject({ type: "end", variant: SQUAD, end: "disconnected", score: 0 });
    expect(event.shown?.players[0].id).toBe(started.round.anchor.id);
    // A deck without the theme closes it all the same, without the round.
    const bare = await disconnectedEnd(record, SAMPLE_DECK, SECRET);
    expect(bare).toMatchObject({ end: "disconnected" });
    expect(bare.shown).toBeUndefined();
  });

  it("takes a leave beacon naming the theme", async () => {
    const h = themed();
    const started = await begin(h, undefined, SQUAD);
    const events: GameEvent[] = [];
    const ctx = {
      deck: THEMED_DECK,
      secret: SECRET,
      clock: () => runDay(started.runId),
      record: (e: GameEvent) => events.push(e),
    };
    const leave = {
      mode: "endless",
      variant: SQUAD,
      runId: started.runId,
      round: 1,
      phase: "question",
      trigger: "hidden",
    };
    expect((await handleLeave(leave, ctx)).status).toBe(204);
    expect(events[0]).toMatchObject({ type: "leave", variant: SQUAD });
    expect(events[0]).toHaveProperty("shown.players.0.id", started.round.anchor.id);
    const gone = await handleLeave(leave, { ...ctx, deck: SAMPLE_DECK });
    expect(gone.status).toBe(400);
  });
});
