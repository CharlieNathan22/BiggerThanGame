/**
 * A player's seat, kept on the device (duel/session.ts), and what it is for:
 * opening the invite link again in a new tab, or after the browser killed the
 * tab, gives the player their own seat back rather than "This room is full".
 * The page's own flow is played here with the room's client (duel/client.ts)
 * over a fake socket; the real thing is checked in a browser.
 */

import { describe, expect, it } from "vitest";
import { DuelClient } from "../duel/client";
import type { DuelSnapshot } from "../duel/client";
import { createSeatStore, seatKey } from "../duel/session";
import { fakeStorage, link, lobby, players, welcome } from "./duel-helpers";
import type { Link } from "./duel-helpers";

/** A page: its own socket and room client, over storage that may be shared with another page. */
function page(storage = fakeStorage()): {
  readonly l: Link;
  readonly client: DuelClient;
  readonly storage: ReturnType<typeof fakeStorage>;
  readonly seats: ReturnType<typeof createSeatStore>;
  snapshot: DuelSnapshot;
} {
  const l = link();
  const seats = createSeatStore(storage.access);
  const self = {
    l,
    storage,
    seats,
    snapshot: undefined as unknown as DuelSnapshot,
    client: undefined as unknown as DuelClient,
  };
  self.client = new DuelClient({
    socket: l.socket,
    seats,
    now: () => l.clock.now,
    onChange: (snapshot) => (self.snapshot = snapshot),
  });
  self.snapshot = self.client.snapshot;
  return self;
}

describe("the seat store", () => {
  it("keeps the token in localStorage under bt:room:<code>", () => {
    const storage = fakeStorage();
    const seats = createSeatStore(storage.access);
    expect(seatKey("K7QM2X")).toBe("bt:room:K7QM2X");
    expect(seats.read("K7QM2X")).toBeNull();
    seats.save("K7QM2X", "token-a");
    expect(storage.items.get("bt:room:K7QM2X")).toBe("token-a");
    expect(seats.read("K7QM2X")).toBe("token-a");
    // One seat per room: another room's is its own.
    seats.save("B3DF9G", "token-b");
    expect(seats.read("K7QM2X")).toBe("token-a");
    expect(seats.read("B3DF9G")).toBe("token-b");
  });

  it("clears one room's seat and leaves the others", () => {
    const storage = fakeStorage();
    const seats = createSeatStore(storage.access);
    seats.save("K7QM2X", "token-a");
    seats.save("B3DF9G", "token-b");
    seats.clear("K7QM2X");
    expect(seats.read("K7QM2X")).toBeNull();
    expect(storage.items.has("bt:room:K7QM2X")).toBe(false);
    expect(seats.read("B3DF9G")).toBe("token-b");
  });

  it("is read by a new page over the same storage: another tab, or the same one reopened", () => {
    const storage = fakeStorage();
    createSeatStore(storage.access).save("K7QM2X", "token-a");
    expect(createSeatStore(storage.access).read("K7QM2X")).toBe("token-a");
  });

  it("lasts the visit, in memory, when storage is blocked, and never throws", () => {
    const storage = fakeStorage(true);
    const seats = createSeatStore(storage.access);
    expect(() => seats.read("K7QM2X")).not.toThrow();
    expect(seats.read("K7QM2X")).toBeNull();
    expect(() => seats.save("K7QM2X", "token-a")).not.toThrow();
    expect(seats.read("K7QM2X")).toBe("token-a");
    expect(() => seats.clear("K7QM2X")).not.toThrow();
    expect(seats.read("K7QM2X")).toBeNull();
    // A page that comes later has nothing to find: storage never took it.
    seats.save("K7QM2X", "token-a");
    expect(createSeatStore(storage.access).read("K7QM2X")).toBeNull();
    // No storage at all (a browser without it) is the same.
    const none = createSeatStore(() => null);
    none.save("K7QM2X", "token-a");
    expect(none.read("K7QM2X")).toBe("token-a");
  });

  it("ignores what isn't a token", () => {
    const storage = fakeStorage();
    const seats = createSeatStore(storage.access);
    storage.items.set("bt:room:K7QM2X", "");
    expect(seats.read("K7QM2X")).toBeNull();
    storage.items.set("bt:room:K7QM2X", "x".repeat(5000));
    expect(seats.read("K7QM2X")).toBeNull();
  });
});

