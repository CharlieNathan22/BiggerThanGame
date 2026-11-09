/**
 * The room machine (room.ts), with 1v1's rules: a pure function of the state,
 * the input and the time it carries. The questions are a fixed list of which
 * way each goes, so nothing here needs a deck.
 */

import { describe, expect, it } from "vitest";
import type { Guess, TimedGuess } from "../api.js";
import { SUDDEN_DEATH_MAX, duelDeadline } from "../duel.js";
import {
  DUEL_RULES,
  REJOIN_MS,
  ROOM_IDLE_MS,
  ROOM_QUIET_MS,
  anyoneConnected,
  createRoom,
  roomExpired,
  roomPlayers,
  roomResult,
  roomSeries,
  seatOf,
  step,
  wakeAt,
} from "../room.js";
import type { RoomDeps, RoomInput, RoomOutput, RoomState } from "../room.js";
import type { RoomSettings } from "../room-protocol.js";

const T0 = 1_800_000_000_000;
const MINUTE = 60_000;

const SETTINGS: RoomSettings = { mode: "duel", pool: "endless", questions: 3, limit: 20 };

/** A pool that deals `answers.length` questions, the same for every match. */
function pool(answers: readonly Guess[]): RoomDeps {
  return {
    rules: DUEL_RULES,
    facts: (_match, index) => {
      const answer = answers[index - 1];
      return answer === undefined ? undefined : { answer, statChanged: false };
    },
  };
}

/** Plenty of questions, all "higher": a match and its whole sudden death. */
const HIGHER = pool(Array.from({ length: 3 + SUDDEN_DEATH_MAX }, () => "higher" as const));

/** A room and a clock, driven like the Durable Object drives it. */
class Table {
  state: RoomState;
  now = T0;
  out: readonly RoomOutput[] = [];
  private matches = 0;

  constructor(
    readonly deps: RoomDeps = HIGHER,
    settings: RoomSettings = SETTINGS,
  ) {
    this.state = createRoom(
      {
        now: T0,
        key: "20270115-room",
        code: "K7QM2X",
        settings,
        host: { id: "p-host", name: "Ada" },
      },
      deps.rules,
    );
  }

  send(input: Record<string, unknown> & { type: RoomInput["type"] }): readonly RoomOutput[] {
    const result = step(this.state, { now: this.now, ...input } as RoomInput, this.deps);
    this.state = result.state;
    this.out = result.out;
    return result.out;
  }

  wait(ms: number): this {
    this.now += ms;
    return this;
  }

  tick(): readonly RoomOutput[] {
    return this.send({ type: "tick" });
  }

  /** The alarm, fired when the room asks for it. */
  alarm(): readonly RoomOutput[] {
    const at = wakeAt(this.state);
    if (at === null) throw new Error("a closed room has no alarm");
    this.now = Math.max(this.now, at);
    return this.tick();
  }

  join(name = "Sam", id = "p-guest"): readonly RoomOutput[] {
    return this.send({ type: "join", player: { id, name } });
  }

  /** Both players in, connected and ready. */
  seated(): this {
    this.join();
    this.send({ type: "connect", seat: 0 });
    this.send({ type: "connect", seat: 1 });
    this.send({ type: "ready", seat: 0, ready: true });
    this.send({ type: "ready", seat: 1, ready: true });
    return this;
  }

  start(): readonly RoomOutput[] {
    return this.send({ type: "start", seat: 0, match: `m${++this.matches}` });
  }

  playing(): this {
    this.seated().start();
    return this;
  }

  answer(seat: number, pick: TimedGuess, index = this.state.match!.index): readonly RoomOutput[] {
    return this.send({ type: "answer", seat, index, pick });
  }

  /** One question: both answer, and it is revealed. */
  both(host: TimedGuess, guest: TimedGuess): readonly RoomOutput[] {
    this.answer(0, host);
    return this.answer(1, guest);
  }

  rematch(seat: number): readonly RoomOutput[] {
    return this.send({ type: "rematch", seat, match: `m${++this.matches}` });
  }
}

function types(out: readonly RoomOutput[]): string[] {
  return out.map((o) => o.type);
}

function refusal(out: readonly RoomOutput[]): string | undefined {
  const refused = out.find((o) => o.type === "refused");
  return refused?.type === "refused" ? refused.code : undefined;
}

function revealOf(out: readonly RoomOutput[]): Extract<RoomOutput, { type: "reveal" }> {
  const found = out.find((o) => o.type === "reveal");
  if (found?.type !== "reveal") throw new Error("no reveal");
  return found;
}

