/**
 * Twitch chat, read anonymously (ARCHITECTURE.md §14): the public chat
 * WebSocket with a guest login, `justinfan` and a number. No token, no OAuth,
 * no Twitch app, nothing sent but the login and the join. It runs in the
 * streamer's browser only; nothing it reads reaches our server.
 *
 * - **Joined** only once Twitch confirms the channel (`ROOMSTATE`). A join it
 *   never confirms within `JOIN_TIMEOUT_MS` reads as no such channel; one it
 *   refuses (a `NOTICE`, suspended or banned) says so. Neither retries.
 * - **Dropped** connections reconnect with exponential backoff and jitter
 *   (`BACKOFF`), for as long as the page is open, and Twitch's own
 *   `RECONNECT` is followed at once. A source that has never got through
 *   gives up after `GIVE_UP_ATTEMPTS` and says Twitch can't be reached.
 * - **Fast**: a busy chat sends thousands of lines a minute. A line whose text
 *   is longer than any command (`LONGEST_COMMAND`) is dropped before its tags
 *   are read, so most cost a couple of `indexOf`s.
 *
 * The socket, the timers, the clock and the randomness are injected, so the
 * tests drive it with a fake socket.
 */

import { ChatEmitter } from "./chat-source";
import type { ChatFailure, ChatMessage, ChatSource, ChatStatus } from "./chat-source";
import { LONGEST_COMMAND } from "./commands";

export const TWITCH_CHAT_URL = "wss://irc-ws.chat.twitch.tv:443";

/** Reconnect delays: the first, doubling each time, up to the most; ±20% jitter on each. */
export const BACKOFF = { firstMs: 1000, maxMs: 30_000, jitter: 0.2 } as const;

/** How long Twitch has to confirm a join before the channel reads as not found. */
export const JOIN_TIMEOUT_MS = 10_000;

/** Attempts before a source that has never got through says Twitch can't be reached. */
export const GIVE_UP_ATTEMPTS = 4;

/** The part of a `WebSocket` the source uses. */
export interface SocketLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

export interface AnonymousChatDeps {
  readonly socket: (url: string) => SocketLike;
  /** Runs `fn` after `ms`; returns a cancel function. */
  readonly schedule: (fn: () => void, ms: number) => () => void;
  /** Wall-clock ms, for `retryAt`. */
  readonly now: () => number;
  /** In [0, 1): the guest number and the jitter. */
  readonly random: () => number;
}

/** The delay before reconnect attempt `attempt` (0-based), with `random` in [0, 1) for jitter. */
export function backoffDelay(attempt: number, random: number): number {
  const base = Math.min(BACKOFF.firstMs * 2 ** attempt, BACKOFF.maxMs);
  return Math.round(base * (1 - BACKOFF.jitter + 2 * BACKOFF.jitter * random));
}

/** A `NOTICE` that refuses the join, by its `msg-id`. */
const REFUSALS = new Set(["msg_channel_suspended", "msg_banned", "msg_channel_blocked", "tos_ban"]);

export class AnonymousTwitchChat implements ChatSource {
  readonly #deps: AnonymousChatDeps;
  readonly #emitter = new ChatEmitter();
  #socket: SocketLike | null = null;
  #channel = "";
  /** Failed attempts in a row since the last successful join. */
  #attempt = 0;
  #everJoined = false;
  #cancelTimer: (() => void) | null = null;
  /** Bumped on every connect and close: a stale socket's events are ignored. */
  #generation = 0;

  constructor(deps: AnonymousChatDeps) {
    this.#deps = deps;
  }

  connect(channel: string): void {
    this.#shut();
    this.#channel = channel;
    this.#attempt = 0;
    this.#everJoined = false;
    this.#open();
  }

  onMessage(listener: (message: ChatMessage) => void): () => void {
    return this.#emitter.onMessage(listener);
  }

  onStatus(listener: (status: ChatStatus) => void): () => void {
    return this.#emitter.onStatus(listener);
  }

  close(): void {
    this.#shut();
    this.#emitter.setStatus({ kind: "idle" });
  }

