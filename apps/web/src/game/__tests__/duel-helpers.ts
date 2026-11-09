/**
 * Scaffolding for 1v1's client tests: a socket that is only a record of what
 * was sent and a way to speak as the room, a clock and timers the test moves
 * by hand, the page's "you're back" events on call, and a storage that can be
 * told to refuse.
 */

import { answerAllowance } from "@bt/core";
import type {
  RoomPlayerView,
  RoomQuestion,
  RoomServerMessage,
  RoomSettings,
  RoomSnapshot,
} from "@bt/core";
import type { SeatStorage } from "../duel/session";
import { RoomSocket } from "../duel/socket";
import type { RoomSocketLike } from "../duel/socket";
import { round } from "./fixtures";

export class FakeSocket implements RoomSocketLike {
  readonly sent: string[] = [];
  closed = false;
  /** Answer the heartbeat as the platform does, for tests that aren't about it. */
  pongs = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onclose: ((event: { readonly code?: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {}

  send(data: string): void {
    if (this.closed) throw new Error("socket is closed");
    this.sent.push(data);
    if (this.pongs && data === "ping") this.onmessage?.({ data: "pong" });
  }

  close(): void {
    this.closed = true;
  }

  /** The connection opens, as the browser reports it. */
  open(): void {
    this.onopen?.();
  }

  /** The room says something. */
  say(message: RoomServerMessage | string): void {
    this.onmessage?.({ data: typeof message === "string" ? message : JSON.stringify(message) });
  }

  /** The connection drops (or the room hangs up, with one of its own codes). */
  drop(code?: number): void {
    this.closed = true;
    this.onclose?.(code === undefined ? {} : { code });
  }

  /** What was sent, as messages; the heartbeat's `ping` stays a string. */
  get messages(): unknown[] {
    return this.sent.map((raw) => {
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return raw;
      }
    });
  }
}

/** Timers and a clock moved by hand. */
export class FakeClock {
  now = 1000;
  #next = 1;
  #timers = new Map<number, { at: number; fn: () => void }>();

  readonly schedule = (fn: () => void, ms: number): (() => void) => {
    const id = this.#next++;
    this.#timers.set(id, { at: this.now + ms, fn });
    return () => this.#timers.delete(id);
  };

  get pending(): number {
    return this.#timers.size;
  }

  /** How long until the next timer fires, or null with none pending. */
  get nextIn(): number | null {
    let soonest: number | null = null;
    for (const { at } of this.#timers.values()) {
      if (soonest === null || at < soonest) soonest = at;
    }
    return soonest === null ? null : soonest - this.now;
  }

  /** Moves the clock on, firing what falls due, in order. */
  advance(ms: number): void {
    const until = this.now + ms;
    for (;;) {
      let due: [number, { at: number; fn: () => void }] | undefined;
      for (const entry of this.#timers) {
        if (entry[1].at <= until && (due === undefined || entry[1].at < due[1].at)) due = entry;
      }
      if (due === undefined) break;
      this.#timers.delete(due[0]);
      this.now = due[1].at;
      due[1].fn();
    }
    this.now = until;
  }
}

export interface Link {
  readonly socket: RoomSocket;
  readonly clock: FakeClock;
  /** Every socket opened, in order. */
  readonly sockets: FakeSocket[];
  /** The newest socket. */
  readonly last: FakeSocket;
  /** The page is back: visible again, or online again. */
  wake(): void;
  /** Whether the socket has asked to hear of the page coming back. */
  readonly listening: boolean;
  /** Makes the next sockets fail to construct. */
  failing: boolean;
}

export function link(random = 0.5): Link {
  const clock = new FakeClock();
  const sockets: FakeSocket[] = [];
  let wake: (() => void) | null = null;
  const self = {
    clock,
    sockets,
    failing: false,
    get last(): FakeSocket {
      const socket = sockets.at(-1);
      if (socket === undefined) throw new Error("no socket has been opened");
      return socket;
    },
    wake: () => wake?.(),
    get listening(): boolean {
      return wake !== null;
    },
  };
  const socket = new RoomSocket({
    socket: (url) => {
      if (self.failing) throw new Error("no network");
      const made = new FakeSocket(url);
      sockets.push(made);
      return made;
    },
    url: (code) => `wss://example.test/api/room/ws?code=${code}`,
    schedule: clock.schedule,
    now: () => clock.now,
    random: () => random,
    onWake: (fn) => {
      wake = fn;
      return () => {
        wake = null;
      };
    },
  });
  return Object.assign(self, { socket });
}

/** A storage that keeps what it is given, or throws on everything when `blocked`. */
export function fakeStorage(blocked = false): {
  readonly access: SeatStorage;
  readonly items: Map<string, string>;
  blocked: boolean;
} {
  const items = new Map<string, string>();
  const self = {
    items,
    blocked,
    access: (() => {
      if (self.blocked) throw new Error("storage is blocked");
      return {
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => void items.set(key, value),
        removeItem: (key: string) => void items.delete(key),
      };
    }) as SeatStorage,
  };
  return self;
}

export const SETTINGS: RoomSettings = { mode: "duel", pool: "endless", questions: 3, limit: 20 };

export function players(overrides: Partial<RoomPlayerView>[] = []): RoomPlayerView[] {
  return [
    { seat: 0, name: "Ada", ready: false, connected: true, ...overrides[0] },
    { seat: 1, name: "Sam", ready: false, connected: true, ...overrides[1] },
  ];
}

/**
 * Question `index` as the room sends it: the anchor has 50, so "higher" is
 * right at 80. It closes when the room's deadline says, less the network's
 * grace: the animation an honest page plays first, then the limit.
 */
export function question(
  index: number,
  match = 1,
  closesInMs = answerAllowance(index, false) + SETTINGS.limit * 1000,
): RoomQuestion {
  return {
    match,
    round: round(index, { anchorValue: 50 }),
    limitMs: SETTINGS.limit * 1000,
    closesInMs,
    suddenDeath: index > SETTINGS.questions,
  };
}

export function lobby(overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    code: "K7QM2X",
    phase: "lobby",
    settings: SETTINGS,
    players: players(),
    series: { wins: [0, 0], draws: 0 },
    ...overrides,
  };
}

export function welcome(you: number, room: RoomSnapshot = lobby()): RoomServerMessage {
  return { v: 1, t: "welcome", you, room };
}

/** A reveal of question `index`: both picks, the score after it, then the next question or the end. */
export function reveal(
  index: number,
  correct: readonly [boolean, boolean],
  scores: readonly [number, number],
  then: {
    next?: RoomQuestion;
    end?: NonNullable<Extract<RoomServerMessage, { t: "reveal" }>["end"]>;
  } = {},
  you = 0,
): Extract<RoomServerMessage, { t: "reveal" }> {
  return {
    v: 1,
    t: "reveal",
    reveal: { round: index, value: 80, display: "80", correct: correct[you] ?? false },
    picks: [correct[0] ? "higher" : "lower", correct[1] ? "higher" : "lower"],
    correct,
    scores,
    ...then,
  };
}