describe("making and joining a room", () => {
  it("starts as a lobby with its host in seat 0, not yet connected", () => {
    const { state } = new Table();
    expect(state).toMatchObject({ phase: "lobby", code: "K7QM2X", match: null, played: 0 });
    expect(state.seats).toHaveLength(2);
    expect(state.seats[0]).toMatchObject({ name: "Ada", connected: false, ready: false });
    expect(state.seats[1]).toBeNull();
    expect(seatOf(state, "p-host")).toBe(0);
    expect(seatOf(state, "nobody")).toBeUndefined();
  });

  it("seats a guest and tells everyone", () => {
    const table = new Table();
    expect(table.join()).toEqual([{ type: "joined", seat: 1 }, { type: "players" }]);
    expect(seatOf(table.state, "p-guest")).toBe(1);
    expect(roomPlayers(table.state, table.now).map((p) => p.name)).toEqual(["Ada", "Sam"]);
  });

  it("refuses a third player: the room is full", () => {
    const table = new Table();
    table.join();
    const before = table.state;
    expect(refusal(table.join("Kit", "p-third"))).toBe("full");
    expect(table.state).toEqual(before);
  });

  it("refuses a name already in the room, whatever its case or spacing", () => {
    for (const name of ["Ada", "ada", "ADA", "  ada  "]) {
      const table = new Table();
      expect(refusal(table.join(name))).toBe("name_taken");
      expect(table.state.seats[1]).toBeNull();
    }
    // A different name is fine, however alike.
    const table = new Table();
    expect(types(table.join("Ada2"))).toContain("joined");
  });

  it("refuses a join once a match is under way", () => {
    const table = new Table().playing();
    expect(refusal(table.join("Kit", "p-third"))).toBe("full");
  });

  it("welcomes a player who connects, and tells the others", () => {
    const table = new Table();
    expect(table.send({ type: "connect", seat: 0 })).toEqual([
      { type: "welcome", seat: 0 },
      { type: "players" },
    ]);
    expect(table.state.seats[0]).toMatchObject({ connected: true, awaySince: null });
  });

  it("refuses a seat nobody holds", () => {
    const table = new Table();
    expect(refusal(table.send({ type: "connect", seat: 1 }))).toBe("bad_token");
    expect(refusal(table.send({ type: "connect", seat: 7 }))).toBe("bad_token");
  });
});

describe("ready and start", () => {
  it("starts once both are connected and ready, from the host only", () => {
    const table = new Table();
    table.join();
    table.send({ type: "connect", seat: 0 });
    table.send({ type: "connect", seat: 1 });
    expect(refusal(table.start())).toBe("not_ready");
    table.send({ type: "ready", seat: 0, ready: true });
    expect(refusal(table.start())).toBe("not_ready");
    table.send({ type: "ready", seat: 1, ready: true });
    expect(refusal(table.send({ type: "start", seat: 1, match: "mx" }))).toBe("not_host");
    expect(table.state.phase).toBe("lobby");

    const out = table.start();
    expect(types(out)).toEqual(["question", "record"]);
    expect(out[1]).toEqual({ type: "record", event: { kind: "start", match: 1, id: "m3" } });
    expect(table.state.phase).toBe("playing");
    expect(table.state.match).toMatchObject({
      no: 1,
      id: "m3",
      index: 1,
      issuedAt: table.now,
      picks: [null, null],
      scores: [0, 0],
      results: [[], []],
      result: null,
    });
    expect(table.state.match!.deadline).toBe(duelDeadline(table.now, 1, false, 20, "endless"));
  });

  it("won't start alone", () => {
    const table = new Table();
    table.send({ type: "connect", seat: 0 });
    table.send({ type: "ready", seat: 0, ready: true });
    expect(refusal(table.start())).toBe("not_ready");
  });

  it("lets a player take Ready back", () => {
    const table = new Table().seated();
    table.send({ type: "ready", seat: 1, ready: false });
    expect(refusal(table.start())).toBe("not_ready");
  });

  it("says so when the pool can't deal a question", () => {
    const table = new Table(pool([])).seated();
    const before = table.state;
    expect(refusal(table.start())).toBe("unavailable");
    expect(table.state.phase).toBe("lobby");
    expect(table.state.match).toEqual(before.match);
  });
});

describe("a question", () => {
  it("is revealed as soon as both have answered", () => {
    const table = new Table().playing();
    table.wait(4000);
    expect(table.answer(0, "higher")).toEqual([{ type: "locked", seat: 0 }]);
    expect(table.state.match).toMatchObject({ index: 1, picks: ["higher", null] });

    table.wait(1000);
    const out = table.answer(1, "lower");
    expect(types(out)).toEqual(["locked", "reveal"]);
    expect(revealOf(out)).toEqual({
      type: "reveal",
      index: 1,
      picks: ["higher", "lower"],
      correct: [true, false],
      ended: false,
    });
    // Straight on to the next question, issued at the reveal.
    expect(table.state.match).toMatchObject({
      index: 2,
      issuedAt: table.now,
      picks: [null, null],
      scores: [1, 0],
      results: [[true], [false]],
    });
    expect(table.state.match!.deadline).toBe(duelDeadline(table.now, 2, false, 20, "endless"));
  });

  it("says a player has locked in, never which way", () => {
    const table = new Table().playing();
    for (const pick of ["higher", "lower", "timeout"] as const) {
      const fresh = new Table().playing();
      const out = fresh.answer(0, pick);
      expect(out).toEqual([{ type: "locked", seat: 0 }]);
      expect(JSON.stringify(out)).not.toContain(pick);
    }
    expect(table.answer(1, "lower")).toEqual([{ type: "locked", seat: 1 }]);
  });

  it("is revealed at the deadline when only one has answered: the other got it wrong", () => {
    const table = new Table().playing();
    const { deadline } = table.state.match!;
    table.wait(3000).answer(1, "higher");
    // Not a moment before the deadline.
    table.now = deadline - 1;
    expect(table.tick()).toEqual([]);
    expect(wakeAt(table.state)).toBe(deadline);
    const out = table.alarm();
    expect(table.now).toBe(deadline);
    expect(revealOf(out)).toMatchObject({ picks: [null, "higher"], correct: [false, true] });
    expect(table.state.match).toMatchObject({ index: 2, scores: [0, 1], issuedAt: deadline });
  });

  it("is revealed at the deadline with no answers: both wrong", () => {
    const table = new Table().playing();
    const out = table.alarm();
    expect(revealOf(out)).toMatchObject({ picks: [null, null], correct: [false, false] });
    expect(table.state.match).toMatchObject({ index: 2, scores: [0, 0] });
  });

  it("counts a timeout as wrong, and as an answer: nobody waits for the deadline", () => {
    const table = new Table().playing();
    const out = table.both("timeout", "timeout");
    expect(revealOf(out)).toMatchObject({ correct: [false, false] });
    expect(table.state.match!.index).toBe(2);
  });

  it("refuses an answer that arrives after the deadline: the question is already revealed", () => {
    const table = new Table().playing();
    table.now = table.state.match!.deadline;
    const out = table.answer(0, "higher", 1);
    // The reveal happens first, from the time alone; then the late answer is out of turn.
    expect(types(out)).toEqual(["reveal", "refused"]);
    expect(revealOf(out)).toMatchObject({ picks: [null, null] });
    expect(refusal(out)).toBe("out_of_turn");
    expect(table.state.match).toMatchObject({ index: 2, scores: [0, 0], picks: [null, null] });
  });

  it("plays every question whoever is ahead, then full time", () => {
    const table = new Table().playing();
    table.both("higher", "lower");
    table.both("higher", "lower");
    const out = table.both("lower", "higher");
    expect(types(out)).toEqual(["locked", "reveal", "record"]);
    expect(revealOf(out)).toMatchObject({ index: 3, ended: true });
    expect(table.state.phase).toBe("fulltime");
    expect(roomResult(table.state)).toEqual({
      winner: 0,
      reason: "finished",
      scores: [2, 1],
      results: [
        [true, true, false],
        [false, false, true],
      ],
      questions: 3,
    });
    expect(out.at(-1)).toEqual({
      type: "record",
      event: {
        kind: "end",
        match: 1,
        id: "m1",
        reason: "finished",
        winner: 0,
        scores: [2, 1],
        suddenDeath: 0,
      },
    });
    expect(roomSeries(table.state)).toEqual({ wins: [1, 0], draws: 0 });
  });
});

