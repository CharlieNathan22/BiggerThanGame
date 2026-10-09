/**
 * A fake Twitch chat for local testing (`pnpm dev` only): `?mockChat=1` on the
 * Twitch Mode page swaps the anonymous source for this one (ARCHITECTURE.md
 * §14). It "joins" any channel, then streams votes from a crowd of made-up
 * viewers:
 *
 *   ?mockChat=1&viewers=50&split=70&fickle=10&spam=20
 *
 * `viewers` how many (default 50), `split` the share leaning higher, in % (70),
 * `fickle` the chance a viewer changes their mind on a later vote, in % (10),
 * and `spam` the share of lines that aren't votes at all, in % (20). Each
 * viewer votes about once every few seconds.
 *
 * `window.__btDropChat()` (and the dev panel's "drop chat" button) cuts the
 * connection, to watch the page reconnect.
 *
 * Loaded by a dynamic import behind `import.meta.env.DEV`, so a production
 * build drops it; `scan:dist` fails if its marker ever ships.
 */

import { ChatEmitter } from "./chat-source";
import type { ChatMessage, ChatSource, ChatStatus } from "./chat-source";

export interface MockChatOptions {
  readonly viewers: number;
  /** % of viewers leaning higher. */
  readonly split: number;
  /** % chance a viewer's later vote changes their mind. */
  readonly fickle: number;
  /** % of lines that aren't votes. */
  readonly spam: number;
}

const DEFAULTS: MockChatOptions = { viewers: 50, split: 70, fickle: 10, spam: 20 };

/** How often the fake chat speaks, and how long a drop lasts. */
const TICK_MS = 100;
const JOIN_MS = 400;
const DROP_MS = 2500;

const SPAM = [
  "lol",
  "PogChamp",
  "no way",
  "hi chat",
  "!h!",
  "h",
  "higher??",
  "this is close",
  "!hh",
  "l",
];

/** The options `?mockChat=1` asks for, or null when it isn't asked for. */
export function mockChatOptions(search: string): MockChatOptions | null {
  const params = new URLSearchParams(search);
  if (params.get("mockChat") !== "1") return null;
  const pick = (name: keyof MockChatOptions, max: number): number => {
    const raw = Number(params.get(name));
    return params.has(name) && Number.isFinite(raw) && raw >= 0
      ? Math.min(raw, max)
      : DEFAULTS[name];
  };
  return {
    viewers: Math.round(pick("viewers", 100_000)),
    split: pick("split", 100),
    fickle: pick("fickle", 100),
    spam: pick("spam", 95),
  };
}

export class MockChat implements ChatSource {
  readonly #options: MockChatOptions;
  readonly #emitter = new ChatEmitter();
  readonly #random: () => number;
  /** Each viewer's lean and last vote. */
  readonly #leans: boolean[];
  #timer: ReturnType<typeof setInterval> | null = null;
  #pending: ReturnType<typeof setTimeout> | null = null;
  #channel = "";

  constructor(options: MockChatOptions, random: () => number = Math.random) {
    this.#options = options;
    this.#random = random;
    this.#leans = Array.from({ length: options.viewers }, () => random() * 100 < options.split);
  }

  connect(channel: string): void {
    this.#stop();
    this.#channel = channel;
    this.#emitter.setStatus({ kind: "connecting", channel });
    this.#pending = setTimeout(() => this.#join(), JOIN_MS);
  }

  onMessage(listener: (message: ChatMessage) => void): () => void {
    return this.#emitter.onMessage(listener);
  }

  onStatus(listener: (status: ChatStatus) => void): () => void {
    return this.#emitter.onStatus(listener);
  }

  close(): void {
    this.#stop();
    this.#emitter.setStatus({ kind: "idle" });
  }

  /** Cuts the connection; it comes back after a short backoff, as the real one would. */
  drop(): void {
    if (this.#channel === "") return;
    this.#stop();
    this.#emitter.setStatus({
      kind: "reconnecting",
      channel: this.#channel,
      attempt: 1,
      retryAt: Date.now() + DROP_MS,
    });
    this.#pending = setTimeout(() => this.connect(this.#channel), DROP_MS);
  }

  #join(): void {
    this.#emitter.setStatus({ kind: "connected", channel: this.#channel });
    // Every viewer votes about once every four seconds, spread over the ticks.
    const perTick = Math.max(1, Math.round((this.#options.viewers * TICK_MS) / 4000));
    this.#timer = setInterval(() => {
      for (let i = 0; i < perTick; i++) this.#speak();
    }, TICK_MS);
  }

  #speak(): void {
    const { viewers, fickle, spam } = this.#options;
    if (viewers === 0) return;
    const viewer = Math.floor(this.#random() * viewers);
    const userId = String(100_000 + viewer);
    if (this.#random() * 100 < spam) {
      const text = SPAM[Math.floor(this.#random() * SPAM.length)] ?? "lol";
      this.#emitter.message({ userId, text });
      return;
    }
    if (this.#random() * 100 < fickle) this.#leans[viewer] = !this.#leans[viewer];
    const higher = this.#leans[viewer] === true;
    const forms = higher ? ["!h", "!higher", "higher", "!H"] : ["!l", "!lower", "lower", "LOWER"];
    this.#emitter.message({
      userId,
      text: forms[Math.floor(this.#random() * forms.length)] ?? "!h",
    });
  }

  #stop(): void {
    if (this.#timer !== null) clearInterval(this.#timer);
    if (this.#pending !== null) clearTimeout(this.#pending);
    this.#timer = null;
    this.#pending = null;
  }
}

declare global {
  interface Window {
    /** `pnpm dev` only: cuts the fake chat's connection. */
    __btDropChat?: () => void;
  }
}

/** The fake chat, with its drop hook on `window` for the dev panel and headless checks. */
export function mountMockChat(options: MockChatOptions): MockChat {
  const chat = new MockChat(options);
  window.__btDropChat = () => chat.drop();
  return chat;
}
