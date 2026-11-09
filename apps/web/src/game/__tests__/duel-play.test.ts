/**
 * 1v1 through the controller and the room's client (duel/client.ts), over a
 * fake socket that speaks as the room does:
 *
 * - the room's first question starts the match on the page, with no request;
 * - a pick is locked in and sent at once, once; the clock running out sends
 *   `timeout`; neither reveals anything;
 * - the room's reveal plays as any mode's does, then the next question, or
 *   full time; a forfeit stops the match with nothing to reveal;
 * - a rematch is a new run on the same page;
 * - coming back mid-match (a refresh, a new tab, a dropped connection) picks
 *   the match up where the room says it is, the clock still running;
 * - the game is always moved to where the room is, never left on a question
 *   the room has finished.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomServerMessage } from "@bt/core";
import { GameController } from "../controller";
import { DuelClient } from "../duel/client";
import type { DuelSnapshot } from "../duel/client";
import { createSeatStore } from "../duel/session";
import { RoomSocket } from "../duel/socket";
import type { GameState } from "../machine";
import { TIMINGS } from "../timing";
import {
  FakeSocket,
  SETTINGS,
  fakeStorage,
  lobby,
  players,
  question,
  reveal,
  welcome,
} from "./duel-helpers";

let controllers: GameController[] = [];
let clients: DuelClient[] = [];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const c of controllers) c.destroy();
  for (const c of clients) c.destroy();
  controllers = [];
  clients = [];
  vi.useRealTimers();
});

const flush = () => vi.advanceTimersByTimeAsync(0);

async function until(done: () => boolean, ms = 60_000): Promise<boolean> {
  for (let t = 0; t < ms && !done(); t += 50) await vi.advanceTimersByTimeAsync(50);
  return done();
}

/** A 1v1 page: the room's client over a fake socket, driving a real controller. */
function page(storage = fakeStorage()) {
  const sockets: FakeSocket[] = [];
  const schedule = (fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  };
  const socket = new RoomSocket({
    socket: (url) => {
      const made = new FakeSocket(url);
      // The room is there throughout: its heartbeat is answered.
      made.pongs = true;
      sockets.push(made);
      return made;
    },
    url: (code) => `wss://example.test/api/room/ws?code=${code}`,
    schedule,
    now: () => Date.now(),
    random: () => 0.5,
  });
  const seats = createSeatStore(storage.access);
  let snapshot!: DuelSnapshot;
  const client = new DuelClient({
    socket,
    seats,
    now: () => Date.now(),
    onChange: (s) => (snapshot = s),
  });
  const c = new GameController({
    api: client.api,
    mode: "duel",
    timings: TIMINGS,
    now: () => Date.now(),
    schedule,
    reducedMotion: () => false,
    onLock: (index, pick) => client.lock(index, pick),
  });
  client.attach(c);
  let state!: GameState;
  c.subscribe((s) => (state = s));
  controllers.push(c);
  clients.push(client);
  const self = {
    c,
    client,
    seats,
    sockets,
    get room(): FakeSocket {
      return sockets.at(-1)!;
    },
    state: () => state,
    snapshot: () => snapshot,
    /** The messages this page has sent the room, on every socket, without hellos and pings. */
    said: () =>
      sockets
        .flatMap((s) => s.messages)
        .filter((m) => typeof m === "object" && (m as { t: string }).t !== "hello"),
    /** Into the room as `you`, welcomed with `room`. */
    enter(you = 0, room = lobby()) {
      client.enter("K7QM2X", `token-${you}`);
      self.room.open();
      self.room.say(welcome(you, room));
    },
    say: (message: RoomServerMessage) => self.room.say(message),
    awaiting: () => until(() => state.phase === "awaiting"),
  };
  return self;
}

/** In the room, the match started: question one on screen and answerable. */
async function playing(you = 0) {
  const p = page();
  p.enter(you);
  p.say({ v: 1, t: "question", question: question(1) });
  await flush();
  expect(await p.awaiting()).toBe(true);
  return p;
}