describe("sudden death", () => {
  it("plays on when the scores are level after the last question", () => {
    const table = new Table().playing();
    table.both("higher", "lower");
    table.both("lower", "higher");
    const out = table.both("higher", "higher");
    expect(revealOf(out)).toMatchObject({ index: 3, ended: false });
    expect(table.state.phase).toBe("playing");
    expect(table.state.match).toMatchObject({ index: 4, scores: [2, 2] });
  });

  it("goes on while both are right, or both wrong, and ends when one is right and the other wrong", () => {
    const table = new Table().playing();
    table.both("higher", "lower");
    table.both("lower", "higher");
    table.both("higher", "higher");
    expect(revealOf(table.both("higher", "higher")).ended).toBe(false); // both right
    expect(revealOf(table.both("lower", "lower")).ended).toBe(false); // both wrong
    expect(revealOf(table.both("timeout", "lower")).ended).toBe(false); // both wrong
    const out = table.both("lower", "higher");
    expect(revealOf(out)).toMatchObject({ index: 7, ended: true, correct: [false, true] });
    // Sudden-death points count in the score.
    expect(roomResult(table.state)).toMatchObject({
      winner: 1,
      reason: "sudden-death",
      scores: [3, 4],
    });
    expect(out.at(-1)).toMatchObject({ event: { kind: "end", suddenDeath: 4 } });
  });

  it("is a draw after ten sudden-death questions with no winner", () => {
    const table = new Table().playing();
    table.both("higher", "lower");
    table.both("lower", "higher");
    table.both("higher", "higher");
    for (let i = 1; i < SUDDEN_DEATH_MAX; i++) {
      expect(revealOf(table.both("higher", "higher")).ended).toBe(false);
    }
    expect(table.state.match!.index).toBe(3 + SUDDEN_DEATH_MAX);
    const out = table.both("lower", "lower");
    expect(revealOf(out).ended).toBe(true);
    expect(roomResult(table.state)).toMatchObject({
      winner: null,
      reason: "draw",
      scores: [2 + SUDDEN_DEATH_MAX - 1, 2 + SUDDEN_DEATH_MAX - 1],
    });
    expect(roomSeries(table.state)).toEqual({ wins: [0, 0], draws: 1 });
    expect(out.at(-1)).toMatchObject({ event: { reason: "draw", winner: null, suddenDeath: 10 } });
  });

  it("is a draw when the pool has no more questions and the scores are level", () => {
    // Three questions and one more: a squad with nobody left after it.
    const short = new Table(pool(["higher", "higher", "higher", "higher"])).playing();
    short.both("higher", "lower");
    short.both("lower", "higher");
    short.both("higher", "higher");
    const out = short.both("higher", "higher");
    expect(revealOf(out)).toMatchObject({ index: 4, ended: true });
    expect(roomResult(short.state)).toMatchObject({ winner: null, reason: "exhausted" });
  });

  it("goes to the higher score when the pool runs out mid-match", () => {
    const table = new Table(pool(["higher", "higher"])).playing();
    table.both("higher", "lower");
    const out = table.both("higher", "higher");
    expect(revealOf(out)).toMatchObject({ index: 2, ended: true });
    expect(roomResult(table.state)).toMatchObject({
      winner: 0,
      reason: "exhausted",
      scores: [2, 1],
    });
  });
});

