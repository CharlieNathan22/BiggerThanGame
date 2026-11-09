/**
 * Scaffolding for 1v1's tests (room.ts, room-host.ts): a room per code held in
 * memory where its Durable Object would be, a clock the test moves by hand,
 * Turnstile that says what it's told, and sockets that are only inboxes. The
 * `Table` does what room-do.ts does with a real socket: a `hello` is checked
 * by the host (`admit`), messages go in, deliveries come out to the seats
 * connected. Runs in Node; the real object and real WebSockets are exercised
 * under workerd (workerd.test.ts).
 */

import { ROOM_CODE_ALPHABET, parseClientMessage, roomWakeAt, valueOf } from "@bt/core";
import type {
  DuelLimit,
  DuelPool,
  Guess,
  Player,
  RoomClientMessage,
  RoomClosedReason,
  RoomQuestion,
  RoomSeatResponse,
  RoomServerMessage,
  TimedGuess,
} from "@bt/core";
import { handleRoomCreate, handleRoomJoin } from "../room.js";
import type { RoomContext, RoomResult } from "../room.js";
import type { RoomEvent } from "../room-analytics.js";
import { RoomHost, memoryRoomStore } from "../room-host.js";
import type { RoomMeta } from "../room-host.js";
import type { Delivery } from "../room-render.js";
import type { TurnstileOutcome } from "../turnstile.js";
import { SAMPLE_DECK, SECRET, TODAY, uuidFrom, wrongGuess } from "./helpers.js";

/** A message as it reached a seat, in the order the room sent them. */
export interface Sent {
  readonly code: string;
  readonly seat: number;
  readonly message: RoomServerMessage;
}

/** One room, as its Durable Object would hold it: the host, and who is connected. */
export class Table {
  readonly host: RoomHost;
  /** The seats with a socket up. */
  readonly connected = new Set<number>();
  /** Why a seat's socket was closed by the room, if it was. */
  readonly closed = new Map<number, RoomClosedReason>();
  /** Everything sent, to anyone, in order. */
  readonly sent: Sent[] = [];

  constructor(
    readonly code: string,
    private readonly h: RoomHarness,
  ) {
    this.host = new RoomHost(memoryRoomStore(), {
      deck: h.ctx.deck,
      images: h.images,
      secret: h.ctx.secret,
      uuid: h.ctx.uuid,
      record: (event, meta) => {
        h.events.push(event);
        h.metas.push(meta);
      },
    });
  }

  deliver(deliveries: readonly Delivery[]): void {
    for (const delivery of deliveries) {
      if (delivery.kind === "send") {
        if (!this.connected.has(delivery.seat)) continue;
        this.sent.push({ code: this.code, seat: delivery.seat, message: delivery.message });
        continue;
      }
      const seats = delivery.seat === "all" ? [...this.connected] : [delivery.seat];
      for (const seat of seats) {
        if (!this.connected.has(seat)) continue;
        this.sent.push({
          code: this.code,
          seat,
          message: { v: 1, t: "closed", reason: delivery.reason },
        });
        this.connected.delete(seat);
        this.closed.set(seat, delivery.reason);
      }
    }
  }

  /** A socket's `hello`: the seat it gets, or why it gets none. */
  async hello(token: string): Promise<number | "bad_token" | "unknown" | "left"> {
    const seat = await this.host.admit(token);
    if (typeof seat !== "number") return seat;
    this.connected.add(seat);
    this.closed.delete(seat);
    this.deliver(await this.host.connect(seat, this.h.now));
    return seat;
  }

  /** A message from `seat`'s socket, through the strict parser, as the object reads it. */
  async say(seat: number, message: RoomClientMessage | Record<string, unknown>): Promise<void> {
    const parsed = parseClientMessage(JSON.stringify(message));
    if (parsed === undefined) {
      this.sent.push({ code: this.code, seat, message: { v: 1, t: "error", code: "bad_message" } });
      return;
    }
    this.deliver(await this.host.message(seat, parsed, this.h.now));
  }

