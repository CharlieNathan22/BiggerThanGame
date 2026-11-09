/**
 * The wire format of a multiplayer room (ARCHITECTURE.md §8, "1v1 rooms"):
 * the three HTTP calls that make, join and look at a room, and the versioned
 * messages a room's WebSocket carries. Shared by the Worker, which builds and
 * checks these, and the web app, which reads them.
 *
 * **The server sends codes and keys, never English**: every reason, status
 * and refusal is one of the unions below, and the page finds the words.
 *
 * **No message carries a hidden value before its reveal.** A question is a
 * `RoundPayload`, exactly the shape every other mode's round has: the
 * challenger's figure, and the other player's pick, arrive only in `reveal`.
 * Until then a pick shows as `locked`, the seat alone.
 *
 * Client messages are parsed strictly (`parseClientMessage`): the version, a
 * known type, exactly its keys, and a size cap. Anything else is no message.
 */

import type { Reveal, RoundPayload, TimedGuess } from "./api.js";
import type { DuelLimit, DuelPool } from "./duel.js";

/** The protocol's version: `v` on every message, both ways. */
export const ROOM_PROTOCOL = 1;

// ------------------------------------------------------------------ codes

/**
 * A room code's letters and digits: none that reads as another (no 0 or O, no
 * 1, I or L), and no vowels, so a code never spells a word.
 */
export const ROOM_CODE_ALPHABET = "23456789BCDFGHJKMNPQRSTVWXYZ";
export const ROOM_CODE_LENGTH = 6;

const ROOM_CODE = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

/** Whether `value` is a room code: six characters of the alphabet, upper case. */
export function isRoomCode(value: unknown): value is string {
  return typeof value === "string" && ROOM_CODE.test(value);
}

/** A code as typed or pasted: upper-cased, without spaces or dashes. Not yet checked. */
export function cleanRoomCode(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

/**
 * A room code from random bytes, each used only if it falls evenly on the
 * alphabet (so no character is likelier than another). Undefined when too few
 * bytes do: ask again with more.
 */
export function roomCodeFrom(bytes: ArrayLike<number>): string | undefined {
  const size = ROOM_CODE_ALPHABET.length;
  const usable = 256 - (256 % size);
  let code = "";
  for (let i = 0; i < bytes.length && code.length < ROOM_CODE_LENGTH; i++) {
    const byte = bytes[i]!;
    if (byte < usable) code += ROOM_CODE_ALPHABET[byte % size];
  }
  return code.length === ROOM_CODE_LENGTH ? code : undefined;
}

// ------------------------------------------------------------------- HTTP

/** The modes a room can play. 1v1 is the only one; Last Man Standing will add its own. */
export type RoomMode = "duel";

/** What a room plays, chosen by its host and fixed for the room's life. */
export interface RoomSettings {
  readonly mode: RoomMode;
  readonly pool: DuelPool;
  /** The match's questions, as the server capped them. */
  readonly questions: number;
  /** Seconds per question. */
  readonly limit: DuelLimit;
}

/** `POST /api/room/create`: makes a room; the caller is its host. */
export interface RoomCreateRequest {
  readonly pool: DuelPool;
  readonly questions: number;
  readonly limit: DuelLimit;
  readonly name: string;
  readonly turnstileToken: string;
}

/** A seat in a room: the code, and the signed token that holds the seat. */
export interface RoomSeatResponse {
  readonly code: string;
  /** Signed, bound to this room and this seat. Kept by the browser to come back with. */
  readonly token: string;
  readonly settings: RoomSettings;
  /** The name as stored: cleaned. */
  readonly name: string;
}

/** `POST /api/room/join`: takes the free seat in a room's lobby. */
export interface RoomJoinRequest {
  readonly code: string;
  readonly name: string;
  readonly turnstileToken: string;
}

/** `POST /api/room/peek`: what an invite link opens on, before anyone joins. */
export interface RoomPeekRequest {
  readonly code: string;
}

export type RoomPeekResponse =
  /** A lobby with a free seat. */
  | { readonly state: "open"; readonly host: string; readonly settings: RoomSettings }
  /** Every seat is taken, or a match is under way. */
  | { readonly state: "full" }
  /** No such room: never made, expired or closed. */
  | { readonly state: "closed" };

/** Why a join was refused, as the `detail` of a `409 conflict`. */
export type RoomJoinRefusal = "full" | "name_taken" | "closed";

// -------------------------------------------------------- client → server

export type RoomClientMessage =
  /** First on every connection: the seat's token. */
  | { readonly v: 1; readonly t: "hello"; readonly token: string }
  | { readonly v: 1; readonly t: "ready"; readonly ready: boolean }
  /** The host's, once everyone is connected and ready. */
  | { readonly v: 1; readonly t: "start" }
  /** A pick for question `q`, or `timeout` when the player's clock ran out. */
  | { readonly v: 1; readonly t: "answer"; readonly q: number; readonly pick: TimedGuess }
  | { readonly v: 1; readonly t: "rematch" }
  | { readonly v: 1; readonly t: "leave" };

/** The heartbeat, as plain text both ways: answered without waking the room. */
export const ROOM_PING = "ping";
export const ROOM_PONG = "pong";

/** The longest client message the server reads: a `hello` and its token, with room to spare. */
export const ROOM_MESSAGE_MAX = 1536;

/** A bound on a question number in any message: far past the longest match and its sudden death. */
export const ROOM_MAX_QUESTION = 100;

const PICKS: readonly string[] = ["higher", "lower", "timeout"];

function keysAre(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(record).sort();
  return keys.length === expected.length && keys.every((key, i) => key === expected[i]);
}

/**
 * A client message, strictly: a JSON object of the protocol's version, a known
 * type and exactly that type's keys. Undefined for anything else.
 */
export function parseClientMessage(raw: unknown): RoomClientMessage | undefined {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > ROOM_MESSAGE_MAX) {
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record["v"] !== ROOM_PROTOCOL) return undefined;
  switch (record["t"]) {
    case "hello": {
      const { token } = record;
      if (!keysAre(record, ["t", "token", "v"])) return undefined;
      if (typeof token !== "string" || token === "") return undefined;
      return { v: 1, t: "hello", token };
    }
    case "ready": {
      const { ready } = record;
      if (!keysAre(record, ["ready", "t", "v"]) || typeof ready !== "boolean") return undefined;
      return { v: 1, t: "ready", ready };
    }
    case "answer": {
      const { q, pick } = record;
      if (!keysAre(record, ["pick", "q", "t", "v"])) return undefined;
      if (typeof q !== "number" || !Number.isInteger(q) || q < 1 || q > ROOM_MAX_QUESTION) {
        return undefined;
      }
      if (typeof pick !== "string" || !PICKS.includes(pick)) return undefined;
      return { v: 1, t: "answer", q, pick: pick as TimedGuess };
    }
    case "start":
    case "rematch":
    case "leave":
      if (!keysAre(record, ["t", "v"])) return undefined;
      return { v: 1, t: record["t"] };
    default:
      return undefined;
  }
}