describe("dropping out of a match", () => {
  it("lets a player back within 30 seconds; what they missed is wrong", () => {
    const table = new Table().playing();
    table.wait(2000);
    expect(table.send({ type: "disconnect", seat: 1 })).toEqual([{ type: "players" }]);
    expect(roomPlayers(table.state, table.now)[1]).toMatchObject({
      connected: false,
      rejoinInMs: REJOIN_MS,
    });
    // The clock keeps running: the host answers, and the question waits for its deadline.
    table.wait(1000).answer(0, "higher");
    expect(table.state.match!.index).toBe(1);
    expect(roomPlayers(table.state, table.now)[1]!.rejoinInMs).toBe(REJOIN_MS - 1000);

    table.wait(20_000);
    const back = table.send({ type: "connect", seat: 1 });
    expect(types(back)).toEqual(["welcome", "players"]);
    expect(table.state.phase).toBe("playing");
    expect(table.state.seats[1]).toMatchObject({ connected: true, awaySince: null, left: false });
    expect(roomPlayers(table.state, table.now)[1]!.rejoinInMs).toBeUndefined();
    // Back in time for this question, still open with its original deadline.
    expect(table.state.match).toMatchObject({ index: 1, picks: ["higher", null] });
    expect(revealOf(table.answer(1, "higher"))).toMatchObject({ correct: [true, true] });
  });

  it("counts every question missed while away as wrong", () => {
    const table = new Table(HIGHER, { ...SETTINGS, limit: 10 }).playing();
    table.send({ type: "disconnect", seat: 1 });
    table.answer(0, "higher");
    // The question's deadline comes before the 30 seconds are up.
    const out = table.alarm();
    expect(revealOf(out)).toMatchObject({ picks: ["higher", null], correct: [true, false] });
    expect(table.state.phase).toBe("playing");
    table.wait(1000).send({ type: "connect", seat: 1 });
    expect(table.state.match).toMatchObject({
      index: 2,
      scores: [1, 0],
      results: [[true], [false]],
    });
  });

  it("forfeits a player away for 30 seconds: the other wins, and they are out", () => {
    // On the 30-second limit, so the forfeit comes before the question's own deadline.
    const table = new Table(HIGHER, { ...SETTINGS, limit: 30 }).playing();
    table.both("lower", "higher");
    table.wait(1000).send({ type: "disconnect", seat: 0 });
    const gone = table.now + REJOIN_MS;
    expect(wakeAt(table.state)).toBe(gone);
    table.now = gone - 1;
    expect(table.tick()).toEqual([]);

    const out = table.alarm();
    expect(types(out)).toEqual(["fulltime", "closed", "record"]);
    expect(out[1]).toEqual({ type: "closed", seat: 0, reason: "left" });
    expect(table.state.phase).toBe("fulltime");
    // The player who left was behind or ahead: the forfeit decides it either way.
    expect(roomResult(table.state)).toEqual({
      winner: 1,
      reason: "forfeit",
      scores: [0, 1],
      results: [[false], [true]],
      questions: 3,
      left: 0,
    });
    expect(roomSeries(table.state)).toEqual({ wins: [0, 1], draws: 0 });
    expect(table.state.seats[0]).toMatchObject({ left: true, connected: false });
    expect(roomPlayers(table.state, table.now)[0]).toMatchObject({ left: true });
    // Their seat is shut: the token that held it holds nothing now.
    expect(seatOf(table.state, "p-host")).toBeUndefined();
    expect(refusal(table.send({ type: "connect", seat: 0 }))).toBe("bad_token");
    expect(refusal(table.rematch(1))).toBe("opponent_left");
  });

  it("forfeits at once on Leave", () => {
    const table = new Table().playing();
    const out = table.send({ type: "leave", seat: 1 });
    expect(types(out)).toEqual(["fulltime", "closed", "record"]);
    expect(roomResult(table.state)).toMatchObject({ winner: 0, reason: "forfeit", left: 1 });
    expect(out.at(-1)).toMatchObject({ event: { kind: "end", reason: "forfeit", winner: 0 } });
  });

  it("closes the room once the last player leaves full time", () => {
    const table = new Table().playing();
    table.send({ type: "leave", seat: 1 });
    const out = table.send({ type: "leave", seat: 0 });
    expect(out).toEqual([
      { type: "closed", seat: 0, reason: "left" },
      { type: "closed", seat: "all", reason: "empty" },
    ]);
    expect(table.state).toMatchObject({ phase: "closed", closed: "empty" });
    expect(wakeAt(table.state)).toBeNull();
  });
});

