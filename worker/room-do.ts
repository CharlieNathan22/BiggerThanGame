/**
 * `RoomDO`: one Durable Object per multiplayer room (ARCHITECTURE.md §8, "1v1
 * rooms"), named by the room's code. Wiring only, as run-do.ts is: the rules
 * are the state machine's (room.ts in @bt/core), the dealing and the messages
 * are room-host.ts and room-render.ts, all tested in Node.
 *
 * A class of its own, not another table in `RunDO`: a room is reached by its
 * code rather than a run key, holds WebSockets, outlives any one match, and
 * its alarm means other things (a question's deadline, a dropped player's
 * time to come back, the idle expiry). It needs its own migration in
 * wrangler.toml (`v2`).
 *
 * **WebSockets with the hibernation API**, so a room that is only waiting
 * costs almost nothing: the object sleeps between messages, its sockets held
 * open by the platform, and the heartbeat (`ping` → `pong`) is answered
 * without waking it. What a socket is, it carries itself (its attachment):
 * its seat once its token has checked out, and when it was last heard from.
 *
 * **Nothing depends on a client being there.** The alarm is set to whatever
 * the room needs next (`RoomHost.wakeAt`), and to a sweep while anyone is
 * connected, which drops a socket that has gone quiet: a phone that lost its
 * signal never says goodbye. A room stays open while anyone is connected (up
 * to `ROOM_QUIET_MS` with nobody doing anything), so the sweep is also what
 * makes sure "connected" means a socket that is really there.
 *
 * SQLite-backed: one table, one row, the room as JSON. The deal is never
 * stored. Everything is deleted when the room closes.
 */

import { DurableObject } from "cloudflare:workers";
import { ROOM_CLOSE, ROOM_PING, ROOM_PONG, parseClientMessage } from "@bt/core";
import type {
  Player,
  RoomClosedReason,
  RoomErrorCode,
  RoomPeekResponse,
  RoomServerMessage,
} from "@bt/core";
import type { Env } from "./src/app.js";
import { DECK, IMAGES } from "./src/deck.js";
import { log } from "./src/log.js";
import type { ImageLookup } from "./src/payload.js";
import { roomDataPoint, roomLogLine } from "./src/room-analytics.js";
import type { RoomEvent } from "./src/room-analytics.js";
import type { RoomJoined } from "./src/room.js";
import { RoomHost } from "./src/room-host.js";
import type { RoomMeta, RoomStore, RoomToMake, StoredRoom } from "./src/room-host.js";
import type { Delivery } from "./src/room-render.js";

/**
 * How long the room goes, at most, between looks for sockets that have gone
 * quiet while anyone is connected. Every alarm looks, so a match, which has
 * one for each question's deadline and each rejoin window, looks sooner.
 */
const SWEEP_MS = 60_000;

/** Where the next sweep's time is kept, so a sleep doesn't lose it. */
const SWEEP_KEY = "sweepAt";

/** A socket not heard from for this long (no message, no heartbeat) is taken as gone. */
const STALE_MS = 20_000;

/** How long a new socket has to say `hello`. */
const HELLO_MS = 10_000;

/** A socket's messages are counted over this window... */
const BUDGET_WINDOW_MS = 10_000;
/** ...and past this many it is told to slow down, */
const BUDGET = 40;
/** and past this many, dropped. An honest page sends a handful. */
const BUDGET_CUT = 120;

/** What a socket carries about itself, across the object's sleep. */
interface Attachment {
  /** Its seat, once its `hello` has checked out. */
  seat?: number;
  /** When it connected, or said `hello`. */
  since: number;
  /** When it last sent a message. */
  heardAt: number;
  /** Messages in the current window, and when the window began. */
  count: number;
  windowAt: number;
  /** Already told goodbye: its closing changes nothing. */
  gone?: true;
}