// -------------------------------------------------------- server → client

/** A player as everyone in the room sees them. Seat 0 is the host. */
export interface RoomPlayerView {
  readonly seat: number;
  readonly name: string;
  readonly ready: boolean;
  readonly connected: boolean;
  /**
   * In a match, for a player who has dropped: how long they have left to come
   * back before they forfeit, ms. Absent otherwise: in the lobby and at full
   * time being away has no limit.
   */
  readonly rejoinInMs?: number;
  /** They left the room, or forfeited: their seat is not coming back. */
  readonly left?: true;
}

/** One question, as both players get it at the same moment. */
export interface RoomQuestion {
  /** The match within the room, from 1: a rematch is the next. */
  readonly match: number;
  readonly round: RoundPayload;
  /** The time limit, ms: the same on every question. */
  readonly limitMs: number;
  /**
   * How long from now until the question closes for the player, ms: the
   * server's deadline less the network's grace. The page's clock never runs
   * past it.
   */
  readonly closesInMs: number;
  readonly suddenDeath: boolean;
}

/** How a match ended. */
export type MatchEndReason =
  /** Every question played, and one player ahead. */
  | "finished"
  /** Level after the last question, then decided in sudden death. */
  | "sudden-death"
  /** Still level after every sudden-death question: nobody wins. */
  | "draw"
  /** The pool ran out of questions first: the higher score wins, a level one is a draw. */
  | "exhausted"
  /** A player left, or stayed away too long: the other wins. */
  | "forfeit";

export interface RoomResult {
  /** The winner's seat, or null for a draw. */
  readonly winner: number | null;
  readonly reason: MatchEndReason;
  /** By seat. Sudden-death points count. */
  readonly scores: readonly number[];
  /** By seat, a right or wrong per question played, sudden death included. */
  readonly results: readonly (readonly boolean[])[];
  /** The match's questions before any sudden death. */
  readonly questions: number;
  /** On a forfeit: who left. */
  readonly left?: number;
}

