/**
 * A room's messages: what the machine asked to be sent (`RoomOutput`, room.ts
 * in @bt/core), rendered for each seat it goes to.
 *
 * The only place a room's engine objects become wire data, and it builds every
 * question and reveal with payload.ts, field by field: a `Round` never leaves,
 * and a question is the `RoundPayload` every other mode sends, the
 * challenger's figure withheld (ARCHITECTURE.md §4, invariant 1).
 *
 * Two things are hidden until a question's reveal, and only `reveal` carries
 * them: the challenger's figure, and the players' picks. Before it a pick
 * shows as `locked`, the seat alone; a snapshot gives a player their own pick
 * back, never anyone else's.
 */

import { NETWORK_GRACE_MS, isSuddenDeath, roomPlayers, roomResult, roomSeries } from "@bt/core";
import type {
  Round,
  RoomClosedReason,
  RoomErrorCode,
  RoomOutput,
  RoomQuestion,
  RoomServerMessage,
  RoomSnapshot,
  RoomState,
} from "@bt/core";
import { toReveal, toRoundPayload } from "./payload.js";
import type { ImageLookup } from "./payload.js";

/** What the room's wrapper does with a step: a message for a seat, or a goodbye. */
export type Delivery =
  | { readonly kind: "send"; readonly seat: number; readonly message: RoomServerMessage }
  /** Say why, then hang up: one seat, or everyone not already told. */
  | { readonly kind: "close"; readonly seat: number | "all"; readonly reason: RoomClosedReason };

export interface RenderContext {
  readonly now: number;
  readonly images: ImageLookup;
  /** The match's rounds, dealt by the wrapper; empty when it couldn't deal them. */
  readonly rounds: readonly Round[];
  /** The match's reference date: its id's day. */
  readonly date: Date;
}

/** The seats a broadcast goes to: everyone still in the room. */
function audience(state: RoomState): number[] {
  const seats: number[] = [];
  state.seats.forEach((s, i) => {
    if (s !== null && !s.left) seats.push(i);
  });
  return seats;
}

/** The question open in `state`, as both players get it. Undefined when it can't be dealt. */
export function questionOf(state: RoomState, ctx: RenderContext): RoomQuestion | undefined {
  const match = state.match;
  if (match === null) return undefined;
  const round = ctx.rounds[match.index - 1];
  if (round === undefined) return undefined;
  const { settings } = state;
  return {
    match: match.no,
    // The round after it only lends its challenger's photo (`upcoming`), to load early.
    round: toRoundPayload(round, ctx.date, ctx.images, ctx.rounds[match.index], settings.pool),
    limitMs: settings.limit * 1000,
    closesInMs: Math.max(0, match.deadline - NETWORK_GRACE_MS - ctx.now),
    suddenDeath: isSuddenDeath(match.index, settings.questions),
  };
}

/** The whole room as `seat` sees it. */
export function snapshotFor(state: RoomState, seat: number, ctx: RenderContext): RoomSnapshot {
  const { match } = state;
  const phase = state.phase === "closed" ? "fulltime" : state.phase;
  const base = {
    code: state.code,
    phase,
    settings: state.settings,
    players: roomPlayers(state, ctx.now),
    series: roomSeries(state),
  };
  if (match === null || phase === "lobby") return base;
  const view = { no: match.no, scores: match.scores, results: match.results };
  if (phase === "fulltime") {
    const result = roomResult(state);
    return {
      ...base,
      match: view,
      ...(result !== undefined ? { result } : {}),
      rematch: state.rematch,
    };
  }
  const question = questionOf(state, ctx);
  const picked = match.picks[seat] ?? null;
  const locked: number[] = [];
  match.picks.forEach((pick, i) => {
    if (pick !== null) locked.push(i);
  });
  return {
    ...base,
    match: view,
    ...(question !== undefined ? { question } : {}),
    // Their own pick, so the page shows "Locked in" again. Never another seat's.
    ...(picked !== null ? { picked } : {}),
    locked,
  };
}

const JOIN_REFUSALS: readonly string[] = ["full", "name_taken", "closed"];

/** `out`, as messages for the seats of `state` (the room after the step). */
export function render(
  state: RoomState,
  out: readonly RoomOutput[],
  ctx: RenderContext,
): Delivery[] {
  const deliveries: Delivery[] = [];
  const everyone = audience(state);
  const broadcast = (message: RoomServerMessage): void => {
    for (const seat of everyone) deliveries.push({ kind: "send", seat, message });
  };
  for (const item of out) {
    switch (item.type) {
      case "welcome":
        deliveries.push({
          kind: "send",
          seat: item.seat,
          message: { v: 1, t: "welcome", you: item.seat, room: snapshotFor(state, item.seat, ctx) },
        });
        break;
      case "players":
        if (state.phase === "closed") break;
        broadcast({ v: 1, t: "players", phase: state.phase, players: roomPlayers(state, ctx.now) });
        break;
      case "question": {
        const question = questionOf(state, ctx);
        if (question !== undefined) broadcast({ v: 1, t: "question", question });
        break;
      }
      case "locked":
        broadcast({ v: 1, t: "locked", seat: item.seat });
        break;
      case "reveal": {
        const round = ctx.rounds[item.index - 1];
        const match = state.match;
        if (round === undefined || match === null) break;
        // A timeout was no pick: the page shows "no answer".
        const picks = item.picks.map((pick) =>
          pick === "higher" || pick === "lower" ? pick : null,
        );
        const next = item.ended ? undefined : questionOf(state, ctx);
        const result = item.ended ? roomResult(state) : undefined;
        for (const seat of everyone) {
          deliveries.push({
            kind: "send",
            seat,
            message: {
              v: 1,
              t: "reveal",
              // `correct` is the reader's own, as in every other mode's reveal.
              reveal: toReveal(round, ctx.date, item.correct[seat] === true),
              picks,
              correct: item.correct,
              scores: match.scores,
              ...(next !== undefined ? { next } : {}),
              ...(result !== undefined ? { end: { result, series: roomSeries(state) } } : {}),
            },
          });
        }
        break;
      }
      case "fulltime": {
        const result = roomResult(state);
        if (result === undefined) break;
        broadcast({
          v: 1,
          t: "fulltime",
          result,
          series: roomSeries(state),
          players: roomPlayers(state, ctx.now),
        });
        break;
      }
      case "rematch":
        broadcast({ v: 1, t: "rematch", seats: state.rematch });
        break;
      case "refused":
        // A join's refusal is its HTTP answer, not a message.
        if (item.seat === null || JOIN_REFUSALS.includes(item.code)) break;
        deliveries.push({
          kind: "send",
          seat: item.seat,
          message: { v: 1, t: "error", code: item.code as RoomErrorCode },
        });
        break;
      case "closed":
        deliveries.push({ kind: "close", seat: item.seat, reason: item.reason });
        break;
      case "joined":
      case "record":
        break;
    }
  }
  return deliveries;
}
