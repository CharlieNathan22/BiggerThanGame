/**
 * A 1v1 room's connection (duel/socket.ts) over a fake socket, with the
 * timers, the clock and the page's events moved by hand: `hello` first,
 * reconnecting by itself for as long as the room is there, at once when the
 * player comes back, a heartbeat that finds a dead socket, and a goodbye that
 * is final.
 */

import { describe, expect, it } from "vitest";
import { REJOIN_MS } from "@bt/core";
import {
  OPEN_TIMEOUT_MS,
  PING_EVERY_MS,
  RECONNECT,
  SILENT_AFTER_MS,
  STALE_ATTEMPT_MS,
  WAKE_PROBE_MS,
  reconnectDelay,
} from "../duel/socket";
import type { LinkStatus } from "../duel/socket";
import { link, welcome } from "./duel-helpers";
import type { Link } from "./duel-helpers";

/** Connected and welcomed. */
function connected(l: Link = link()): Link {
  l.socket.connect("K7QM2X", "seat-token");
  l.last.open();
  l.last.say(welcome(0));
  return l;
}

describe("connecting", () => {
  it("opens the room's socket and says hello with the seat's token, first", () => {
    const l = link();
    const statuses: LinkStatus["kind"][] = [];
    l.socket.onStatus((s) => statuses.push(s.kind));
    l.socket.connect("K7QM2X", "seat-token");
    expect(l.sockets).toHaveLength(1);
    expect(l.last.url).toBe("wss://example.test/api/room/ws?code=K7QM2X");
    // Nothing until the socket is open.
    expect(l.last.sent).toEqual([]);
    l.last.open();
    expect(l.last.messages).toEqual([{ v: 1, t: "hello", token: "seat-token" }]);
    // Open is not yet in: only the room's welcome is.
    expect(l.socket.status.kind).toBe("connecting");
    expect(l.socket.send({ v: 1, t: "ready", ready: true })).toBe(false);
    l.last.say(welcome(0));
    expect(l.socket.status.kind).toBe("connected");
    expect(statuses).toEqual(["idle", "connecting", "connected"]);
    expect(l.socket.send({ v: 1, t: "ready", ready: true })).toBe(true);
    expect(l.last.messages.at(-1)).toEqual({ v: 1, t: "ready", ready: true });
  });

  it("hands every message of the room on, and never the heartbeat's answer", () => {
    const l = link();
    const heard: string[] = [];
    l.socket.onMessage((m) => heard.push(m.t));
    connected(l);
    l.last.say("pong");
    l.last.say({ v: 1, t: "locked", seat: 1 });
    l.last.say("not json");
    l.last.say(JSON.stringify({ v: 2, t: "locked", seat: 1 }));
    expect(heard).toEqual(["welcome", "locked"]);
  });

  it("leaves one room for another", () => {
    const l = connected();
    const first = l.last;
    l.socket.connect("B3DF9G", "other-token");
    expect(first.closed).toBe(true);
    expect(l.sockets).toHaveLength(2);
    expect(l.last.url).toContain("code=B3DF9G");
    // The old socket's last words change nothing.
    first.drop();
    first.say({ v: 1, t: "closed", reason: "expired" });
    expect(l.socket.status.kind).toBe("connecting");
    expect(l.sockets).toHaveLength(2);
  });
});