describe("being away in the lobby", () => {
  it("keeps the host's seat and the room through five minutes away", () => {
    const table = new Table().seated();
    const before = table.state;
    table.wait(1000).send({ type: "disconnect", seat: 0 });
    expect(roomPlayers(table.state, table.now)[0]).toEqual({
      seat: 0,
      name: "Ada",
      ready: true,
      connected: false,
    });

    // Nothing is due in those five minutes: the guest is in the room, so only the
    // two hours with nothing done could close it, and they are far off.
    expect(wakeAt(table.state)).toBe(before.lastAction + ROOM_QUIET_MS);
    for (let minute = 1; minute <= 5; minute++) {
      table.wait(MINUTE);
      expect(table.tick()).toEqual([]);
    }
    expect(table.state.phase).toBe("lobby");
    expect(table.state.seats.map((s) => s?.name)).toEqual(["Ada", "Sam"]);

    const back = table.send({ type: "connect", seat: 0 });
    expect(types(back)).toEqual(["welcome", "players"]);
    expect(table.state).toMatchObject({
      phase: "lobby",
      key: before.key,
      code: before.code,
      settings: before.settings,
    });
    expect(table.state.seats[0]).toMatchObject({ id: "p-host", connected: true, ready: true });
    expect(table.state.seats[1]).toMatchObject({ id: "p-guest", connected: true, ready: true });
    expect(types(table.start())).toContain("question");
  });

  it("won't start while the guest is away, however ready they were", () => {
    const table = new Table().seated();
    table.send({ type: "disconnect", seat: 1 });
    expect(table.state.seats[1]).toMatchObject({ ready: true, connected: false });
    expect(refusal(table.start())).toBe("not_ready");
    table.wait(2 * MINUTE);
    expect(refusal(table.start())).toBe("not_ready");
    expect(table.state.phase).toBe("lobby");

    table.send({ type: "connect", seat: 1 });
    expect(types(table.start())).toEqual(["question", "record"]);
  });

  it("never runs the forfeit clock in the lobby or at full time", () => {
    const lobby = new Table().seated();
    lobby.send({ type: "disconnect", seat: 1 });
    expect(roomPlayers(lobby.state, lobby.now)[1]!.rejoinInMs).toBeUndefined();
    lobby.wait(REJOIN_MS * 4);
    expect(lobby.tick()).toEqual([]);
    expect(lobby.state.seats[1]).toMatchObject({ left: false, name: "Sam" });

    const over = new Table().playing();
    over.both("higher", "lower");
    over.both("higher", "lower");
    over.both("higher", "lower");
    over.send({ type: "disconnect", seat: 0 });
    over.wait(REJOIN_MS * 4);
    expect(over.tick()).toEqual([]);
    expect(over.state.phase).toBe("fulltime");
    expect(over.state.seats[0]).toMatchObject({ left: false });
    expect(types(over.send({ type: "connect", seat: 0 }))).toEqual(["welcome", "players"]);
  });

  it("closes the room when the host leaves, and tells the guest", () => {
    const table = new Table().seated();
    expect(table.send({ type: "leave", seat: 0 })).toEqual([
      { type: "closed", seat: 0, reason: "left" },
      { type: "closed", seat: "all", reason: "host-left" },
    ]);
    expect(table.state).toMatchObject({ phase: "closed", closed: "host-left" });
  });

  it("frees the seat when the guest leaves: the invite still works", () => {
    const table = new Table().seated();
    expect(table.send({ type: "leave", seat: 1 })).toEqual([
      { type: "closed", seat: 1, reason: "left" },
      { type: "players" },
    ]);
    expect(table.state.phase).toBe("lobby");
    expect(table.state.seats[1]).toBeNull();
    expect(seatOf(table.state, "p-guest")).toBeUndefined();
    expect(table.join("Kit", "p-new")).toEqual([{ type: "joined", seat: 1 }, { type: "players" }]);
  });
});

describe("a rematch", () => {
  function finished(): Table {
    const table = new Table().playing();
    table.both("higher", "lower");
    table.both("higher", "lower");
    table.both("higher", "lower");
    return table;
  }

  it("starts when both have asked, in the same room, on the same settings, under a new match id", () => {
    const table = finished();
    const settings = table.state.settings;
    expect(table.rematch(1)).toEqual([{ type: "rematch" }]);
    expect(table.state).toMatchObject({ phase: "fulltime", rematch: [1] });
    // Asking twice is still one ask.
    expect(table.rematch(1)).toEqual([{ type: "rematch" }]);
    expect(table.state.rematch).toEqual([1]);

    table.wait(3000);
    const out = table.rematch(0);
    expect(types(out)).toEqual(["question", "record"]);
    expect(out[1]).toEqual({ type: "record", event: { kind: "start", match: 2, id: "m4" } });
    expect(table.state).toMatchObject({ phase: "playing", settings, rematch: [] });
    expect(table.state.match).toMatchObject({
      no: 2,
      id: "m4",
      index: 1,
      scores: [0, 0],
      results: [[], []],
      result: null,
    });
  });

  it("keeps a running series score across matches", () => {
    const table = finished();
    expect(roomSeries(table.state)).toEqual({ wins: [1, 0], draws: 0 });
    table.rematch(0);
    table.rematch(1);
    table.both("lower", "higher");
    table.both("lower", "higher");
    table.both("lower", "higher");
    expect(roomSeries(table.state)).toEqual({ wins: [1, 1], draws: 0 });
    table.rematch(1);
    table.rematch(0);
    table.both("higher", "lower");
    table.both("higher", "lower");
    table.both("higher", "lower");
    expect(roomSeries(table.state)).toEqual({ wins: [2, 1], draws: 0 });
    expect(table.state.played).toBe(3);
    expect(table.state.match!.no).toBe(3);
  });

  it("gives a player who had dropped 30 seconds from the rematch's start", () => {
    const table = finished();
    table.rematch(1);
    table.send({ type: "disconnect", seat: 1 });
    table.wait(5 * MINUTE);
    table.rematch(0);
    expect(table.state.phase).toBe("playing");
    expect(table.state.seats[1]!.awaySince).toBe(table.now);
    expect(roomPlayers(table.state, table.now)[1]!.rejoinInMs).toBe(REJOIN_MS);
  });

  it("drops the asks when a player leaves at full time", () => {
    const table = finished();
    table.rematch(0);
    const out = table.send({ type: "leave", seat: 1 });
    expect(types(out)).toEqual(["closed", "players", "rematch"]);
    expect(table.state.rematch).toEqual([]);
    expect(refusal(table.rematch(0))).toBe("opponent_left");
  });
});