/** The room's running score across its matches. */
export interface RoomSeries {
  /** Matches won, by seat. */
  readonly wins: readonly number[];
  readonly draws: number;
}

/** A match in play, as a player coming back to it needs it. */
export interface RoomMatchView {
  readonly no: number;
  readonly scores: readonly number[];
  readonly results: readonly (readonly boolean[])[];
}

export type RoomPhase = "lobby" | "playing" | "fulltime";

/** The whole room for one player: sent when they connect, and enough to draw any screen from. */
export interface RoomSnapshot {
  readonly code: string;
  readonly phase: RoomPhase;
  readonly settings: RoomSettings;
  readonly players: readonly RoomPlayerView[];
  readonly series: RoomSeries;
  /** In a match, and at full time. */
  readonly match?: RoomMatchView;
  /** In a match: the question on screen, with what is left of its clock. */
  readonly question?: RoomQuestion;
  /** In a match: this player's own pick on it, if they have made one. Never anyone else's. */
  readonly picked?: TimedGuess;
  /** In a match: the seats that have locked in on it. */
  readonly locked?: readonly number[];
  /** At full time. */
  readonly result?: RoomResult;
  /** At full time: the seats that have asked for a rematch. */
  readonly rematch?: readonly number[];
}

/** Why a room closed for a player. */
export type RoomClosedReason =
  /** Nothing happened in it for too long. */
  | "expired"
  /** The host left the lobby. */
  | "host-left"
  /** This player left it, or forfeited. */
  | "left"
  /** Everyone has gone. */
  | "empty"
  /** No such room. */
  | "unknown"
  /** The seat was taken over by a newer connection of the same player. */
  | "replaced";

/** Why the server refused a message. Nothing changed. */
export type RoomErrorCode =
  /** Not a message of this protocol. */
  | "bad_message"
  /** A token that isn't this room's, or isn't anyone's. */
  | "bad_token"
  /** Not now: an answer after the reveal, a second answer, a start before everyone is ready… */
  | "out_of_turn"
  /** Only the host starts a match. */
  | "not_host"
  /** Not everyone is connected and ready. */
  | "not_ready"
  /** The other player has left: no rematch. */
  | "opponent_left"
  /** Too many messages. */
  | "slow_down"
  /** The room couldn't deal a question. */
  | "unavailable";

export type RoomServerMessage =
  | {
      readonly v: 1;
      readonly t: "welcome";
      /** This connection's seat. */
      readonly you: number;
      readonly room: RoomSnapshot;
    }
  /** The players changed: someone joined, left, readied, dropped or came back. */
  | {
      readonly v: 1;
      readonly t: "players";
      readonly phase: RoomPhase;
      readonly players: readonly RoomPlayerView[];
    }
  /** A match starts: its first question. */
  | { readonly v: 1; readonly t: "question"; readonly question: RoomQuestion }
  /** A player has answered. Never which way. */
  | { readonly v: 1; readonly t: "locked"; readonly seat: number }
  /**
   * A question's answer, and everyone's picks, together: then the next
   * question, or full time.
   */
  | {
      readonly v: 1;
      readonly t: "reveal";
      /** The challenger's figure; `correct` is this player's own. */
      readonly reveal: Reveal;
      /** By seat: the pick, or null for none in time. */
      readonly picks: readonly ("higher" | "lower" | null)[];
      /** By seat. */
      readonly correct: readonly boolean[];
      /** By seat, after this question. */
      readonly scores: readonly number[];
      readonly next?: RoomQuestion;
      readonly end?: { readonly result: RoomResult; readonly series: RoomSeries };
    }
  /** A match ended without a reveal: a forfeit. */
  | {
      readonly v: 1;
      readonly t: "fulltime";
      readonly result: RoomResult;
      readonly series: RoomSeries;
      readonly players: readonly RoomPlayerView[];
    }
  /** Who has asked for a rematch so far. */
  | { readonly v: 1; readonly t: "rematch"; readonly seats: readonly number[] }
  | { readonly v: 1; readonly t: "closed"; readonly reason: RoomClosedReason }
  | { readonly v: 1; readonly t: "error"; readonly code: RoomErrorCode };

/**
 * WebSocket close codes of the room's own (4000–4999 are an application's):
 * the page tells a seat taken over or a closed room from a dropped connection,
 * which it reconnects.
 */
export const ROOM_CLOSE = {
  /** The room is closed for this player: don't come back. */
  closed: 4000,
  /** A newer connection has this seat. */
  replaced: 4001,
  /** No valid `hello`, or too many bad messages. */
  refused: 4002,
} as const;