describe("a dropped connection", () => {
  it("is tried again after a short wait, then longer ones, up to a cap", () => {
    expect([0, 1, 2, 3, 4, 5, 9].map((n) => reconnectDelay(n, 0.5))).toEqual([
      400, 800, 1600, 3200, 4000, 4000, 4000,
    ]);
    // ±20% either side.
    expect(reconnectDelay(0, 0)).toBe(320);
    expect(reconnectDelay(0, 0.999)).toBe(480);
    expect(reconnectDelay(9, 0.999)).toBeLessThanOrEqual(RECONNECT.maxMs * 1.2);
  });

  it("reconnects by itself and says hello again with the same token", () => {
    const l = connected();
    const dropped = l.clock.now;
    l.last.drop();
    expect(l.socket.status).toEqual({ kind: "reconnecting", since: dropped, attempt: 0 });
    expect(l.sockets).toHaveLength(1);
    l.clock.advance(399);
    expect(l.sockets).toHaveLength(1);
    l.clock.advance(1);
    expect(l.sockets).toHaveLength(2);
    l.last.open();
    expect(l.last.messages).toEqual([{ v: 1, t: "hello", token: "seat-token" }]);
    l.last.say(welcome(0));
    expect(l.socket.status.kind).toBe("connected");
  });

  it("keeps trying well past thirty seconds, as the lobby and full time need", () => {
    const l = connected();
    const dropped = l.clock.now;
    l.failing = true;
    l.last.drop();
    // Ten minutes with no network at all.
    l.clock.advance(10 * 60_000);
    expect(l.socket.status.kind).toBe("reconnecting");
    const status = l.socket.status;
    if (status.kind !== "reconnecting") throw new Error("not reconnecting");
    // Still counted from when it first dropped, however many tries since.
    expect(status.since).toBe(dropped);
    expect(status.attempt).toBeGreaterThan(100);
    // And never waiting longer than the cap between tries.
    expect(l.clock.nextIn).toBeLessThanOrEqual(RECONNECT.maxMs);
    expect(l.clock.now - dropped).toBeGreaterThan(REJOIN_MS * 10);

    // The network returns: the next try gets through.
    l.failing = false;
    l.clock.advance(RECONNECT.maxMs);
    l.last.open();
    l.last.say(welcome(0));
    expect(l.socket.status.kind).toBe("connected");
    // A later drop starts its waits from the shortest again.
    l.last.drop();
    expect(l.socket.status).toMatchObject({ kind: "reconnecting", attempt: 0 });
    expect(l.clock.nextIn).toBe(400);
  });

  it("says when it dropped, so a match can count the thirty seconds down", () => {
    const l = connected();
    l.clock.advance(5000);
    const dropped = l.clock.now;
    l.last.drop();
    l.clock.advance(400);
    l.last.drop();
    l.clock.advance(800);
    const status = l.socket.status;
    expect(status).toMatchObject({ kind: "reconnecting", since: dropped });
  });

  it("gives up on a socket that never opens, and tries another", () => {
    const l = link();
    l.socket.connect("K7QM2X", "seat-token");
    l.clock.advance(OPEN_TIMEOUT_MS - 1);
    expect(l.sockets).toHaveLength(1);
    l.clock.advance(1);
    expect(l.sockets[0]!.closed).toBe(true);
    expect(l.socket.status.kind).toBe("reconnecting");
    l.clock.advance(400);
    expect(l.sockets).toHaveLength(2);
  });

  it("gives up on a socket that opens and is never welcomed", () => {
    const l = link();
    l.socket.connect("K7QM2X", "seat-token");
    l.last.open();
    l.clock.advance(OPEN_TIMEOUT_MS);
    expect(l.socket.status.kind).toBe("reconnecting");
  });
});

describe("coming back to the page", () => {
  it("asks to hear of it once connected to a room", () => {
    const l = link();
    expect(l.listening).toBe(false);
    connected(l);
    expect(l.listening).toBe(true);
  });

  it("reconnects at once, cancelling the wait it was in", () => {
    const l = connected();
    l.failing = true;
    l.last.drop();
    // Deep into the backoff: four seconds between tries.
    l.clock.advance(60_000);
    l.failing = false;
    const before = l.sockets.length;
    const due = l.clock.nextIn!;
    expect(due).toBeGreaterThan(0);

    l.wake();
    // No waiting: a socket is opened there and then.
    expect(l.sockets).toHaveLength(before + 1);
    expect(l.clock.pending).toBe(1); // only the new socket's own open timeout
    // The wait that was pending is gone: its time passes and nothing more opens.
    l.clock.advance(due);
    expect(l.sockets).toHaveLength(before + 1);
    l.last.open();
    l.last.say(welcome(0));
    expect(l.socket.status.kind).toBe("connected");
  });

  it("never opens a second socket for one return", () => {
    const l = connected();
    l.last.drop();
    l.wake();
    l.wake();
    l.wake();
    // visibilitychange, online and pageshow can all fire for one return.
    expect(l.sockets).toHaveLength(2);
    l.clock.advance(400);
    expect(l.sockets).toHaveLength(2);
  });

  it("abandons an attempt begun before the return, and leaves one only just begun", () => {
    const l = connected();
    l.last.drop();
    l.clock.advance(400);
    // An attempt is in flight, begun while the player was away (offline, say): it hangs.
    const hung = l.last;
    expect(l.sockets).toHaveLength(2);
    l.clock.advance(STALE_ATTEMPT_MS + 500);
    l.wake();
    // Not waited on: closed, and a fresh one opened there and then.
    expect(hung.closed).toBe(true);
    expect(l.sockets).toHaveLength(3);
    expect(l.socket.status.kind).toBe("reconnecting");
    // The same return's other events find that one only just begun, and leave it.
    l.wake();
    l.wake();
    expect(l.sockets).toHaveLength(3);
    l.last.open();
    expect(l.last.messages).toEqual([{ v: 1, t: "hello", token: "seat-token" }]);
    l.last.say(welcome(0));
    expect(l.socket.status.kind).toBe("connected");
    // The abandoned attempt opening late is ignored.
    hung.open();
    expect(hung.sent).toEqual([]);
  });

  it("does the same for the very first connection to a room", () => {
    const l = link();
    l.socket.connect("K7QM2X", "seat-token");
    l.clock.advance(STALE_ATTEMPT_MS + 1);
    l.wake();
    expect(l.sockets).toHaveLength(2);
    expect(l.sockets[0]!.closed).toBe(true);
  });

  it("probes a socket that looks alive, and keeps it when the room answers", () => {
    const l = connected();
    const socket = l.last;
    l.clock.advance(1000);
    l.wake();
    expect(socket.sent.at(-1)).toBe("ping");
    l.clock.advance(300);
    socket.say("pong");
    l.clock.advance(WAKE_PROBE_MS);
    expect(l.sockets).toHaveLength(1);
    expect(socket.closed).toBe(false);
    expect(l.socket.status.kind).toBe("connected");
  });

  it("replaces a socket that died quietly while the page was away", () => {
    const l = connected();
    const stale = l.last;
    l.clock.advance(1000);
    const back = l.clock.now;
    l.wake();
    expect(stale.sent.at(-1)).toBe("ping");
    // No answer: the socket is dead and never said so.
    l.clock.advance(WAKE_PROBE_MS);
    expect(stale.closed).toBe(true);
    expect(l.sockets).toHaveLength(2);
    expect(l.socket.status).toMatchObject({ kind: "reconnecting", since: back + WAKE_PROBE_MS });
    l.last.open();
    expect(l.last.messages).toEqual([{ v: 1, t: "hello", token: "seat-token" }]);
    l.last.say(welcome(0));
    expect(l.socket.status.kind).toBe("connected");
    // The dead socket's late close changes nothing.
    stale.drop();
    expect(l.socket.status.kind).toBe("connected");
    expect(l.sockets).toHaveLength(2);
  });

  it("does nothing when no room is being connected to", () => {
    const l = link();
    l.wake();
    expect(l.sockets).toHaveLength(0);
    connected(l);
    l.last.say({ v: 1, t: "closed", reason: "expired" });
    l.wake();
    expect(l.sockets).toHaveLength(1);
  });
});

