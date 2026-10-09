/**
 * Where Twitch Mode's chat comes from: a small seam, so the game never knows
 * how chat is read (ARCHITECTURE.md §14). The anonymous read-only source
 * (twitch-anon.ts) is the only one today; an official, login-based one
 * (EventSub) can be added later behind the same four calls without touching
 * the game. Development swaps in a fake (mock-chat.ts).
 *
 * Chat runs entirely in the streamer's browser and never reaches our server.
 */

/** One chat message: who sent it (Twitch's user id) and what it said. Nothing else is kept. */
export interface ChatMessage {
  readonly userId: string;
  readonly text: string;
}

/** Why a source couldn't join the channel at all. */
export type ChatFailure =
  /** No such channel, or one that never confirmed the join. */
  | "not_found"
  /** Twitch refused it (suspended, banned, …). */
  | "refused"
  /** Twitch's chat couldn't be reached. */
  | "unreachable";

export type ChatStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "connecting"; readonly channel: string }
  | { readonly kind: "connected"; readonly channel: string }
  /** The connection dropped; another attempt is due at `retryAt` (`Date.now()` ms). */
  | {
      readonly kind: "reconnecting";
      readonly channel: string;
      readonly attempt: number;
      readonly retryAt: number;
    }
  | { readonly kind: "failed"; readonly channel: string; readonly reason: ChatFailure };

export interface ChatSource {
  /** Joins `channel` (a normalised login, channel.ts), leaving any other first. */
  connect(channel: string): void;
  /** Every message from the joined channel. Returns an unsubscribe. */
  onMessage(listener: (message: ChatMessage) => void): () => void;
  /** Every change of status, starting with the current one. Returns an unsubscribe. */
  onStatus(listener: (status: ChatStatus) => void): () => void;
  /** Leaves and stops reconnecting. */
  close(): void;
}

/** A source's listeners, and the status it last reported: shared by every source. */
export class ChatEmitter {
  #messages = new Set<(message: ChatMessage) => void>();
  #statuses = new Set<(status: ChatStatus) => void>();
  #status: ChatStatus = { kind: "idle" };

  get status(): ChatStatus {
    return this.#status;
  }

  onMessage(listener: (message: ChatMessage) => void): () => void {
    this.#messages.add(listener);
    return () => this.#messages.delete(listener);
  }

  onStatus(listener: (status: ChatStatus) => void): () => void {
    this.#statuses.add(listener);
    listener(this.#status);
    return () => this.#statuses.delete(listener);
  }

  message(message: ChatMessage): void {
    for (const listener of this.#messages) listener(message);
  }

  setStatus(status: ChatStatus): void {
    this.#status = status;
    for (const listener of this.#statuses) listener(status);
  }
}
