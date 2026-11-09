/**
 * A room, between its state machine and its Durable Object (ARCHITECTURE.md
 * §8, "1v1 rooms").
 *
 * The rules are the machine's (room.ts in @bt/core). This adds what the
 * machine is kept from: the stored state, the match's questions (dealt from
 * the deck under the match's seed, and never stored) and the messages
 * (room-render.ts). It knows nothing of sockets: every call takes the server's
 * time and returns `Delivery`s, which the Durable Object (room-do.ts) hands to
 * whoever is connected. So a whole match is played in Node against a memory
 * store, and the object stays a thin wrapper.
 *
 * The deal is rebuilt from the match's id whenever it isn't in memory (after
 * the object has slept), a few milliseconds' work: only the id is kept.
 */

import {
  DUEL_RULES,
  buildDuelRun,
  createRoom,
  roomStep,
  roomExpired,
  roomOccupied,
  roomWakeAt,
  seatOf,
} from "@bt/core";
import type {
  Player,
  QuestionFacts,
  Round,
  RoomClientMessage,
  RoomInput,
  RoomJoinRefusal,
  RoomOutput,
  RoomPeekResponse,
  RoomSettings,
  RoomState,
} from "@bt/core";
import { isCorrect } from "./payload.js";
import type { ImageLookup } from "./payload.js";
import type { RoomEvent } from "./room-analytics.js";
import { render } from "./room-render.js";
import type { Delivery } from "./room-render.js";
import { duelSeed } from "./seed.js";
import { verifyRoomToken } from "./token.js";
import type { RoomTokenPayload } from "./token.js";

/** What the events of a room are recorded with: facts about how it was made. */
export interface RoomMeta {
  /** The host's country, as the room was made; `XX` when unknown. */
  readonly country: string;
  readonly deckVersion: string;
}

/** A room as it is kept: the machine's state, and the meta beside it. */
export interface StoredRoom {
  readonly state: RoomState;
  readonly meta: RoomMeta;
}

/** Where a room is kept: the object's own SQLite (room-do.ts), or memory in tests. */
export interface RoomStore {
  read(): StoredRoom | undefined;
  write(room: StoredRoom): void;
  clear(): void;
}

export function memoryRoomStore(): RoomStore {
  let kept: string | undefined;
  return {
    // Through JSON, as the object's store is: a state that didn't survive it would show here.
    read: () => (kept === undefined ? undefined : (JSON.parse(kept) as StoredRoom)),
    write: (room) => {
      kept = JSON.stringify(room);
    },
    clear: () => {
      kept = undefined;
    },
  };
}

export interface RoomHostDeps {
  readonly deck: readonly Player[];
  readonly images: ImageLookup;
  readonly secret: string;
  readonly uuid: () => string;
  /** Must not throw. */
  readonly record?: (event: RoomEvent, meta: RoomMeta) => void;
}

/** A room to make: minted by the create handler (room.ts). */
export interface RoomToMake {
  readonly now: number;
  /** The room's own key, `YYYYMMDD-<uuid>`. */
  readonly key: string;
  readonly code: string;
  readonly settings: RoomSettings;
  readonly host: { readonly id: string; readonly name: string };
  readonly meta: RoomMeta;
}

export type JoinOutcome = (
  | {
      readonly ok: true;
      readonly seat: number;
      readonly key: string;
      readonly settings: RoomSettings;
    }
  | { readonly ok: false; readonly reason: RoomJoinRefusal }
) & {
  /** What the join told the room, or the goodbyes of a room it found expired. */
  readonly deliveries: Delivery[];
};

interface Stepped {
  readonly state: RoomState;
  readonly out: readonly RoomOutput[];
  readonly deliveries: Delivery[];
}

/** A match id, `YYYYMMDD-<uuid>`: its day is the deal's reference date, as a run id's is. */
const MATCH_ID = /^(\d{4})(\d{2})(\d{2})-/;

function dateOf(matchId: string): Date {
  const parts = MATCH_ID.exec(matchId);
  if (parts === null) return new Date(0);
  return new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])));
}