describe("the heartbeat", () => {
  it("pings while connected, and the room's answers keep the socket", () => {
    const l = connected();
    const socket = l.last;
    for (let beat = 1; beat <= 6; beat++) {
      l.clock.advance(PING_EVERY_MS);
      expect(socket.sent.filter((s) => s === "ping")).toHaveLength(beat);
      socket.say("pong");
    }
    expect(l.sockets).toHaveLength(1);
    expect(l.socket.status.kind).toBe("connected");
  });

  it("replaces a socket the room has gone quiet on", () => {
    const l = connected();
    const quiet = l.last;
    // Pings go out and nothing comes back.
    l.clock.advance(SILENT_AFTER_MS + PING_EVERY_MS);
    expect(quiet.closed).toBe(true);
    expect(l.sockets).toHaveLength(2);
    expect(l.socket.status.kind).toBe("reconnecting");
  });

  it("stops with the socket", () => {
    const l = connected();
    const socket = l.last;
    socket.drop();
    const pings = socket.sent.filter((s) => s === "ping").length;
    l.clock.advance(PING_EVERY_MS * 3);
    expect(socket.sent.filter((s) => s === "ping")).toHaveLength(pings);
  });
});

describe("a goodbye", () => {
  it("is final: the room's `closed` is handed on, and nothing reconnects", () => {
    for (const reason of [
      "expired",
      "host-left",
      "left",
      "empty",
      "unknown",
      "replaced",
    ] as const) {
      const l = connected();
      const heard: unknown[] = [];
      l.socket.onMessage((m) => heard.push(m));
      l.last.say({ v: 1, t: "closed", reason });
      expect(heard).toEqual([{ v: 1, t: "closed", reason }]);
      expect(l.socket.status.kind).toBe("closed");
      expect(l.last.closed).toBe(true);
      l.clock.advance(60_000);
      l.wake();
      expect(l.sockets).toHaveLength(1);
    }
  });

  it("is final by the room's own close codes too, with no message read", () => {
    for (const code of [4000, 4001, 4002]) {
      const l = connected();
      l.last.drop(code);
      expect(l.socket.status.kind).toBe("closed");
      l.clock.advance(60_000);
      expect(l.sockets).toHaveLength(1);
    }
    // Any other close is only a drop.
    for (const code of [1000, 1001, 1006, 1011, undefined]) {
      const l = connected();
      l.last.drop(code);
      expect(l.socket.status.kind).toBe("reconnecting");
    }
  });

  it("is final for a token the room won't have", () => {
    const l = link();
    l.socket.connect("K7QM2X", "old-token");
    l.last.open();
    l.last.say({ v: 1, t: "error", code: "bad_token" });
    expect(l.socket.status.kind).toBe("closed");
    l.clock.advance(60_000);
    expect(l.sockets).toHaveLength(1);
  });

  it("isn't said for an ordinary refusal", () => {
    const l = connected();
    l.last.say({ v: 1, t: "error", code: "not_ready" });
    expect(l.socket.status.kind).toBe("connected");
  });

  it("is the player's own: Leave says so to the room and stops", () => {
    const l = connected();
    const socket = l.last;
    l.socket.leave();
    expect(socket.messages.at(-1)).toEqual({ v: 1, t: "leave" });
    expect(socket.closed).toBe(true);
    expect(l.socket.status.kind).toBe("closed");
    l.clock.advance(60_000);
    l.wake();
    expect(l.sockets).toHaveLength(1);
  });

  it("stops everything when the page goes, and stops hearing of returns", () => {
    const l = connected();
    l.last.drop();
    l.socket.destroy();
    expect(l.listening).toBe(false);
    expect(l.clock.pending).toBe(0);
    l.clock.advance(60_000);
    expect(l.sockets).toHaveLength(1);
  });
});