describe("expiry", () => {
  const HOUR = 60 * MINUTE;

  /** Both players go, a second apart: nobody is connected from `table.now` on. */
  function emptied(table: Table): Table {
    table.send({ type: "disconnect", seat: 1 });
    table.wait(1000).send({ type: "disconnect", seat: 0 });
    return table;
  }

  it("keeps a lobby open while anyone is connected, well past the fifteen minutes", () => {
    const table = new Table().seated();
    expect(anyoneConnected(table.state)).toBe(true);
    // The only thing due is the two hours with nothing done.
    expect(wakeAt(table.state)).toBe(T0 + ROOM_QUIET_MS);
    table.wait(HOUR + 59 * MINUTE);
    expect(roomExpired(table.state, table.now)).toBe(false);
    expect(table.tick()).toEqual([]);
    expect(table.state.phase).toBe("lobby");
    expect(types(table.start())).toContain("question");
  });

  it("keeps the room for a host waiting alone for their friend", () => {
    const table = new Table();
    table.send({ type: "connect", seat: 0 });
    expect(wakeAt(table.state)).toBe(T0 + ROOM_QUIET_MS);
    table.wait(45 * MINUTE);
    expect(table.tick()).toEqual([]);
    expect(table.state.phase).toBe("lobby");
    // The friend can still join, and nothing has run out meanwhile.
    expect(types(table.join())).toEqual(["joined", "players"]);
  });

  it("keeps it for a guest in the lobby while the host is away", () => {
    const table = new Table().seated();
    table.send({ type: "disconnect", seat: 0 });
    table.wait(40 * MINUTE);
    expect(table.tick()).toEqual([]);
    expect(table.state.phase).toBe("lobby");
    expect(types(table.send({ type: "connect", seat: 0 }))).toEqual(["welcome", "players"]);
  });

  it("closes a lobby 15 minutes after the last player went", () => {
    const table = new Table().seated();
    // A long wait first: none of it counts, because they were there.
    table.wait(HOUR);
    emptied(table);
    const went = table.now;
    expect(anyoneConnected(table.state)).toBe(false);
    expect(wakeAt(table.state)).toBe(went + ROOM_IDLE_MS);
    table.now = went + ROOM_IDLE_MS - 1;
    expect(roomExpired(table.state, table.now)).toBe(false);
    expect(table.tick()).toEqual([]);
    // What a caller reads before the alarm is what the alarm then does.
    expect(roomExpired(table.state, went + ROOM_IDLE_MS)).toBe(true);
    expect(table.alarm()).toEqual([{ type: "closed", seat: "all", reason: "expired" }]);
    expect(table.state).toMatchObject({ phase: "closed", closed: "expired" });
    expect(roomExpired(table.state, table.now)).toBe(false);
    expect(wakeAt(table.state)).toBeNull();
  });

  it("stops that count when someone comes back, and starts it afresh when they go", () => {
    const table = emptied(new Table().seated());
    table.wait(14 * MINUTE).send({ type: "connect", seat: 1 });
    expect(wakeAt(table.state)).toBe(T0 + ROOM_QUIET_MS);
    table.wait(30 * MINUTE);
    expect(table.tick()).toEqual([]);
    table.send({ type: "disconnect", seat: 1 });
    expect(wakeAt(table.state)).toBe(table.now + ROOM_IDLE_MS);
    table.wait(14 * MINUTE);
    expect(table.tick()).toEqual([]);
    table.wait(MINUTE);
    expect(types(table.tick())).toEqual(["closed"]);
  });

  it("closes a room nobody ever connected to, 15 minutes after the last thing done", () => {
    // Made, and the page never got as far as its socket.
    const table = new Table();
    expect(wakeAt(table.state)).toBe(T0 + ROOM_IDLE_MS);
    // A friend joining is something done: the count starts again from there.
    table.wait(10 * MINUTE).join();
    expect(wakeAt(table.state)).toBe(table.now + ROOM_IDLE_MS);
    table.wait(10 * MINUTE);
    expect(table.tick()).toEqual([]);
    table.wait(5 * MINUTE);
    expect(types(table.tick())).toEqual(["closed"]);
  });

  it("keeps a room at full time while its players are there, then closes it 15 minutes after", () => {
    const table = new Table().playing();
    table.both("higher", "lower");
    table.both("higher", "lower");
    table.both("higher", "lower");
    expect(table.state.phase).toBe("fulltime");
    expect(wakeAt(table.state)).toBe(T0 + ROOM_QUIET_MS);
    table.wait(HOUR);
    expect(table.tick()).toEqual([]);
    expect(types(table.rematch(0))).toContain("rematch");
    emptied(table);
    expect(wakeAt(table.state)).toBe(table.now + ROOM_IDLE_MS);
    expect(table.alarm()).toEqual([{ type: "closed", seat: "all", reason: "expired" }]);
  });

  it("doesn't count a player who left as being there", () => {
    const table = new Table().playing();
    // The guest leaves mid-match (a forfeit); the host then goes without a word.
    table.send({ type: "leave", seat: 1 });
    expect(table.state.phase).toBe("fulltime");
    table.send({ type: "disconnect", seat: 0 });
    expect(anyoneConnected(table.state)).toBe(false);
    expect(wakeAt(table.state)).toBe(table.now + ROOM_IDLE_MS);
  });

  it("never expires mid-match: the clocks carry it to full time first", () => {
    const table = new Table().playing();
    // Nobody answers anything: every question runs to its deadline.
    while (table.state.phase === "playing") table.alarm();
    expect(table.state.phase).toBe("fulltime");
    expect(roomResult(table.state)).toMatchObject({ winner: null, reason: "draw", scores: [0, 0] });
    expect(table.state.match!.index).toBe(3 + SUDDEN_DEATH_MAX);
  });

  it("refuses everything once closed", () => {
    const table = emptied(new Table().seated());
    table.alarm();
    const closed = table.state;
    expect(closed.phase).toBe("closed");
    for (const input of [
      { type: "connect", seat: 0 },
      { type: "ready", seat: 0, ready: true },
      { type: "start", seat: 0, match: "m" },
      { type: "join", player: { id: "x", name: "Kit" } },
    ] as const) {
      expect(refusal(table.send(input))).toBe("out_of_turn");
      expect(table.state).toBe(closed);
    }
    expect(table.tick()).toEqual([]);
  });

  it("refuses a player who comes back to an expired room", () => {
    const table = emptied(new Table().seated());
    table.wait(ROOM_IDLE_MS);
    // Their return is what finds it expired: it closes, and nothing else happens.
    expect(table.send({ type: "connect", seat: 1 })).toEqual([
      { type: "closed", seat: "all", reason: "expired" },
    ]);
  });
});