function dayStamp(now: number): string {
  const d = new Date(now);
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}${month}${day}`;
}

/** A fresh key for a room or a match: today's date (UTC) and a uuid. */
export function mintKey(now: number, uuid: string): string {
  return `${dayStamp(now)}-${uuid}`;
}

export class RoomHost {
  readonly #store: RoomStore;
  readonly #deps: RoomHostDeps;
  /** The deals in memory, by match id: the match in play, and one about to start. */
  readonly #deals = new Map<string, readonly Round[]>();

  constructor(store: RoomStore, deps: RoomHostDeps) {
    this.#store = store;
    this.#deps = deps;
  }

  /** The room as it stands, or undefined when there is none. */
  get state(): RoomState | undefined {
    return this.#store.read()?.state;
  }

  /**
   * When the room next needs a `tick`, or null when there is no room: a
   * question's deadline, a forfeit, or the room running out of time.
   */
  wakeAt(): number | null {
    const state = this.state;
    return state === undefined ? null : roomWakeAt(state);
  }

  /** The room believes someone is connected: something has to keep checking that they are. */
  get occupied(): boolean {
    const state = this.state;
    return state !== undefined && roomOccupied(state);
  }

  /** Makes the room. False when one is already here: the code is taken. */
  create(room: RoomToMake): boolean {
    if (this.#store.read() !== undefined) return false;
    const state = createRoom(
      { now: room.now, key: room.key, code: room.code, settings: room.settings, host: room.host },
      DUEL_RULES,
    );
    this.#store.write({ state, meta: room.meta });
    return true;
  }

  /** What an invite link opens on. Changes nothing. */
  peek(now: number): RoomPeekResponse {
    const state = this.state;
    if (state === undefined || state.phase === "closed") return { state: "closed" };
    // Out of time, the alarm not yet fired: as good as closed.
    if (roomExpired(state, now)) return { state: "closed" };
    const host = state.seats[0];
    const free = state.seats.some((s) => s === null);
    if (state.phase !== "lobby" || !free || host === null || host === undefined) {
      return { state: "full" };
    }
    return { state: "open", host: host.name, settings: state.settings };
  }

  async join(player: { id: string; name: string }, now: number): Promise<JoinOutcome> {
    const stepped = await this.#input({ type: "join", now, player });
    if (stepped === undefined) return { ok: false, reason: "closed", deliveries: [] };
    const { out, deliveries, state } = stepped;
    const joined = out.find((o) => o.type === "joined");
    if (joined?.type === "joined") {
      return { ok: true, seat: joined.seat, key: state.key, settings: state.settings, deliveries };
    }
    const refused = out.find((o) => o.type === "refused");
    const code = refused?.type === "refused" && state.phase !== "closed" ? refused.code : "closed";
    const reason = code === "full" || code === "name_taken" ? code : "closed";
    return { ok: false, reason, deliveries };
  }

  /**
   * The seat a verified token holds here, or undefined: another room's token,
   * a room that has gone, or a seat that isn't this player's any more.
   */
  seatFor(token: RoomTokenPayload): number | undefined {
    const state = this.state;
    if (state === undefined || state.key !== token.room) return undefined;
    return seatOf(state, token.player) === token.seat ? token.seat : undefined;
  }

  /**
   * The seat a `hello`'s token holds, or why it holds none: `bad_token` for a
   * token that isn't this room's (forged, edited, another room's, or a room
   * that once had this code), `unknown` when there is no room here at all,
   * `left` for a seat its player has given up.
   */
  async admit(token: string): Promise<number | "bad_token" | "unknown" | "left"> {
    const payload = await verifyRoomToken(this.#deps.secret, token);
    // Read after the check, which waits: the room as it is now.
    const state = this.state;
    if (state === undefined) return "unknown";
    if (payload === undefined || payload.room !== state.key) return "bad_token";
    return this.seatFor(payload) ?? "left";
  }

  connect(seat: number, now: number): Promise<Delivery[]> {
    return this.#send({ type: "connect", now, seat });
  }

  disconnect(seat: number, now: number): Promise<Delivery[]> {
    return this.#send({ type: "disconnect", now, seat });
  }

  /**
   * Brings the room's idea of who is connected into line with the sockets
   * there really are (`live`: the seats that have one). A socket can go
   * without a word reaching the room (a deploy drops them all), and a room
   * stays open while anyone is connected: a seat it only believes is here
   * would keep it open for ever.
   */
  async reconcile(live: ReadonlySet<number>, now: number): Promise<Delivery[]> {
    const out: Delivery[] = [];
    const seats = this.state?.seats ?? [];
    for (const [seat, player] of seats.entries()) {
      if (player === null || player.left || !player.connected || live.has(seat)) continue;
      out.push(...(await this.disconnect(seat, now)));
    }
    return out;
  }

  tick(now: number): Promise<Delivery[]> {
    return this.#send({ type: "tick", now });
  }

  /** A message from `seat`'s socket, already parsed. `hello` is the wrapper's: it names the seat. */
  message(seat: number, message: RoomClientMessage, now: number): Promise<Delivery[]> {
    switch (message.t) {
      case "ready":
        return this.#send({ type: "ready", now, seat, ready: message.ready });
      case "start":
        return this.#send({ type: "start", now, seat, match: mintKey(now, this.#deps.uuid()) });
      case "answer":
        return this.#send({ type: "answer", now, seat, index: message.q, pick: message.pick });
      case "rematch":
        return this.#send({ type: "rematch", now, seat, match: mintKey(now, this.#deps.uuid()) });
      case "leave":
        return this.#send({ type: "leave", now, seat });
      case "hello":
        return Promise.resolve([
          { kind: "send", seat, message: { v: 1, t: "error", code: "out_of_turn" } },
        ]);
    }
  }

  /** An input from a seat or the clock: what to send for it. */
  async #send(input: RoomInput): Promise<Delivery[]> {
    const stepped = await this.#input(input);
    if (stepped !== undefined) return stepped.deliveries;
    // No room here: a seat that asks is told so; the clock and a dropped socket have nobody to tell.
    if (input.type === "tick" || input.type === "disconnect" || input.type === "join") return [];
    return [{ kind: "close", seat: input.seat, reason: "unknown" }];
  }

  /**
   * One input, or undefined when there is no room. The questions it may need
   * are dealt first, which waits on the seed; then the room is read, stepped
   * and kept in one go, with nothing awaited in between, so two inputs that
   * arrive together can't both step from the same state.
   */
  async #input(input: RoomInput): Promise<Stepped | undefined> {
    for (;;) {
      const stored = this.#store.read();
      if (stored === undefined) return undefined;
      const { state } = stored;
      const wanted: string[] = [];
      if (state.match !== null && state.phase === "playing") wanted.push(state.match.id);
      if (input.type === "start" || input.type === "rematch") wanted.push(input.match);
      const missing = wanted.filter((id) => !this.#deals.has(id));
      if (missing.length === 0) return this.#step(stored, input);
      for (const id of missing) await this.#deal(id, state.settings);
    }
  }

  /** Runs the machine, keeps the state, renders and records. Nothing here waits. */
  #step(stored: StoredRoom, input: RoomInput): Stepped {
    const before = stored.state;
    const { settings } = before;
    const { state, out } = roomStep(before, input, {
      rules: DUEL_RULES,
      facts: (match, index) => this.#facts(match, index),
    });

    if (state.phase === "closed") this.#store.clear();
    else if (state !== before) this.#store.write({ state, meta: stored.meta });

    const matchId = state.match?.id;
    const deliveries = render(state, out, {
      now: input.now,
      images: this.#deps.images,
      rounds: matchId === undefined ? [] : (this.#deals.get(matchId) ?? []),
      date: matchId === undefined ? new Date(input.now) : dateOf(matchId),
    });

    for (const item of out) {
      if (item.type !== "record") continue;
      const { event } = item;
      this.#deps.record?.(
        event.kind === "start"
          ? { type: "start", room: state.key, settings, match: event.match }
          : {
              type: "end",
              room: state.key,
              settings,
              match: event.match,
              reason: event.reason,
              scores: event.scores,
              suddenDeath: event.suddenDeath,
            },
        stored.meta,
      );
    }
    // Only the match in play is worth keeping dealt.
    for (const id of this.#deals.keys()) if (id !== matchId) this.#deals.delete(id);
    return { state, out, deliveries };
  }

  /** The match's rounds, in memory: dealt from its id, the same every time. */
  async #deal(matchId: string, settings: RoomSettings): Promise<void> {
    if (this.#deals.has(matchId)) return;
    const seed = await duelSeed(this.#deps.secret, matchId, settings.pool);
    let rounds: Round[];
    try {
      rounds = buildDuelRun({
        deck: this.#deps.deck,
        seed,
        now: dateOf(matchId),
        pool: settings.pool,
        questions: settings.questions,
      });
    } catch {
      // A squad the deck no longer has: no questions, and the machine says so.
      rounds = [];
    }
    this.#deals.set(matchId, rounds);
  }

  /** Which way question `index` goes. All the machine is told about it. */
  #facts(matchId: string, index: number): QuestionFacts | undefined {
    const round = this.#deals.get(matchId)?.[index - 1];
    if (round === undefined) return undefined;
    return {
      answer: isCorrect(round, dateOf(matchId), "higher") ? "higher" : "lower",
      statChanged: round.statChanged,
    };
  }
}
