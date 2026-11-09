/**
 * A player's seat in a 1v1 room, kept on this device: the room's signed token
 * under `bt:room:<code>` in `localStorage`. It is what brings a player back to
 * their own seat: after a refresh, a dropped connection, the invite link opened
 * again in a new tab, or a phone's browser having killed the tab. Without it
 * the room would only see a third player and say it is full.
 *
 * `localStorage`, not `sessionStorage`: a new tab has to find it. It is
 * cleared when the room closes, when the player leaves or forfeits, and when
 * the room refuses it, so it never outlives the seat it holds.
 *
 * Storage can be missing, blocked or full (private browsing, a locked-down
 * browser), so every read and write is wrapped. When it fails, the seat lasts
 * as long as the page does, kept in memory, and the game plays the same.
 */

/** How the store reaches storage. Returns null, or throws, when there is none. */
export type SeatStorage = () => Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;

/** The storage key for a room's seat. */
export function seatKey(code: string): string {
  return `bt:room:${code}`;
}

/** Far past a real token (about 200 characters); anything longer isn't one. */
const MAX_TOKEN_CHARS = 1024;

export interface SeatStore {
  /** The token kept for the room with this code, or null. */
  read(code: string): string | null;
  save(code: string, token: string): void;
  clear(code: string): void;
}

export function createSeatStore(storage: SeatStorage): SeatStore {
  /** What storage wouldn't take, for this page's life. */
  const memory = new Map<string, string>();
  return {
    read(code) {
      try {
        const kept = storage()?.getItem(seatKey(code));
        if (typeof kept === "string" && kept !== "" && kept.length <= MAX_TOKEN_CHARS) return kept;
      } catch {
        // Fall through to what this page remembers.
      }
      return memory.get(code) ?? null;
    },
    save(code, token) {
      memory.set(code, token);
      try {
        storage()?.setItem(seatKey(code), token);
      } catch {
        // Kept in memory: it lasts the visit.
      }
    },
    clear(code) {
      memory.delete(code);
      try {
        storage()?.removeItem(seatKey(code));
      } catch {
        // Nothing was kept there to clear.
      }
    },
  };
}