describe("a match starts", () => {
  it("when the room sends its first question: no request, straight onto the pitch", async () => {
    const p = page();
    p.enter();
    expect(p.state().phase).toBe("idle");
    p.say({ v: 1, t: "question", question: question(1) });
    await flush();
    // Round one, behind its title card, as any run opens.
    expect(p.state()).toMatchObject({
      phase: "title",
      mode: "duel",
      runId: "duel:K7QM2X:1",
      stream: { pool: "endless", questions: 3, limit: 20 },
    });
    expect(p.state().round?.index).toBe(1);
    expect(p.snapshot().view).toMatchObject({ phase: "playing", matchNo: 1, scores: [0, 0] });
    expect(await p.awaiting()).toBe(true);
    // The room's own limit on the clock, question one included.
    expect(p.state().clock?.limitMs).toBe(SETTINGS.limit * 1000);
    expect(p.said()).toEqual([]);
  });

  it("never lets the clock run past the room's deadline", async () => {
    const p = page();
    p.enter();
    // The room closes this question twelve seconds from now: the opening takes most of it.
    p.say({ v: 1, t: "question", question: question(1, 1, 12_000) });
    const arrived = Date.now();
    await flush();
    expect(await p.awaiting()).toBe(true);
    const { clock } = p.state();
    expect(clock!.startedAt + clock!.limitMs).toBe(arrived + 12_000);
    expect(clock!.limitMs).toBeLessThan(SETTINGS.limit * 1000);
  });
});

describe("answering", () => {
  it("locks the pick in and sends it to the room at once, once", async () => {
    const p = await playing();
    p.c.guess("higher");
    expect(p.said()).toEqual([{ v: 1, t: "answer", q: 1, pick: "higher" }]);
    // Locked in, and waiting on the room: nothing is revealed for it.
    expect(p.state()).toMatchObject({ phase: "awaiting", locked: "higher", reveal: null });
    expect(p.snapshot().view).toMatchObject({ picked: "higher", locked: [0] });
    // A second press, either way, changes nothing and sends nothing.
    p.c.guess("lower");
    p.c.guess("higher");
    expect(p.said()).toHaveLength(1);
    expect(p.state().locked).toBe("higher");
  });

  it("hears the other player lock in, and never which way", async () => {
    const p = await playing();
    p.say({ v: 1, t: "locked", seat: 1 });
    expect(p.snapshot().view?.locked).toEqual([1]);
    expect(JSON.stringify(p.snapshot().view)).not.toMatch(/"higher"|"lower"/);
    // It doesn't answer for this player.
    expect(p.state()).toMatchObject({ phase: "awaiting", locked: null });
  });

  it("sends `timeout` when the clock runs out, and waits for the room", async () => {
    const p = await playing();
    await vi.advanceTimersByTimeAsync(SETTINGS.limit * 1000);
    expect(p.said()).toEqual([{ v: 1, t: "answer", q: 1, pick: "timeout" }]);
    expect(p.state()).toMatchObject({ phase: "awaiting", locked: "timeout" });
    // Too late to pick now.
    p.c.guess("higher");
    expect(p.said()).toHaveLength(1);
  });

  it("doesn't send a timeout for a question already answered", async () => {
    const p = await playing();
    p.c.guess("lower");
    await vi.advanceTimersByTimeAsync(SETTINGS.limit * 1000 + 5000);
    expect(p.said()).toEqual([{ v: 1, t: "answer", q: 1, pick: "lower" }]);
    expect(p.state().locked).toBe("lower");
  });
});