  /** The seat's socket drops. */
  async drop(seat: number): Promise<void> {
    this.connected.delete(seat);
    this.deliver(await this.host.disconnect(seat, this.h.now));
  }

  async tick(): Promise<void> {
    this.deliver(await this.host.tick(this.h.now));
  }

  /** The alarm, when the room asks for it. */
  async alarm(): Promise<void> {
    const state = this.host.state;
    const at = state === undefined ? null : roomWakeAt(state);
    if (at === null) throw new Error("no alarm set");
    this.h.now = Math.max(this.h.now, at);
    await this.tick();
  }

  /** What `seat` has been sent since `from`. */
  inbox(seat: number, from = 0): RoomServerMessage[] {
    return this.sent
      .slice(from)
      .filter((s) => s.seat === seat)
      .map((s) => s.message);
  }

  /** The last message of type `t` sent to `seat`. */
  last<T extends RoomServerMessage["t"]>(
    seat: number,
    t: T,
  ): Extract<RoomServerMessage, { t: T }> | undefined {
    const found = this.inbox(seat)
      .filter((m) => m.t === t)
      .at(-1);
    return found as Extract<RoomServerMessage, { t: T }> | undefined;
  }
}

export interface RoomHarness {
  readonly ctx: RoomContext;
  readonly images: Record<string, { key: string; width: number; height: number }>;
  readonly tables: Map<string, Table>;
  readonly events: RoomEvent[];
  readonly metas: RoomMeta[];
  /** Codes the next rooms get, in order; after them, codes count up. */
  readonly codes: string[];
  now: number;
  wait(ms: number): void;
  turnstile: TurnstileOutcome;
  table(code: string): Table;
}

/** The bytes that `roomCodeFrom` turns into `code`. */
export function bytesFor(code: string): Uint8Array {
  return Uint8Array.from([...code].map((c) => ROOM_CODE_ALPHABET.indexOf(c)));
}

function codeNumber(n: number): string {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code = ROOM_CODE_ALPHABET[n % ROOM_CODE_ALPHABET.length]! + code;
    n = Math.floor(n / ROOM_CODE_ALPHABET.length);
  }
  return code;
}

export function roomHarness(
  overrides: Partial<RoomContext> & { images?: RoomHarness["images"] } = {},
): RoomHarness {
  const { images = {}, ...context } = overrides;
  const tables = new Map<string, Table>();
  const events: RoomEvent[] = [];
  let ids = 0;
  let made = 0;
  const h: RoomHarness = {
    tables,
    events,
    metas: [],
    images,
    codes: [],
    now: TODAY.getTime(),
    wait(ms) {
      h.now += ms;
    },
    turnstile: "pass",
    table(code) {
      let table = tables.get(code);
      if (table === undefined) tables.set(code, (table = new Table(code, h)));
      return table;
    },
    ctx: undefined as unknown as RoomContext,
  };
  (h as { ctx: RoomContext }).ctx = {
    deck: SAMPLE_DECK,
    secret: SECRET,
    clock: () => new Date(h.now),
    uuid: () => uuidFrom(++ids),
    randomBytes: () => bytesFor(h.codes.shift() ?? codeNumber(1000 + made++)),
    verifyTurnstile: async () => h.turnstile,
    rooms: (code) => ({
      create: async (room) => h.table(code).host.create(room),
      join: async (player, now) => {
        const table = h.table(code);
        const joined = await table.host.join(player, now);
        table.deliver(joined.deliveries);
        if (!joined.ok) return { ok: false, reason: joined.reason };
        return { ok: true, seat: joined.seat, key: joined.key, settings: joined.settings };
      },
      peek: async (now) => h.table(code).host.peek(now),
    }),
    moderate: () => true,
    record: (event) => events.push(event),
    country: "GB",
    deckVersion: "legends-test",
    ...context,
  };
  return h;
}

export function createBody(
  pool: DuelPool = "endless",
  questions: 10 | 20 = 10,
  limit: DuelLimit = 20,
  name = "Ada",
): Record<string, unknown> {
  return { pool, questions, limit, name, turnstileToken: "turnstile-token" };
}