export class RoomDO extends DurableObject<Env> {
  readonly #host: RoomHost;
  readonly #store: SqlRoomStore;
  /** When the next sweep is due, or null for none; undefined until read from storage. */
  #sweepAt: number | null | undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#store = sqlRoomStore(ctx.storage.sql);
    this.#host = new RoomHost(this.#store, {
      ...this.source(),
      secret: env.RUN_SECRET ?? "",
      uuid: () => crypto.randomUUID(),
      record: (event, meta) => this.#record(event, meta),
    });
    // The heartbeat: answered by the platform, without waking the room.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(ROOM_PING, ROOM_PONG));
  }

  /**
   * What a room deals from: the bundled deck and its photos. The test Worker
   * deals from its fixture instead (worker/test/entry.ts).
   */
  protected source(): { deck: readonly Player[]; images: ImageLookup } {
    return { deck: DECK, images: IMAGES };
  }

  // ------------------------------------------------------------- the lobby's door

  /** Makes the room. False when this code already has one. */
  async create(room: RoomToMake): Promise<boolean> {
    const made = this.#host.create(room);
    if (made) await this.#schedule();
    return made;
  }

  async join(player: { id: string; name: string }, now: number): Promise<RoomJoined> {
    const joined = await this.#host.join(player, now);
    this.#deliver(joined.deliveries);
    await this.#schedule();
    if (!joined.ok) return { ok: false, reason: joined.reason };
    return { ok: true, seat: joined.seat, key: joined.key, settings: joined.settings };
  }

  async peek(now: number): Promise<RoomPeekResponse> {
    const seen = this.#host.peek(now);
    // Looking at a code nobody holds must leave nothing behind.
    if (this.#host.state === undefined) await this.#schedule();
    return seen;
  }

  // ------------------------------------------------------------------ sockets

  /** The WebSocket upgrade (`GET /api/room/ws`, app.ts). The seat comes with `hello`. */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response(null, { status: 426, headers: { upgrade: "websocket" } });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const now = Date.now();
    if (this.#host.state === undefined) {
      // No such room. A page can't read a refused upgrade's status, so it is told in words.
      server.accept();
      this.#goodbye(server, "unknown");
      await this.#schedule();
      return new Response(null, { status: 101, webSocket: client });
    }
    this.ctx.acceptWebSocket(server);
    this.#attach(server, { since: now, heardAt: now, count: 0, windowAt: now });
    await this.#schedule();
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const now = Date.now();
    const socket = this.#read(ws);
    if (socket === undefined || socket.gone === true) return;

    if (now - socket.windowAt > BUDGET_WINDOW_MS) {
      socket.windowAt = now;
      socket.count = 0;
    }
    socket.count += 1;
    socket.heardAt = now;
    this.#attach(ws, socket);
    if (socket.count > BUDGET_CUT) return this.#refuse(ws, "slow_down");
    if (socket.count > BUDGET) return this.#send(ws, { v: 1, t: "error", code: "slow_down" });

    const message = parseClientMessage(raw);
    if (message === undefined) {
      // A stranger talking nonsense is dropped; a seated player's bad message is only refused.
      if (socket.seat === undefined) return this.#refuse(ws, "bad_message");
      return this.#send(ws, { v: 1, t: "error", code: "bad_message" });
    }

    let deliveries: Delivery[];
    if (socket.seat === undefined) {
      if (message.t !== "hello") return this.#refuse(ws, "bad_token");
      const seat = await this.#host.admit(message.token);
      if (typeof seat !== "number") {
        if (seat === "bad_token") return this.#refuse(ws, "bad_token");
        return this.#goodbye(ws, seat);
      }
      // Read again: the check above waited, and the socket may have closed meanwhile.
      const fresh = this.#read(ws);
      if (fresh === undefined || fresh.gone === true) return;
      // One connection a seat: the newer one has it.
      for (const other of this.#sockets(seat)) if (other !== ws) this.#goodbye(other, "replaced");
      this.#attach(ws, { ...fresh, seat, since: now });
      deliveries = await this.#host.connect(seat, now);
    } else {
      deliveries = await this.#host.message(socket.seat, message, now);
    }
    this.#deliver(deliveries);
    await this.#schedule();
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, reason);
    } catch {
      // Already closed.
    }
    await this.#dropped(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.#dropped(ws);
  }

  /** A socket has gone: its seat is away, unless another of its connections is still up. */
  async #dropped(ws: WebSocket): Promise<void> {
    const socket = this.#read(ws);
    if (socket === undefined || socket.gone === true || socket.seat === undefined) return;
    this.#attach(ws, { ...socket, gone: true });
    if (this.#sockets(socket.seat).some((other) => other !== ws)) return;
    this.#deliver(await this.#host.disconnect(socket.seat, Date.now()));
    await this.#schedule();
  }

  // -------------------------------------------------------------------- alarm

  override async alarm(): Promise<void> {
    await this.onAlarm(Date.now());
  }

  /**
   * The alarm's work: drop the sockets that have gone quiet, then let the room
   * catch up with the clock as at `now`. Apart from `alarm` so the workerd
   * tests can run it at a chosen moment (worker/test/entry.ts) instead of
   * waiting it out; the sweep always goes by the real clock.
   */
  protected async onAlarm(now: number): Promise<void> {
    const real = Date.now();
    const away = new Set<number>();
    for (const ws of this.ctx.getWebSockets()) {
      const socket = this.#read(ws);
      if (socket === undefined || socket.gone === true) continue;
      if (socket.seat === undefined) {
        if (real - socket.since > HELLO_MS) this.#refuse(ws, "bad_token");
        continue;
      }
      const pinged = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0;
      if (real - Math.max(socket.since, socket.heardAt, pinged) <= STALE_MS) continue;
      this.#attach(ws, { ...socket, gone: true });
      try {
        ws.close(ROOM_CLOSE.refused, "stale");
      } catch {
        // Already closed.
      }
      away.add(socket.seat);
    }
    for (const seat of away) {
      if (this.#sockets(seat).length === 0) this.#deliver(await this.#host.disconnect(seat, real));
    }
    // And any seat the room believes is here with no socket at all.
    this.#deliver(await this.#host.reconcile(this.#live(), real));
    this.#deliver(await this.#host.tick(now));
    await this.#schedule(true);
  }

  /**
   * When the sweep is next due, or null with nobody to look for. It keeps its
   * own time: set when a sweep first becomes needed and again by each alarm
   * (`swept`), and never by the messages and connections in between. Counted
   * from those instead, a room that is never quiet for a whole `SWEEP_MS`
   * would put its sweep off for ever.
   */
  async #sweep(needed: boolean, swept: boolean): Promise<number | null> {
    if (this.#sweepAt === undefined) {
      this.#sweepAt = (await this.ctx.storage.get<number>(SWEEP_KEY)) ?? null;
    }
    const kept = swept ? null : this.#sweepAt;
    const next = needed ? (kept ?? Date.now() + SWEEP_MS) : null;
    if (next !== this.#sweepAt) {
      this.#sweepAt = next;
      if (next === null) await this.ctx.storage.delete(SWEEP_KEY);
      else await this.ctx.storage.put(SWEEP_KEY, next);
    }
    return next;
  }

  /**
   * The alarm, set to what the room needs next and to the next sweep; or
   * everything deleted. `swept` when an alarm has just run: the sweep's time
   * starts again from there.
   */
  async #schedule(swept = false): Promise<void> {
    const sockets = this.ctx.getWebSockets().length;
    if (this.#host.state === undefined) {
      // The room has closed (or was never made): nothing is kept.
      if (sockets === 0) {
        await this.ctx.storage.deleteAlarm();
        await this.ctx.storage.deleteAll();
        this.#store.reset();
        this.#sweepAt = null;
        return;
      }
      await this.ctx.storage.setAlarm((await this.#sweep(true, swept)) ?? Date.now() + SWEEP_MS);
      return;
    }
    // Whatever the room needs next (a deadline, a forfeit, its expiry), or the sweep if
    // that comes first: with a socket open, or a seat the room believes is connected,
    // the sweep is what notices them go. Every alarm sweeps, so a match's own alarms
    // do it more often than this.
    let at = this.#host.wakeAt() ?? Infinity;
    const sweep = await this.#sweep(sockets > 0 || this.#host.occupied, swept);
    if (sweep !== null) at = Math.min(at, sweep);
    if (Number.isFinite(at)) await this.ctx.storage.setAlarm(at);
    else await this.ctx.storage.deleteAlarm();
  }

  // ----------------------------------------------------------------- delivery

  /** The seats that have a live socket. */
  #live(): Set<number> {
    const seats = new Set<number>();
    for (const ws of this.ctx.getWebSockets()) {
      const socket = this.#read(ws);
      if (socket !== undefined && socket.gone !== true && socket.seat !== undefined) {
        seats.add(socket.seat);
      }
    }
    return seats;
  }

  /** The live sockets of `seat`. */
  #sockets(seat: number): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => {
      const socket = this.#read(ws);
      return socket !== undefined && socket.gone !== true && socket.seat === seat;
    });
  }

  #deliver(deliveries: readonly Delivery[]): void {
    for (const delivery of deliveries) {
      if (delivery.kind === "send") {
        for (const ws of this.#sockets(delivery.seat)) this.#send(ws, delivery.message);
        continue;
      }
      const targets =
        delivery.seat === "all"
          ? this.ctx.getWebSockets().filter((ws) => this.#read(ws)?.gone !== true)
          : this.#sockets(delivery.seat);
      for (const ws of targets) this.#goodbye(ws, delivery.reason);
    }
  }

  #send(ws: WebSocket, message: RoomServerMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // A socket that has just gone: its close will say so.
    }
  }

  /** The room is closed for this socket: say why, and hang up. */
  #goodbye(ws: WebSocket, reason: RoomClosedReason): void {
    const socket = this.#read(ws);
    if (socket !== undefined) this.#attach(ws, { ...socket, gone: true });
    this.#send(ws, { v: 1, t: "closed", reason });
    try {
      ws.close(reason === "replaced" ? ROOM_CLOSE.replaced : ROOM_CLOSE.closed, reason);
    } catch {
      // Already closed.
    }
  }

  /** Not a client of ours, or one that won't stop: an error, and the door. */
  #refuse(ws: WebSocket, code: RoomErrorCode): void {
    const socket = this.#read(ws);
    if (socket !== undefined) this.#attach(ws, { ...socket, gone: true });
    this.#send(ws, { v: 1, t: "error", code });
    try {
      ws.close(ROOM_CLOSE.refused, code);
    } catch {
      // Already closed.
    }
    // A seated player dropped for flooding is away, like any other dropped socket.
    if (socket?.seat !== undefined && socket.gone !== true) {
      const { seat } = socket;
      if (this.#sockets(seat).length === 0) {
        void this.#host.disconnect(seat, Date.now()).then((deliveries) => {
          this.#deliver(deliveries);
          return this.#schedule();
        });
      }
    }
  }

  #read(ws: WebSocket): Attachment | undefined {
    try {
      const value = ws.deserializeAttachment() as Attachment | null;
      return value ?? undefined;
    } catch {
      return undefined;
    }
  }

  #attach(ws: WebSocket, socket: Attachment): void {
    try {
      ws.serializeAttachment(socket);
    } catch {
      // A socket accepted without hibernation (the goodbye to a room that isn't there).
    }
  }

  /** A match's start or end, logged and recorded. Never throws. */
  #record(event: RoomEvent, meta: RoomMeta): void {
    try {
      log(roomLogLine(event, meta, "room-do"));
      this.env.GAME_EVENTS?.writeDataPoint(roomDataPoint(event, meta));
    } catch {
      // Telemetry is never worth a failed message.
    }
  }
}

interface SqlRoomStore extends RoomStore {
  /** After `deleteAll`: the table is gone, and is made again when next needed. */
  reset(): void;
}

/** The room's store: one row, the whole room (state and meta) as JSON. */
function sqlRoomStore(sql: SqlStorage): SqlRoomStore {
  let ready = false;
  const table = (): void => {
    if (ready) return;
    sql.exec(
      "CREATE TABLE IF NOT EXISTS room (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL)",
    );
    ready = true;
  };
  return {
    read() {
      table();
      const row = sql.exec<{ data: string }>("SELECT data FROM room WHERE id = 1").toArray()[0];
      return row === undefined ? undefined : (JSON.parse(row.data) as StoredRoom);
    },
    write(room) {
      table();
      sql.exec(
        "INSERT INTO room (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
        JSON.stringify(room),
      );
    },
    clear() {
      table();
      sql.exec("DELETE FROM room");
    },
    reset() {
      ready = false;
    },
  };
}
