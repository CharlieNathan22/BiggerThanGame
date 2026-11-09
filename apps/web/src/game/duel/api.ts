/**
 * Getting a seat in a 1v1 room (ARCHITECTURE.md §8, "1v1 rooms"): making one
 * (`POST /api/room/create`), joining one (`POST /api/room/join`), and looking
 * at one before either (`POST /api/room/peek`). Create and join each carry a
 * fresh Turnstile token, as every run start does. Playing is the room's
 * WebSocket (socket.ts, client.ts).
 *
 * Also the room's addresses: the invite link people share
 * (`/…/multiplayer/1v1?room=K7QM2X`), the code read back out of it, and the
 * socket's URL.
 */

import { cleanRoomCode, isRoomCode } from "@bt/core";
import type {
  DuelLength,
  DuelLimit,
  DuelPool,
  RoomCreateRequest,
  RoomJoinRequest,
  RoomPeekRequest,
  RoomPeekResponse,
  RoomSeatResponse,
} from "@bt/core";
import { DUEL_PATH } from "../../lib/paths";
import { ApiFailure, REQUEST_TIMEOUT_MS, jsonPoster } from "../api";
import type { Fetch } from "../api";

export const ROOM_CREATE_ENDPOINT = "/api/room/create";
export const ROOM_JOIN_ENDPOINT = "/api/room/join";
export const ROOM_PEEK_ENDPOINT = "/api/room/peek";
export const ROOM_SOCKET_ENDPOINT = "/api/room/ws";

/** The invite link's query parameter. */
export const ROOM_PARAM = "room";

/** What a room is made with. */
export interface RoomSetup {
  readonly pool: DuelPool;
  readonly questions: DuelLength;
  readonly limit: DuelLimit;
  readonly name: string;
}

export interface RoomApi {
  create(setup: RoomSetup): Promise<RoomSeatResponse>;
  join(code: string, name: string): Promise<RoomSeatResponse>;
  peek(code: string): Promise<RoomPeekResponse>;
}

export function createRoomApi(
  fetchFn: Fetch,
  checkHuman: () => Promise<string>,
  timeoutMs = REQUEST_TIMEOUT_MS,
): RoomApi {
  const post = jsonPoster(fetchFn, timeoutMs);
  const human = async (): Promise<string> => {
    try {
      return await checkHuman();
    } catch {
      throw new ApiFailure(0, "turnstile");
    }
  };
  return {
    async create({ pool, questions, limit, name }) {
      const turnstileToken = await human();
      const body: RoomCreateRequest = { pool, questions, limit, name, turnstileToken };
      return post<RoomSeatResponse>(ROOM_CREATE_ENDPOINT, body);
    },
    async join(code, name) {
      const turnstileToken = await human();
      const body: RoomJoinRequest = { code, name, turnstileToken };
      return post<RoomSeatResponse>(ROOM_JOIN_ENDPOINT, body);
    },
    peek(code) {
      const body: RoomPeekRequest = { code };
      return post<RoomPeekResponse>(ROOM_PEEK_ENDPOINT, body);
    },
  };
}

/**
 * Why a seat wasn't had, as far as the page can say it: the name (taken in
 * this room, or not allowed), the room (full, or gone), the human check, a
 * limit to wait out, or nothing it can name.
 */
export type SeatProblem =
  "nameTaken" | "nameRejected" | "full" | "closed" | "verification" | "slowDown" | "failed";

export function seatProblem(err: unknown): SeatProblem {
  if (!(err instanceof ApiFailure)) return "failed";
  if (err.status === 409) {
    if (err.detail === "name_taken") return "nameTaken";
    if (err.detail === "full") return "full";
    if (err.detail === "closed") return "closed";
  }
  if (err.status === 422 && err.code === "nickname_rejected") return "nameRejected";
  if (err.status === 400 && err.detail?.startsWith("nickname_") === true) return "nameRejected";
  if (err.code === "turnstile" || err.code === "verification_failed") return "verification";
  if (err.status === 429) return "slowDown";
  return "failed";
}

/** The room code an invite link carries, or one typed in: cleaned, or null when it isn't one. */
export function roomCodeOf(raw: string): string | null {
  const code = cleanRoomCode(raw);
  return isRoomCode(code) ? code : null;
}

/** The code in the page's address (`?room=K7QM2X`), or null. */
export function roomFromQuery(search: string): string | null {
  const raw = new URLSearchParams(search).get(ROOM_PARAM);
  return raw === null ? null : roomCodeOf(raw);
}

/** The invite link: the 1v1 page with the room's code. `site` has no trailing slash. */
export function inviteLink(site: string, code: string): string {
  return `${site}${DUEL_PATH}?${ROOM_PARAM}=${code}`;
}

/** The page's address with the room's code in it, and without: what a refresh comes back to. */
export function withRoom(search: string, code: string | null): string {
  const params = new URLSearchParams(search);
  if (code === null) params.delete(ROOM_PARAM);
  else params.set(ROOM_PARAM, code);
  const rest = params.toString();
  return rest === "" ? "" : `?${rest}`;
}

/** The room's WebSocket address, on the page's own host. */
export function socketUrl(location: { protocol: string; host: string }, code: string): string {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${location.host}${ROOM_SOCKET_ENDPOINT}?code=${code}`;
}