describe("two hours with nothing done", () => {
  const HOUR = 60 * MINUTE;
  const EXPIRED = [{ type: "closed", seat: "all", reason: "expired" }];

  it("takes the room from a host who has sat connected in the lobby for two hours", () => {
    const table = new Table();
    table.send({ type: "connect", seat: 0 });
    expect(anyoneConnected(table.state)).toBe(true);
    expect(wakeAt(table.state)).toBe(T0 + ROOM_QUIET_MS);
    table.now = T0 + ROOM_QUIET_MS - 1;
    expect(roomExpired(table.state, table.now)).toBe(false);
    expect(table.tick()).toEqual([]);
    expect(table.state.phase).toBe("lobby");
    // Two hours since the room was made, the host connected throughout: it closes on them.
    expect(roomExpired(table.state, T0 + ROOM_QUIET_MS)).toBe(true);
    expect(table.alarm()).toEqual(EXPIRED);
    expect(table.now).toBe(T0 + ROOM_QUIET_MS);
    expect(table.state).toMatchObject({ phase: "closed", closed: "expired" });
    expect(wakeAt(table.state)).toBeNull();
  });

  it("takes it from two players sitting ready, and from two sitting at full time", () => {
    const lobby = new Table().seated();
    lobby.wait(ROOM_QUIET_MS);
    expect(lobby.tick()).toEqual(EXPIRED);

    const over = new Table().playing();
    over.wait(MINUTE);
    over.both("higher", "lower");
    over.both("higher", "lower");
    over.both("higher", "lower");
    expect(over.state.phase).toBe("fulltime");
    // From the last answer, not from full time or from anything since.
    const last = over.now;
    over.wait(ROOM_QUIET_MS - 1);
    expect(over.tick()).toEqual([]);
    expect(over.alarm()).toEqual(EXPIRED);
    expect(over.now).toBe(last + ROOM_QUIET_MS);
  });

  it("starts the two hours again on anything a player does", () => {
    const table = new Table();
    table.send({ type: "connect", seat: 0 });
    const due = () => wakeAt(table.state);
    const late = 90 * MINUTE;

    // Made at T0. Each thing done comes an hour and a half after the last: none would
    // have been in time had the one before it not counted.
    table.wait(late).join();
    expect(due()).toBe(table.now + ROOM_QUIET_MS);
    table.send({ type: "connect", seat: 1 });

    table.wait(late).send({ type: "ready", seat: 0, ready: true });
    expect(due()).toBe(table.now + ROOM_QUIET_MS);
    table.wait(late).send({ type: "ready", seat: 1, ready: true });
    expect(due()).toBe(table.now + ROOM_QUIET_MS);

    table.wait(late);
    expect(types(table.start())).toContain("question");
    expect(table.state.lastAction).toBe(table.now);

    table.wait(1000).both("higher", "lower");
    table.wait(1000).both("higher", "lower");
    table.wait(1000).both("higher", "lower");
    expect(table.state.phase).toBe("fulltime");
    expect(due()).toBe(table.now + ROOM_QUIET_MS);

    table.wait(late);
    expect(types(table.rematch(0))).toEqual(["rematch"]);
    expect(table.state.phase).toBe("fulltime");
    expect(due()).toBe(table.now + ROOM_QUIET_MS);

    // And then nothing: two hours from that last press it closes.
    const pressed = table.now;
    table.wait(ROOM_QUIET_MS - 1);
    expect(table.tick()).toEqual([]);
    expect(table.alarm()).toEqual(EXPIRED);
    expect(table.now).toBe(pressed + ROOM_QUIET_MS);
  });

  it("doesn't take a connection coming or going for something done", () => {
    const table = new Table().seated();
    table.wait(HOUR).send({ type: "disconnect", seat: 1 });
    table.wait(MINUTE).send({ type: "connect", seat: 1 });
    table.wait(30 * MINUTE).send({ type: "disconnect", seat: 0 });
    table.wait(MINUTE).send({ type: "connect", seat: 0 });
    expect(table.state.lastAction).toBe(T0);
    expect(wakeAt(table.state)).toBe(T0 + ROOM_QUIET_MS);
    // Nor a refusal: the guest can't start the match.
    expect(refusal(table.send({ type: "start", seat: 1, match: "m" }))).toBe("not_host");
    expect(table.state.lastAction).toBe(T0);
    table.now = T0 + ROOM_QUIET_MS;
    expect(table.tick()).toEqual(EXPIRED);
  });

  it("doesn't take a clock running out for something done", () => {
    const table = new Table().playing();
    // The pages answer `timeout` by themselves, question after question, to a draw.
    while (table.state.phase === "playing") table.wait(20_000).both("timeout", "timeout");
    expect(table.state.phase).toBe("fulltime");
    expect(table.now).toBeGreaterThan(T0);
    // The last thing anyone did was start the match.
    expect(table.state.lastAction).toBe(T0);
    expect(wakeAt(table.state)).toBe(T0 + ROOM_QUIET_MS);
  });

  it("leaves a match alone: only a lobby or a room at full time can run out", () => {
    const table = new Table().playing();
    table.now = T0 + ROOM_QUIET_MS + HOUR;
    expect(roomExpired(table.state, table.now)).toBe(false);
    // The tick settles the question whose deadline passed, and the match goes on.
    expect(types(table.tick())).toContain("reveal");
    expect(table.state.phase).toBe("playing");
  });

  it("closes an empty room at whichever comes first", () => {
    // Fifteen minutes after the last player went, when that is sooner...
    const soon = new Table().seated();
    soon.wait(HOUR).send({ type: "disconnect", seat: 1 });
    soon.send({ type: "disconnect", seat: 0 });
    expect(wakeAt(soon.state)).toBe(soon.now + ROOM_IDLE_MS);
    // ...and the two hours, when they are: the players went five minutes before them.
    const late = new Table().seated();
    late.wait(ROOM_QUIET_MS - 5 * MINUTE).send({ type: "disconnect", seat: 1 });
    late.send({ type: "disconnect", seat: 0 });
    expect(wakeAt(late.state)).toBe(T0 + ROOM_QUIET_MS);
    expect(late.alarm()).toEqual(EXPIRED);
  });
});

