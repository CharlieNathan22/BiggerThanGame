/**
 * A 1v1 room's connection: one WebSocket to the room (ARCHITECTURE.md §8,
 * "1v1 rooms"), kept up for as long as the room is there.
 *
 * - **`hello` first.** Every connection opens with the seat's token; the room
 *   answers with a `welcome`, and only then is the connection `connected`.
 * - **It reconnects by itself**, with a short backoff (`RECONNECT`), for as
 *   long as the room hasn't said goodbye. In the lobby and at full time there
 *   is no limit: a player away keeps their seat. In a match the room gives a
 *   dropped player thirty seconds, which the page counts down from `since`;
 *   the socket itself keeps trying either way, and learns from the room if it
 *   was too late.
 * - **It reconnects at once when the player comes back**: the page becoming
 *   visible again, or the browser coming back online (`wake`), cancels any
 *   wait and connects straight away. A phone returning from another app is
 *   the usual case: the socket it left may be dead without having said so, so
 *   on waking a connected socket is probed, and dropped and reopened if the
 *   room doesn't answer.
 * - **A heartbeat** (`ping`, answered `pong` by the platform without waking
 *   the room) finds a connection that has died quietly, and tells the room
 *   this player is still there.
 * - **A goodbye is final.** A `closed` message, or the room's own close codes,
 *   end it: no reconnect. So does `leave` and `destroy`.
 *
 * The socket, the timers, the clock, the randomness and the page's events are
 * injected, so the tests drive it with a fake socket.
 */

import { ROOM_CLOSE, ROOM_PING, ROOM_PONG } from "@bt/core";
import type { RoomClientMessage, RoomServerMessage } from "@bt/core";

/** Reconnect delays: the first, doubling each time, up to the most; ±20% jitter on each. */
export const RECONNECT = { firstMs: 400, maxMs: 4000, jitter: 0.2 } as const;

/** How often the heartbeat goes. */
export const PING_EVERY_MS = 5000;

/** A connection that hasn't been heard from for this long has died quietly. */
export const SILENT_AFTER_MS = 12_000;

/** On waking, how long the room has to answer a probe before the socket is replaced. */
export const WAKE_PROBE_MS = 2000;

/** How long a new socket has to open and be welcomed before it is given up on. */
export const OPEN_TIMEOUT_MS = 8000;

/**
 * On waking, a connection attempt older than this is abandoned for a fresh
 * one: it was begun while the player was away, on a network that may be gone.
 * A younger one is left to finish, so one return never opens two.
 */
export const STALE_ATTEMPT_MS = 1000;

/** The part of a `WebSocket` the connection uses. */
export interface RoomSocketLike {
  send(data: string): void;
  close(code?: number): void;
  onopen: (() => void) | null;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onclose: ((event: { readonly code?: number }) => void) | null;
  onerror: (() => void) | null;
}

export type LinkStatus =
  | { readonly kind: "idle" }
  /** The first connection to this room, not yet welcomed. */
  | { readonly kind: "connecting" }
  | { readonly kind: "connected" }
  /** Dropped at `since` (the injected clock), and trying again. */
  | { readonly kind: "reconnecting"; readonly since: number; readonly attempt: number }
  /** Over: the room said goodbye, or the player left. */
  | { readonly kind: "closed" };

export interface RoomSocketDeps {
  readonly socket: (url: string) => RoomSocketLike;
  /** The room's WebSocket address for a code. */
  readonly url: (code: string) => string;
  /** Runs `fn` after `ms`; returns a cancel function. */
  readonly schedule: (fn: () => void, ms: number) => () => void;
  /** Milliseconds, for the heartbeat and `since`. */
  readonly now: () => number;
  /** In [0, 1): the jitter. */
  readonly random: () => number;
  /**
   * Calls `wake` when the player comes back: the page visible again, or the
   * browser online again. Returns an unsubscribe.
   */
  readonly onWake?: (wake: () => void) => () => void;
}

/** The delay before reconnect attempt `attempt` (0-based), with `random` in [0, 1) for jitter. */
export function reconnectDelay(attempt: number, random: number): number {
  const base = Math.min(RECONNECT.firstMs * 2 ** attempt, RECONNECT.maxMs);
  return Math.round(base * (1 - RECONNECT.jitter + 2 * RECONNECT.jitter * random));
}