describe("coming back to a room", () => {
  it("keeps the seat's token as the player takes the seat", () => {
    const p = page();
    p.client.enter("K7QM2X", "token-a");
    expect(p.storage.items.get("bt:room:K7QM2X")).toBe("token-a");
    expect(p.snapshot.code).toBe("K7QM2X");
  });

  it("restores the seat from a new tab: hello with the kept token, never a join", () => {
    const storage = fakeStorage();
    // The first tab: in the room's lobby, as the guest.
    const first = page(storage);
    first.client.enter("K7QM2X", "token-guest");
    first.l.last.open();
    first.l.last.say(welcome(1));
    expect(first.snapshot.view?.you).toBe(1);

    // The invite link again, in a new tab: the same storage, a new page.
    const second = page(storage);
    const kept = second.seats.read("K7QM2X");
    expect(kept).toBe("token-guest");
    second.client.enter("K7QM2X", kept!);
    second.l.last.open();
    // Straight in with the seat's own token: the room is never asked for a new seat.
    expect(second.l.last.messages).toEqual([{ v: 1, t: "hello", token: "token-guest" }]);
    second.l.last.say(welcome(1, lobby({ players: players([{}, { ready: true }]) })));
    expect(second.snapshot.view).toMatchObject({ you: 1, phase: "lobby", code: "K7QM2X" });
    expect(second.snapshot.closed).toBeNull();

    // The room gives the seat to the newer connection, and tells the older tab.
    first.l.last.say({ v: 1, t: "closed", reason: "replaced" });
    expect(first.snapshot.closed).toBe("replaced");
    // The seat is still the player's: the tab that has it now must keep its token.
    expect(storage.items.get("bt:room:K7QM2X")).toBe("token-guest");
    expect(second.seats.read("K7QM2X")).toBe("token-guest");
  });

  it("restores the seat after the browser killed the tab", () => {
    const storage = fakeStorage();
    const before = page(storage);
    before.client.enter("K7QM2X", "token-host");
    before.l.last.open();
    before.l.last.say(welcome(0));
    // The tab is killed: no goodbye, no clean-up, nothing.
    const after = page(storage);
    after.client.enter("K7QM2X", after.seats.read("K7QM2X")!);
    after.l.last.open();
    expect(after.l.last.messages).toEqual([{ v: 1, t: "hello", token: "token-host" }]);
    after.l.last.say(welcome(0));
    expect(after.snapshot.view?.you).toBe(0);
  });
});

describe("a seat that is over", () => {
  /** In the lobby as the guest, welcomed. */
  function seated(): ReturnType<typeof page> {
    const p = page();
    p.client.enter("K7QM2X", "token-guest");
    p.l.last.open();
    p.l.last.say(welcome(1));
    return p;
  }

  it("is cleared when the room closes", () => {
    for (const reason of ["expired", "host-left", "empty", "unknown"] as const) {
      const p = seated();
      p.l.last.say({ v: 1, t: "closed", reason });
      expect(p.snapshot.closed).toBe(reason);
      expect(p.seats.read("K7QM2X")).toBeNull();
      expect(p.storage.items.has("bt:room:K7QM2X")).toBe(false);
    }
  });

  it("is cleared when the player leaves", () => {
    const p = seated();
    p.client.leave();
    expect(p.l.sockets[0]!.messages.at(-1)).toEqual({ v: 1, t: "leave" });
    expect(p.seats.read("K7QM2X")).toBeNull();
    expect(p.snapshot).toMatchObject({ code: null, view: null, closed: null });
  });

  it("is cleared when the player forfeits", () => {
    const p = seated();
    // Away past the thirty seconds: the room has given the match to the other player.
    p.l.last.say({ v: 1, t: "closed", reason: "left" });
    expect(p.snapshot.closed).toBe("left");
    expect(p.seats.read("K7QM2X")).toBeNull();
  });

  it("is cleared when the room refuses the token, and the page can fall back to joining", () => {
    const p = page();
    p.storage.items.set("bt:room:K7QM2X", "token-from-an-old-room");
    p.client.enter("K7QM2X", p.seats.read("K7QM2X")!);
    p.l.last.open();
    p.l.last.say({ v: 1, t: "error", code: "bad_token" });
    expect(p.seats.read("K7QM2X")).toBeNull();
    expect(p.snapshot.closed).toBe("unknown");
    expect(p.snapshot.view).toBeNull();
    // Nothing reconnects with it.
    p.l.clock.advance(60_000);
    expect(p.l.sockets).toHaveLength(1);
    // Back to the setup, to look at the room afresh and join it.
    p.client.forget();
    expect(p.snapshot).toMatchObject({ code: null, view: null, closed: null });
  });

  it("is cleared when the room hangs up with no word", () => {
    const p = seated();
    p.l.last.drop(4000);
    expect(p.snapshot.closed).toBe("unknown");
    expect(p.seats.read("K7QM2X")).toBeNull();
  });

  it("is kept through a dropped connection: that is what it is for", () => {
    const p = seated();
    p.l.last.drop();
    expect(p.snapshot.link.kind).toBe("reconnecting");
    expect(p.seats.read("K7QM2X")).toBe("token-guest");
    p.l.clock.advance(400);
    p.l.last.open();
    expect(p.l.last.messages).toEqual([{ v: 1, t: "hello", token: "token-guest" }]);
  });

  it("plays the same with storage blocked: the seat lasts the visit", () => {
    const p = page(fakeStorage(true));
    expect(() => p.client.enter("K7QM2X", "token-a")).not.toThrow();
    p.l.last.open();
    p.l.last.say(welcome(0));
    expect(p.snapshot.view?.you).toBe(0);
    expect(p.seats.read("K7QM2X")).toBe("token-a");
    expect(() => p.l.last.say({ v: 1, t: "closed", reason: "expired" })).not.toThrow();
    expect(p.seats.read("K7QM2X")).toBeNull();
  });
});