  #open(): void {
    const generation = this.#generation;
    const channel = this.#channel;
    if (this.#emitter.status.kind !== "reconnecting") {
      this.#emitter.setStatus({ kind: "connecting", channel });
    }
    let socket: SocketLike;
    try {
      socket = this.#deps.socket(TWITCH_CHAT_URL);
    } catch {
      this.#dropped(generation);
      return;
    }
    this.#socket = socket;
    socket.onopen = () => {
      if (generation !== this.#generation) return;
      const guest = `justinfan${10000 + Math.floor(this.#deps.random() * 89999)}`;
      socket.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
      socket.send("PASS SCHMOOPIIE");
      socket.send(`NICK ${guest}`);
      socket.send(`JOIN #${channel}`);
      this.#timer(JOIN_TIMEOUT_MS, () => this.#fail("not_found"));
    };
    socket.onmessage = (event) => {
      if (generation !== this.#generation || typeof event.data !== "string") return;
      for (const line of event.data.split("\r\n")) if (line !== "") this.#line(line);
    };
    socket.onclose = () => this.#dropped(generation);
    // A close always follows an error; that's where it's handled.
    socket.onerror = () => {};
  }

  #line(line: string): void {
    // Most lines are chat: the fast path reads only what a vote needs.
    const privmsg = line.indexOf(" PRIVMSG #");
    if (privmsg !== -1) {
      const start = line.indexOf(" :", privmsg + 10);
      if (start === -1) return;
      const text = line.slice(start + 2);
      if (text.trim().length > LONGEST_COMMAND) return;
      const userId = tag(line, "user-id");
      if (userId !== "") this.#emitter.message({ userId, text });
      return;
    }
    if (line.startsWith("PING")) {
      this.#socket?.send(`PONG${line.slice(4)}`);
      return;
    }
    const command = commandOf(line);
    if (command === "ROOMSTATE") {
      this.#clearTimer();
      this.#attempt = 0;
      this.#everJoined = true;
      this.#emitter.setStatus({ kind: "connected", channel: this.#channel });
    } else if (command === "RECONNECT") {
      // Twitch is restarting the server: go again now rather than wait to be cut off.
      this.#attempt = 0;
      this.#socket?.close();
    } else if (command === "NOTICE") {
      const id = tag(line, "msg-id");
      if (REFUSALS.has(id) || /Login (unsuccessful|authentication failed)/i.test(line)) {
        this.#fail("refused");
      }
    }
  }

  /** The socket closed: reconnect after the backoff, or give up if it never got through. */
  #dropped(generation: number): void {
    if (generation !== this.#generation) return;
    this.#socket = null;
    this.#clearTimer();
    if (!this.#everJoined && this.#attempt + 1 >= GIVE_UP_ATTEMPTS) {
      this.#fail("unreachable");
      return;
    }
    const delay = backoffDelay(this.#attempt, this.#deps.random());
    this.#attempt += 1;
    this.#emitter.setStatus({
      kind: "reconnecting",
      channel: this.#channel,
      attempt: this.#attempt,
      retryAt: this.#deps.now() + delay,
    });
    this.#timer(delay, () => this.#open());
  }

  #fail(reason: ChatFailure): void {
    const channel = this.#channel;
    this.#shut();
    this.#emitter.setStatus({ kind: "failed", channel, reason });
  }

  /** Closes the socket and cancels the timer, ignoring anything the old socket says after. */
  #shut(): void {
    this.#generation += 1;
    this.#clearTimer();
    const socket = this.#socket;
    this.#socket = null;
    try {
      socket?.close();
    } catch {
      // Already closed.
    }
  }

  #timer(ms: number, fn: () => void): void {
    this.#clearTimer();
    const generation = this.#generation;
    this.#cancelTimer = this.#deps.schedule(() => {
      this.#cancelTimer = null;
      if (generation === this.#generation) fn();
    }, ms);
  }

  #clearTimer(): void {
    this.#cancelTimer?.();
    this.#cancelTimer = null;
  }
}

/** A tag's value from an IRC line's `@a=b;c=d` prefix; "" when absent. */
export function tag(line: string, name: string): string {
  if (!line.startsWith("@")) return "";
  const end = line.indexOf(" ");
  const tags = end === -1 ? line : line.slice(0, end);
  const key = `${name}=`;
  let at = tags.indexOf(key);
  while (at !== -1 && at !== 1 && tags[at - 1] !== ";") at = tags.indexOf(key, at + 1);
  if (at === -1) return "";
  const from = at + key.length;
  const stop = tags.indexOf(";", from);
  return tags.slice(from, stop === -1 ? tags.length : stop);
}

/** The command word of an IRC line, past its tags and prefix. */
export function commandOf(line: string): string {
  let rest = line;
  if (rest.startsWith("@")) rest = rest.slice(rest.indexOf(" ") + 1);
  if (rest.startsWith(":")) rest = rest.slice(rest.indexOf(" ") + 1);
  const space = rest.indexOf(" ");
  return space === -1 ? rest : rest.slice(0, space);
}

/** The anonymous source over the browser's own WebSocket and timers. */
export function browserTwitchChat(): AnonymousTwitchChat {
  return new AnonymousTwitchChat({
    socket: (url) => new WebSocket(url) as unknown as SocketLike,
    schedule: (fn, ms) => {
      const id = setTimeout(fn, ms);
      return () => clearTimeout(id);
    },
    now: () => Date.now(),
    random: () => Math.random(),
  });
}