/** Close codes after which the room is not to be tried again. */
const FINAL_CODES: readonly number[] = [ROOM_CLOSE.closed, ROOM_CLOSE.replaced, ROOM_CLOSE.refused];

export class RoomSocket {
  readonly #deps: RoomSocketDeps;
  readonly #messages = new Set<(message: RoomServerMessage) => void>();
  readonly #statuses = new Set<(status: LinkStatus) => void>();
  #status: LinkStatus = { kind: "idle" };
  #socket: RoomSocketLike | null = null;
  #code = "";
  #token = "";
  /** Failed attempts in a row since the last welcome. */
  #attempt = 0;
  /** Bumped on every open and shut: a stale socket's events are ignored. */
  #generation = 0;
  #cancelRetry: (() => void) | null = null;
  #cancelBeat: (() => void) | null = null;
  #cancelProbe: (() => void) | null = null;
  #cancelOpen: (() => void) | null = null;
  #unwake: (() => void) | null = null;
  /** When the room was last heard from on the socket in use. */
  #heardAt = 0;
  /** When the socket in use was opened. */
  #openedAt = 0;

  constructor(deps: RoomSocketDeps) {
    this.#deps = deps;
  }

  get status(): LinkStatus {
    return this.#status;
  }

  /** Every message from the room. Returns an unsubscribe. */
  onMessage(listener: (message: RoomServerMessage) => void): () => void {
    this.#messages.add(listener);
    return () => this.#messages.delete(listener);
  }