describe("out of turn", () => {
  /** `input` is refused with `code`, and the room is exactly as it was. */
  function refused(
    table: Table,
    input: Record<string, unknown> & { type: RoomInput["type"] },
    code: string,
  ): void {
    const before = table.state;
    const out = table.send(input);
    expect(out).toEqual([{ type: "refused", seat: input["seat"] ?? null, code }]);
    expect(table.state).toEqual(before);
  }

  it("in the lobby: no answers, no rematch", () => {
    const table = new Table().seated();
    refused(table, { type: "answer", seat: 0, index: 1, pick: "higher" }, "out_of_turn");
    refused(table, { type: "rematch", seat: 0, match: "m" }, "out_of_turn");
    refused(table, { type: "start", seat: 1, match: "m" }, "not_host");
  });

  it("in a match: no second answer, no other question, no ready, start or rematch", () => {
    const table = new Table().playing();
    table.answer(0, "higher");
    refused(table, { type: "answer", seat: 0, index: 1, pick: "lower" }, "out_of_turn");
    refused(table, { type: "answer", seat: 0, index: 1, pick: "higher" }, "out_of_turn");
    refused(table, { type: "answer", seat: 1, index: 2, pick: "higher" }, "out_of_turn");
    refused(table, { type: "answer", seat: 1, index: 0, pick: "higher" }, "out_of_turn");
    refused(table, { type: "ready", seat: 1, ready: true }, "out_of_turn");
    refused(table, { type: "start", seat: 0, match: "m" }, "out_of_turn");
    refused(table, { type: "rematch", seat: 1, match: "m" }, "out_of_turn");
    refused(table, { type: "join", player: { id: "x", name: "Kit" } }, "full");
    // The first answer stands.
    expect(table.state.match!.picks).toEqual(["higher", null]);
  });

  it("after a reveal: no answer to the question just revealed", () => {
    const table = new Table().playing();
    table.both("higher", "lower");
    refused(table, { type: "answer", seat: 1, index: 1, pick: "higher" }, "out_of_turn");
    expect(table.state.match).toMatchObject({ index: 2, scores: [1, 0] });
  });

  it("at full time: no answers, no start, no ready", () => {
    const table = new Table().playing();
    table.both("higher", "lower");
    table.both("higher", "lower");
    table.both("higher", "lower");
    refused(table, { type: "answer", seat: 0, index: 3, pick: "higher" }, "out_of_turn");
    refused(table, { type: "answer", seat: 0, index: 4, pick: "higher" }, "out_of_turn");
    refused(table, { type: "start", seat: 0, match: "m" }, "out_of_turn");
    refused(table, { type: "ready", seat: 0, ready: true }, "out_of_turn");
  });

  it("from a seat nobody holds", () => {
    const table = new Table();
    refused(table, { type: "ready", seat: 1, ready: true }, "bad_token");
    refused(table, { type: "leave", seat: 1 }, "bad_token");
    refused(table, { type: "answer", seat: 5, index: 1, pick: "higher" }, "bad_token");
  });
});

describe("purity", () => {
  it("never changes the state it was given, and gives the same step for the same input", () => {
    const table = new Table().playing();
    const state = table.state;
    const frozen = JSON.stringify(state);
    const input: RoomInput = {
      type: "answer",
      now: table.now + 500,
      seat: 0,
      index: 1,
      pick: "higher",
    };
    const first = step(state, input, HIGHER);
    const second = step(state, input, HIGHER);
    expect(JSON.stringify(state)).toBe(frozen);
    expect(second).toEqual(first);
    expect(first.state).not.toBe(state);
  });

  it("keeps its state JSON all the way down", () => {
    const table = new Table().playing();
    table.both("higher", "lower");
    table.send({ type: "disconnect", seat: 1 });
    expect(JSON.parse(JSON.stringify(table.state))).toEqual(table.state);
  });

  it("is built for more than two: the seats come from the rules", () => {
    const rules = { ...DUEL_RULES, minPlayers: 2, maxPlayers: 10 };
    const state = createRoom(
      {
        now: T0,
        key: "20270115-lms",
        code: "K7QM2X",
        settings: SETTINGS,
        host: { id: "p0", name: "P0" },
      },
      rules,
    );
    expect(state.seats).toHaveLength(10);
    expect(state.wins).toHaveLength(10);
    let room = state;
    for (let i = 1; i < 10; i++) {
      const joined = step(
        room,
        { type: "join", now: T0, player: { id: `p${i}`, name: `P${i}` } },
        { rules, facts: HIGHER.facts },
      );
      expect(joined.out[0]).toEqual({ type: "joined", seat: i });
      room = joined.state;
    }
    const eleventh = step(
      room,
      { type: "join", now: T0, player: { id: "p10", name: "P10" } },
      { rules, facts: HIGHER.facts },
    );
    expect(refusal(eleventh.out)).toBe("full");
  });
});
