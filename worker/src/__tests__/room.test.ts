/**
 * 1v1's rooms in Node: the three HTTP handlers (room.ts), the seat token
 * (token.ts), and whole matches through the host (room-host.ts) with a memory
 * room where the Durable Object would be. The machine's own rules are tested
 * in @bt/core (room.test.ts); the real object and real sockets under workerd.
 */

import { describe, expect, it } from "vitest";
import {
  REJOIN_MS,
  ROOM_CODE_ALPHABET,
  ROOM_IDLE_MS,
  ROOM_QUIET_MS,
  SUDDEN_DEATH_MAX,
  isRoomCode,
} from "@bt/core";
import type { RoomPeekResponse, RoomSeatResponse, RoomServerMessage } from "@bt/core";
import { handleRoomCreate, handleRoomJoin, handleRoomPeek } from "../room.js";
import type { RoomResult } from "../room.js";
import { roomDataPoint, roomLogLine } from "../room-analytics.js";
import { mintKey } from "../room-host.js";
import {
  signRoomToken,
  signStreamToken,
  signToken,
  verifyRoomToken,
  verifyStreamToken,
  verifyToken,
} from "../token.js";
import { SAMPLE_DECK, SECRET, THEMED_DECK, TODAY, uuidFrom } from "./helpers.js";
import {
  createBody,
  joinBody,
  matchDay,
  openRoom,
  playMatch,
  rightPick,
  roomHarness,
  startMatch,
} from "./room-helpers.js";
import type { Way } from "./room-helpers.js";

function ok(result: RoomResult): RoomSeatResponse {
  expect(result.status).toBe(200);
  return result.body as RoomSeatResponse;
}

function detail(result: RoomResult): string | undefined {
  return "detail" in result.body ? result.body.detail : undefined;
}

/** The token's payload, read as the client could: signed, not encrypted. */
function read(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
}

describe("making a room", () => {
  it("answers with a code, the host's token and the settings", async () => {
    const h = roomHarness();
    h.codes.push("K7QM2X");
    const made = ok(await handleRoomCreate(createBody("endless", 20, 30, "  Ada  "), h.ctx));
    expect(made).toEqual({
      code: "K7QM2X",
      token: expect.any(String) as string,
      settings: { mode: "duel", pool: "endless", questions: 20, limit: 30 },
      name: "Ada",
    });
    expect(Object.keys(made).sort()).toEqual(["code", "name", "settings", "token"]);
    // The token names the room's own key and the host's seat: never the code.
    const payload = read(made.token);
    expect(Object.keys(payload).sort()).toEqual(["player", "room", "seat", "v"]);
    expect(payload).toMatchObject({ v: 1, seat: 0 });
    expect(payload["room"]).toMatch(/^20260919-/);
    expect(JSON.stringify(payload)).not.toContain("K7QM2X");
    expect(h.table("K7QM2X").host.state).toMatchObject({
      phase: "lobby",
      code: "K7QM2X",
      key: payload["room"],
    });
  });

  it("gives every room a code from the alphabet", async () => {
    const h = roomHarness({ randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)) });
    const codes = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const { code } = ok(await handleRoomCreate(createBody(), h.ctx));
      expect(isRoomCode(code)).toBe(true);
      for (const char of code) expect(ROOM_CODE_ALPHABET).toContain(char);
      codes.add(code);
    }
    expect(codes.size).toBe(40);
  });

  it("caps a squad's length as Twitch Mode does", async () => {
    const h = roomHarness({ deck: THEMED_DECK });
    // Kestrel Rovers: 15 players, so 14 questions.
    const made = ok(await handleRoomCreate(createBody("squad:club-kestrel-rovers", 20), h.ctx));
    expect(made.settings.questions).toBe(14);
    const short = ok(await handleRoomCreate(createBody("squad:club-kestrel-rovers", 10), h.ctx));
    expect(short.settings.questions).toBe(10);
  });

  it("takes only the three limits, the two lengths and a pool", async () => {
    const h = roomHarness();
    for (const limit of [10, 20, 30]) {
      expect((await handleRoomCreate(createBody("endless", 10, limit as 10), h.ctx)).status).toBe(
        200,
      );
    }
    // Twitch Mode's minute is not a 1v1 limit.
    for (const limit of [60, 15, 0, 5, 45, "20", null]) {
      const res = await handleRoomCreate({ ...createBody(), limit }, h.ctx);
      expect(res.status).toBe(400);
      expect(detail(res)).toBe("limit must be 10, 20 or 30");
    }
    for (const questions of [15, 0, 30, "10"]) {
      expect((await handleRoomCreate({ ...createBody(), questions }, h.ctx)).status).toBe(400);
    }
    for (const pool of ["ranked", "friendly", "daily", "", 7, "squad:"]) {
      expect((await handleRoomCreate({ ...createBody(), pool }, h.ctx)).status).toBe(400);
    }
  });

  it("refuses a body with a missing or extra key, or that isn't an object", async () => {
    const h = roomHarness();
    const missing = createBody();
    delete missing["turnstileToken"];
    for (const body of [
      missing,
      { ...createBody(), mode: "duel" },
      { ...createBody(), seat: 0 },
      { ...createBody(), code: "K7QM2X" },
      { ...createBody(), turnstileToken: "" },
      { ...createBody(), turnstileToken: "x".repeat(2049) },
      { ...createBody(), name: 7 },
      { ...createBody(), name: "x".repeat(65) },
      [],
      null,
      "room",
    ]) {
      expect((await handleRoomCreate(body, h.ctx)).status).toBe(400);
    }
    expect(h.tables.size).toBe(0);
  });

  it("refuses a squad the deck doesn't have, before Turnstile is asked", async () => {
    let asked = 0;
    const h = roomHarness({
      verifyTurnstile: async () => {
        asked += 1;
        return "pass";
      },
    });
    const res = await handleRoomCreate(createBody("squad:club-nowhere"), h.ctx);
    expect(res.status).toBe(400);
    expect(detail(res)).toBe("pool names no theme in this deck");
    expect(asked).toBe(0);
  });

  it("holds the name to the leaderboards' rules", async () => {
    const h = roomHarness({ moderate: (name) => name !== "Blocked" });
    for (const [name, problem] of [
      ["ab", "nickname_short"],
      ["x".repeat(21), "nickname_long"],
      ["no!way", "nickname_characters"],
    ] as const) {
      const res = await handleRoomCreate(createBody("endless", 10, 20, name), h.ctx);
      expect(res.status).toBe(400);
      expect(detail(res)).toBe(problem);
    }
    // Another script, and a blocked name: the same calm refusal.
    for (const name of ["Игрок", "Blocked"]) {
      const res = await handleRoomCreate(createBody("endless", 10, 20, name), h.ctx);
      expect(res).toEqual({ status: 422, body: { error: "nickname_rejected" } });
    }
    expect(h.tables.size).toBe(0);
  });

  it("uses the real blocklist by default", async () => {
    const h = roomHarness();
    // The harness's blocklist lets everything through; without it, the real one applies.
    type Ctx = typeof h.ctx;
    const ctx: { -readonly [K in keyof Ctx]?: Ctx[K] } = { ...h.ctx };
    delete ctx.moderate;
    const res = await handleRoomCreate(createBody("endless", 10, 20, "admin"), ctx as Ctx);
    expect(res.status).toBe(422);
  });

  it("makes no room when Turnstile says no, or can't be asked", async () => {
    const h = roomHarness();
    h.turnstile = "fail";
    expect(await handleRoomCreate(createBody(), h.ctx)).toEqual({
      status: 403,
      body: { error: "verification_failed" },
    });
    h.turnstile = "error";
    expect(await handleRoomCreate(createBody(), h.ctx)).toEqual({
      status: 502,
      body: { error: "unavailable", detail: "turnstile" },
    });
    expect(h.tables.size).toBe(0);
    expect(h.events).toEqual([]);
  });

  it("counts a run start per IP before any other work", async () => {
    let asked = 0;
    const h = roomHarness({
      limits: { start: async () => ({ ok: false, retryAfter: 60 }) },
      verifyTurnstile: async () => {
        asked += 1;
        return "pass";
      },
    });
    // Even a malformed body is counted and turned away first.
    for (const body of [createBody(), { nonsense: true }]) {
      expect(await handleRoomCreate(body, h.ctx)).toEqual({
        status: 429,
        body: { error: "rate_limited" },
        retryAfter: 60,
        limit: "starts",
      });
    }
    expect(asked).toBe(0);
    expect(h.tables.size).toBe(0);
  });

  it("tries another code when one is taken", async () => {
    const h = roomHarness();
    h.codes.push("K7QM2X");
    const first = ok(await handleRoomCreate(createBody(), h.ctx));
    h.codes.push("K7QM2X", "K7QM2X", "B3DF9G");
    const second = ok(await handleRoomCreate(createBody("endless", 10, 20, "Kit"), h.ctx));
    expect(first.code).toBe("K7QM2X");
    expect(second.code).toBe("B3DF9G");
    // The first room is untouched: still the first host's.
    expect(h.table("K7QM2X").host.state?.seats[0]?.name).toBe("Ada");
    expect(read(first.token)["room"]).not.toBe(read(second.token)["room"]);
  });

  it("gives up calmly when every code it tries is taken", async () => {
    const h = roomHarness();
    h.codes.push("K7QM2X");
    ok(await handleRoomCreate(createBody(), h.ctx));
    h.codes.push("K7QM2X", "K7QM2X", "K7QM2X", "K7QM2X", "K7QM2X");
    expect(await handleRoomCreate(createBody(), h.ctx)).toEqual({
      status: 503,
      body: { error: "unavailable", detail: "codes" },
    });
  });

  it("skips random bytes that make no code", async () => {
    const h = roomHarness({ randomBytes: () => new Uint8Array([255, 254, 253]) });
    expect((await handleRoomCreate(createBody(), h.ctx)).status).toBe(503);
  });
});