describe("the reveal", () => {
  it("plays when the room sends it, then the next question comes", async () => {
    const p = await playing();
    p.c.guess("higher");
    p.say({ v: 1, t: "locked", seat: 1 });
    p.say(reveal(1, [true, false], [1, 0], { next: question(2) }));
    await flush();
    // The figure arrives with the reveal, and the count-up plays as in any mode.
    expect(p.state()).toMatchObject({ phase: "revealing", guess: "higher" });
    expect(p.state().reveal).toMatchObject({ round: 1, value: 80, correct: true });
    expect(p.snapshot().view).toMatchObject({
      scores: [1, 0],
      results: [[true], [false]],
      reveal: { index: 1, picks: ["higher", "lower"], correct: [true, false] },
    });
    expect(await until(() => p.state().phase === "verdict")).toBe(true);
    expect(p.state().streak).toBe(1);
    // On to question two, a miss or not.
    expect(await until(() => p.state().round?.index === 2 && p.state().phase === "awaiting")).toBe(
      true,
    );
    expect(p.state()).toMatchObject({ locked: null, reveal: null });
    expect(p.snapshot().view).toMatchObject({ picked: null, locked: [] });
    expect(p.snapshot().view?.question?.round.index).toBe(2);
    // No request was ever made: only the pick was sent.
    expect(p.said()).toEqual([{ v: 1, t: "answer", q: 1, pick: "higher" }]);
  });

  it("goes on after a miss, and after no answer at all", async () => {
    const p = await playing(1);
    // This player (the guest) never answers; the room closes the question at its deadline.
    p.say(reveal(1, [true, false], [1, 0], { next: question(2) }, 1));
    await flush();
    expect(p.state()).toMatchObject({ phase: "revealing", guess: "timeout" });
    expect(p.state().reveal?.correct).toBe(false);
    expect(await until(() => p.state().round?.index === 2 && p.state().phase === "awaiting")).toBe(
      true,
    );
    expect(p.state().streak).toBe(0);
    expect(p.state().history).toEqual([expect.objectContaining({ index: 1, correct: false })]);
  });

  it("is taken even while the question is still being dealt", async () => {
    const p = page();
    p.enter();
    p.say({ v: 1, t: "question", question: question(1) });
    await flush();
    // Both others answered before this page got as far as the picks.
    expect(await until(() => p.state().phase === "dealing")).toBe(true);
    p.say(reveal(1, [false, true], [0, 1], { next: question(2) }));
    await flush();
    expect(p.state()).toMatchObject({ phase: "revealing", guess: "timeout" });
    expect(await until(() => p.state().round?.index === 2 && p.state().phase === "awaiting")).toBe(
      true,
    );
  });

  it("carries the next question's deadline to its clock", async () => {
    const p = await playing();
    p.c.guess("higher");
    p.say(reveal(1, [true, true], [1, 1], { next: question(2, 1, 9000) }));
    const arrived = Date.now();
    await flush();
    expect(await until(() => p.state().round?.index === 2 && p.state().phase === "awaiting")).toBe(
      true,
    );
    const { clock } = p.state();
    expect(clock!.startedAt + clock!.limitMs).toBe(arrived + 9000);
  });
});

describe("full time", () => {
  const result = {
    winner: 0,
    reason: "finished" as const,
    scores: [2, 1],
    results: [
      [true, false, true],
      [false, true, false],
    ],
    questions: 3,
  };

  it("comes with the last reveal, once it has played", async () => {
    const p = await playing();
    for (const index of [1, 2]) {
      p.c.guess("higher");
      p.say(reveal(index, [true, false], [index, 0], { next: question(index + 1) }));
      await flush();
      expect(
        await until(() => p.state().round?.index === index + 1 && p.state().phase === "awaiting"),
      ).toBe(true);
    }
    p.c.guess("higher");
    p.say(
      reveal(3, [true, false], [3, 0], {
        end: { result: { ...result, scores: [3, 0] }, series: { wins: [1, 0], draws: 0 } },
      }),
    );
    await flush();
    // The room is at full time at once; the page plays the last reveal first.
    expect(p.snapshot().view).toMatchObject({ phase: "fulltime", series: { wins: [1, 0] } });
    expect(p.state().phase).toBe("revealing");
    expect(await until(() => p.state().phase === "over")).toBe(true);
    expect(p.state()).toMatchObject({ end: "finished", streak: 3 });
    expect(p.snapshot().view?.result).toMatchObject({ winner: 0, scores: [3, 0] });
  });

  it("comes at once on a forfeit: there is no reveal to play", async () => {
    const p = await playing();
    p.c.guess("higher");
    p.say({
      v: 1,
      t: "fulltime",
      result: { ...result, reason: "forfeit", left: 1, scores: [0, 0], results: [[], []] },
      series: { wins: [1, 0], draws: 0 },
      players: players([{}, { connected: false, left: true }]),
    });
    await flush();
    expect(p.state()).toMatchObject({ phase: "over", end: "finished" });
    expect(p.snapshot().view).toMatchObject({
      phase: "fulltime",
      result: { reason: "forfeit", left: 1, winner: 0 },
    });
    expect(p.snapshot().view?.players[1]).toMatchObject({ left: true });
  });

  it("starts a rematch as a new run when the room deals it", async () => {
    const p = await playing();
    p.c.guess("higher");
    p.say(
      reveal(1, [true, false], [1, 0], {
        end: { result, series: { wins: [1, 0], draws: 0 } },
      }),
    );
    await flush();
    expect(await until(() => p.state().phase === "over")).toBe(true);

    p.client.rematch();
    expect(p.said().at(-1)).toEqual({ v: 1, t: "rematch" });
    p.say({ v: 1, t: "rematch", seats: [0] });
    expect(p.snapshot().view?.rematch).toEqual([0]);
    // The other player accepts: the room deals match two.
    p.say({ v: 1, t: "question", question: question(1, 2) });
    await flush();
    expect(p.state()).toMatchObject({ phase: "title", runId: "duel:K7QM2X:2", streak: 0 });
    expect(p.snapshot().view).toMatchObject({
      phase: "playing",
      matchNo: 2,
      scores: [0, 0],
      results: [[], []],
      result: null,
      rematch: [],
      // The series is the room's, and carries over.
      series: { wins: [1, 0], draws: 0 },
    });
    expect(await p.awaiting()).toBe(true);
  });
});