  /** Every change of status, starting with the current one. Returns an unsubscribe. */
  onStatus(listener: (status: LinkStatus) => void): () => void {
    this.#statuses.add(listener);
    listener(this.#status);
    return () => this.#statuses.delete(listener);
  }

  /** Connects to the room with this code as the seat `token` holds, leaving any other first. */
  connect(code: string, token: string): void {
    this.#shut();
    this.#code = code;
    this.#token = token;
    this.#attempt = 0;
    this.#unwake ??= this.#deps.onWake?.(() => this.wake()) ?? null;
    this.#setStatus({ kind: "connecting" });
    this.#open();
  }

  /** Sends a message, if the room is listening. False when it isn't: nothing is queued. */
  send(message: RoomClientMessage): boolean {
    if (this.#status.kind !== "connected" || this.#socket === null) return false;
    try {
      this.#socket.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * The player is back (the page visible, the browser online): no more
   * waiting. A connection that is down is tried at once; one that looks up is
   * probed, and replaced if the room doesn't answer.
   */
  wake(): void {
    const { kind } = this.#status;
    if (kind === "reconnecting" || kind === "connecting") {
      this.#cancelRetry?.();
      this.#cancelRetry = null;
      if (this.#socket === null) {
        this.#open();
        return;
      }
      // A socket still on its way: left to finish if it was only just begun (a
      // second one would race it), replaced if it dates from before the return.
      if (this.#deps.now() - this.#openedAt < STALE_ATTEMPT_MS) return;
      this.#shut();
      this.#open();
      return;
    }
    if (kind !== "connected" || this.#socket === null) return;
    const generation = this.#generation;
    const asked = this.#deps.now();
    this.#ping();
    this.#cancelProbe?.();
    this.#cancelProbe = this.#deps.schedule(() => {
      this.#cancelProbe = null;
      if (generation !== this.#generation) return;
      // Nothing since the probe: the socket is dead and hasn't said so.
      if (this.#heardAt < asked) this.#replace();
    }, WAKE_PROBE_MS);
  }

  /** Leaves the room for good: says so if it can, and stops. */
  leave(): void {
    this.send({ v: 1, t: "leave" });
    this.#finish();
  }

  /** Stops everything, without a word to the room: the page is going. */
  destroy(): void {
    this.#finish();
    this.#unwake?.();
    this.#unwake = null;
    this.#messages.clear();
    this.#statuses.clear();
  }

  #open(): void {
    const generation = ++this.#generation;
    let socket: RoomSocketLike;
    try {
      socket = this.#deps.socket(this.#deps.url(this.#code));
    } catch {
      this.#dropped(generation);
      return;
    }
    this.#socket = socket;
    this.#openedAt = this.#deps.now();
    this.#cancelOpen?.();
    this.#cancelOpen = this.#deps.schedule(() => {
      this.#cancelOpen = null;
      // Never opened, or never welcomed: as good as dropped, and tried again after a wait.
      if (generation === this.#generation && this.#status.kind !== "connected") {
        this.#dropped(generation);
      }
    }, OPEN_TIMEOUT_MS);
    socket.onopen = () => {
      if (generation !== this.#generation) return;
      this.#heardAt = this.#deps.now();
      try {
        socket.send(JSON.stringify({ v: 1, t: "hello", token: this.#token }));
      } catch {
        // Its close follows.
      }
    };
    socket.onmessage = (event) => {
      if (generation !== this.#generation || typeof event.data !== "string") return;
      this.#heardAt = this.#deps.now();
      if (event.data === ROOM_PONG) return;
      let message: RoomServerMessage;
      try {
        message = JSON.parse(event.data) as RoomServerMessage;
      } catch {
        return;
      }
      if (typeof message !== "object" || message === null || message.v !== 1) return;
      if (message.t === "welcome") {
        this.#attempt = 0;
        this.#cancelOpen?.();
        this.#cancelOpen = null;
        this.#setStatus({ kind: "connected" });
        this.#beat(generation);
      }
      for (const listener of this.#messages) listener(message);
      // A goodbye, or a token the room won't have: there is nothing to come back to.
      if (message.t === "closed" || (message.t === "error" && message.code === "bad_token")) {
        this.#finish();
      }
    };
    socket.onclose = (event) => {
      if (generation !== this.#generation) return;
      if (event.code !== undefined && FINAL_CODES.includes(event.code)) {
        this.#finish();
        return;
      }
      this.#dropped(generation);
    };
    // A close always follows an error; that's where it's handled.
    socket.onerror = () => {};
  }

  /** The heartbeat, while this socket is the one in use. */
  #beat(generation: number): void {
    this.#cancelBeat?.();
    this.#cancelBeat = this.#deps.schedule(() => {
      this.#cancelBeat = null;
      if (generation !== this.#generation) return;
      if (this.#deps.now() - this.#heardAt > SILENT_AFTER_MS) {
        this.#replace();
        return;
      }
      this.#ping();
      this.#beat(generation);
    }, PING_EVERY_MS);
  }

  #ping(): void {
    try {
      this.#socket?.send(ROOM_PING);
    } catch {
      // Its close follows.
    }
  }

  /** The socket in use is no good: drop it and open another, now. */
  #replace(): void {
    const since = this.#status.kind === "reconnecting" ? this.#status.since : this.#deps.now();
    this.#shut();
    this.#setStatus({ kind: "reconnecting", since, attempt: this.#attempt });
    this.#open();
  }

  /** The socket closed without a goodbye: wait a little, then try again. */
  #dropped(generation: number): void {
    if (generation !== this.#generation) return;
    const since = this.#status.kind === "reconnecting" ? this.#status.since : this.#deps.now();
    this.#shut();
    const attempt = this.#attempt++;
    this.#setStatus({ kind: "reconnecting", since, attempt });
    this.#cancelRetry = this.#deps.schedule(
      () => {
        this.#cancelRetry = null;
        this.#open();
      },
      reconnectDelay(attempt, this.#deps.random()),
    );
  }

  /** Closes the socket in use and stops its timers. Its events are ignored from here. */
  #shut(): void {
    this.#generation++;
    for (const cancel of [
      this.#cancelRetry,
      this.#cancelBeat,
      this.#cancelProbe,
      this.#cancelOpen,
    ]) {
      cancel?.();
    }
    this.#cancelRetry = this.#cancelBeat = this.#cancelProbe = this.#cancelOpen = null;
    const socket = this.#socket;
    this.#socket = null;
    if (socket === null) return;
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
    try {
      socket.close();
    } catch {
      // Already closed.
    }
  }

  #finish(): void {
    this.#shut();
    if (this.#status.kind !== "idle") this.#setStatus({ kind: "closed" });
  }

  #setStatus(status: LinkStatus): void {
    this.#status = status;
    for (const listener of this.#statuses) listener(status);
  }
}