describe("joining a room", () => {
  async function lobby(): Promise<{ h: ReturnType<typeof roomHarness>; code: string }> {
    const h = roomHarness();
    const { code } = ok(await handleRoomCreate(createBody(), h.ctx));
    return { h, code };
  }

  it("takes the free seat, with a token of its own", async () => {
    const { h, code } = await lobby();
    const joined = ok(await handleRoomJoin(joinBody(code, " Sam "), h.ctx));
    expect(joined).toMatchObject({
      code,
      name: "Sam",
      settings: { mode: "duel", pool: "endless", questions: 10, limit: 20 },
    });
    const state = h.table(code).host.state!;
    expect(read(joined.token)).toMatchObject({ v: 1, seat: 1, room: state.key });
    expect(state.seats.map((s) => s?.name)).toEqual(["Ada", "Sam"]);
  });

  it("says a third player the room is full", async () => {
    const { h, code } = await lobby();
    ok(await handleRoomJoin(joinBody(code), h.ctx));
    expect(await handleRoomJoin(joinBody(code, "Kit"), h.ctx)).toEqual({
      status: 409,
      body: { error: "conflict", detail: "full" },
    });
    expect(h.table(code).host.state!.seats.map((s) => s?.name)).toEqual(["Ada", "Sam"]);
  });

  it("refuses the host's name, whatever its case", async () => {
    const { h, code } = await lobby();
    for (const name of ["Ada", "ada", "ADA"]) {
      expect(await handleRoomJoin(joinBody(code, name), h.ctx)).toEqual({
        status: 409,
        body: { error: "conflict", detail: "name_taken" },
      });
    }
    expect(h.table(code).host.state!.seats[1]).toBeNull();
    // Another name, and the seat is theirs.
    expect((await handleRoomJoin(joinBody(code, "Adah"), h.ctx)).status).toBe(200);
  });

  it("says a room that isn't there has closed", async () => {
    const h = roomHarness();
    expect(await handleRoomJoin(joinBody("ZZZZZZ"), h.ctx)).toEqual({
      status: 409,
      body: { error: "conflict", detail: "closed" },
    });
  });

  it("refuses a join once the match has started", async () => {
    const h = roomHarness();
    const room = await openRoom(h);
    await startMatch(room);
    expect(detail(await handleRoomJoin(joinBody(room.code, "Kit"), h.ctx))).toBe("full");
  });

  it("holds the code, the name and the body to their shapes", async () => {
    const { h, code } = await lobby();
    for (const body of [
      joinBody(code.toLowerCase()),
      joinBody("K7QM2"),
      joinBody("K7QM2O"),
      { ...joinBody(code), seat: 0 },
      { code, name: "Sam" },
      { ...joinBody(code), name: 5 },
      { ...joinBody(code), turnstileToken: "" },
      null,
    ]) {
      expect((await handleRoomJoin(body, h.ctx)).status).toBe(400);
    }
    for (const name of ["ab", "no!way"]) {
      expect((await handleRoomJoin(joinBody(code, name), h.ctx)).status).toBe(400);
    }
    expect(h.table(code).host.state!.seats[1]).toBeNull();
  });

  it("asks Turnstile before the room is touched, so a code can't be tried for free", async () => {
    const { h, code } = await lobby();
    h.turnstile = "fail";
    expect((await handleRoomJoin(joinBody(code), h.ctx)).status).toBe(403);
    // A wrong code gets the same answer as a right one: nothing is learned without a pass.
    expect((await handleRoomJoin(joinBody("ZZZZZZ"), h.ctx)).status).toBe(403);
    expect(h.table(code).host.state!.seats[1]).toBeNull();
    h.turnstile = "error";
    expect((await handleRoomJoin(joinBody(code), h.ctx)).status).toBe(502);
  });

  it("counts every attempt against the run-start limit, before anything else", async () => {
    const { h, code } = await lobby();
    const limited = { ...h.ctx, limits: { start: async () => ({ ok: false, retryAfter: 60 }) } };
    for (const body of [joinBody(code), joinBody("ZZZZZZ"), { nonsense: 1 }]) {
      expect((await handleRoomJoin(body, limited)).status).toBe(429);
    }
    expect((await handleRoomPeek({ code }, limited)).status).toBe(429);
    expect(h.table(code).host.state!.seats[1]).toBeNull();
  });

  it("moderates the guest's name too", async () => {
    const { h, code } = await lobby();
    const strict = { ...h.ctx, moderate: (name: string) => name !== "Blocked" };
    expect((await handleRoomJoin(joinBody(code, "Blocked"), strict)).status).toBe(422);
  });
});