describe("coming back to a match", () => {
  /** A room mid-match, as a returning player's `welcome` describes it. */
  const midMatch = (overrides: Record<string, unknown> = {}) =>
    lobby({
      phase: "playing",
      match: { no: 1, scores: [1, 0], results: [[true], [false]] },
      question: question(2, 1, 14_000),
      locked: [],
      ...overrides,
    });

  it("picks the match up at the room's question, its clock still running", async () => {
    // A fresh page: a refresh, a new tab, or the tab reopened.
    const p = page();
    p.enter(0, midMatch());
    const arrived = Date.now();
    await flush();
    // Straight to the cards: no title card, the score and the track as they stand.
    expect(p.state()).toMatchObject({
      phase: "dealing",
      runId: "duel:K7QM2X:1",
      streak: 1,
      stream: { pool: "endless", questions: 3, limit: 20 },
      locked: null,
    });
    expect(p.state().round?.index).toBe(2);
    expect(p.state().history.map((r) => r.correct)).toEqual([true]);
    expect(await p.awaiting()).toBe(true);
    // Only what the room says is left: the time away was not given back.
    const { clock } = p.state();
    expect(clock!.startedAt + clock!.limitMs).toBe(arrived + 14_000);
    expect(p.said()).toEqual([]);
    // And the match plays on.
    p.c.guess("lower");
    expect(p.said()).toEqual([{ v: 1, t: "answer", q: 2, pick: "lower" }]);
  });

  it("keeps a pick the room already holds: locked in, and not sent again", async () => {
    const p = page();
    p.enter(0, midMatch({ picked: "higher", locked: [0] }));
    await flush();
    expect(await p.awaiting()).toBe(true);
    expect(p.state().locked).toBe("higher");
    p.c.guess("lower");
    expect(p.said()).toEqual([]);
    expect(p.state().locked).toBe("higher");
  });

  it("counts a question whose time ran out while away as missed, by the clock itself", async () => {
    const p = page();
    p.enter(0, midMatch({ question: question(2, 1, 0) }));
    await flush();
    expect(await until(() => p.state().locked === "timeout")).toBe(true);
    expect(p.said()).toEqual([{ v: 1, t: "answer", q: 2, pick: "timeout" }]);
  });

  it("carries on in place after a dropped connection, on the same question", async () => {
    const p = await playing();
    const before = p.state();
    p.room.drop();
    expect(p.snapshot().link.kind).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(400);
    p.room.open();
    p.room.say(
      welcome(
        0,
        midMatch({ question: question(1), match: { no: 1, scores: [0, 0], results: [[], []] } }),
      ),
    );
    await flush();
    // The same question, not dealt again.
    expect(p.state().round).toEqual(before.round);
    expect(p.state().phase).toBe("awaiting");
    expect(p.state().clock).toEqual(before.clock);
    expect(p.snapshot().link.kind).toBe("connected");
  });

  it("sends a pick again when it was made while the connection was down", async () => {
    const p = await playing();
    p.room.drop();
    // Locked in on the page; the room never heard it.
    p.c.guess("higher");
    expect(p.state().locked).toBe("higher");
    expect(p.said()).toEqual([]);
    await vi.advanceTimersByTimeAsync(400);
    p.room.open();
    p.room.say(
      welcome(
        0,
        midMatch({ question: question(1), match: { no: 1, scores: [0, 0], results: [[], []] } }),
      ),
    );
    await flush();
    expect(p.said()).toEqual([{ v: 1, t: "answer", q: 1, pick: "higher" }]);
    expect(p.snapshot().view).toMatchObject({ picked: "higher" });
    // Once: a later reconnect, with the room now holding it, doesn't repeat it.
    p.room.drop();
    await vi.advanceTimersByTimeAsync(400);
    p.room.open();
    p.room.say(
      welcome(
        0,
        midMatch({
          question: question(1),
          match: { no: 1, scores: [0, 0], results: [[], []] },
          picked: "higher",
          locked: [0],
        }),
      ),
    );
    await flush();
    expect(p.said()).toHaveLength(1);
  });

  it("moves on to where the room is when the page slept through a question", async () => {
    const p = await playing();
    p.room.drop();
    await vi.advanceTimersByTimeAsync(400);
    p.room.open();
    // Question one was revealed while this page was away; the room is on question three.
    p.room.say(
      welcome(
        0,
        midMatch({
          question: question(3, 1, 20_000),
          match: {
            no: 1,
            scores: [0, 2],
            results: [
              [false, false],
              [true, true],
            ],
          },
        }),
      ),
    );
    await flush();
    expect(p.state().round?.index).toBe(3);
    expect(p.state()).toMatchObject({ phase: "dealing", streak: 0 });
    expect(p.state().history.map((r) => r.correct)).toEqual([false, false]);
    expect(await p.awaiting()).toBe(true);
  });

  it("jumps to the room's question when a reveal arrives for one the page isn't on", async () => {
    const p = await playing();
    // A reveal for question two, while the page still shows question one.
    p.say(reveal(2, [true, true], [2, 2], { next: question(3) }));
    await flush();
    expect(p.state().round?.index).toBe(3);
    expect(p.state().phase).toBe("dealing");
    expect(p.snapshot().view?.scores).toEqual([2, 2]);
  });

  it("shows full time to a player who comes back after the match has ended", async () => {
    const p = page();
    p.enter(
      1,
      lobby({
        phase: "fulltime",
        match: {
          no: 1,
          scores: [2, 1],
          results: [
            [true, true, false],
            [false, true, false],
          ],
        },
        result: {
          winner: 0,
          reason: "finished",
          scores: [2, 1],
          results: [
            [true, true, false],
            [false, true, false],
          ],
          questions: 3,
        },
        rematch: [0],
        series: { wins: [1, 0], draws: 0 },
      }),
    );
    await flush();
    // Nothing on the pitch to play: the result is the room's to show.
    expect(p.state().phase).toBe("idle");
    expect(p.snapshot().view).toMatchObject({
      phase: "fulltime",
      you: 1,
      result: { winner: 0 },
      rematch: [0],
    });
  });
});