export function joinBody(code: string, name = "Sam"): Record<string, unknown> {
  return { code, name, turnstileToken: "turnstile-token" };
}

function seatOk(result: RoomResult): RoomSeatResponse {
  if (result.status !== 200) throw new Error(`refused: ${JSON.stringify(result.body)}`);
  return result.body as RoomSeatResponse;
}

export interface OpenRoom {
  readonly code: string;
  readonly table: Table;
  /** By seat: the host's token, then the guest's. */
  readonly tokens: readonly [string, string];
}

/** A room made and joined, both players connected. Not yet ready. */
export async function openRoom(
  h: RoomHarness,
  opts: { pool?: DuelPool; questions?: 10 | 20; limit?: DuelLimit } = {},
): Promise<OpenRoom> {
  const made = seatOk(
    await handleRoomCreate(createBody(opts.pool, opts.questions, opts.limit), h.ctx),
  );
  const joined = seatOk(await handleRoomJoin(joinBody(made.code), h.ctx));
  const table = h.table(made.code);
  await table.hello(made.token);
  await table.hello(joined.token);
  return { code: made.code, table, tokens: [made.token, joined.token] };
}

/** Both ready, and the host starts: the match's first question is out. */
export async function startMatch(room: OpenRoom): Promise<RoomQuestion> {
  const { table } = room;
  await table.say(0, { v: 1, t: "ready", ready: true });
  await table.say(1, { v: 1, t: "ready", ready: true });
  await table.say(0, { v: 1, t: "start" });
  const question = table.last(0, "question")?.question;
  if (question === undefined) throw new Error("the match did not start");
  return question;
}

/** The right answer, from the deck the test holds: nothing the room said is trusted for it. */
export function rightPick(deck: readonly Player[], question: RoomQuestion, date: Date): Guess {
  const { round } = question;
  const challenger = deck.find((p) => p.id === round.challenger.id)!;
  return valueOf(challenger, round.stat.key, date)! > round.anchor.value ? "higher" : "lower";
}

/** The day a match started on in these tests: the harness's clock, at midnight UTC. */
export function matchDay(h: RoomHarness): Date {
  const d = new Date(h.now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** How a seat answers a question: a pick, a `timeout`, or nothing at all. */
export type Way = "right" | "wrong" | "timeout" | "none";

/**
 * One whole match from its first question: each seat answers as `way` says,
 * `think` ms apart, and a question someone left unanswered runs to its
 * deadline. Ends at full time.
 */
export async function playMatch(
  h: RoomHarness,
  room: OpenRoom,
  first: RoomQuestion,
  opts: {
    deck?: readonly Player[];
    way?: (seat: number, index: number) => Way;
    think?: number;
  } = {},
): Promise<{ questions: RoomQuestion[] }> {
  const deck = opts.deck ?? h.ctx.deck;
  const { table } = room;
  const date = matchDay(h);
  const questions: RoomQuestion[] = [];
  let question: RoomQuestion | undefined = first;
  while (question !== undefined) {
    questions.push(question);
    const index = question.round.index;
    const right = rightPick(deck, question, date);
    const mark = table.sent.length;
    for (const seat of [0, 1]) {
      const way = opts.way?.(seat, index) ?? "right";
      if (way === "none") continue;
      h.wait(opts.think ?? 1500);
      const pick: TimedGuess =
        way === "right" ? right : way === "wrong" ? wrongGuess(right) : "timeout";
      await table.say(seat, { v: 1, t: "answer", q: index, pick });
    }
    let reveal = table.inbox(0, mark).find((m) => m.t === "reveal");
    if (reveal === undefined) {
      await table.alarm();
      reveal = table.inbox(0, mark).find((m) => m.t === "reveal");
    }
    if (reveal?.t !== "reveal") throw new Error(`question ${index} was never revealed`);
    question = reveal.next;
  }
  return { questions };
}