describe("looking at a room", () => {
  const peek = async (
    h: ReturnType<typeof roomHarness>,
    code: string,
  ): Promise<RoomPeekResponse> => {
    const res = await handleRoomPeek({ code }, h.ctx);
    expect(res.status).toBe(200);
    return res.body as RoomPeekResponse;
  };

  it("says whose lobby it is and what it plays, while a seat is free", async () => {
    const h = roomHarness();
    const { code } = ok(await handleRoomCreate(createBody("endless-instagram", 20, 10), h.ctx));
    expect(await peek(h, code)).toEqual({
      state: "open",
      host: "Ada",
      settings: { mode: "duel", pool: "endless-instagram", questions: 20, limit: 10 },
    });
  });

  it("says full once both seats are taken, and through a match", async () => {
    const h = roomHarness();
    const room = await openRoom(h);
    expect(await peek(h, room.code)).toEqual({ state: "full" });
    await startMatch(room);
    expect(await peek(h, room.code)).toEqual({ state: "full" });
  });

  it("says closed for a code nobody holds, and for a room idle past its time", async () => {
    const h = roomHarness();
    expect(await peek(h, "ZZZZZZ")).toEqual({ state: "closed" });
    const { code } = ok(await handleRoomCreate(createBody(), h.ctx));
    h.wait(ROOM_IDLE_MS);
    expect(await peek(h, code)).toEqual({ state: "closed" });
  });

  it("takes a code and nothing else", async () => {
    const h = roomHarness();
    for (const body of [{ code: "k7qm2x" }, { code: "K7QM2X", name: "x" }, {}, null, "K7QM2X"]) {
      expect((await handleRoomPeek(body, h.ctx)).status).toBe(400);
    }
  });
});

describe("the seat token", () => {
  it("admits its seat, again and again: it is what a player comes back with", async () => {
    const h = roomHarness();
    const room = await openRoom(h);
    expect(await room.table.hello(room.tokens[0])).toBe(0);
    expect(await room.table.hello(room.tokens[1])).toBe(1);
    expect(await room.table.hello(room.tokens[1])).toBe(1);
  });

  it("can't be forged or edited", async () => {
    const h = roomHarness();
    const room = await openRoom(h);
    const [body, sig] = room.tokens[1].split(".") as [string, string];
    const payload = read(room.tokens[1]);
    const encode = (value: unknown): string =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    for (const forged of [
      // The guest making themselves the host.
      `${encode({ ...payload, seat: 0 })}.${sig}`,
      // Another player's id.
      `${encode({ ...payload, player: uuidFrom(1) })}.${sig}`,
      // The signature edited, dropped, or from another secret.
      `${body}.${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`,
      body,
      `${body}.`,
      await signRoomToken("another-secret", payload as never),
      // Nonsense.
      "",
      "not.a.token",
      "x".repeat(2000),
    ]) {
      expect(await room.table.hello(forged)).toBe("bad_token");
      expect(await verifyRoomToken(SECRET, forged)).toBeUndefined();
    }
  });

  it("is refused in any other room", async () => {
    const h = roomHarness();
    const mine = await openRoom(h);
    const theirs = await openRoom(h);
    expect(mine.code).not.toBe(theirs.code);
    for (const token of mine.tokens) expect(await theirs.table.hello(token)).toBe("bad_token");
    for (const token of theirs.tokens) expect(await mine.table.hello(token)).toBe("bad_token");
  });

  it("is refused by a later room that gets the same code", async () => {
    const h = roomHarness();
    h.codes.push("K7QM2X");
    const old = await openRoom(h);
    // The host leaves: the room closes, and the code is free again.
    await old.table.say(0, { v: 1, t: "leave" });
    expect(old.table.host.state).toBeUndefined();
    expect(await old.table.hello(old.tokens[1])).toBe("unknown");

    h.codes.push("K7QM2X");
    const fresh = await openRoom(h);
    expect(fresh.code).toBe("K7QM2X");
    expect(fresh.table).toBe(old.table);
    for (const token of old.tokens) expect(await fresh.table.hello(token)).toBe("bad_token");
    expect(await fresh.table.hello(fresh.tokens[0])).toBe(0);
  });

  it("holds nothing once its player has left or forfeited", async () => {
    const h = roomHarness();
    const lobby = await openRoom(h);
    await lobby.table.say(1, { v: 1, t: "leave" });
    expect(await lobby.table.hello(lobby.tokens[1])).toBe("left");
    // The host's is unaffected, and the seat can be joined afresh.
    expect(await lobby.table.hello(lobby.tokens[0])).toBe(0);
    const again = ok(await handleRoomJoin(joinBody(lobby.code, "Kit"), h.ctx));
    expect(await lobby.table.hello(again.token)).toBe(1);
    expect(await lobby.table.hello(lobby.tokens[1])).toBe("left");

    const match = await openRoom(h);
    await startMatch(match);
    await match.table.drop(1);
    h.wait(REJOIN_MS);
    await match.table.tick();
    expect(await match.table.hello(match.tokens[1])).toBe("left");
  });

  it("passes for no other kind of token, nor any other for it", async () => {
    const h = roomHarness();
    const room = await openRoom(h);
    const payload = read(room.tokens[0]);
    expect(await verifyToken(SECRET, room.tokens[0])).toBeUndefined();
    expect(await verifyStreamToken(SECRET, room.tokens[0])).toBeUndefined();
    const progress = await signToken(SECRET, {
      v: 1,
      runId: "20260919-x",
      mode: "endless",
      round: 1,
      streak: 0,
      anchorId: "a",
      challengerId: "b",
      stat: "caps",
      anchorValue: 1,
      issuedAt: 1,
      deadline: 2,
      nonce: "n",
    });
    expect(await room.table.hello(progress)).toBe("bad_token");
    const stream = await signStreamToken(SECRET, { ...payload } as never);
    expect(await room.table.hello(stream)).toBe("bad_token");
  });

  it("is parsed strictly", async () => {
    const key = mintKey(TODAY.getTime(), uuidFrom(9));
    const good = { v: 1, room: key, seat: 1, player: uuidFrom(3) } as const;
    expect(await verifyRoomToken(SECRET, await signRoomToken(SECRET, good))).toEqual(good);
    const sign = async (payload: unknown): Promise<string> => {
      const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
      const mac = await crypto.subtle.sign(
        "HMAC",
        await crypto.subtle.importKey(
          "raw",
          new TextEncoder().encode(SECRET),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"],
        ),
        new TextEncoder().encode(`room-token:${body}`),
      );
      return `${body}.${Buffer.from(mac).toString("base64url")}`;
    };
    // The helper signs as the server does: a good payload verifies.
    expect(await verifyRoomToken(SECRET, await sign(good))).toEqual(good);
    for (const bad of [
      { ...good, v: 2 },
      { ...good, seat: -1 },
      { ...good, seat: 10 },
      { ...good, seat: 1.5 },
      { ...good, seat: "1" },
      { ...good, room: "K7QM2X" },
      { ...good, room: "20260919-short" },
      { ...good, player: "" },
      { ...good, name: "Sam" },
      { ...good, variant: "endless-instagram" },
      { v: 1, room: key, seat: 1 },
      [],
      "token",
    ]) {
      expect(await verifyRoomToken(SECRET, await sign(bad))).toBeUndefined();
    }
  });
});