describe("a room that goes", () => {
  it("stops the match on the page, and gives up the seat", async () => {
    const p = await playing();
    p.say({ v: 1, t: "closed", reason: "expired" });
    await flush();
    expect(p.state()).toMatchObject({ phase: "over" });
    expect(p.snapshot()).toMatchObject({ closed: "expired" });
    expect(p.seats.read("K7QM2X")).toBeNull();
    // Nothing more is sent, and nothing reconnects.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(p.sockets).toHaveLength(1);
  });

  it("keeps the seat's token when another tab of the player's took the seat", async () => {
    const p = await playing();
    p.say({ v: 1, t: "closed", reason: "replaced" });
    await flush();
    expect(p.snapshot().closed).toBe("replaced");
    expect(p.seats.read("K7QM2X")).toBe("token-0");
    expect(p.state().phase).toBe("over");
  });

  it("says why the room refused something, until the next thing goes through", () => {
    const p = page();
    p.enter();
    p.client.startMatch();
    expect(p.said().at(-1)).toEqual({ v: 1, t: "start" });
    p.say({ v: 1, t: "error", code: "not_ready" });
    expect(p.snapshot().refused).toBe("not_ready");
    // A refusal is not a goodbye.
    expect(p.snapshot().closed).toBeNull();
    expect(p.snapshot().link.kind).toBe("connected");
    p.client.ready(true);
    expect(p.snapshot().refused).toBeNull();
    expect(p.said().at(-1)).toEqual({ v: 1, t: "ready", ready: true });
  });

  it("leaves for good: the room is told, the seat cleared, the page back at the setup", async () => {
    const p = await playing();
    p.client.leave();
    expect(p.sockets[0]!.messages.at(-1)).toEqual({ v: 1, t: "leave" });
    expect(p.snapshot()).toMatchObject({ code: null, view: null, closed: null });
    expect(p.seats.read("K7QM2X")).toBeNull();
    expect(p.state().phase).toBe("over");
  });
});