describe("a match", () => {
  it("deals both players the same question at the same moment", async () => {
    const h = roomHarness();
    const room = await openRoom(h);
    const first = await startMatch(room);
    await playMatch(h, room, first);
    const forHost = room.table.inbox(0).filter((m) => m.t === "question" || m.t === "reveal");
    const forGuest = room.table.inbox(1).filter((m) => m.t === "question" || m.t === "reveal");
    expect(forHost.length).toBe(forGuest.length);
    expect(forHost.length).toBeGreaterThan(10);
    const questionsOf = (messages: RoomServerMessage[]): unknown[] =>
      messages.flatMap((m) =>
        m.t === "question" ? [m.question] : m.t === "reveal" && m.next ? [m.next] : [],
      );
    expect(questionsOf(forGuest)).toEqual(questionsOf(forHost));
    // In step: the same message, in the same order, for each.
    const order = room.table.sent
      .filter((s) => s.message.t === "question" || s.message.t === "reveal")
      .map((s) => `${s.seat}:${s.message.t}`);
    for (let i = 0; i < order.length; i += 2) {
      expect(order.slice(i, i + 2)).toEqual([`0:${order[i]!.slice(2)}`, `1:${order[i]!.slice(2)}`]);
    }
  });

  it("gives each player their own verdict, and both the picks, at the reveal", async () => {
    const h = roomHarness();
    const room = await openRoom(h);
    const first = await startMatch(room);
    const right = rightPick(SAMPLE_DECK, first, matchDay(h));
    const wrong = right === "higher" ? "lower" : "higher";
    await room.table.say(0, { v: 1, t: "answer", q: 1, pick: right });
    await room.table.say(1, { v: 1, t: "answer", q: 1, pick: wrong });
    const host = room.table.last(0, "reveal")!;
    const guest = room.table.last(1, "reveal")!;
    expect(host.reveal.correct).toBe(true);
    expect(guest.reveal.correct).toBe(false);
    for (const reveal of [host, guest]) {
      expect(reveal.picks).toEqual([right, wrong]);
      expect(reveal.correct).toEqual([true, false]);
      expect(reveal.scores).toEqual([1, 0]);
      expect(reveal.next?.round.index).toBe(2);
      expect(reveal).not.toHaveProperty("end");
    }
    // The figure revealed is the same for both.
    expect(guest.reveal.value).toBe(host.reveal.value);
    expect(guest.reveal.display).toBe(host.reveal.display);
  });

  it("plays ten questions to a winner, a point a right answer", async () => {
    const h = roomHarness();
    const room = await openRoom(h);
    const first = await startMatch(room);
    // The host gets seven right, the guest four.
    const { questions } = await playMatch(h, room, first, {
      way: (seat, index) => (index <= (seat === 0 ? 7 : 4) ? "right" : "wrong"),
    });
    expect(questions.map((q) => q.round.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(questions.every((q) => !q.suddenDeath && q.limitMs === 20_000 && q.match === 1)).toBe(
      true,
    );
    const end = room.table.last(1, "reveal")!.end!;
    expect(end.result).toMatchObject({
      winner: 0,
      reason: "finished",
      scores: [7, 4],
      questions: 10,
    });
    expect(end.result.results[0]).toHaveLength(10);
    expect(end.series).toEqual({ wins: [1, 0], draws: 0 });
    expect(room.table.host.state!.phase).toBe("fulltime");
  });

  it("goes to sudden death on a level score, in the last band, until one is right and one wrong", async () => {
    const h = roomHarness();
    const room = await openRoom(h);
    const first = await startMatch(room);
    const { questions } = await playMatch(h, room, first, {
      // Level through the match and two sudden-death questions; then the guest alone is right.
      way: (seat, index) => (index <= 12 || seat === 1 ? "right" : "wrong"),
    });
    expect(questions).toHaveLength(13);
    expect(questions.map((q) => q.suddenDeath)).toEqual([
      ...Array.from({ length: 10 }, () => false),
      true,
      true,
      true,
    ]);
    const end = room.table.last(0, "reveal")!.end!;
    expect(end.result).toMatchObject({ winner: 1, reason: "sudden-death", scores: [12, 13] });
    expect(end.series).toEqual({ wins: [0, 1], draws: 0 });
  });

  it("is a draw after ten sudden-death questions", async () => {
    const h = roomHarness();
    const room = await openRoom(h);
    const first = await startMatch(room);
    const { questions } = await playMatch(h, room, first);
    expect(questions).toHaveLength(10 + SUDDEN_DEATH_MAX);
    const end = room.table.last(0, "reveal")!.end!;
    expect(end.result).toMatchObject({ winner: null, reason: "draw", scores: [20, 20] });
    expect(end.series).toEqual({ wins: [0, 0], draws: 1 });
  });

  it("ends a small squad's level match when the squad runs out", async () => {
    const h = roomHarness({ deck: THEMED_DECK });
    // Kestrel Rovers: 15 players, 14 questions, and nobody left for sudden death.
    const room = await openRoom(h, { pool: "squad:club-kestrel-rovers", questions: 20 });
    const first = await startMatch(room);
    const { questions } = await playMatch(h, room, first, { deck: THEMED_DECK });
    expect(questions.length).toBeLessThanOrEqual(14);
    const result = room.table.last(0, "reveal")!.end!.result;
    expect(result.winner).toBeNull();
    expect(["exhausted", "draw"]).toContain(result.reason);
    // Nobody appeared twice.
    const ids = [questions[0]!.round.anchor.id, ...questions.map((q) => q.round.challenger.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("closes a question at its deadline when someone hasn't answered", async () => {
    const h = roomHarness();
    const room = await openRoom(h);
    const first = await startMatch(room);
    const started = h.now;
    await room.table.say(0, {
      v: 1,
      t: "answer",
      q: 1,
      pick: rightPick(SAMPLE_DECK, first, matchDay(h)),
    });
    expect(room.table.last(0, "reveal")).toBeUndefined();
    // The other player is told the host has locked in, and nothing more.
    expect(room.table.last(1, "locked")).toEqual({ v: 1, t: "locked", seat: 0 });
    await room.table.alarm();
    expect(h.now).toBe(room.table.host.state!.match!.issuedAt);
    expect(h.now).toBeGreaterThan(started + 20_000);
    expect(room.table.last(1, "reveal")).toMatchObject({
      picks: [expect.any(String) as string, null],
      correct: [true, false],
      scores: [1, 0],
    });
  });

  it("tells each player how long the question has, less the network's grace", async () => {
    const h = roomHarness();
    const room = await openRoom(h, { limit: 30 });
    const first = await startMatch(room);
    const { deadline } = room.table.host.state!.match!;
    expect(first.limitMs).toBe(30_000);
    expect(first.closesInMs).toBe(deadline - 3000 - h.now);
    // Never less than the limit itself: the allowance for the opening is on top.
    expect(first.closesInMs).toBeGreaterThan(30_000);
  });

  it("refuses what is out of turn, and changes nothing", async () => {
    const h = roomHarness();
    const room = await openRoom(h);
    const { table } = room;
    const errors = (seat: number): string[] =>
      table.inbox(seat).flatMap((m) => (m.t === "error" ? [m.code] : []));

    // Before the match: the guest can't start, nobody can answer.
    await table.say(1, { v: 1, t: "start" });
    await table.say(0, { v: 1, t: "start" });
    await table.say(0, { v: 1, t: "answer", q: 1, pick: "higher" });
    await table.say(0, { v: 1, t: "rematch" });
    expect(errors(1)).toEqual(["not_host"]);
    expect(errors(0)).toEqual(["not_ready", "out_of_turn", "out_of_turn"]);
    expect(table.host.state!.phase).toBe("lobby");

    const first = await startMatch(room);
    const before = table.host.state;
    await table.say(0, { v: 1, t: "answer", q: 2, pick: "higher" });
    await table.say(0, { v: 1, t: "ready", ready: true });
    await table.say(1, { v: 1, t: "start" });
    await table.say(1, { v: 1, t: "hello", token: room.tokens[1] });
    expect(errors(0).slice(3)).toEqual(["out_of_turn", "out_of_turn"]);
    expect(errors(1).slice(1)).toEqual(["out_of_turn", "out_of_turn"]);
    expect(table.host.state).toEqual(before);

    // A second answer, either way: the first stands.
    const right = rightPick(SAMPLE_DECK, first, matchDay(h));
    await table.say(0, { v: 1, t: "answer", q: 1, pick: right });
    await table.say(0, { v: 1, t: "answer", q: 1, pick: right === "higher" ? "lower" : "higher" });
    await table.say(0, { v: 1, t: "answer", q: 1, pick: right });
    expect(errors(0).slice(5)).toEqual(["out_of_turn", "out_of_turn"]);
    await table.say(1, { v: 1, t: "answer", q: 1, pick: right });
    expect(table.last(0, "reveal")).toMatchObject({ correct: [true, true] });
    // And none for the question just revealed.
    await table.say(1, { v: 1, t: "answer", q: 1, pick: right });
    expect(errors(1).at(-1)).toBe("out_of_turn");
    expect(table.host.state!.match!.scores).toEqual([1, 1]);
  });

  it("refuses a message that isn't one of the protocol's", async () => {
    const h = roomHarness();
    const room = await openRoom(h);
    await startMatch(room);
    const before = room.table.host.state;
    for (const message of [
      { v: 2, t: "answer", q: 1, pick: "higher" },
      { v: 1, t: "answer", q: 1, pick: "higher", seat: 1 },
      { v: 1, t: "answer", q: 1, pick: "up" },
      { v: 1, t: "reveal" },
      { v: 1, t: "win" },
      { t: "start" },
    ]) {
      await room.table.say(1, message);
      expect(room.table.inbox(1).at(-1)).toEqual({ v: 1, t: "error", code: "bad_message" });
    }
    expect(room.table.host.state).toEqual(before);
  });
});

describe("coming back", () => {
  it("restores the seat mid-question, with what is left of its clock and the player's own pick", async () => {
    const h = roomHarness();
    const room = await openRoom(h);
    const first = await startMatch(room);
    const right = rightPick(SAMPLE_DECK, first, matchDay(h));
    await room.table.say(1, { v: 1, t: "answer", q: 1, pick: right });
    h.wait(4000);
    await room.table.drop(1);
    expect(room.table.last(0, "players")!.players[1]).toMatchObject({
      connected: false,
      rejoinInMs: REJOIN_MS,
    });

    h.wait(6000);
    const mark = room.table.sent.length;
    expect(await room.table.hello(room.tokens[1])).toBe(1);
    const welcome = room.table.inbox(1, mark).find((m) => m.t === "welcome");
    if (welcome?.t !== "welcome") throw new Error("no welcome");
    expect(welcome.you).toBe(1);
    expect(welcome.room).toMatchObject({
      code: room.code,
      phase: "playing",
      settings: { pool: "endless", questions: 10, limit: 20 },
      match: { no: 1, scores: [0, 0], results: [[], []] },
      picked: right,
      locked: [1],
    });
    // The clock kept running: ten seconds have gone.
    expect(welcome.room.question!.round).toEqual(first.round);
    expect(welcome.room.question!.closesInMs).toBe(first.closesInMs - 10_000);
    expect(welcome.room.players[1]).toEqual({
      seat: 1,
      name: "Sam",
      ready: false,
      connected: true,
    });
    // The host sees them back.
    expect(room.table.last(0, "players")!.players[1]!.connected).toBe(true);
  });

  it("never gives a returning player the other's pick", async () => {
    const h = roomHarness();
    const room = await openRoom(h);
    const first = await startMatch(room);
    const pick = rightPick(SAMPLE_DECK, first, matchDay(h));
    await room.table.say(0, { v: 1, t: "answer", q: 1, pick });
    await room.table.drop(1);
    const mark = room.table.sent.length;
    await room.table.hello(room.tokens[1]);
    const welcome = room.table.inbox(1, mark).find((m) => m.t === "welcome");
    if (welcome?.t !== "welcome") throw new Error("no welcome");
    expect(welcome.room.locked).toEqual([0]);
    expect(welcome.room).not.toHaveProperty("picked");
    expect(JSON.stringify(welcome)).not.toContain(`"${pick}"`);
  });

  it("counts what was missed while away as wrong, and plays on", async () => {
    const h = roomHarness();
    const room = await openRoom(h, { limit: 10 });
    const first = await startMatch(room);
    await room.table.drop(1);
    await room.table.say(0, {
      v: 1,
      t: "answer",
      q: 1,
      pick: rightPick(SAMPLE_DECK, first, matchDay(h)),
    });
    // Question one's deadline comes before the thirty seconds are up.
    await room.table.alarm();
    expect(room.table.host.state!.phase).toBe("playing");
    expect(await room.table.hello(room.tokens[1])).toBe(1);
    const welcome = room.table.last(1, "welcome")!;
    expect(welcome.room.match).toMatchObject({ scores: [1, 0], results: [[true], [false]] });
    expect(welcome.room.question!.round.index).toBe(2);
  });

  it("forfeits a player away for thirty seconds: the other is told, and wins", async () => {
    const h = roomHarness();
    const room = await openRoom(h, { limit: 30 });
    await startMatch(room);
    await room.table.drop(1);
    h.wait(REJOIN_MS - 1);
    await room.table.tick();
    expect(room.table.host.state!.phase).toBe("playing");
    h.wait(1);
    await room.table.tick();
    const full = room.table.last(0, "fulltime")!;
    expect(full.result).toMatchObject({ winner: 0, reason: "forfeit", left: 1, scores: [0, 0] });
    expect(full.series).toEqual({ wins: [1, 0], draws: 0 });
    expect(full.players[1]).toMatchObject({ name: "Sam", left: true });
    // No rematch with someone who has gone.
    await room.table.say(0, { v: 1, t: "rematch" });
    expect(room.table.inbox(0).at(-1)).toEqual({ v: 1, t: "error", code: "opponent_left" });
  });

  it("keeps a lobby through five minutes of its host away, and the same room on return", async () => {
    const h = roomHarness();
    const room = await openRoom(h);
    await room.table.say(0, { v: 1, t: "ready", ready: true });
    await room.table.say(1, { v: 1, t: "ready", ready: true });
    const key = room.table.host.state!.key;
    await room.table.drop(0);
    expect(room.table.last(1, "players")!.players[0]).toEqual({
      seat: 0,
      name: "Ada",
      ready: true,
      connected: false,
    });
    for (let minute = 0; minute < 5; minute++) {
      h.wait(60_000);
      await room.table.tick();
    }
    expect(room.table.closed.size).toBe(0);
    expect(await room.table.hello(room.tokens[0])).toBe(0);
    const welcome = room.table.last(0, "welcome")!;
    expect(welcome.room).toMatchObject({ code: room.code, phase: "lobby" });
    expect(welcome.room.players).toEqual([
      { seat: 0, name: "Ada", ready: true, connected: true },
      { seat: 1, name: "Sam", ready: true, connected: true },
    ]);
    expect(room.table.host.state!.key).toBe(key);
  });

  it("won't start while the guest is away from the lobby", async () => {
    const h = roomHarness();
    const room = await openRoom(h);
    await room.table.say(0, { v: 1, t: "ready", ready: true });
    await room.table.say(1, { v: 1, t: "ready", ready: true });
    await room.table.drop(1);
    await room.table.say(0, { v: 1, t: "start" });
    expect(room.table.inbox(0).at(-1)).toEqual({ v: 1, t: "error", code: "not_ready" });
    expect(room.table.host.state!.phase).toBe("lobby");
    await room.table.hello(room.tokens[1]);
    await room.table.say(0, { v: 1, t: "start" });
    expect(room.table.last(1, "question")).toBeDefined();
  });
});

describe("rematches", () => {
  it("start a new match on a new deal when both have asked, and keep the series", async () => {
    const h = roomHarness();
    const room = await openRoom(h);
    const first = await startMatch(room);
    const one = await playMatch(h, room, first, {
      way: (seat) => (seat === 0 ? "right" : "wrong"),
    });
    const oneId = room.table.host.state!.match!.id;

    await room.table.say(1, { v: 1, t: "rematch" });
    expect(room.table.last(0, "rematch")).toEqual({ v: 1, t: "rematch", seats: [1] });
    const mark = room.table.sent.length;
    await room.table.say(0, { v: 1, t: "rematch" });
    const again = room.table.inbox(1, mark).find((m) => m.t === "question");
    if (again?.t !== "question") throw new Error("no rematch");
    expect(again.question.match).toBe(2);
    expect(again.question.round.index).toBe(1);
    expect(room.table.host.state!.match!.id).not.toBe(oneId);
    expect(room.table.host.state!.settings).toEqual({
      mode: "duel",
      pool: "endless",
      questions: 10,
      limit: 20,
    });

    const two = await playMatch(h, room, again.question, {
      way: (seat) => (seat === 1 ? "right" : "wrong"),
    });
    // Another seed: not the same questions again.
    const fingerprint = (qs: typeof one.questions): string =>
      qs.map((q) => `${q.round.stat.key}:${q.round.anchor.id}>${q.round.challenger.id}`).join("|");
    expect(fingerprint(two.questions)).not.toBe(fingerprint(one.questions));
    expect(room.table.last(0, "reveal")!.end!.series).toEqual({ wins: [1, 1], draws: 0 });

    await room.table.say(0, { v: 1, t: "rematch" });
    await room.table.say(1, { v: 1, t: "rematch" });
    const third = room.table.last(0, "question")!.question;
    expect(third.match).toBe(3);
    await playMatch(h, room, third, { way: (seat) => (seat === 0 ? "right" : "wrong") });
    expect(room.table.last(1, "reveal")!.end!.series).toEqual({ wins: [2, 1], draws: 0 });
  });
});

describe("expiry", () => {
  const HOUR = 60 * 60_000;

  it("keeps a room open while someone is connected to it, well past fifteen minutes", async () => {
    const h = roomHarness();
    const room = await openRoom(h);
    const made = h.now;
    // The only thing due is the two hours with nothing done.
    expect(room.table.host.wakeAt()).toBe(made + ROOM_QUIET_MS);
    h.wait(HOUR);
    await room.table.tick();
    expect(room.table.closed.size).toBe(0);
    expect(room.table.host.state?.phase).toBe("lobby");
    // One of them going changes nothing either, while the other is there.
    await room.table.drop(1);
    expect(room.table.host.wakeAt()).toBe(made + ROOM_QUIET_MS);
    h.wait(50 * 60_000);
    await room.table.tick();
    expect(room.table.host.state?.phase).toBe("lobby");
    expect((await handleRoomPeek({ code: room.code }, h.ctx)).body).toEqual({ state: "full" });
    // And the match can still be played.
    expect(await room.table.hello(room.tokens[1])).toBe(1);
    expect((await startMatch(room)).match).toBe(1);
  });

  it("closes a room on a host who has sat connected in the lobby for two hours", async () => {
    const h = roomHarness();
    const made = ok(await handleRoomCreate(createBody(), h.ctx));
    const table = h.table(made.code);
    expect(await table.hello(made.token)).toBe(0);
    const at = h.now;
    h.wait(ROOM_QUIET_MS - 1000);
    await table.tick();
    expect(table.closed.size).toBe(0);
    expect((await handleRoomPeek({ code: made.code }, h.ctx)).body).toMatchObject({
      state: "open",
    });
    // The alarm comes two hours after the room was made, and the host is told as anyone is.
    await table.alarm();
    expect(h.now).toBe(at + ROOM_QUIET_MS);
    expect(table.closed).toEqual(new Map([[0, "expired"]]));
    expect(table.inbox(0).at(-1)).toEqual({ v: 1, t: "closed", reason: "expired" });
    // Nothing is kept: the token opens nothing, and the code reads as closed.
    expect(table.host.state).toBeUndefined();
    expect(table.host.wakeAt()).toBeNull();
    expect(await table.hello(made.token)).toBe("unknown");
    expect((await handleRoomPeek({ code: made.code }, h.ctx)).body).toEqual({ state: "closed" });
    expect(detail(await handleRoomJoin(joinBody(made.code), h.ctx))).toBe("closed");
  });

  it("reads as closed to the invite link from the two hours on, alarm or no alarm", async () => {
    const h = roomHarness();
    const room = await openRoom(h);
    h.wait(ROOM_QUIET_MS);
    // The alarm hasn't fired; both players are still connected.
    expect(room.table.host.state?.phase).toBe("lobby");
    expect((await handleRoomPeek({ code: room.code }, h.ctx)).body).toEqual({ state: "closed" });
  });

  it("starts the two hours again on anything a player does, and both are told when they end", async () => {
    const h = roomHarness();
    const room = await openRoom(h);
    const late = 90 * 60_000;
    const due = () => room.table.host.wakeAt();

    h.wait(late);
    await room.table.say(0, { v: 1, t: "ready", ready: true });
    expect(due()).toBe(h.now + ROOM_QUIET_MS);
    h.wait(late);
    await room.table.say(1, { v: 1, t: "ready", ready: true });
    expect(due()).toBe(h.now + ROOM_QUIET_MS);
    h.wait(late);
    await room.table.say(0, { v: 1, t: "start" });
    const first = room.table.last(0, "question")!.question;
    await playMatch(h, room, first, { way: (seat) => (seat === 0 ? "right" : "wrong") });
    expect(room.table.host.state?.phase).toBe("fulltime");
    const answered = room.table.host.state!.lastAction;
    expect(due()).toBe(answered + ROOM_QUIET_MS);

    h.wait(late);
    await room.table.say(1, { v: 1, t: "rematch" });
    expect(room.table.host.state?.phase).toBe("fulltime");
    expect(due()).toBe(h.now + ROOM_QUIET_MS);

    // A connection going and coming back is not something done.
    const pressed = h.now;
    h.wait(late);
    await room.table.drop(1);
    expect(await room.table.hello(room.tokens[1])).toBe(1);
    expect(due()).toBe(pressed + ROOM_QUIET_MS);

    await room.table.alarm();
    expect(h.now).toBe(pressed + ROOM_QUIET_MS);
    expect(room.table.closed).toEqual(
      new Map([
        [0, "expired"],
        [1, "expired"],
      ]),
    );
    expect(room.table.host.state).toBeUndefined();
  });

  it("lets a friend in on a host who has waited in the lobby well past fifteen minutes", async () => {
    const h = roomHarness();
    const made = ok(await handleRoomCreate(createBody(), h.ctx));
    const table = h.table(made.code);
    expect(await table.hello(made.token)).toBe(0);
    h.wait(40 * 60_000);
    // The invite link opens on the room, not on "This room has closed".
    expect((await handleRoomPeek({ code: made.code }, h.ctx)).body).toMatchObject({
      state: "open",
      host: "Ada",
    });
    const joined = ok(await handleRoomJoin(joinBody(made.code), h.ctx));
    expect(await table.hello(joined.token)).toBe(1);
    expect(table.host.state?.phase).toBe("lobby");
  });

  it("closes a room fifteen minutes after the last player went, and keeps nothing", async () => {
    const h = roomHarness();
    const room = await openRoom(h);
    h.wait(HOUR);
    await room.table.drop(1);
    h.wait(1000);
    await room.table.drop(0);
    const went = h.now;
    expect(room.table.host.wakeAt()).toBe(went + ROOM_IDLE_MS);
    await room.table.alarm();
    expect(h.now).toBe(went + ROOM_IDLE_MS);
    expect(room.table.host.state).toBeUndefined();
    expect(room.table.host.wakeAt()).toBeNull();
    // Its tokens open nothing, and the code reads as closed.
    expect(await room.table.hello(room.tokens[0])).toBe("unknown");
    expect((await handleRoomPeek({ code: room.code }, h.ctx)).body).toEqual({ state: "closed" });
    expect(detail(await handleRoomJoin(joinBody(room.code, "Kit"), h.ctx))).toBe("closed");
  });

  it("gives a player who comes back in time their seat, and the room its time again", async () => {
    const h = roomHarness();
    const room = await openRoom(h);
    await room.table.drop(0);
    await room.table.drop(1);
    h.wait(ROOM_IDLE_MS - 1000);
    expect(await room.table.hello(room.tokens[0])).toBe(0);
    // The fifteen minutes no longer run; only the two hours with nothing done are due.
    expect(room.table.host.wakeAt()).toBe(room.table.host.state!.lastAction + ROOM_QUIET_MS);
    h.wait(HOUR);
    await room.table.tick();
    expect(room.table.host.state?.phase).toBe("lobby");
  });

  it("doesn't take the room's word for who is connected", async () => {
    const h = roomHarness();
    const room = await openRoom(h);
    // The sockets go and no word of it reaches the room (a deploy drops them all).
    room.table.connected.clear();
    const quiet = room.table.host.state!.lastAction + ROOM_QUIET_MS;
    expect(room.table.host.occupied).toBe(true);
    expect(room.table.host.wakeAt()).toBe(quiet);
    // One socket really is there: only the other seat is marked away, and the first is told.
    const mark = room.table.sent.length;
    room.table.connected.add(0);
    room.table.deliver(await room.table.host.reconcile(new Set([0]), h.now));
    expect(room.table.host.state?.seats.map((s) => s?.connected)).toEqual([true, false]);
    expect(room.table.sent.slice(mark).map((m) => [m.seat, m.message.t])).toEqual([[0, "players"]]);
    expect(room.table.host.wakeAt()).toBe(quiet);
    // None is: both are away, and the fifteen minutes start from here.
    room.table.connected.clear();
    h.wait(5000);
    await room.table.host.reconcile(new Set(), h.now);
    expect(room.table.host.state?.seats.map((s) => s?.connected)).toEqual([false, false]);
    expect(room.table.host.occupied).toBe(false);
    expect(room.table.host.wakeAt()).toBe(h.now + ROOM_IDLE_MS);
    // With everyone accounted for, it has nothing to do.
    expect(await room.table.host.reconcile(new Set(), h.now)).toEqual([]);
    await room.table.alarm();
    expect(room.table.host.state).toBeUndefined();
  });

  it("tells a seat that speaks to a room that has gone", async () => {
    const h = roomHarness();
    const room = await openRoom(h);
    await room.table.drop(0);
    await room.table.drop(1);
    await room.table.alarm();
    room.table.connected.add(0);
    await room.table.say(0, { v: 1, t: "ready", ready: true });
    expect(room.table.closed.get(0)).toBe("unknown");
  });
});

describe("what a room records", () => {
  it("a room made, each match started and each match ended, never a name", async () => {
    const h = roomHarness();
    const room = await openRoom(h);
    const first = await startMatch(room);
    await playMatch(h, room, first, { way: (seat) => (seat === 0 ? "right" : "wrong") });
    await room.table.say(0, { v: 1, t: "rematch" });
    await room.table.say(1, { v: 1, t: "rematch" });
    await playMatch(h, room, room.table.last(0, "question")!.question, {
      way: (seat, index) => (index <= 11 || seat === 1 ? "right" : "wrong") as Way,
    });
    const key = room.table.host.state!.key;
    const settings = { mode: "duel", pool: "endless", questions: 10, limit: 20 };
    expect(h.events).toEqual([
      { type: "room", room: key, settings },
      { type: "start", room: key, settings, match: 1 },
      {
        type: "end",
        room: key,
        settings,
        match: 1,
        reason: "finished",
        scores: [10, 0],
        suddenDeath: 0,
      },
      { type: "start", room: key, settings, match: 2 },
      {
        type: "end",
        room: key,
        settings,
        match: 2,
        reason: "sudden-death",
        scores: [11, 12],
        suddenDeath: 2,
      },
    ]);
    // The room's own events carry how it was made.
    expect(new Set(h.metas.map((m) => JSON.stringify(m)))).toEqual(
      new Set([JSON.stringify({ country: "GB", deckVersion: "legends-test" })]),
    );
    const ctx = { country: "GB", deckVersion: "legends-test" };
    const everything = JSON.stringify([
      h.events,
      h.events.map((e) => roomDataPoint(e, ctx)),
      h.events.map((e) => roomLogLine(e, ctx, "room-do")),
    ]);
    for (const secret of ["Ada", "Sam", room.code, ...room.tokens]) {
      expect(everything).not.toContain(secret);
    }
  });

  it("records a forfeit", async () => {
    const h = roomHarness();
    const room = await openRoom(h);
    await startMatch(room);
    await room.table.say(1, { v: 1, t: "leave" });
    expect(h.events.at(-1)).toMatchObject({ type: "end", reason: "forfeit", scores: [0, 0] });
    expect(room.table.closed.get(1)).toBe("left");
  });
});

describe("a room's data points and log lines", () => {
  const ctx = { country: "GB", deckVersion: "legends-test" };
  const settings = {
    mode: "duel",
    pool: "squad:club-testfield",
    questions: 14,
    limit: 30,
  } as const;
  const room = "20260919-00000000-0000-4000-8000-000000000001";

  it("share the dataset's columns: the event, the mode, the kind, the deck, the country", () => {
    expect(roomDataPoint({ type: "room", room, settings }, ctx)).toEqual({
      indexes: [room],
      blobs: [
        "room",
        "duel",
        "fresh",
        "legends-test",
        "GB",
        "",
        "",
        "",
        "",
        "club-testfield",
        "squad:club-testfield",
      ],
      doubles: [14, 30],
    });
    const start = roomDataPoint({ type: "start", room, settings, match: 3 }, ctx);
    expect(start.blobs.slice(0, 3)).toEqual(["start", "duel", "rematch"]);
    expect(start.doubles).toEqual([14, 30, 3]);
    // The room's first match is not a rematch.
    expect(roomDataPoint({ type: "start", room, settings, match: 1 }, ctx).blobs[2]).toBe("fresh");
  });

  it("write an end as the higher and the lower score, never whose", () => {
    const end = (scores: number[]) =>
      roomDataPoint(
        { type: "end", room, settings, match: 2, reason: "sudden-death", scores, suddenDeath: 3 },
        ctx,
      );
    expect(end([9, 12])).toEqual(end([12, 9]));
    expect(end([9, 12]).blobs[5]).toBe("sudden-death");
    // higher, lower, questions, limit, sudden-death questions, the match's number
    expect(end([9, 12]).doubles).toEqual([12, 9, 14, 30, 3, 2]);
  });

  it("leave the theme empty for a pool that isn't a squad, and fit Analytics Engine's limits", () => {
    const point = roomDataPoint(
      { type: "room", room, settings: { ...settings, pool: "endless-instagram" } },
      ctx,
    );
    expect(point.blobs.slice(9)).toEqual(["", "endless-instagram"]);
    expect(point.blobs.length).toBeLessThanOrEqual(20);
    expect(new TextEncoder().encode(point.indexes[0]).length).toBeLessThanOrEqual(96);
  });

  it("log each event as one info line, with a message, and nothing that names a player", () => {
    const lines = [
      roomLogLine({ type: "room", room, settings }, ctx, "/api/room/create"),
      roomLogLine({ type: "start", room, settings, match: 1 }, ctx, "room-do"),
      roomLogLine(
        {
          type: "end",
          room,
          settings,
          match: 1,
          reason: "forfeit",
          scores: [4, 6],
          suddenDeath: 0,
        },
        ctx,
        "room-do",
      ),
    ];
    expect(lines.map((l) => [l.level, l.message, l.event])).toEqual([
      ["info", "room_create", "room_create"],
      ["info", "match_start", "match_start"],
      ["info", "match_end", "match_end"],
    ]);
    expect(lines[2]).toMatchObject({
      mode: "duel",
      pool: "squad:club-testfield",
      theme: "club-testfield",
      questions: 14,
      limit: 30,
      room,
      match: 1,
      reason: "forfeit",
      score: 6,
      loserScore: 4,
      country: "GB",
    });
    for (const line of lines) {
      expect(Object.keys(line)).not.toEqual(
        expect.arrayContaining(["name", "names", "code", "token"]),
      );
    }
  });
});
